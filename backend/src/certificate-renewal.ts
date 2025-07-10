import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Logger } from './logger';
import { DatabaseManager } from './database';
import { ConnectionRecord } from './types';
import { accountManager, AccountManager } from './account-manager';

export interface RenewalStatus {
  id: string;
  connectionId: number;
  status: 'pending' | 'generating_csr' | 'creating_account' | 'requesting_certificate' | 'creating_dns_challenge' | 'waiting_dns_propagation' | 'completing_validation' | 'downloading_certificate' | 'uploading_certificate' | 'completed' | 'failed';
  message: string;
  progress: number;
  startTime: Date;
  endTime?: Date;
  error?: string;
  logs: string[];
}

export interface CertificateRenewalService {
  renewCertificate(connectionId: number, database: DatabaseManager): Promise<RenewalStatus>;
  getRenewalStatus(renewalId: string): RenewalStatus | null;
}

class CertificateRenewalServiceImpl implements CertificateRenewalService {
  private renewalStatuses: Map<string, RenewalStatus> = new Map();

  async renewCertificate(connectionId: number, database: DatabaseManager): Promise<RenewalStatus> {
    const renewalId = crypto.randomUUID();
    const status: RenewalStatus = {
      id: renewalId,
      connectionId,
      status: 'pending',
      message: 'Starting certificate renewal process',
      progress: 0,
      startTime: new Date(),
      logs: []
    };

    this.renewalStatuses.set(renewalId, status);
    Logger.info(`Created renewal status with ID: ${renewalId} for connection ${connectionId}`);

    // Start the renewal process asynchronously
    this.performRenewal(renewalId, connectionId, database).catch(error => {
      Logger.error(`Certificate renewal failed for connection ${connectionId}:`, error);
      status.status = 'failed';
      status.error = error.message;
      status.message = 'Certificate renewal failed';
      status.endTime = new Date();
    });

    return status;
  }

  getRenewalStatus(renewalId: string): RenewalStatus | null {
    Logger.info(`Looking for renewal status ID: ${renewalId}`);
    Logger.info(`Available renewal IDs: ${Array.from(this.renewalStatuses.keys()).join(', ')}`);
    return this.renewalStatuses.get(renewalId) || null;
  }

  private async performRenewal(renewalId: string, connectionId: number, database: DatabaseManager): Promise<void> {
    const status = this.renewalStatuses.get(renewalId)!;
    
    try {
      // Get connection details
      const connection = await database.getConnectionById(connectionId);
      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      this.updateStatus(status, 'generating_csr', 'Generating CSR from CUCM server', 10);
      
      // Step 1: Generate CSR from CUCM
      const csr = await this.generateCSRFromCUCM(connection, status);
      
      // Now continue with Let's Encrypt certificate request
      this.updateStatus(status, 'requesting_certificate', 'Requesting certificate from Let\'s Encrypt', 20);
      const certificate = await this.requestCertificate(connection, csr, database, status);
      
      this.updateStatus(status, 'uploading_certificate', 'Uploading certificate to CUCM', 90);
      await this.uploadCertificateToCUCM(connection, certificate, status);
      
      this.updateStatus(status, 'completed', 'Certificate renewal completed successfully', 100);
      status.endTime = new Date();
      
      // Save the renewal completion info
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      await accountManager.saveRenewalLog(fullFQDN, `Certificate renewal completed for renewal ${renewalId}`);
      
      // Update database with renewal info
      await this.updateDatabaseWithRenewal(connectionId, database);
      
    } catch (error) {
      Logger.error(`Certificate renewal error for ${renewalId}:`, error);
      status.status = 'failed';
      status.error = error instanceof Error ? error.message : 'Unknown error';
      status.message = 'Certificate renewal failed';
      status.endTime = new Date();
      status.logs.push(`ERROR: ${status.error}`);
    }
  }

  private updateStatus(status: RenewalStatus, newStatus: RenewalStatus['status'], message: string, progress: number): void {
    status.status = newStatus;
    status.message = message;
    status.progress = progress;
    status.logs.push(`${new Date().toISOString()}: ${message}`);
    Logger.info(`Renewal ${status.id}: ${message}`);
  }

  private async generateCSRFromCUCM(connection: ConnectionRecord, status: RenewalStatus): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        // Construct full FQDN from hostname and domain
        const fullFQDN = `${connection.hostname}.${connection.domain}`;
        
        // Check if we have an existing CSR
        const existingCSR = await accountManager.loadCSR(fullFQDN);
        if (existingCSR) {
          status.logs.push(`Using existing CSR for ${fullFQDN}`);
          await accountManager.saveRenewalLog(fullFQDN, `Using existing CSR for renewal`);
          resolve(existingCSR);
          return;
        }

