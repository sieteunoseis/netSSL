import https from 'https';
import fs from 'fs';
import path from 'path';
import {
  PlatformProvider,
  PlatformConfig,
  CSRGenerationParams,
  CSRResponse,
  CertificateData,
  CertificateUploadResponse,
  RenewalContext,
  RestartResult,
} from './platform-provider';
import { Logger } from '../logger';
import { accountManager } from '../account-manager';
import { SSHClient } from '../ssh-client';

export class VOSProvider extends PlatformProvider {
  constructor() {
    const config: PlatformConfig = {
      platformType: 'vos',
      apiEndpoints: {
        generateCSR: '/platformcom/api/v1/certmgr/config/csr',
        uploadIdentityCert: '/platformcom/api/v1/certmgr/config/identity/certificates',
        getTrustCerts: '/platformcom/api/v1/certmgr/config/trust/certificate?service=tomcat',
        uploadTrustCerts: '/platformcom/api/v1/certmgr/config/trust/certificates'
      },
      sshConfig: {
        promptPattern: 'admin:',
        serviceRestartCommand: 'utils service restart Cisco Tomcat',
        connectionAlgorithms: {
          kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group-exchange-sha1'],
          cipher: ['aes256-ctr', 'aes192-ctr', 'aes128-ctr', 'aes256-cbc', 'aes192-cbc', 'aes128-cbc'],
          hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
          serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']
        }
      },
      certificateConfig: {
        serviceName: 'tomcat',
        supportedKeyTypes: ['RSA'],
        maxKeySize: 4096
      }
    };
    
    super(config);
  }

