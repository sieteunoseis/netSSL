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
  getRenewalStatus(renewalId: string): Promise<RenewalStatus | null>;
}

class CertificateRenewalServiceImpl implements CertificateRenewalService {
  private renewalStatuses: Map<string, RenewalStatus> = new Map();
  private database: DatabaseManager | null = null;

  setDatabase(database: DatabaseManager): void {
    this.database = database;
  }

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

    // Save to database
    await database.saveRenewalStatus(renewalId, connectionId, status.status, undefined, status.message, undefined, status.logs);

    // Start the renewal process asynchronously
    this.performRenewal(renewalId, connectionId, database).catch(async error => {
      Logger.error(`Certificate renewal failed for connection ${connectionId}:`, error);
      status.status = 'failed';
      status.error = error.message;
      status.message = 'Certificate renewal failed';
      status.endTime = new Date();
      
      // Save failed status to database
      if (database) {
        await database.saveRenewalStatus(
          renewalId,
          connectionId,
          'failed',
          undefined,
          'Certificate renewal failed',
          error.message,
          status.logs
        ).catch(err => {
          Logger.error(`Failed to save failed renewal status to database: ${err.message}`);
        });
      }
    });

    return status;
  }

  async getRenewalStatus(renewalId: string): Promise<RenewalStatus | null> {
    Logger.info(`Looking for renewal status ID: ${renewalId}`);
    
    // First check memory cache
    const memoryStatus = this.renewalStatuses.get(renewalId);
    if (memoryStatus) {
      return memoryStatus;
    }
    
    // If not in memory, check database
    if (this.database) {
      const dbStatus = await this.database.getRenewalStatus(renewalId);
      if (dbStatus) {
        // Convert database format to RenewalStatus format
        const status: RenewalStatus = {
          id: dbStatus.renewal_id,
          connectionId: dbStatus.connection_id,
          status: dbStatus.status,
          message: dbStatus.message || '',
          progress: this.getProgressForStatus(dbStatus.status),
          startTime: new Date(dbStatus.created_at),
          endTime: dbStatus.updated_at ? new Date(dbStatus.updated_at) : undefined,
          error: dbStatus.error,
          logs: dbStatus.logs || []
        };
        // Cache in memory
        this.renewalStatuses.set(renewalId, status);
        return status;
      }
    }
    
    Logger.info(`Available renewal IDs in memory: ${Array.from(this.renewalStatuses.keys()).join(', ')}`);
    return null;
  }

  private getProgressForStatus(status: string): number {
    const progressMap: Record<string, number> = {
      'pending': 0,
      'generating_csr': 10,
      'creating_account': 15,
      'requesting_certificate': 20,
      'creating_dns_challenge': 30,
      'waiting_dns_propagation': 50,
      'completing_validation': 70,
      'downloading_certificate': 80,
      'uploading_certificate': 90,
      'completed': 100,
      'failed': 0
    };
    return progressMap[status] || 0;
  }

  private async performRenewal(renewalId: string, connectionId: number, database: DatabaseManager): Promise<void> {
    const status = this.renewalStatuses.get(renewalId)!;
    
    // Ensure database is set for this renewal
    if (!this.database) {
      this.database = database;
    }
    
    try {
      // Get connection details
      const connection = await database.getConnectionById(connectionId);
      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      const fullFQDN = `${connection.hostname}.${connection.domain}`;

      // Check for existing valid certificate
      const existingCert = await this.getExistingCertificate(fullFQDN);
      if (existingCert) {
        await this.updateStatus(status, 'uploading_certificate', 'Using existing valid certificate', 80);
        await this.uploadCertificateToCUCM(connection, existingCert, status);
        await this.updateStatus(status, 'completed', 'Certificate renewal completed successfully', 100);
        status.endTime = new Date();
        return;
      }

      await this.updateStatus(status, 'generating_csr', 'Generating CSR from CUCM server', 10);
      
      // Step 1: Generate CSR from CUCM
      const csr = await this.generateCSRFromCUCM(connection, status);
      
      // Now continue with Let's Encrypt certificate request
      await this.updateStatus(status, 'requesting_certificate', 'Requesting certificate from Let\'s Encrypt', 20);
      const certificate = await this.requestCertificate(connection, csr, database, status);
      
      await this.updateStatus(status, 'uploading_certificate', 'Uploading certificate to CUCM', 90);
      await this.uploadCertificateToCUCM(connection, certificate, status);
      
      await this.updateStatus(status, 'completed', 'Certificate renewal completed successfully', 100);
      status.endTime = new Date();
      
      // Save the renewal completion info
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

  private async getExistingCertificate(domain: string): Promise<string | null> {
    try {
      const fullChainPath = path.join(process.env.ACCOUNTS_DIR || './accounts', domain, 'fullchain.pem');
      if (!fs.existsSync(fullChainPath)) {
        return null;
      }

      const certificateData = await fs.promises.readFile(fullChainPath, 'utf8');
      const cert = new crypto.X509Certificate(certificateData);

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      if (new Date(cert.validTo) > thirtyDaysFromNow) {
        Logger.info(`Found existing certificate for ${domain} that is valid for more than 30 days.`);
        return certificateData;
      }

      return null;
    } catch (error) {
      Logger.error(`Error checking for existing certificate for ${domain}:`, error);
      return null;
    }
  }

  private async updateStatus(status: RenewalStatus, newStatus: RenewalStatus['status'], message: string, progress: number): Promise<void> {
    status.status = newStatus;
    status.message = message;
    status.progress = progress;
    status.logs.push(`${new Date().toISOString()}: ${message}`);
    Logger.info(`Renewal ${status.id}: ${message}`);
    
    // Save to database if available
    if (this.database) {
      await this.database.saveRenewalStatus(
        status.id,
        status.connectionId,
        newStatus,
        undefined,
        message,
        status.error,
        status.logs
      ).catch(err => {
        Logger.error(`Failed to save renewal status to database: ${err.message}`);
      });
    }
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
      
      // Log renewal start
      await accountManager.saveRenewalLog(fullFQDN, `=== Let's Encrypt Certificate Renewal Started ===`);
      await accountManager.saveRenewalLog(fullFQDN, `Domains: ${domains.join(', ')}`);
      await accountManager.saveRenewalLog(fullFQDN, `Environment: ${process.env.LETSENCRYPT_STAGING !== 'false' ? 'STAGING' : 'PRODUCTION'}`);
      
      await this.updateStatus(status, 'creating_account', 'Setting up Let\'s Encrypt account', 20);
      
      // Get or create ACME account
      let account = await acmeClient.loadAccount(fullFQDN);
      if (!account) {
        Logger.info('No existing account found, creating new account');
        await accountManager.saveRenewalLog(fullFQDN, `No existing account found, creating new account`);
        const email = settings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
        if (!email) {
          throw new Error('Let\'s Encrypt email not configured in settings. Please add LETSENCRYPT_EMAIL to your settings.');
        }
        Logger.info(`Creating new Let's Encrypt account with email: ${email}`);
        await accountManager.saveRenewalLog(fullFQDN, `Creating new Let's Encrypt account with email: ${email}`);
        account = await acmeClient.createAccount(email, fullFQDN);
        await accountManager.saveRenewalLog(fullFQDN, `Account created successfully`);
      } else {
        Logger.info(`Using existing account for domain: ${fullFQDN}`);
        await accountManager.saveRenewalLog(fullFQDN, `Using existing account for domain: ${fullFQDN}`);
        await accountManager.saveRenewalLog(fullFQDN, `Account URL: ${account.accountUrl}`);
      }
      
      await this.updateStatus(status, 'requesting_certificate', 'Requesting certificate from Let\'s Encrypt', 30);
      
      // Create certificate order
      await accountManager.saveRenewalLog(fullFQDN, `Creating certificate order for domains: ${domains.join(', ')}`);
      const order = await acmeClient.requestCertificate(csr, domains);
      await accountManager.saveRenewalLog(fullFQDN, `Certificate order created: ${order.order.url}`);
      
      await this.updateStatus(status, 'creating_dns_challenge', 'Setting up DNS challenges', 40);
      
      // Initialize Cloudflare provider
      const cloudflare = await CloudflareProvider.create(database, fullFQDN);
      await accountManager.saveRenewalLog(fullFQDN, `Cloudflare DNS provider initialized`);
      
      // Create DNS TXT records for challenges
      const dnsRecords: any[] = [];
      await accountManager.saveRenewalLog(fullFQDN, `Setting up ${order.challenges.length} DNS challenge(s)`);
      
      for (const challenge of order.challenges) {
        const keyAuthorization = await acmeClient.getChallengeKeyAuthorization(challenge);
        
        // Log the key authorization for debugging
        await accountManager.saveRenewalLog(fullFQDN, `Key authorization: ${keyAuthorization}`);
        
        const dnsValue = acmeClient.getDNSRecordValue(keyAuthorization);
        
        // Extract domain from challenge
        const challengeDomain = challenge.url.includes('identifier') 
          ? domains.find(d => challenge.url.includes(d)) || domains[0]
          : domains[0];
        
        await accountManager.saveRenewalLog(fullFQDN, `Processing challenge for domain: ${challengeDomain}`);
        await accountManager.saveRenewalLog(fullFQDN, `Challenge URL: ${challenge.url}`);
        await accountManager.saveRenewalLog(fullFQDN, `DNS value: ${dnsValue}`);
        
        // Clean up any existing TXT records before creating new one
        await accountManager.saveRenewalLog(fullFQDN, `Cleaning up existing TXT records for ${challengeDomain}`);
        await cloudflare.cleanupTxtRecords(challengeDomain);
        
        const record = await cloudflare.createTxtRecord(challengeDomain, dnsValue);
        dnsRecords.push({ record, challenge, domain: challengeDomain });
        
        await accountManager.saveRenewalLog(fullFQDN, `Created DNS TXT record for ${challengeDomain}: ${record.id}`);
        status.logs.push(`Created DNS TXT record for ${challengeDomain}: ${record.id}`);
      }
      
      await this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation', 50);
      await accountManager.saveRenewalLog(fullFQDN, `Waiting for DNS propagation of ${dnsRecords.length} record(s)`);
      
      // Wait for DNS propagation
      for (const { record, challenge, domain } of dnsRecords) {
        const keyAuthorization = await acmeClient.getChallengeKeyAuthorization(challenge);
        const expectedValue = acmeClient.getDNSRecordValue(keyAuthorization);
        
        await accountManager.saveRenewalLog(fullFQDN, `Verifying DNS propagation for ${domain}, expected value: ${expectedValue}`);
        const isVerified = await cloudflare.verifyTxtRecord(domain, expectedValue);
        if (!isVerified) {
          await accountManager.saveRenewalLog(fullFQDN, `ERROR: DNS propagation verification failed for ${domain}`);
          throw new Error(`DNS propagation verification failed for ${domain}`);
        }
        
        await accountManager.saveRenewalLog(fullFQDN, `DNS propagation verified for ${domain}`);
        status.logs.push(`DNS propagation verified for ${domain}`);
      }
      
      await this.updateStatus(status, 'completing_validation', 'Completing Let\'s Encrypt validation', 70);
      await accountManager.saveRenewalLog(fullFQDN, `Completing ${dnsRecords.length} Let's Encrypt challenge(s)`);
      
      // Complete challenges
      for (const { challenge } of dnsRecords) {
        await accountManager.saveRenewalLog(fullFQDN, `Completing challenge: ${challenge.url}`);
        await acmeClient.completeChallenge(challenge);
        await accountManager.saveRenewalLog(fullFQDN, `Challenge completed successfully: ${challenge.url}`);
      }
      
      // Add delay to ensure Let's Encrypt processes the completed challenges
      Logger.info('Waiting for Let\'s Encrypt to process challenge completion...');
      await accountManager.saveRenewalLog(fullFQDN, `Waiting 3 seconds for Let's Encrypt to process challenge completion...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for order completion
      await accountManager.saveRenewalLog(fullFQDN, `Waiting for order completion: ${order.order.url}`);
      const completedOrder = await acmeClient.waitForOrderCompletion(order.order);
      await accountManager.saveRenewalLog(fullFQDN, `Order completed successfully`);
      
      await this.updateStatus(status, 'downloading_certificate', 'Downloading certificate', 80);
      
      // Finalize and get certificate
      await accountManager.saveRenewalLog(fullFQDN, `Finalizing certificate order`);
      const certificate = await acmeClient.finalizeCertificate(completedOrder, csr);
      await accountManager.saveRenewalLog(fullFQDN, `Certificate downloaded successfully`);
      
      // Clean up DNS records - skip in staging mode for debugging
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      if (!isStaging || process.env.LETSENCRYPT_CLEANUP_DNS === 'true') {
        await accountManager.saveRenewalLog(fullFQDN, `Cleaning up ${dnsRecords.length} DNS TXT record(s)`);
        for (const { record } of dnsRecords) {
          try {
            await cloudflare.deleteTxtRecord(record.id);
            await accountManager.saveRenewalLog(fullFQDN, `Cleaned up DNS TXT record: ${record.id}`);
            status.logs.push(`Cleaned up DNS TXT record: ${record.id}`);
          } catch (error) {
            Logger.warn(`Failed to clean up DNS record ${record.id}:`, error);
            await accountManager.saveRenewalLog(fullFQDN, `WARNING: Failed to clean up DNS record ${record.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      } else {
        Logger.info(`Skipping DNS record cleanup in staging mode (${dnsRecords.length} records)`);
        await accountManager.saveRenewalLog(fullFQDN, `Skipping DNS record cleanup in staging mode (${dnsRecords.length} records)`);
        status.logs.push(`Skipped DNS cleanup in staging mode for debugging`);
      }
      
      // Save certificate and chain to accounts folder
      await this.saveCertificateFiles(fullFQDN, certificate, status);
      
      await accountManager.saveRenewalLog(fullFQDN, `=== Certificate obtained successfully from Let's Encrypt ===`);
      status.logs.push('Certificate obtained from Let\'s Encrypt');
      return certificate;
      
    } catch (error) {
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      Logger.error('Let\'s Encrypt certificate request failed:', error);
      
      // Log detailed error information
      await accountManager.saveRenewalLog(fullFQDN, `=== ERROR: Let's Encrypt certificate request failed ===`);
      await accountManager.saveRenewalLog(fullFQDN, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof Error && error.stack) {
        await accountManager.saveRenewalLog(fullFQDN, `Stack trace: ${error.stack}`);
      }
      
      // If it's a JSON error with detailed info, log that too
      try {
        const errorObj = JSON.parse(error instanceof Error ? error.message : String(error));
        if (errorObj && typeof errorObj === 'object') {
          await accountManager.saveRenewalLog(fullFQDN, `Detailed error: ${JSON.stringify(errorObj, null, 2)}`);
          
          // If we have authorization URLs, try to get detailed auth info
          if (errorObj.authorizations && Array.isArray(errorObj.authorizations)) {
            await accountManager.saveRenewalLog(fullFQDN, `Attempting to fetch detailed authorization information...`);
            // The detailed auth info will be logged by the ACME client's enhanced error handling
          }
        }
      } catch {
        // Not a JSON error, ignore
      }
      
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
    return new Promise(async (resolve, reject) => {
      try {
        const fullFQDN = `${connection.hostname}.${connection.domain}`;

        // Parse the certificate chain into individual certificates
        const certParts = certificate.split('-----END CERTIFICATE-----');
        const certificates = certParts
          .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
          .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));

        if (certificates.length === 0) {
          return reject(new Error('No certificates found to upload.'));
        }

        const leafCert = certificates[0];
        const caCerts = certificates.slice(1);

        // Upload the leaf certificate
        await this.uploadLeafCertificate(connection, leafCert, status);

        // Upload the CA certificates
        if (caCerts.length > 0) {
          await this.uploadCaCertificates(connection, caCerts, status);
        }

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  private async uploadLeafCertificate(connection: ConnectionRecord, certificate: string, status: RenewalStatus): Promise<void> {
    return new Promise((resolve, reject) => {
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      const postData = JSON.stringify({
        service: 'tomcat',
        certificates: [certificate]
      });

      Logger.info(`CUCM leaf cert upload request body: ${postData}`);

      const options = {
        hostname: fullFQDN,
        port: 443,
        path: '/platformcom/api/v1/certmgr/config/identity/certificates',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`,
          'Content-Length': Buffer.byteLength(postData)
        },
        rejectUnauthorized: false
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            Logger.info(`CUCM leaf cert upload response: ${data}`);
            if (res.statusCode === 200 || res.statusCode === 201) {
              status.logs.push(`Leaf certificate uploaded successfully to ${fullFQDN}`);
              resolve();
            } else {
              const response = JSON.parse(data);
              reject(new Error(`Leaf certificate upload failed: ${response.message || 'Unknown error'}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse leaf cert upload response: ${error}. Raw response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Leaf certificate upload failed: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  private async getExistingTrustCertificates(connection: ConnectionRecord): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const fullFQDN = `${connection.hostname}.${connection.domain}`;
        const options = {
            hostname: fullFQDN,
            port: 443,
            path: '/platformcom/api/v1/certmgr/config/trust/certificate?service=tomcat',
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`
            },
            rejectUnauthorized: false
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const response = JSON.parse(data);
                        const existingCerts = response.map((c: any) => c.certificate.trim());
                        resolve(existingCerts);
                    } else {
                        Logger.warn(`Could not get existing trust certificates. Status: ${res.statusCode}, Body: ${data}`);
                        resolve([]);
                    }
                } catch (error) {
                    Logger.error(`Failed to parse existing trust certificates response: ${error}. Raw response: ${data}`);
                    resolve([]);
                }
            });
        });

        req.on('error', (error) => {
            Logger.error(`Failed to get existing trust certificates: ${error.message}`);
            resolve([]);
        });

        req.end();
    });
  }

  private async uploadCaCertificates(connection: ConnectionRecord, certificates: string[], status: RenewalStatus): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const existingCerts = await this.getExistingTrustCertificates(connection);
        const certsToUpload = certificates.filter(c => !existingCerts.includes(c.trim()));

        if (certsToUpload.length === 0) {
            Logger.info('All CA certificates already exist on the server. Skipping upload.');
            status.logs.push('All CA certificates already exist on the server. Skipping upload.');
            return resolve();
        }

        const fullFQDN = `${connection.hostname}.${connection.domain}`;
        const postData = JSON.stringify({
          service: ['tomcat'],
          certificates: certsToUpload,
          description: 'Trust Certificate'
        });

        Logger.info(`CUCM CA cert upload request body: ${postData}`);

        const options = {
          hostname: fullFQDN,
          port: 443,
          path: '/platformcom/api/v1/certmgr/config/trust/certificates',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`,
            'Content-Length': Buffer.byteLength(postData)
          },
          rejectUnauthorized: false
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              Logger.info(`CUCM CA cert upload response: ${data}`);
              if (res.statusCode === 200 || res.statusCode === 201) {
                status.logs.push(`CA certificates uploaded successfully to ${fullFQDN}`);
                resolve();
              } else {
                const response = JSON.parse(data);
                reject(new Error(`CA certificate upload failed: ${response.message || 'Unknown error'}`));
              }
            } catch (error) {
              reject(new Error(`Failed to parse CA cert upload response: ${error}. Raw response: ${data}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(new Error(`CA certificate upload failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
      } catch (error) {
        reject(error);
      }
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