        const authHeader = `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`;
        Logger.info(connection.password)
        Logger.info(`Using Authorization header: ${authHeader}`);
        
        // Parse altNames from comma-separated string
        const altNames = connection.alt_names 
          ? connection.alt_names.split(',').map(name => name.trim()).filter(name => name.length > 0)
          : [];

        const csrPayload = {
          'service': 'tomcat',
          'distribution': 'this-server',
          'commonName': fullFQDN,
          'keyType': 'rsa',
          'keyLength': 2048,
          'hashAlgorithm': 'sha256',
          ...(altNames.length > 0 && { 'altNames': altNames })
        };

        const options = {
          hostname: fullFQDN,
          port: 443,
          path: '/platformcom/api/v1/certmgr/config/csr',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(JSON.stringify(csrPayload))
          },
          rejectUnauthorized: false,
          timeout: 30000
        };

        const postData = JSON.stringify(csrPayload);

        Logger.info(`Sending CSR request to ${fullFQDN}:${options.port}${options.path}`);
        Logger.info(`CSR Request Body: ${postData}`);
        Logger.info(`Using credentials for user: ${connection.username}`);
        
        // Test basic connectivity first
        Logger.info(`Testing CUCM connectivity and authentication...`);
        
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', async () => {
            try {
              Logger.info(`CSR API Response Status: ${res.statusCode}`);
              Logger.info(`CSR API Response Body: ${data}`);
              
              if (res.statusCode !== 200) {
                reject(new Error(`CSR API returned status ${res.statusCode}: ${data}`));
                return;
              }
              
              const response = JSON.parse(data);
              if (response.csr) {
                // Save CSR to accounts folder
                await accountManager.saveCSR(fullFQDN, response.csr);
                await accountManager.saveRenewalLog(fullFQDN, `Generated new CSR from ${fullFQDN} for service: tomcat`);
                
                status.logs.push(`CSR generated successfully from ${fullFQDN} for service: tomcat`);
                resolve(response.csr);
              } else {
                reject(new Error(`CSR not found in response. Response: ${JSON.stringify(response)}`));
              }
            } catch (error) {
              reject(new Error(`Failed to parse CSR response: ${error}. Raw response: ${data}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(new Error(`CSR generation failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private async requestCertificate(connection: ConnectionRecord, csr: string, database: DatabaseManager, status: RenewalStatus): Promise<string> {
    // Get SSL provider settings
    const sslProvider = connection.ssl_provider || 'letsencrypt';
    const settings = await database.getSettingsByProvider(sslProvider);
    
    if (sslProvider === 'letsencrypt') {
      return this.requestLetsEncryptCertificate(connection, csr, settings, database, status);
    } else if (sslProvider === 'zerossl') {
      return this.requestZeroSSLCertificate(connection, csr, settings, status);
    } else {
      throw new Error(`Unsupported SSL provider: ${sslProvider}`);
    }
  }

  private async requestLetsEncryptCertificate(connection: ConnectionRecord, csr: string, settings: any[], database: DatabaseManager, status: RenewalStatus): Promise<string> {
    try {
      const { acmeClient } = await import('./acme-client');
      const CloudflareProvider = (await import('./dns-providers/cloudflare')).default;
      
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      
      // Parse altNames from connection
      const altNames = connection.alt_names 
        ? connection.alt_names.split(',').map(name => name.trim()).filter(name => name.length > 0)
        : [];
      
      const domains = [fullFQDN, ...altNames];
      
      this.updateStatus(status, 'creating_account', 'Setting up Let\'s Encrypt account', 20);
      
      // Get or create ACME account
      let account = await acmeClient.loadAccount(fullFQDN);
      if (!account) {
        Logger.info('No existing account found, creating new account');
        const email = settings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
        if (!email) {
          throw new Error('Let\'s Encrypt email not configured in settings. Please add LETSENCRYPT_EMAIL to your settings.');
        }
        Logger.info(`Creating new Let's Encrypt account with email: ${email}`);
        account = await acmeClient.createAccount(email, fullFQDN);
      } else {
        Logger.info(`Using existing account for domain: ${fullFQDN}`);
      }
      
      this.updateStatus(status, 'requesting_certificate', 'Requesting certificate from Let\'s Encrypt', 30);
      
      // Create certificate order
      const order = await acmeClient.requestCertificate(csr, domains);
      
      this.updateStatus(status, 'creating_dns_challenge', 'Setting up DNS challenges', 40);
      
      // Initialize Cloudflare provider
      const cloudflare = await CloudflareProvider.create(database, fullFQDN);
      
      // Create DNS TXT records for challenges
      const dnsRecords: any[] = [];
      
      for (const challenge of order.challenges) {
        const keyAuthorization = await acmeClient.getChallengeKeyAuthorization(challenge);
        const dnsValue = acmeClient.getDNSRecordValue(keyAuthorization);
        
        // Extract domain from challenge
        const challengeDomain = challenge.url.includes('identifier') 
          ? domains.find(d => challenge.url.includes(d)) || domains[0]
          : domains[0];
        
        const record = await cloudflare.createTxtRecord(challengeDomain, dnsValue);
        dnsRecords.push({ record, challenge, domain: challengeDomain });
        
        status.logs.push(`Created DNS TXT record for ${challengeDomain}: ${record.id}`);
      }
      
      this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation', 50);
      
      // Wait for DNS propagation
      for (const { record, challenge, domain } of dnsRecords) {
        const keyAuthorization = await acmeClient.getChallengeKeyAuthorization(challenge);
        const expectedValue = acmeClient.getDNSRecordValue(keyAuthorization);
        
        const isVerified = await cloudflare.verifyTxtRecord(domain, expectedValue);
        if (!isVerified) {
          throw new Error(`DNS propagation verification failed for ${domain}`);
        }
        
        status.logs.push(`DNS propagation verified for ${domain}`);
      }
      
      this.updateStatus(status, 'completing_validation', 'Completing Let\'s Encrypt validation', 70);
      
      // Complete challenges
      for (const { challenge } of dnsRecords) {
        await acmeClient.completeChallenge(challenge);
      }
      
      // Add delay to ensure Let's Encrypt processes the completed challenges
      Logger.info('Waiting for Let\'s Encrypt to process challenge completion...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for order completion
      const completedOrder = await acmeClient.waitForOrderCompletion(order.order);
      
      this.updateStatus(status, 'downloading_certificate', 'Downloading certificate', 80);
      
      // Finalize and get certificate
      const certificate = await acmeClient.finalizeCertificate(completedOrder, csr);
      
      // Clean up DNS records - skip in staging mode for debugging
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      if (!isStaging || process.env.LETSENCRYPT_CLEANUP_DNS === 'true') {
        for (const { record } of dnsRecords) {
          try {
            await cloudflare.deleteTxtRecord(record.id);
            status.logs.push(`Cleaned up DNS TXT record: ${record.id}`);
          } catch (error) {
            Logger.warn(`Failed to clean up DNS record ${record.id}:`, error);
          }
        }
      } else {
        Logger.info(`Skipping DNS record cleanup in staging mode (${dnsRecords.length} records)`);
        status.logs.push(`Skipped DNS cleanup in staging mode for debugging`);
      }
      
      // Save certificate and chain to accounts folder
      await this.saveCertificateFiles(fullFQDN, certificate, status);
      
      status.logs.push('Certificate obtained from Let\'s Encrypt');
      return certificate;
      
    } catch (error) {
      Logger.error('Let\'s Encrypt certificate request failed:', error);
      throw error;
    }
  }

  private async requestZeroSSLCertificate(connection: ConnectionRecord, csr: string, settings: any[], status: RenewalStatus): Promise<string> {
    // This would integrate with ZeroSSL API
    status.logs.push('Requesting certificate from ZeroSSL');
    
    // TODO: Implement ZeroSSL API integration
    return new Promise((resolve, reject) => {
      // Placeholder implementation
      setTimeout(() => {
        status.logs.push('Certificate obtained from ZeroSSL');
        resolve('-----BEGIN CERTIFICATE-----\n...certificate data...\n-----END CERTIFICATE-----');
      }, 2000);
    });
  }

  private async handleDNSChallenge(connection: ConnectionRecord, database: DatabaseManager, status: RenewalStatus): Promise<void> {
    const dnsProvider = connection.dns_provider || 'cloudflare';
    const settings = await database.getSettingsByProvider(dnsProvider);
    
    if (dnsProvider === 'cloudflare') {
      await this.handleCloudflareChallenge(connection, settings, status);
    } else if (dnsProvider === 'digitalocean') {
      await this.handleDigitalOceanChallenge(connection, settings, status);
    } else {
      throw new Error(`Unsupported DNS provider: ${dnsProvider}`);
    }
  }

  private async handleCloudflareChallenge(connection: ConnectionRecord, settings: any[], status: RenewalStatus): Promise<void> {
    const cfKey = settings.find(s => s.key_name === 'CF_KEY')?.key_value;
    const cfZone = settings.find(s => s.key_name === 'CF_ZONE')?.key_value;
    
    if (!cfKey || !cfZone) {
      throw new Error('Cloudflare API key or zone ID not configured');
    }

    status.logs.push('Managing DNS challenge via Cloudflare');
    
    // TODO: Implement Cloudflare API integration
    // This would involve:
    // 1. Creating TXT record for _acme-challenge.domain
    // 2. Waiting for DNS propagation
    // 3. Cleaning up the TXT record after challenge
    
    return new Promise((resolve) => {
      setTimeout(() => {
        status.logs.push('DNS challenge completed via Cloudflare');
        resolve();
      }, 1000);
    });
  }

  private async handleDigitalOceanChallenge(connection: ConnectionRecord, settings: any[], status: RenewalStatus): Promise<void> {
    const doKey = settings.find(s => s.key_name === 'DO_KEY')?.key_value;
    
    if (!doKey) {
      throw new Error('DigitalOcean API key not configured');
    }

    status.logs.push('Managing DNS challenge via DigitalOcean');
    
    // TODO: Implement DigitalOcean API integration
    return new Promise((resolve) => {
      setTimeout(() => {
        status.logs.push('DNS challenge completed via DigitalOcean');
        resolve();
      }, 1000);
    });
  }

  private async uploadCertificateToCUCM(connection: ConnectionRecord, certificate: string, status: RenewalStatus): Promise<void> {
    return new Promise((resolve, reject) => {
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      const options = {
        hostname: fullFQDN,
        port: 443,
        path: '/platformcom/api/v1/certmgr/config/certificate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`
        },
        rejectUnauthorized: false
      };

      const postData = JSON.stringify({
        'certificate-name': 'tomcat',
        'certificate-content': certificate,
        'restart-services': true
      });

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (res.statusCode === 200 || res.statusCode === 201) {
              status.logs.push(`Certificate uploaded successfully to ${fullFQDN}`);
              resolve();
            } else {
              reject(new Error(`Certificate upload failed: ${response.message || 'Unknown error'}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse upload response: ${error}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Certificate upload failed: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  private async saveCertificateFiles(domain: string, certificateData: string, status: RenewalStatus): Promise<void> {
    try {
      // Parse certificate chain
      const certParts = certificateData.split('-----END CERTIFICATE-----');
      const certificates = certParts
        .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
        .map(part => part.trim() + '\n-----END CERTIFICATE-----');
      
      if (certificates.length === 0) {
        throw new Error('No certificates found in response');
      }
      
      // First certificate is the domain certificate
      const domainCert = certificates[0];
      
      // Remaining certificates are the chain (intermediate + root)
      const chainCerts = certificates.slice(1);
      const fullChain = chainCerts.join('\n');
      
      // Save domain certificate
      await accountManager.saveCertificate(domain, domainCert, ''); // Private key not included in Let's Encrypt response
      
      // Save certificate chain to accounts folder
      const accountsDir = process.env.ACCOUNTS_DIR || './accounts';
      const domainDir = path.join(accountsDir, domain);
      
      // Ensure domain directory exists
      if (!fs.existsSync(domainDir)) {
        fs.mkdirSync(domainDir, { recursive: true });
      }
      
      const chainPath = path.join(domainDir, 'chain.pem');
      const fullChainPath = path.join(domainDir, 'fullchain.pem');
      
      await fs.promises.writeFile(chainPath, fullChain);
      await fs.promises.writeFile(fullChainPath, certificateData);
      
      status.logs.push(`Saved certificate files for ${domain}`);
      status.logs.push(`- Domain certificate: certificate.pem`);
      status.logs.push(`- Certificate chain: chain.pem`);
      status.logs.push(`- Full chain: fullchain.pem`);
      
      Logger.info(`Successfully saved certificate files for ${domain}`);
    } catch (error) {
      Logger.error(`Failed to save certificate files for ${domain}:`, error);
      throw error;
    }
  }

  private async updateDatabaseWithRenewal(connectionId: number, database: DatabaseManager): Promise<void> {
    try {
      // Update the database with renewal information
      await database.updateConnection(connectionId, {
        last_cert_issued: new Date().toISOString(),
        cert_count_this_week: 1, // This should be calculated based on existing count
        cert_count_reset_date: new Date().toISOString()
      });
      
      Logger.info(`Updated database with renewal info for connection ${connectionId}`);
    } catch (error) {
      Logger.error(`Failed to update database with renewal info for connection ${connectionId}:`, error);
      throw error;
    }
  }
}

export const certificateRenewalService = new CertificateRenewalServiceImpl();