  async generateCSR(
    hostname: string,
    username: string,
    password: string,
    params: CSRGenerationParams
  ): Promise<CSRResponse> {
    try {
      Logger.info(`Generating CSR for VOS platform: ${hostname}`);

      const csrData = {
        certificateRequestData: {
          subject: {
            commonName: params.commonName,
            organizationName: params.organizationName || 'Cisco',
            organizationalUnit: params.organizationalUnit || 'IT',
            locality: params.locality || 'San Jose',
            state: params.state || 'CA',
            country: params.country || 'US'
          },
          keySize: params.keySize || 2048,
          keyType: params.keyType || 'RSA',
          subjectAltNames: params.subjectAltNames || []
        }
      };

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.generateCSR,
        'POST',
        csrData
      );

      if (response && response.certificateSigningRequest) {
        Logger.info(`Successfully generated CSR for ${hostname}`);
        return {
          csr: response.certificateSigningRequest,
          success: true,
          message: 'CSR generated successfully'
        };
      } else {
        throw new Error('Invalid response format from VOS API');
      }
    } catch (error) {
      Logger.error(`Failed to generate CSR for ${hostname}:`, error);
      return {
        csr: '',
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async uploadIdentityCertificate(
    hostname: string,
    username: string,
    password: string,
    certificateData: CertificateData
  ): Promise<CertificateUploadResponse> {
    try {
      Logger.info(`Uploading identity certificate to VOS platform: ${hostname}`);

      // First upload the leaf certificate
      const leafUploadResult = await this.uploadLeafCertificate(
        hostname,
        username,
        password,
        certificateData.certificate,
        certificateData.privateKey
      );

      if (!leafUploadResult.success) {
        return leafUploadResult;
      }

      // Then upload CA certificates if provided
      if (certificateData.caCertificates && certificateData.caCertificates.length > 0) {
        const caUploadResult = await this.uploadTrustCertificates(
          hostname,
          username,
          password,
          certificateData.caCertificates
        );

        if (!caUploadResult.success) {
          Logger.warn(`CA certificate upload failed, but leaf certificate was uploaded successfully`);
        }
      }

      return {
        success: true,
        message: 'Certificate uploaded successfully',
        certificateId: leafUploadResult.certificateId
      };
    } catch (error) {
      Logger.error(`Failed to upload certificate to ${hostname}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async uploadLeafCertificate(
    hostname: string,
    username: string,
    password: string,
    certificate: string,
    privateKey?: string
  ): Promise<CertificateUploadResponse> {
    const uploadData = {
      certificateData: {
        certificate: certificate,
        privateKey: privateKey || undefined,
        certificateType: 'identity'
      }
    };

    const response = await this.makeApiRequest(
      hostname,
      username,
      password,
      this.config.apiEndpoints.uploadIdentityCert,
      'POST',
      uploadData
    );

    return {
      success: true,
      message: 'Leaf certificate uploaded successfully',
      certificateId: response?.certificateId
    };
  }

  async uploadTrustCertificates(
    hostname: string,
    username: string,
    password: string,
    caCertificates: string[]
  ): Promise<CertificateUploadResponse> {
    try {
      Logger.info(`Uploading ${caCertificates.length} CA certificates to VOS platform: ${hostname}`);

      // Get existing trust certificates to avoid duplicates
      const existingCerts = await this.getTrustCertificates(hostname, username, password);
      
      const certsToUpload = caCertificates.filter(cert => {
        return !existingCerts.some(existing => existing.includes(cert.trim()));
      });

      if (certsToUpload.length === 0) {
        return {
          success: true,
          message: 'All CA certificates already exist in trust store'
        };
      }

      for (const cert of certsToUpload) {
        const uploadData = {
          certificateData: {
            certificate: cert,
            certificateType: 'trust'
          }
        };

        await this.makeApiRequest(
          hostname,
          username,
          password,
          this.config.apiEndpoints.uploadTrustCerts,
          'POST',
          uploadData
        );
      }

      Logger.info(`Successfully uploaded ${certsToUpload.length} CA certificates to ${hostname}`);
      return {
        success: true,
        message: `Uploaded ${certsToUpload.length} CA certificates`
      };
    } catch (error) {
      Logger.error(`Failed to upload CA certificates to ${hostname}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getTrustCertificates(
    hostname: string,
    username: string,
    password: string
  ): Promise<string[]> {
    try {
      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.getTrustCerts,
        'GET'
      );

      if (response && response.certificates) {
        return response.certificates.map((cert: any) => cert.certificateData || cert.certificate || '');
      }

      return [];
    } catch (error) {
      Logger.error(`Failed to get trust certificates from ${hostname}:`, error);
      return [];
    }
  }

  async restartServices(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      Logger.info(`Restarting Cisco Tomcat service on VOS platform: ${hostname}`);

      await this.connectSSH(hostname, username, password);
      
      // Execute the service restart command
      const output = await this.executeSSHCommand(this.config.sshConfig.serviceRestartCommand);
      
      await this.disconnectSSH();

      // Check if restart was successful (VOS typically returns service status)
      const success = !output.toLowerCase().includes('error') && 
                     !output.toLowerCase().includes('failed');

      if (success) {
        Logger.info(`Successfully restarted Cisco Tomcat service on ${hostname}`);
      } else {
        Logger.warn(`Service restart may have failed on ${hostname}: ${output}`);
      }

      return success;
    } catch (error) {
      Logger.error(`Failed to restart services on ${hostname}:`, error);
      try {
        await this.disconnectSSH();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      return false;
    }
  }

  async validateConnection(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      Logger.info(`Validating VOS platform connection: ${hostname}`);

      // Test SSH connection
      await this.connectSSH(hostname, username, password);
      
      // Execute a simple command to verify connectivity
      const output = await this.executeSSHCommand('show version');
      
      await this.disconnectSSH();

      // Check if we got expected VOS output
      const isVOS = output.toLowerCase().includes('cisco') || 
                   output.toLowerCase().includes('unified');

      if (isVOS) {
        Logger.info(`Successfully validated VOS platform connection: ${hostname}`);
      } else {
        Logger.warn(`Connection validated but may not be a VOS platform: ${hostname}`);
      }

      return true;
    } catch (error) {
      Logger.error(`Failed to validate VOS platform connection ${hostname}:`, error);
      try {
        await this.disconnectSSH();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Renewal lifecycle methods (moved from certificate-renewal.ts)
  // ---------------------------------------------------------------------------

  async prepareCSR(ctx: RenewalContext): Promise<string> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = `${connection.hostname}.${connection.domain}`;

    // Always generate a fresh CSR from VOS — VOS CSRs are tied to internal
    // tracking IDs and keypairs, so cached ones cause 500 errors on upload
    await accountManager.clearCSR(connectionId, fullFQDN);

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for VOS applications');
    }

    const authHeader = `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`;
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
      ...(altNames.length > 0 && { 'altNames': altNames }),
    };

    const postData = JSON.stringify(csrPayload);

    const options = {
      hostname: fullFQDN,
      port: 443,
      path: '/platformcom/api/v1/certmgr/config/csr',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      rejectUnauthorized: false,
      timeout: 30000,
    };

    Logger.info(`Sending CSR request to ${fullFQDN}:${options.port}${options.path}`);
    Logger.info(`CSR Request Body: ${postData}`);
    Logger.info(`Using credentials for user: ${connection.username}`);

    await ctx.saveLog(`=== CSR Generation Request ===`);
    await ctx.saveLog(`Target: ${fullFQDN}:${options.port}${options.path}`);
    await ctx.saveLog(`Service: ${csrPayload.service}`);
    await ctx.saveLog(`Common Name: ${csrPayload.commonName}`);
    await ctx.saveLog(`Key Type: ${csrPayload.keyType}, Length: ${csrPayload.keyLength}`);
    await ctx.saveLog(`Hash Algorithm: ${csrPayload.hashAlgorithm}`);
    if (altNames.length > 0) {
      await ctx.saveLog(`Alt Names: ${altNames.join(', ')}`);
    }
    await ctx.saveLog(`Request Body: ${postData}`);
    await ctx.saveLog(`Using credentials for user: ${connection.username}`);

    Logger.info(`Testing VOS connectivity and authentication...`);
    await ctx.saveLog(`Testing VOS connectivity and authentication...`);

    return new Promise<string>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', async () => {
          try {
            Logger.info(`CSR API Response Status: ${res.statusCode}`);
            Logger.info(`CSR API Response Body: ${data}`);

            await ctx.saveLog(`CSR API Response Status: ${res.statusCode}`);
            await ctx.saveLog(`CSR API Response Body: ${data}`);

            if (res.statusCode !== 200) {
              const errorMsg = `CSR API returned status ${res.statusCode}: ${data}`;
              await ctx.saveLog(`ERROR: ${errorMsg}`);
              reject(new Error(errorMsg));
              return;
            }

            const response = JSON.parse(data);
            if (response.csr) {
              await accountManager.saveCSR(connectionId, fullFQDN, response.csr);
              await ctx.saveLog(`Generated new CSR from ${fullFQDN} for service: tomcat`);
              await ctx.saveLog(`CSR length: ${response.csr.length} characters`);

              status.logs.push(`CSR generated successfully from ${fullFQDN} for service: tomcat`);
              resolve(response.csr);
            } else {
              const errorMsg = `CSR not found in response. Response: ${JSON.stringify(response)}`;
              await ctx.saveLog(`ERROR: ${errorMsg}`);
              reject(new Error(errorMsg));
            }
          } catch (error) {
            const errorMsg = `Failed to parse CSR response: ${error}. Raw response: ${data}`;
            await ctx.saveLog(`ERROR: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        });
      });

      req.on('error', async (error) => {
        const errorMsg = `CSR generation failed: ${error.message}`;
        await ctx.saveLog(`ERROR: ${errorMsg}`);
        reject(new Error(errorMsg));
      });

      req.write(postData);
      req.end();
    });
  }

  async installCertificate(ctx: RenewalContext, certificate: string): Promise<void> {
    const { connectionId, connection, status } = ctx;

    // Parse the certificate chain into individual certificates
    const certParts = certificate.split('-----END CERTIFICATE-----');
    const certificates = certParts
      .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
      .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));

    if (certificates.length === 0) {
      throw new Error('No certificates found to upload.');
    }

    // Upload CA certificates (intermediate + root) to trust store FIRST
    // VOS must have the signing CA in its trust store before it will accept the identity cert
    if (certificates.length > 1) {
      try {
        await this.renewalUploadCaCertificates(ctx, certificates.slice(1));
      } catch (caError: any) {
        const fullFQDN = `${connection.hostname}.${connection.domain}`;
        await ctx.saveLog(`CA certificate upload warning: ${caError.message}`);
        status.logs.push(`CA certificates may already exist on server (this is normal)`);
      }
    }

    // Now upload the identity certificate chain (leaf + intermediates)
    await this.renewalUploadLeafCertificate(ctx, certificate);

    // Clear cached CSR after successful upload — VOS has consumed it
    const fullFQDN = `${connection.hostname}.${connection.domain}`;
    await accountManager.clearCSR(connectionId, fullFQDN);
  }

  async handleServiceRestart(ctx: RenewalContext): Promise<RestartResult> {
    const { connection, status } = ctx;

    Logger.info(`handleServiceRestart called for ${connection.hostname}.${connection.domain} - application_type=${connection.application_type}, enable_ssh=${connection.enable_ssh} (${typeof connection.enable_ssh}), auto_restart_service=${connection.auto_restart_service} (${typeof connection.auto_restart_service})`);

    // Only proceed if SSH is enabled and auto_restart_service is enabled
    if (!connection.enable_ssh || !connection.auto_restart_service) {
      Logger.info(`Skipping service restart for ${connection.hostname}.${connection.domain} - SSH or auto restart not enabled (enable_ssh=${connection.enable_ssh}, auto_restart_service=${connection.auto_restart_service})`);
      return { success: true, requiresManualRestart: false };
    }

    try {
      const fqdn = `${connection.hostname}.${connection.domain}`;
      Logger.info(`Starting Cisco Tomcat service restart for ${fqdn}`);

      status.logs.push(`Restarting Cisco Tomcat service on ${fqdn}`);
      await ctx.updateStatus('restarting_service', 'Testing SSH connection...', 92);

      // Test SSH connection first
      const sshTest = await SSHClient.testConnection({
        hostname: fqdn,
        username: connection.username!,
        password: connection.password!,
      });

      if (!sshTest.success) {
        const errorMsg = `SSH connection failed for ${fqdn}: ${sshTest.error}`;
        Logger.error(errorMsg);
        status.logs.push(`\u26a0\ufe0f ${errorMsg}`);
        status.logs.push(`\ud83d\udccb Manual action required: Run 'utils service restart Cisco Tomcat' on ${fqdn}`);
        return {
          success: false,
          requiresManualRestart: true,
          message: `SSH failed - Manual service restart required on ${fqdn}`,
        };
      }

      await ctx.updateStatus('restarting_service', 'Restarting Tomcat...', 94);

      if (connection.id) {
        await accountManager.saveRenewalLog(connection.id, fqdn, `\ud83d\udd04 Initiating Cisco Tomcat service restart on ${fqdn}`);
      }
      status.logs.push(`\ud83d\udd04 Initiating Cisco Tomcat service restart on ${fqdn}`);

      const restartResult = await SSHClient.executeCommandWithStream({
        hostname: fqdn,
        username: connection.username!,
        password: connection.password!,
        command: 'utils service restart Cisco Tomcat',
        timeout: 600000,
        onData: async (chunk: string, totalOutput: string) => {
          if (chunk.includes('[STARTING]') || totalOutput.includes('Cisco Tomcat[STARTING]')) {
            Logger.info(`Detected Cisco Tomcat [STARTING] for ${fqdn} during certificate renewal`);
            await ctx.updateStatus('restarting_service', 'Tomcat starting...', 97);
            const logMessage = `\ud83d\udd04 Cisco Tomcat service is starting on ${fqdn}`;
            status.logs.push(logMessage);
            if (connection.id) {
              await accountManager.saveRenewalLog(connection.id, fqdn, logMessage);
            }
          }
          if (chunk.includes('[STOPPING]') || totalOutput.includes('Cisco Tomcat[STOPPING]')) {
            await ctx.updateStatus('restarting_service', 'Tomcat stopping...', 95);
            const logMessage = `\u23f8\ufe0f Cisco Tomcat service is stopping on ${fqdn}`;
            status.logs.push(logMessage);
            if (connection.id) {
              await accountManager.saveRenewalLog(connection.id, fqdn, logMessage);
            }
          }
          if (chunk.includes('[RUNNING]') || totalOutput.includes('Cisco Tomcat[RUNNING]')) {
            await ctx.updateStatus('restarting_service', 'Tomcat running', 99);
            const logMessage = `\u2705 Cisco Tomcat service is now running on ${fqdn}`;
            status.logs.push(logMessage);
            if (connection.id) {
              await accountManager.saveRenewalLog(connection.id, fqdn, logMessage);
            }
          }
        },
      });

      if (restartResult.success) {
        Logger.info(`Successfully restarted Cisco Tomcat service for ${fqdn}`);
        const successMsg = `\u2705 Cisco Tomcat service restarted successfully on ${fqdn}`;
        status.logs.push(successMsg);
        if (connection.id) {
          await accountManager.saveRenewalLog(connection.id, fqdn, successMsg);
        }

        const outputMsg = `Service restart output: ${restartResult.output || 'Command completed'}`;
        status.logs.push(outputMsg);
        if (connection.id) {
          await accountManager.saveRenewalLog(connection.id, fqdn, outputMsg);
        }

        return { success: true, requiresManualRestart: false };
      } else {
        const isTimeout = restartResult.error?.includes('timeout');

        if (isTimeout) {
          const timeoutMsg = `Service restart initiated on ${fqdn} but confirmation timed out. The service is likely still restarting.`;
          Logger.warn(timeoutMsg);
          status.logs.push(`\u23f1\ufe0f ${timeoutMsg}`);
          if (connection.id) {
            await accountManager.saveRenewalLog(connection.id, fqdn, `\u23f1\ufe0f ${timeoutMsg}`);
          }

          const verifyMsg = `\ud83d\udccb Manual verification recommended: Check that Cisco Tomcat is running on ${fqdn}`;
          status.logs.push(verifyMsg);
          if (connection.id) {
            await accountManager.saveRenewalLog(connection.id, fqdn, verifyMsg);
          }

          return {
            success: false,
            requiresManualRestart: false,
            message: `Certificate installed successfully - Service restart confirmation timed out on ${fqdn}. Manual verification recommended.`,
          };
        } else {
          const errorMsg = `Failed to restart Cisco Tomcat service for ${fqdn}: ${restartResult.error}`;
          Logger.error(errorMsg);
          status.logs.push(`\u26a0\ufe0f ${errorMsg}`);
          if (connection.id) {
            await accountManager.saveRenewalLog(connection.id, fqdn, `\u26a0\ufe0f ${errorMsg}`);
          }

          const manualMsg = `\ud83d\udccb Manual action required: Run 'utils service restart Cisco Tomcat' on ${fqdn}`;
          status.logs.push(manualMsg);
          if (connection.id) {
            await accountManager.saveRenewalLog(connection.id, fqdn, manualMsg);
          }

          return {
            success: false,
            requiresManualRestart: true,
            message: `Service restart failed - Manual restart required on ${fqdn}`,
          };
        }
      }
    } catch (error: any) {
      const errorMsg = `Error during service restart for ${connection.hostname}: ${error.message}`;
      Logger.error(errorMsg);
      status.logs.push(`\u26a0\ufe0f ${errorMsg}`);
      status.logs.push(`\ud83d\udccb Manual action required: Run 'utils service restart Cisco Tomcat' on ${connection.hostname}.${connection.domain}`);
      return {
        success: false,
        requiresManualRestart: true,
        message: `Service restart error - Manual restart required on ${connection.hostname}.${connection.domain}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Renewal helper methods (moved from certificate-renewal.ts)
  // ---------------------------------------------------------------------------

  private async renewalUploadLeafCertificate(ctx: RenewalContext, certificate: string): Promise<void> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = `${connection.hostname}.${connection.domain}`;

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for VOS application certificate upload');
    }

    let certificates: string[] = [];
    const accountsDir = process.env.ACCOUNTS_DIR || './accounts';
    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const certDir = path.join(accountsDir, `connection-${connectionId}`, envDir);

    const certParts = certificate.split('-----END CERTIFICATE-----');
    const parsedCerts = certParts
      .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
      .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));

    if (parsedCerts.length === 0) {
      throw new Error('No certificates found in certificate chain');
    }

    certificates = [...parsedCerts];

    // Try to load and add root certificate if not already present
    try {
      const rootPath = path.join(certDir, 'root.crt');
      const rootCert = await fs.promises.readFile(rootPath, 'utf8');
      if (rootCert.trim()) {
        const hasRoot = certificates.some(cert => cert.includes('ISRG Root'));
        if (!hasRoot) {
          certificates.push(rootCert.trim());
          await ctx.saveLog(`Added root certificate to chain for VOS upload`);
        }
      }
    } catch (error) {
      await ctx.saveLog(`WARNING: Could not load root certificate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    const postData = JSON.stringify({
      service: 'tomcat',
      certificates: certificates,
    });

    const options = {
      hostname: fullFQDN,
      port: 443,
      path: '/platformcom/api/v1/certmgr/config/identity/certificates',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      rejectUnauthorized: false,
    };

    Logger.info(`VOS certificate chain upload request body: ${postData}`);
    await ctx.saveLog(`VOS certificate chain upload request to ${fullFQDN}:${options.port}${options.path}`);
    await ctx.saveLog(`Uploading full certificate chain (${certificates.length} certificates) to tomcat service`);
    await ctx.saveLog(`Certificate chain includes: leaf${certificates.length > 1 ? ', intermediate' : ''}${certificates.length > 2 ? ', root' : ''}`);

    return new Promise<void>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', async () => {
          try {
            Logger.info(`VOS certificate chain upload response: ${data}`);
            await ctx.saveLog(`VOS certificate chain upload response (${res.statusCode}): ${data}`);
            if (res.statusCode === 200 || res.statusCode === 201) {
              status.logs.push(`Certificate chain uploaded successfully to ${fullFQDN}`);
              await ctx.saveLog(`Certificate chain uploaded successfully to ${fullFQDN}`);
              resolve();
            } else {
              let errorMsg = `Certificate chain upload failed with status ${res.statusCode}`;
              try {
                const response = JSON.parse(data);
                if (response.message) {
                  errorMsg += `: ${response.message}`;
                } else if (response.error) {
                  errorMsg += `: ${response.error}`;
                } else {
                  errorMsg += `: ${data}`;
                }
              } catch {
                errorMsg += `: ${data || 'No response body'}`;
              }
              await ctx.saveLog(`ERROR: ${errorMsg}`);
              reject(new Error(errorMsg));
            }
          } catch (error) {
            const errorMsg = `Failed to parse certificate chain upload response: ${error}. Raw response: ${data}`;
            await ctx.saveLog(`ERROR: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        });
      });

      req.on('error', async (error) => {
        const errorMsg = `Leaf certificate upload failed: ${error.message}`;
        await ctx.saveLog(`ERROR: ${errorMsg}`);
        reject(new Error(errorMsg));
      });

      req.write(postData);
      req.end();
    });
  }

  private async renewalGetExistingTrustCertificates(connection: { hostname: string; domain: string; username?: string; password?: string }): Promise<string[]> {
    const fullFQDN = `${connection.hostname}.${connection.domain}`;

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for VOS application certificate operations');
    }

    return new Promise((resolve) => {
      const options = {
        hostname: fullFQDN,
        port: 443,
        path: '/platformcom/api/v1/certmgr/config/trust/certificate?service=tomcat',
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`,
        },
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const response = JSON.parse(data);
              const certificates = Array.isArray(response) ? response : response.certificates || [];
              const existingCerts = certificates.map((c: any) => c.certificate.trim());
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

  private async renewalUploadCaCertificates(ctx: RenewalContext, certificates: string[]): Promise<void> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = `${connection.hostname}.${connection.domain}`;

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for VOS application certificate upload');
    }

    const existingCerts = await this.renewalGetExistingTrustCertificates(connection);
    const certsToUpload = certificates.filter(c => !existingCerts.includes(c.trim()));

    if (certsToUpload.length === 0) {
      Logger.info('All CA certificates already exist on the server. Skipping upload.');
      status.logs.push('All CA certificates already exist on the server. Skipping upload.');
      await ctx.saveLog(`All CA certificates already exist on ${fullFQDN}. Skipping upload.`);
      await ctx.saveLog(`Found ${existingCerts.length} existing trust certificates on server`);
      return;
    }

    const postData = JSON.stringify({
      service: ['tomcat'],
      certificates: certsToUpload,
      description: 'Trust Certificate',
    });

    const options = {
      hostname: fullFQDN,
      port: 443,
      path: '/platformcom/api/v1/certmgr/config/trust/certificates',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      rejectUnauthorized: false,
    };

    Logger.info(`VOS CA cert upload request body: ${postData}`);
    await ctx.saveLog(`Uploading ${certsToUpload.length} CA certificate(s) to ${fullFQDN}:${options.port}${options.path}`);
    await ctx.saveLog(`CA cert request body: ${postData}`);

    return new Promise<void>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', async () => {
          try {
            Logger.info(`VOS CA cert upload response: ${data}`);
            await ctx.saveLog(`VOS CA cert upload response (${res.statusCode}): ${data}`);
            if (res.statusCode === 200 || res.statusCode === 201) {
              status.logs.push(`CA certificates uploaded successfully to ${fullFQDN}`);
              await ctx.saveLog(`CA certificates uploaded successfully to ${fullFQDN}`);
              resolve();
            } else {
              const response = JSON.parse(data);
              const errorMsg = `CA certificate upload failed: ${response.message || response.messages?.[0] || 'Unknown error'}`;
              await ctx.saveLog(`ERROR: ${errorMsg}`);
              await ctx.saveLog(`Full response: ${JSON.stringify(response, null, 2)}`);
              reject(new Error(errorMsg));
            }
          } catch (error) {
            const errorMsg = `Failed to parse CA cert upload response: ${error}. Raw response: ${data}`;
            await ctx.saveLog(`ERROR: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        });
      });

      req.on('error', async (error) => {
        const errorMsg = `CA certificate upload failed: ${error.message}`;
        await ctx.saveLog(`ERROR: ${errorMsg}`);
        reject(new Error(errorMsg));
      });

      req.write(postData);
      req.end();
    });
  }

  // VOS-specific utility methods
  async getSystemInfo(
    hostname: string,
    username: string,
    password: string
  ): Promise<any> {
    try {
      await this.connectSSH(hostname, username, password);
      const version = await this.executeSSHCommand('show version');
      const status = await this.executeSSHCommand('show status');
      await this.disconnectSSH();

      return {
        version: version.trim(),
        status: status.trim(),
        platform: 'vos'
      };
    } catch (error) {
      Logger.error(`Failed to get system info from ${hostname}:`, error);
      try {
        await this.disconnectSSH();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      return null;
    }
  }
}