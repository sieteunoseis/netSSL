import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Logger } from './logger';
import { DatabaseManager } from './database';
import { ConnectionRecord } from './types';
import { accountManager } from './account-manager';
import { SSHClient, SFTPUploadParams } from './ssh-client';
import { OperationStatusManager } from './services/operation-status-manager';
import { getDomainFromConnection } from './utils/domain-utils';
import { PlatformFactory } from './platform-providers/platform-factory';
import { ISEProvider } from './platform-providers/ise-provider';

export interface RenewalStatus {
  id: string;
  connectionId: number;
  status: 'pending' | 'generating_csr' | 'creating_account' | 'requesting_certificate' | 'creating_dns_challenge' | 'dns_validation' | 'waiting_dns_propagation' | 'waiting_manual_dns' | 'completing_validation' | 'downloading_certificate' | 'uploading_certificate' | 'restarting_service' | 'completed' | 'failed';
  message: string;
  progress: number;
  startTime: Date;
  endTime?: Date;
  error?: string;
  logs: string[];
  challenges?: any[];
  manualDNSEntry?: {
    recordName: string;
    recordValue: string;
    instructions: string;
  };
}

export interface CertificateRenewalService {
  renewCertificate(connectionId: number, database: DatabaseManager, operationManager: OperationStatusManager): Promise<RenewalStatus>;
  getRenewalStatus(renewalId: string): Promise<RenewalStatus | null>;
}

class CertificateRenewalServiceImpl implements CertificateRenewalService {
  private renewalStatuses: Map<string, RenewalStatus> = new Map();
  private database: DatabaseManager | null = null;
  private activeRenewals: Set<number> = new Set(); // Track active renewals by connection ID
  private authzRecords: any[] = []; // Store authorization records for DNS challenges
  private dnsRecordIds: string[] = []; // Store DNS record IDs for cleanup
  private cancellationTokens: Map<string, boolean> = new Map(); // Track cancellation tokens

  setDatabase(database: DatabaseManager): void {
    this.database = database;
  }

  async renewCertificate(connectionId: number, database: DatabaseManager, operationManager?: OperationStatusManager): Promise<RenewalStatus> {
    // Check if there's already an active renewal for this connection
    if (operationManager) {
      const existingOperation = await operationManager.checkActiveOperation(connectionId, 'certificate_renewal');
      if (existingOperation) {
        throw new Error('A certificate renewal is already in progress for this connection');
      }
    } else {
      // Check in-memory cache for legacy support
      if (this.activeRenewals.has(connectionId)) {
        throw new Error('A certificate renewal is already in progress for this connection');
      }
    }

    let renewalId: string;
    
    if (operationManager) {
      // Start the operation using the operation manager
      const operation = await operationManager.startOperation(connectionId, 'certificate_renewal', 'user', {
        hostname: 'pending', // Will be updated in performRenewal
        renewal_type: 'certificate'
      });
      renewalId = operation.id;
    } else {
      // Use legacy approach for cron jobs
      renewalId = crypto.randomUUID();
      this.activeRenewals.add(connectionId);
    }

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

    // Save to database (legacy support)
    await database.saveRenewalStatus(renewalId, connectionId, status.status, undefined, status.message, undefined, status.logs);

    // Start the renewal process asynchronously with comprehensive error handling
    this.performRenewal(renewalId, connectionId, database, operationManager).catch(async error => {
      try {
        Logger.error(`Certificate renewal failed for connection ${connectionId}:`, error);
        status.status = 'failed';
        status.error = error.message || 'Unknown error during certificate renewal';
        status.message = 'Certificate renewal failed';
        status.endTime = new Date();
        status.logs.push(`ERROR: ${status.error}`);
        
        // Update operation status if available
        if (operationManager) {
          await operationManager.updateOperation(renewalId, {
            status: 'failed',
            progress: 100,
            error: status.error,
            metadata: {
              logs: status.logs
            }
          });
        }
        
        // Save failed status to database (legacy support)
        if (database) {
          await database.saveRenewalStatus(
            renewalId,
            connectionId,
            'failed',
            undefined,
            'Certificate renewal failed',
            status.error,
            status.logs
          ).catch(err => {
            Logger.error(`Failed to save failed renewal status to database: ${err.message}`);
          });
        }
      } catch (cleanupError) {
        Logger.error(`Error during renewal cleanup for connection ${connectionId}:`, cleanupError);
      }
    }).finally(() => {
      // Always remove from active renewals when done (legacy support)
      this.activeRenewals.delete(connectionId);
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

  async cancelRenewal(renewalId: string): Promise<void> {
    Logger.info(`Cancelling renewal ${renewalId}`);
    
    // Set cancellation token
    this.cancellationTokens.set(renewalId, true);
    
    // Update status in memory
    const status = this.renewalStatuses.get(renewalId);
    if (status) {
      status.status = 'failed';
      status.error = 'Cancelled by administrator';
      status.message = 'Renewal cancelled by administrator';
      status.endTime = new Date();
      
      // Update in database
      if (this.database) {
        await this.database.saveRenewalStatus(
          renewalId,
          status.connectionId,
          'failed',
          new Date().toISOString(),
          'Renewal cancelled by administrator',
          'Cancelled by administrator',
          status.logs
        );
      }
      
      // Remove from active renewals
      this.activeRenewals.delete(status.connectionId);
    }
    
    Logger.info(`Renewal ${renewalId} has been cancelled`);
  }

  isCancelled(renewalId: string): boolean {
    return this.cancellationTokens.get(renewalId) === true;
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

  private async performRenewal(renewalId: string, connectionId: number, database: DatabaseManager, operationManager?: OperationStatusManager): Promise<void> {
    const status = this.renewalStatuses.get(renewalId)!;
    
    // Ensure database is set for this renewal
    if (!this.database) {
      this.database = database;
    }
    
    
    // Helper method to update status with operationManager
    const updateStatusWithOp = (newStatus: RenewalStatus['status'], message: string, progress: number) => 
      this.updateStatus(status, newStatus, message, progress, operationManager);
    
    // Helper method to check cancellation
    const checkCancellation = () => {
      if (this.isCancelled(renewalId)) {
        throw new Error('Operation cancelled by user');
      }
    };
    
    try {
      // Check cancellation at the start
      checkCancellation();
      // Get connection details
      const connection = await database.getConnectionById(connectionId);
      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      const fullFQDN = getDomainFromConnection(connection);
      if (!fullFQDN) {
        throw new Error(`Invalid connection configuration: missing hostname/domain for connection ${connectionId}`);
      }

      // Check for existing valid certificate
      const existingCert = await this.getExistingCertificate(fullFQDN);
      
      // For ISE, also check for recently generated certificates (within last hour)
      // This helps when retrying failed uploads
      let recentCert = null;
      if (!existingCert && connection.application_type === 'ise') {
        recentCert = await this.getRecentCertificate(connectionId, fullFQDN, 3600000); // 1 hour in milliseconds
        if (recentCert) {
          status.logs.push(`Found recently generated certificate for ${connection.name} (generated within last hour)`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Using recently generated certificate (less than 1 hour old)`);
        }
      }
      
      const certificateToUse = existingCert || recentCert;
      if (certificateToUse) {
        if (connection.application_type === 'general') {
          if (connection.enable_ssh && (connection.ssh_cert_path || connection.ssh_key_path)) {
            await updateStatusWithOp('uploading_certificate', 'Uploading existing certificate via SSH/SFTP', 80);
            const sshResult = await this.uploadCertificateViaSSH(connectionId, connection, status);
            if (!sshResult.success) {
              status.logs.push(`Falling back to manual download: ${sshResult.message}`);
            }
          } else {
            await updateStatusWithOp('uploading_certificate', 'Existing certificate available for download', 80);
            status.logs.push(`Existing valid certificate available for ${connection.name}`);
          }
        } else if (connection.application_type === 'ise') {
          await updateStatusWithOp('uploading_certificate', 'Using existing valid certificate for ISE', 80);
          await this.uploadCertificateToISE(connectionId, connection, certificateToUse, status);
        } else {
          await updateStatusWithOp('uploading_certificate', 'Using existing valid certificate', 80);
          await this.uploadCertificateToVOS(connectionId, connection, certificateToUse, status);
        }
        
        // Notify user about service restart attempt (VOS only)
        if (connection.application_type === 'vos' && connection.enable_ssh && connection.auto_restart_service) {
          await updateStatusWithOp('restarting_service', 'Restarting Tomcat...', 91);
        }
        
        // Handle service restart if enabled
        const restartResult = await this.handleServiceRestart(connection, status);
        
        // Set completion message based on restart result
        let completionMessage = 'Certificate renewal completed successfully';
        if (restartResult.requiresManualRestart) {
          completionMessage = `Certificate installed successfully - ${restartResult.message}`;
        }
        
        await updateStatusWithOp('completed', completionMessage, 100);
        status.endTime = new Date();
        return;
      }

      // Step 1: Get CSR based on application type
      let csr: string;
      if (connection.application_type === 'general') {
        // For general applications, use the provided custom CSR
        await updateStatusWithOp('generating_csr', 'Processing custom CSR for general application', 10);
        
        if (!connection.custom_csr) {
          throw new Error('Custom CSR is required for general applications');
        }
        
        // Extract CSR and private key if both are present
        const customCsrContent = connection.custom_csr;
        
        // Look for CSR section
        const csrMatch = customCsrContent.match(/-----BEGIN CERTIFICATE REQUEST-----[\s\S]*?-----END CERTIFICATE REQUEST-----/);
        if (!csrMatch) {
          throw new Error('Valid CSR not found in custom CSR field');
        }
        csr = csrMatch[0];
        
        // Look for private key section (supports both PRIVATE KEY and RSA PRIVATE KEY formats)
        const privateKeyMatch = customCsrContent.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA )?PRIVATE KEY-----/);
        
        status.logs.push(`Using custom CSR for general application: ${connection.name}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Using custom CSR for general application: ${connection.name}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `CSR length: ${csr.length} characters`);
        
        // Save the CSR to accounts folder for record keeping
        await accountManager.saveCSR(connectionId, fullFQDN, csr);
        
        // If private key is included in CSR field or in separate general_private_key field, save it
        let privateKey: string | null = null;
        if (privateKeyMatch) {
          privateKey = privateKeyMatch[0];
          status.logs.push(`Private key found in CSR field for ${connection.name}`);
        } else if (connection.general_private_key && connection.general_private_key.trim()) {
          const gkMatch = connection.general_private_key.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA )?PRIVATE KEY-----/);
          if (gkMatch) {
            privateKey = gkMatch[0];
            status.logs.push(`Private key found in general_private_key field for ${connection.name}`);
          }
        }

        if (privateKey) {
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Private key found and saved for ${connection.name}`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Private key length: ${privateKey.length} characters`);

          // Save private key to accounts folder in the appropriate environment subdirectory
          const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
          const envDir = isStaging ? 'staging' : 'prod';
          const domainDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);

          // Ensure the directory exists
          await fs.promises.mkdir(domainDir, { recursive: true });

          const privateKeyPath = path.join(domainDir, 'private_key.pem');
          await fs.promises.writeFile(privateKeyPath, privateKey);
        } else {
          status.logs.push(`No private key found - only CSR will be processed. Certificate will be issued but key must be uploaded manually.`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `No private key found in CSR or general_private_key fields`);
        }
      } else if (connection.application_type === 'ise') {
        // For ISE applications, use the provided CSR if available, otherwise generate one
        if (connection.ise_certificate && connection.ise_certificate.trim()) {
          await updateStatusWithOp('generating_csr', 'Using provided CSR from ISE connection', 10);
          
          // Extract CSR from the provided certificate field
          const csrMatch = connection.ise_certificate.match(/-----BEGIN CERTIFICATE REQUEST-----[\s\S]*?-----END CERTIFICATE REQUEST-----/);
          if (!csrMatch) {
            throw new Error('Valid CSR not found in ISE certificate field');
          }
          csr = csrMatch[0];
          
          status.logs.push(`Using provided CSR for ISE application: ${connection.name}`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Using provided CSR for ISE application: ${connection.name}`);
        } else {
          // Generate CSR using ISE provider
          await updateStatusWithOp('generating_csr', 'Generating CSR from ISE application API', 10);
          csr = await this.generateCSRFromISE(connection, status, connectionId);
        }
      } else {
        // For VOS applications (CUCM, CER, CUC, IM&P), generate CSR from API
        await updateStatusWithOp('generating_csr', 'Generating CSR from VOS application API', 10);
        csr = await this.generateCSRFromVOS(connection, status, connectionId);
      }
      
      // Check cancellation before certificate request
      checkCancellation();
      
      // Now continue with Let's Encrypt certificate request
      await updateStatusWithOp('requesting_certificate', 'Requesting certificate from Let\'s Encrypt', 20);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `DEBUG: About to call requestCertificate method`);
      const certificate = await this.requestCertificate(connection, csr, database, status, connectionId, operationManager);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `DEBUG: requestCertificate returned, certificate length: ${certificate ? certificate.length : 'null/undefined'}`);
      
      // Step 4: Handle certificate installation based on application type
      if (connection.application_type === 'general') {
        // For general applications, save files locally then optionally upload via SSH/SFTP
        await updateStatusWithOp('uploading_certificate', 'Saving certificate files...', 85);
        status.logs.push(`Certificate generated for ${connection.name}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate generated for ${connection.name}`);
        const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
        const envDir = isStaging ? 'staging' : 'prod';
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate files available in: ./accounts/connection-${connectionId}/${envDir}/`);

        // Create CRT and KEY files for easier manual import
        try {
          const domainEnvDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
          const certPath = path.join(domainEnvDir, 'certificate.pem');
          const privateKeyPath = path.join(domainEnvDir, 'private_key.pem');

          // Create .crt file from certificate.pem
          if (fs.existsSync(certPath)) {
            const certContent = await fs.promises.readFile(certPath, 'utf8');
            const crtPath = path.join(domainEnvDir, `${fullFQDN}.crt`);
            await fs.promises.writeFile(crtPath, certContent);
            status.logs.push(`Created ${fullFQDN}.crt file`);
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `Created ${fullFQDN}.crt file`);
          }

          // Create .key file from private_key.pem
          if (fs.existsSync(privateKeyPath)) {
            const keyContent = await fs.promises.readFile(privateKeyPath, 'utf8');
            if (keyContent.trim()) {
              const keyPath = path.join(domainEnvDir, `${fullFQDN}.key`);
              await fs.promises.writeFile(keyPath, keyContent);
              status.logs.push(`Created ${fullFQDN}.key file`);
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `Created ${fullFQDN}.key file`);
            }
          }
        } catch (error) {
          status.logs.push(`Warning: Could not create CRT/KEY files: ${error instanceof Error ? error.message : 'Unknown error'}`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Warning: Could not create CRT/KEY files: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Upload via SSH/SFTP if configured
        if (connection.enable_ssh && (connection.ssh_cert_path || connection.ssh_key_path)) {
          await updateStatusWithOp('uploading_certificate', 'Uploading certificate via SSH/SFTP...', 90);
          const sshResult = await this.uploadCertificateViaSSH(connectionId, connection, status);
          if (sshResult.success) {
            status.logs.push('Certificate installed on remote server via SSH/SFTP');
          } else {
            status.logs.push(`SSH/SFTP upload failed: ${sshResult.message} - files still available for manual download`);
          }
        } else {
          await updateStatusWithOp('uploading_certificate', 'Certificate ready for download', 90);
          status.logs.push(`Certificate ready for manual installation on ${connection.name}`);
        }
      } else if (connection.application_type === 'ise') {
        // For ISE applications, upload via ISE API
        await updateStatusWithOp('uploading_certificate', 'Uploading certificate to ISE nodes', 90);
        await this.uploadCertificateToISE(connectionId, connection, certificate, status);
      } else {
        // For VOS applications, upload via API
        await updateStatusWithOp('uploading_certificate', 'Uploading certificate to VOS application', 90);
        await this.uploadCertificateToVOS(connectionId, connection, certificate, status);
        // Clear cached CSR after successful upload — VOS has consumed it
        await accountManager.clearCSR(connectionId, fullFQDN);
      }
      
      // Notify user about service restart attempt (VOS only)
      if (connection.application_type === 'vos' && connection.enable_ssh && connection.auto_restart_service) {
        await updateStatusWithOp('restarting_service', 'Restarting Tomcat...', 91);
      }
      
      // Handle service restart if enabled
      const restartResult = await this.handleServiceRestart(connection, status);
      
      // Set completion message based on restart result
      let completionMessage = 'Certificate renewal completed successfully';
      if (restartResult.requiresManualRestart) {
        completionMessage = `Certificate installed successfully - ${restartResult.message}`;
      }
      
      await updateStatusWithOp('completed', completionMessage, 100);
      status.endTime = new Date();
      
      // Save the renewal completion info
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate renewal completed for renewal ${renewalId}`);
      
      // Update database with renewal info
      await this.updateDatabaseWithRenewal(connectionId, database);
      
    } catch (error) {
      Logger.error(`Certificate renewal error for ${renewalId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      status.error = errorMessage;
      status.endTime = new Date();
      status.logs.push(`ERROR: ${errorMessage}`);
      await updateStatusWithOp('failed', `Certificate renewal failed: ${errorMessage}`, 0);
      // Clear cached CSR on failure so next retry generates a fresh one from VOS
      try {
        const conn = await database.getConnectionById(connectionId);
        if (conn) {
          const fqdn = getDomainFromConnection(conn);
          if (fqdn) await accountManager.clearCSR(connectionId, fqdn);
        }
      } catch (clearErr) {
        Logger.warn(`Failed to clear CSR after renewal failure: ${clearErr}`);
      }
    } finally {
      // Always remove from active renewals
      this.activeRenewals.delete(connectionId);
    }
  }

  private async getRecentCertificate(connectionId: number, domain: string, maxAgeMs: number): Promise<string | null> {
    try {
      // Use connection-based directory structure
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envDir = isStaging ? 'staging' : 'prod';
      const connectionDir = path.join(process.env.ACCOUNTS_DIR || './accounts', `connection-${connectionId}`, envDir);
      
      // Try different certificate file names in order of preference
      const certFiles = ['fullchain.pem', 'certificate.pem', `${domain}.crt`];
      
      for (const certFile of certFiles) {
        const certPath = path.join(connectionDir, certFile);
        
        if (fs.existsSync(certPath)) {
          try {
            // Check file modification time
            const stats = await fs.promises.stat(certPath);
            const fileAge = Date.now() - stats.mtime.getTime();
            
            if (fileAge <= maxAgeMs) {
              const certificateData = await fs.promises.readFile(certPath, 'utf8');
              const envType = isStaging ? 'staging' : 'production';
              Logger.info(`Found recent certificate for ${domain} (${Math.round(fileAge / 60000)} minutes old, ${envType}): ${certPath}`);
              return certificateData;
            }
            
            Logger.info(`Certificate found but too old (${Math.round(fileAge / 60000)}min old, max ${Math.round(maxAgeMs / 60000)}min): ${certPath}`);
          } catch (statError: any) {
            Logger.error(`Error checking file stats for ${certPath}:`, statError);
          }
        }
      }
      
      Logger.info(`No recent certificate found for connection ${connectionId} in ${connectionDir}`);
      return null;
    } catch (error) {
      Logger.error(`Error checking for recent certificate for connection ${connectionId}, domain ${domain}:`, error);
      return null;
    }
  }

  private async getExistingCertificate(domain: string): Promise<string | null> {
    try {
      // Use environment-specific directory structure
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envDir = isStaging ? 'staging' : 'prod';
      const fullChainPath = path.join(process.env.ACCOUNTS_DIR || './accounts', domain, envDir, 'fullchain.pem');
      
      if (!fs.existsSync(fullChainPath)) {
        // Try to find certificate.pem as fallback
        const certPath = path.join(process.env.ACCOUNTS_DIR || './accounts', domain, envDir, 'certificate.pem');
        if (!fs.existsSync(certPath)) {
          return null;
        }
        
        const certificateData = await fs.promises.readFile(certPath, 'utf8');
        const cert = new crypto.X509Certificate(certificateData);

        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        if (new Date(cert.validTo) > thirtyDaysFromNow) {
          const envType = isStaging ? 'staging' : 'production';
          Logger.info(`Found existing certificate for ${domain} that is valid for more than 30 days (${envType}).`);
          return certificateData;
        }

        return null;
      }

      const certificateData = await fs.promises.readFile(fullChainPath, 'utf8');
      const cert = new crypto.X509Certificate(certificateData);

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      if (new Date(cert.validTo) > thirtyDaysFromNow) {
        const envType = isStaging ? 'staging' : 'production';
        Logger.info(`Found existing certificate for ${domain} that is valid for more than 30 days (${envType}).`);
        return certificateData;
      }

      return null;
    } catch (error) {
      Logger.error(`Error checking for existing certificate for ${domain}:`, error);
      return null;
    }
  }

  private async updateStatus(status: RenewalStatus, newStatus: RenewalStatus['status'], message: string, progress: number, operationManager?: OperationStatusManager): Promise<void> {
    status.status = newStatus;
    status.message = message;
    status.progress = progress;
    status.logs.push(`${new Date().toISOString()}: ${message}`);
    Logger.info(`Renewal ${status.id}: ${message}`);
    
    // Update operation status - this will automatically emit WebSocket events
    if (operationManager) {
      const metadata: any = {
        logs: status.logs,
        renewal_status: newStatus
      };
      
      // Include manual DNS entry if present
      if (status.manualDNSEntry) {
        metadata.manualDNSEntry = status.manualDNSEntry;
        Logger.info(`Including manualDNSEntry in metadata: ${JSON.stringify(status.manualDNSEntry)}`);
      }
      
      await operationManager.updateOperation(status.id, {
        status: newStatus === 'completed' ? 'completed' : newStatus === 'failed' ? 'failed' : 'in_progress',
        progress: progress,
        message: message,
        metadata
      });
    }
    
    // Save to database if available (legacy support)
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

  private async generateCSRFromVOS(connection: ConnectionRecord, status: RenewalStatus, connectionId: number): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        // Construct full FQDN from hostname and domain
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
        
        // Log detailed CSR information to renewal log
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `=== CSR Generation Request ===`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Target: ${fullFQDN}:${options.port}${options.path}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Service: ${csrPayload.service}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Common Name: ${csrPayload.commonName}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Key Type: ${csrPayload.keyType}, Length: ${csrPayload.keyLength}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Hash Algorithm: ${csrPayload.hashAlgorithm}`);
        if (altNames.length > 0) {
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Alt Names: ${altNames.join(', ')}`);
        }
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Request Body: ${postData}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Using credentials for user: ${connection.username}`);
        
        // Test basic connectivity first
        Logger.info(`Testing VOS connectivity and authentication...`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Testing VOS connectivity and authentication...`);
        
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', async () => {
            try {
              Logger.info(`CSR API Response Status: ${res.statusCode}`);
              Logger.info(`CSR API Response Body: ${data}`);
              
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `CSR API Response Status: ${res.statusCode}`);
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `CSR API Response Body: ${data}`);
              
              if (res.statusCode !== 200) {
                const errorMsg = `CSR API returned status ${res.statusCode}: ${data}`;
                await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
                reject(new Error(errorMsg));
                return;
              }
              
              const response = JSON.parse(data);
              if (response.csr) {
                // Save CSR to accounts folder
                await accountManager.saveCSR(connectionId, fullFQDN, response.csr);
                await accountManager.saveRenewalLog(connectionId, fullFQDN, `Generated new CSR from ${fullFQDN} for service: tomcat`);
                await accountManager.saveRenewalLog(connectionId, fullFQDN, `CSR length: ${response.csr.length} characters`);
                
                status.logs.push(`CSR generated successfully from ${fullFQDN} for service: tomcat`);
                resolve(response.csr);
              } else {
                const errorMsg = `CSR not found in response. Response: ${JSON.stringify(response)}`;
                await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
                reject(new Error(errorMsg));
              }
            } catch (error) {
              const errorMsg = `Failed to parse CSR response: ${error}. Raw response: ${data}`;
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
              reject(new Error(errorMsg));
            }
          });
        });

        req.on('error', async (error) => {
          const errorMsg = `CSR generation failed: ${error.message}`;
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
          reject(new Error(errorMsg));
        });

        req.write(postData);
        req.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private async requestCertificate(connection: ConnectionRecord, csr: string, database: DatabaseManager, status: RenewalStatus, connectionId: number, operationManager?: OperationStatusManager): Promise<string> {
    // Get SSL provider settings
    const sslProvider = connection.ssl_provider || 'letsencrypt';
    const settings = await database.getSettingsByProvider(sslProvider);
    
    if (sslProvider === 'letsencrypt') {
      return this.requestLetsEncryptCertificate(connection, csr, settings, database, status, connectionId, operationManager);
    } else if (sslProvider === 'zerossl') {
      return this.requestZeroSSLCertificate(connection, csr, settings, status, operationManager);
    } else {
      throw new Error(`Unsupported SSL provider: ${sslProvider}`);
    }
  }

  private async requestLetsEncryptCertificate(connection: ConnectionRecord, csr: string, settings: any[], database: DatabaseManager, status: RenewalStatus, connectionId: number, operationManager?: OperationStatusManager): Promise<string> {
    try {
      const { acmeClient } = await import('./acme-client');
      
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      
      // Parse altNames from connection
      const altNames = connection.alt_names 
        ? connection.alt_names.split(',').map(name => name.trim()).filter(name => name.length > 0)
        : [];
      
      const domains = [fullFQDN, ...altNames];
      
      // Log renewal start
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `=== Let's Encrypt Certificate Renewal Started ===`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Domains: ${domains.join(', ')}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Environment: ${process.env.LETSENCRYPT_STAGING !== 'false' ? 'STAGING' : 'PRODUCTION'}`);
      
      await this.updateStatus(status, 'creating_account', 'Setting up Let\'s Encrypt account', 20);
      
      // Load existing ACME account
      const account = await acmeClient.loadAccount(fullFQDN, connectionId);
      if (!account) {
        const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
        const envType = isStaging ? 'STAGING' : 'PRODUCTION';
        const errorMsg = `No Let's Encrypt account found for ${fullFQDN} in ${envType} mode. The account should have been created during server startup. Please restart the server to create missing accounts.`;
        
        Logger.error(errorMsg);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
        
        // Try to create account as fallback
        const email = settings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
        if (!email) {
          throw new Error('Let\'s Encrypt email not configured in settings. Please add LETSENCRYPT_EMAIL to your settings.');
        }
        
        Logger.info(`Attempting to create account as fallback with email: ${email}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Attempting to create account as fallback with email: ${email}`);
        
        try {
          const newAccount = await acmeClient.createAccount(email, fullFQDN, connectionId);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Account created successfully as fallback`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Account URL: ${newAccount.accountUrl}`);
        } catch (accountError) {
          Logger.error(`Failed to create account as fallback:`, accountError);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Failed to create account: ${accountError instanceof Error ? accountError.message : 'Unknown error'}`);
          throw new Error(`Failed to create Let's Encrypt account for ${fullFQDN}. ${accountError instanceof Error ? accountError.message : 'Unknown error'}`);
        }
      } else {
        Logger.info(`Using existing account for domain: ${fullFQDN}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Using existing account for domain: ${fullFQDN}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Account URL: ${account.accountUrl}`);
      }
      
      await this.updateStatus(status, 'requesting_certificate', 'Requesting certificate from Let\'s Encrypt', 30);
      
      // Create certificate order
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Creating certificate order for domains: ${domains.join(', ')}`);
      const order = await acmeClient.requestCertificate(csr, domains);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate order created: ${order.order.url}`);
      
      await this.updateStatus(status, 'creating_dns_challenge', 'Setting up DNS challenges', 40);
      
      // Check DNS challenge mode and provider
      Logger.info(`DNS provider from connection: raw='${connection.dns_provider}', type=${typeof connection.dns_provider}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `DNS provider from connection: raw='${connection.dns_provider}', type=${typeof connection.dns_provider}`);
      const dnsProvider = connection.dns_provider || 'cloudflare';
      Logger.info(`Resolved DNS provider: '${dnsProvider}'`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Resolved DNS provider: '${dnsProvider}'`);
      
      // Store challenges for manual mode
      status.challenges = order.challenges.map(challenge => ({
        ...challenge,
        keyAuthorization: '' // Will be filled later
      }));
      
      // Determine if we should use manual DNS
      let forceManualDNS = false;
      
      // Always use manual for custom DNS provider
      if (dnsProvider === 'custom') {
        forceManualDNS = true;
      } else {
        // For other providers, check if API keys are available
        try {
          const settings = await this.database!.getSettingsByProvider(dnsProvider);
          
          // Check for required API keys based on provider
          let hasRequiredKeys = false;
          
          switch (dnsProvider) {
            case 'cloudflare':
              const cfKey = settings.find(s => s.key_name === 'CF_KEY')?.key_value;
              const cfZone = settings.find(s => s.key_name === 'CF_ZONE')?.key_value;
              hasRequiredKeys = !!(cfKey && cfZone);
              break;
            case 'digitalocean':
              const doKey = settings.find(s => s.key_name === 'DO_KEY')?.key_value;
              hasRequiredKeys = !!doKey;
              break;
            case 'route53':
              const awsKey = settings.find(s => s.key_name === 'AWS_ACCESS_KEY')?.key_value;
              const awsSecret = settings.find(s => s.key_name === 'AWS_SECRET_KEY')?.key_value;
              const awsZone = settings.find(s => s.key_name === 'AWS_ZONE_ID')?.key_value;
              hasRequiredKeys = !!(awsKey && awsSecret && awsZone);
              break;
            case 'azure':
              const azureSub = settings.find(s => s.key_name === 'AZURE_SUBSCRIPTION_ID')?.key_value;
              const azureRg = settings.find(s => s.key_name === 'AZURE_RESOURCE_GROUP')?.key_value;
              const azureZone = settings.find(s => s.key_name === 'AZURE_ZONE_NAME')?.key_value;
              hasRequiredKeys = !!(azureSub && azureRg && azureZone);
              break;
            case 'google':
              const googleProject = settings.find(s => s.key_name === 'GOOGLE_PROJECT_ID')?.key_value;
              const googleZone = settings.find(s => s.key_name === 'GOOGLE_ZONE_NAME')?.key_value;
              hasRequiredKeys = !!(googleProject && googleZone);
              break;
            default:
              hasRequiredKeys = false;
          }
          
          if (!hasRequiredKeys) {
            forceManualDNS = true;
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `API keys not configured for ${dnsProvider} provider, falling back to manual DNS`);
            status.logs.push(`API keys not configured for ${dnsProvider} provider, using manual DNS mode`);
          }
        } catch (error) {
          // If we can't check settings, fall back to manual
          forceManualDNS = true;
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Failed to check API keys for ${dnsProvider} provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
          status.logs.push(`Failed to check API keys, using manual DNS mode`);
        }
      }
      
      if (forceManualDNS) {
        const reason = dnsProvider === 'custom' ? 'custom DNS provider' : 'API keys not configured';
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Manual DNS challenge required (${reason}) for ${dnsProvider} provider`);
        status.logs.push(`Manual DNS challenge required (${reason})`);
        
        // Add key authorizations to challenges for manual mode
        for (let i = 0; i < order.challenges.length; i++) {
          const challenge = order.challenges[i];
          const keyAuthorization = await acmeClient.getChallengeKeyAuthorization(challenge);
          status.challenges[i].keyAuthorization = keyAuthorization;
        }
        
        // Use custom DNS handler for manual mode
        await this.handleCustomDNSChallenge(connectionId, connection, [], status, operationManager);
        
        // Complete the challenges
        await this.updateStatus(status, 'completing_validation', 'Completing Let\'s Encrypt validation', 70);
        for (const challenge of order.challenges) {
          await acmeClient.completeChallenge(challenge);
        }
        
        // Wait for order completion and finalize certificate
        await acmeClient.waitForOrderCompletion(order.order, 300000); // 5 minutes
        const certificateData = await acmeClient.finalizeCertificate(order.order, csr);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, 'Let\'s Encrypt certificate downloaded successfully');
        status.logs.push('Let\'s Encrypt certificate downloaded successfully');
        
        // Save certificate and chain to accounts folder with individual certificate extraction
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `DEBUG: About to save certificate chain. Certificate data length: ${certificateData.length}`);
        Logger.debug(`About to save certificate chain for ${fullFQDN}. Certificate data length: ${certificateData.length}`);
        
        if (!certificateData || certificateData.length === 0) {
          throw new Error('Certificate data is empty - cannot save certificate chain');
        }
        
        await this.saveCertificateChain(connectionId, fullFQDN, certificateData, status);
        
        return certificateData;
      }
      
      // Try automated DNS provider first, fall back to manual on failure
      try {
        // Dynamically initialize the correct DNS provider based on connection config
        let provider: any;
        switch (dnsProvider) {
          case 'cloudflare': {
            const { CloudflareProvider } = await import('./dns-providers/cloudflare');
            provider = await CloudflareProvider.create(database, fullFQDN);
            break;
          }
          case 'route53': {
            const { Route53DNSProvider } = await import('./dns-providers/route53');
            provider = await Route53DNSProvider.create(database, fullFQDN);
            break;
          }
          case 'digitalocean': {
            const { DigitalOceanDNSProvider } = await import('./dns-providers/digitalocean');
            provider = await DigitalOceanDNSProvider.create(database, fullFQDN);
            break;
          }
          case 'azure': {
            const { AzureDNSProvider } = await import('./dns-providers/azure');
            provider = await AzureDNSProvider.create(database, fullFQDN);
            break;
          }
          case 'google': {
            const { GoogleDNSProvider } = await import('./dns-providers/google');
            provider = await GoogleDNSProvider.create(database, fullFQDN);
            break;
          }
          default:
            throw new Error(`Unsupported DNS provider for automated challenges: ${dnsProvider}`);
        }
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `${dnsProvider} DNS provider initialized`);

        // Create DNS TXT records for challenges
        const dnsRecords: any[] = [];
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Setting up ${order.challenges.length} DNS challenge(s)`);

        for (const challenge of order.challenges) {
          const keyAuthorization = await acmeClient.getChallengeKeyAuthorization(challenge);

          // Log the key authorization for debugging
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Key authorization: ${keyAuthorization}`);

          const dnsValue = acmeClient.getDNSRecordValue(keyAuthorization);

          // Extract domain from challenge
          const challengeDomain = challenge.url.includes('identifier')
            ? domains.find(d => challenge.url.includes(d)) || domains[0]
            : domains[0];

          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Processing challenge for domain: ${challengeDomain}`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Challenge URL: ${challenge.url}`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `DNS value: ${dnsValue}`);

          const acmeRecordName = `_acme-challenge.${challengeDomain}`;

          // Clean up any existing TXT records before creating new one (Cloudflare only)
          if (dnsProvider === 'cloudflare' && typeof provider.cleanupTxtRecords === 'function') {
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `Cleaning up existing TXT records for ${challengeDomain}`);
            await provider.cleanupTxtRecords(challengeDomain);
          }

          // Use createDNSRecord (available on all providers) with the full _acme-challenge record name
          const record = await provider.createDNSRecord(acmeRecordName, dnsValue, 'TXT');
          dnsRecords.push({ record, challenge, domain: challengeDomain });

          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Created DNS TXT record for ${challengeDomain}: ${record.id}`);
          status.logs.push(`Created DNS TXT record for ${challengeDomain}: ${record.id}`);
        }

        await this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation', 50);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Waiting for DNS propagation of ${dnsRecords.length} record(s)`);

        // Wait for DNS propagation
        for (const { challenge, domain } of dnsRecords) {
          const keyAuthorization = await acmeClient.getChallengeKeyAuthorization(challenge);
          const expectedValue = acmeClient.getDNSRecordValue(keyAuthorization);
          const acmeRecordName = `_acme-challenge.${domain}`;

          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Verifying DNS propagation for ${domain}, expected value: ${expectedValue}`);

          // Cloudflare uses verifyTxtRecord (which prepends _acme-challenge internally),
          // all other providers use waitForDNSPropagation with the full record name
          let isVerified: boolean;
          if (dnsProvider === 'cloudflare' && typeof provider.verifyTxtRecord === 'function') {
            isVerified = await provider.verifyTxtRecord(domain, expectedValue);
          } else {
            isVerified = await provider.waitForDNSPropagation(acmeRecordName, expectedValue);
          }

          if (!isVerified) {
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: DNS propagation verification failed for ${domain}`);
            throw new Error(`DNS propagation verification failed for ${domain}`);
          }

          await accountManager.saveRenewalLog(connectionId, fullFQDN, `DNS propagation verified for ${domain}`);
          status.logs.push(`DNS propagation verified for ${domain}`);
        }

        await this.updateStatus(status, 'completing_validation', 'Completing Let\'s Encrypt validation', 70);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Completing ${dnsRecords.length} Let's Encrypt challenge(s)`);

        // Complete challenges
        for (const { challenge } of dnsRecords) {
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Completing challenge: ${challenge.url}`);
          await acmeClient.completeChallenge(challenge);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Challenge completed successfully: ${challenge.url}`);
        }

        // Add delay to ensure Let's Encrypt processes the completed challenges
        Logger.info('Waiting for Let\'s Encrypt to process challenge completion...');
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Waiting 3 seconds for Let's Encrypt to process challenge completion...`);
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Wait for order completion
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Waiting for order completion: ${order.order.url}`);
        const completedOrder = await acmeClient.waitForOrderCompletion(order.order);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Order completed successfully`);

        await this.updateStatus(status, 'downloading_certificate', 'Downloading certificate', 80);

        // Finalize and get certificate
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Finalizing certificate order`);
        const certificate = await acmeClient.finalizeCertificate(completedOrder, csr);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate downloaded successfully`);

        // Clean up DNS records - skip in staging mode for debugging
        const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
        if (!isStaging || process.env.LETSENCRYPT_CLEANUP_DNS === 'true') {
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Cleaning up ${dnsRecords.length} DNS TXT record(s)`);
          for (const { record } of dnsRecords) {
            try {
              // Cloudflare uses deleteTxtRecord, all other providers use deleteDNSRecord
              if (dnsProvider === 'cloudflare' && typeof provider.deleteTxtRecord === 'function') {
                await provider.deleteTxtRecord(record.id);
              } else {
                await provider.deleteDNSRecord(record.id);
              }
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `Cleaned up DNS TXT record: ${record.id}`);
              status.logs.push(`Cleaned up DNS TXT record: ${record.id}`);
            } catch (error) {
              Logger.warn(`Failed to clean up DNS record ${record.id}:`, error);
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `WARNING: Failed to clean up DNS record ${record.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }
        } else {
          Logger.info(`Skipping DNS record cleanup in staging mode (${dnsRecords.length} records)`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Skipping DNS record cleanup in staging mode (${dnsRecords.length} records)`);
          status.logs.push(`Skipped DNS cleanup in staging mode for debugging`);
        }

        // Save certificate and chain to accounts folder with individual certificate extraction
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `DEBUG: About to save certificate chain. Certificate data length: ${certificate.length}`);
        Logger.debug(`About to save certificate chain for ${fullFQDN}. Certificate data length: ${certificate.length}`);

        if (!certificate || certificate.length === 0) {
          throw new Error('Certificate data is empty - cannot save certificate chain');
        }

        await this.saveCertificateChain(connectionId, fullFQDN, certificate, status);

        await accountManager.saveRenewalLog(connectionId, fullFQDN, `=== Certificate obtained successfully from Let's Encrypt ===`);
        status.logs.push('Certificate obtained from Let\'s Encrypt');
        return certificate;
      
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        Logger.error(`Automated DNS provider failed: ${errorMessage}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Automated DNS failed for ${dnsProvider}: ${errorMessage}`);

        // Don't silently fall back to manual DNS for API providers — fail with the actual error
        // so the user can fix their provider configuration and retry
        throw new Error(`${dnsProvider} DNS provider failed: ${errorMessage}`);
      }
      
    } catch (error) {
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      Logger.error('Let\'s Encrypt certificate request failed:', error);
      
      // Log detailed error information
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `=== ERROR: Let's Encrypt certificate request failed ===`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof Error && error.stack) {
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Stack trace: ${error.stack}`);
      }
      
      // If it's a JSON error with detailed info, log that too
      try {
        const errorObj = JSON.parse(error instanceof Error ? error.message : String(error));
        if (errorObj && typeof errorObj === 'object') {
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Detailed error: ${JSON.stringify(errorObj, null, 2)}`);
          
          // If we have authorization URLs, try to get detailed auth info
          if (errorObj.authorizations && Array.isArray(errorObj.authorizations)) {
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `Attempting to fetch detailed authorization information...`);
            // The detailed auth info will be logged by the ACME client's enhanced error handling
          }
        }
      } catch {
        // Not a JSON error, ignore
      }
      
      throw error;
    }
  }

  private async requestZeroSSLCertificate(connection: ConnectionRecord, csr: string, _settings: any[], status: RenewalStatus, operationManager?: OperationStatusManager): Promise<string> {
    try {
      const { ZeroSSLProvider } = await import('./ssl-providers/zerossl');
      const { MXToolboxService } = await import('./services/mxtoolbox');
      
      if (!this.database) {
        throw new Error('Database not initialized');
      }

      const zeroSSL = await ZeroSSLProvider.create(this.database);
      const mxToolbox = await MXToolboxService.create(this.database);
      
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      const domains = [fullFQDN];
      
      // Add alt_names if provided
      if (connection.alt_names) {
        const altNames = connection.alt_names.split(',').map(name => name.trim()).filter(name => name);
        domains.push(...altNames);
      }

      await this.updateStatus(status, 'requesting_certificate', 'Creating ZeroSSL certificate request', 30);
      
      // Create certificate with ZeroSSL
      const certificate = await zeroSSL.createCertificate(domains, csr);
      status.logs.push(`ZeroSSL certificate created with ID: ${certificate.id}`);

      await this.updateStatus(status, 'creating_dns_challenge', 'Setting up DNS validation', 40);
      
      // Get validation details
      const validations = await zeroSSL.getValidationDetails(certificate.id);
      status.logs.push(`Retrieved validation details for ${validations.length} domains`);

      // Create DNS records for validation
      const dnsProvider = connection.dns_provider || 'cloudflare';
      
      for (const validation of validations) {
        if (validation.details?.cname_validation_p1 && validation.details?.cname_validation_p2) {
          const recordName = validation.details.cname_validation_p1;
          const recordValue = validation.details.cname_validation_p2;
          
          status.logs.push(`Creating CNAME record: ${recordName} -> ${recordValue}`);
          
          // Create DNS record using the configured DNS provider
          await this.createDNSRecordForValidation(dnsProvider, recordName, recordValue, 'CNAME');
          
          // Store record for cleanup
          this.dnsRecordIds.push(`CNAME_${recordName}`);
        }
      }

      await this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation via MXToolbox', 50);
      
      // Wait for DNS propagation using MXToolbox
      for (const validation of validations) {
        if (validation.details?.cname_validation_p1 && validation.details?.cname_validation_p2) {
          const recordName = validation.details.cname_validation_p1;
          const recordValue = validation.details.cname_validation_p2;
          
          const isVerified = await mxToolbox.waitForDNSPropagation(
            recordName,
            recordValue,
            'CNAME',
            180000 // 3 minutes timeout
          );
          
          if (!isVerified) {
            throw new Error(`DNS propagation failed for ${recordName}`);
          }
          
          status.logs.push(`CNAME record verified: ${recordName}`);
        }
      }

      await this.updateStatus(status, 'completing_validation', 'Triggering ZeroSSL validation', 70);
      
      // Verify domains with ZeroSSL
      for (const validation of validations) {
        await zeroSSL.verifyDomain(certificate.id, validation.domain);
        status.logs.push(`Verification triggered for ${validation.domain}`);
      }

      await this.updateStatus(status, 'downloading_certificate', 'Waiting for certificate issuance', 80);
      
      // Wait for certificate to be issued and download it
      const certificateData = await zeroSSL.waitForCertificate(certificate.id, 300000); // 5 minutes
      status.logs.push('ZeroSSL certificate downloaded successfully');

      return certificateData;
    } catch (error) {
      Logger.error(`ZeroSSL certificate request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async createDNSRecordForValidation(dnsProvider: string, recordName: string, recordValue: string, recordType: string = 'TXT'): Promise<void> {
    if (!this.database) {
      throw new Error('Database not initialized');
    }

    try {
      if (dnsProvider === 'cloudflare') {
        const { CloudflareProvider } = await import('./dns-providers/cloudflare');
        const cloudflare = await CloudflareProvider.create(this.database, recordName);
        await cloudflare.createDNSRecord(recordName, recordValue, recordType);
      } else if (dnsProvider === 'digitalocean') {
        const { DigitalOceanDNSProvider } = await import('./dns-providers/digitalocean');
        const digitalOcean = await DigitalOceanDNSProvider.create(this.database, recordName);
        await digitalOcean.createDNSRecord(recordName, recordValue, recordType);
      } else if (dnsProvider === 'route53') {
        const { Route53DNSProvider } = await import('./dns-providers/route53');
        const route53 = await Route53DNSProvider.create(this.database, recordName);
        await route53.createDNSRecord(recordName, recordValue, recordType);
      } else if (dnsProvider === 'azure') {
        const { AzureDNSProvider } = await import('./dns-providers/azure');
        const azure = await AzureDNSProvider.create(this.database, recordName);
        await azure.createDNSRecord(recordName, recordValue, recordType);
      } else if (dnsProvider === 'google') {
        const { GoogleDNSProvider } = await import('./dns-providers/google');
        const google = await GoogleDNSProvider.create(this.database, recordName);
        await google.createDNSRecord(recordName, recordValue, recordType);
      } else {
        throw new Error(`DNS provider ${dnsProvider} not supported for ZeroSSL CNAME validation`);
      }
    } catch (error) {
      Logger.error(`Failed to create DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async handleDNSChallenge(connectionId: number, connection: ConnectionRecord, database: DatabaseManager, status: RenewalStatus, operationManager?: OperationStatusManager): Promise<void> {
    const dnsProvider = connection.dns_provider || 'cloudflare';
    const settings = await database.getSettingsByProvider(dnsProvider);
    
    // Use automated DNS challenge based on provider
    if (dnsProvider === 'cloudflare') {
      await this.handleCloudflareChallenge(connection, settings, status);
    } else if (dnsProvider === 'digitalocean') {
      await this.handleDigitalOceanChallenge(connection, settings, status);
    } else if (dnsProvider === 'route53') {
      await this.handleRoute53Challenge(connection, settings, status);
    } else if (dnsProvider === 'azure') {
      await this.handleAzureChallenge(connection, settings, status);
    } else if (dnsProvider === 'google') {
      await this.handleGoogleChallenge(connection, settings, status);
    } else if (dnsProvider === 'custom') {
      await this.handleCustomDNSChallenge(connectionId, connection, settings, status, operationManager);
    } else {
      throw new Error(`Unsupported DNS provider: ${dnsProvider}`);
    }
  }

  private async handleCloudflareChallenge(_connection: ConnectionRecord, settings: any[], status: RenewalStatus): Promise<void> {
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

  private async handleDigitalOceanChallenge(connection: ConnectionRecord, _settings: any[], status: RenewalStatus): Promise<void> {
    const fullFQDN = `${connection.hostname}.${connection.domain}`;
    
    try {
      const { DigitalOceanDNSProvider } = await import('./dns-providers/digitalocean');
      if (!this.database) {
        throw new Error('Database not initialized');
      }
      const digitalOceanDNS = await DigitalOceanDNSProvider.create(this.database, fullFQDN);
      
      await this.updateStatus(status, 'dns_validation', 'Creating DNS records in DigitalOcean', 50);
      
      // Process each authorization
      for (const authz of this.authzRecords) {
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const keyAuth = challenge.keyAuthorization;
        
        // Create the DNS record
        const record = await digitalOceanDNS.createDNSRecord(recordName, keyAuth, 'TXT');
        status.logs.push(`Created DigitalOcean DNS record with ID: ${record.id}`);
        
        // Store record ID for cleanup
        this.dnsRecordIds.push(record.id.toString());
      }
      
      // Wait for DNS propagation
      await this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation', 60);
      
      for (const authz of this.authzRecords) {
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const isVerified = await digitalOceanDNS.waitForDNSPropagation(
          recordName,
          challenge.keyAuthorization,
          120000 // 2 minutes timeout
        );
        
        if (!isVerified) {
          throw new Error(`DNS propagation failed for ${recordName}`);
        }
      }
      
      await this.updateStatus(status, 'completing_validation', 'DNS propagation confirmed - completing validation', 70);
      
    } catch (error) {
      Logger.error(`DigitalOcean DNS challenge failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async handleRoute53Challenge(connection: ConnectionRecord, _settings: any[], status: RenewalStatus): Promise<void> {
    const fullFQDN = `${connection.hostname}.${connection.domain}`;
    
    try {
      const { Route53DNSProvider } = await import('./dns-providers/route53');
      if (!this.database) {
        throw new Error('Database not initialized');
      }
      const route53DNS = await Route53DNSProvider.create(this.database, fullFQDN);
      
      await this.updateStatus(status, 'dns_validation', 'Creating DNS records in Route53', 50);
      
      // Process each authorization
      for (const authz of this.authzRecords) {
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const keyAuth = challenge.keyAuthorization;
        
        // Create the DNS record
        const record = await route53DNS.createDNSRecord(recordName, keyAuth, 'TXT');
        status.logs.push(`Created Route53 DNS record: ${record.id}`);
        
        // Store record ID for cleanup
        this.dnsRecordIds.push(record.id);
      }
      
      // Wait for DNS propagation
      await this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation', 60);
      
      for (const authz of this.authzRecords) {
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const isVerified = await route53DNS.waitForDNSPropagation(
          recordName,
          challenge.keyAuthorization,
          120000 // 2 minutes timeout
        );
        
        if (!isVerified) {
          throw new Error(`DNS propagation failed for ${recordName}`);
        }
      }
      
      await this.updateStatus(status, 'completing_validation', 'DNS propagation confirmed - completing validation', 70);
      
    } catch (error) {
      Logger.error(`Route53 DNS challenge failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async handleAzureChallenge(connection: ConnectionRecord, _settings: any[], status: RenewalStatus): Promise<void> {
    const fullFQDN = `${connection.hostname}.${connection.domain}`;
    
    try {
      const { AzureDNSProvider } = await import('./dns-providers/azure');
      if (!this.database) {
        throw new Error('Database not initialized');
      }
      const azureDNS = await AzureDNSProvider.create(this.database, fullFQDN);
      
      await this.updateStatus(status, 'dns_validation', 'Creating DNS records in Azure', 50);
      
      // Process each authorization
      for (const authz of this.authzRecords) {
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const keyAuth = challenge.keyAuthorization;
        
        // Create the DNS record
        const record = await azureDNS.createDNSRecord(recordName, keyAuth, 'TXT');
        status.logs.push(`Created Azure DNS record: ${record.id}`);
        
        // Store record ID for cleanup
        this.dnsRecordIds.push(record.id);
      }
      
      // Wait for DNS propagation
      await this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation', 60);
      
      for (const authz of this.authzRecords) {
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const isVerified = await azureDNS.waitForDNSPropagation(
          recordName,
          challenge.keyAuthorization,
          120000 // 2 minutes timeout
        );
        
        if (!isVerified) {
          throw new Error(`DNS propagation failed for ${recordName}`);
        }
      }
      
      await this.updateStatus(status, 'completing_validation', 'DNS propagation confirmed - completing validation', 70);
      
    } catch (error) {
      Logger.error(`Azure DNS challenge failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async handleGoogleChallenge(connection: ConnectionRecord, _settings: any[], status: RenewalStatus): Promise<void> {
    const fullFQDN = `${connection.hostname}.${connection.domain}`;
    
    try {
      const { GoogleDNSProvider } = await import('./dns-providers/google');
      if (!this.database) {
        throw new Error('Database not initialized');
      }
      const googleDNS = await GoogleDNSProvider.create(this.database, fullFQDN);
      
      await this.updateStatus(status, 'dns_validation', 'Creating DNS records in Google Cloud', 50);
      
      // Process each authorization
      for (const authz of this.authzRecords) {
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const keyAuth = challenge.keyAuthorization;
        
        // Create the DNS record
        const record = await googleDNS.createDNSRecord(recordName, keyAuth, 'TXT');
        status.logs.push(`Created Google Cloud DNS record: ${record.id}`);
        
        // Store record ID for cleanup
        this.dnsRecordIds.push(record.id);
      }
      
      // Wait for DNS propagation
      await this.updateStatus(status, 'waiting_dns_propagation', 'Waiting for DNS propagation', 60);
      
      for (const authz of this.authzRecords) {
        const recordName = `_acme-challenge.${authz.identifier.value}`;
        const challenge = authz.challenges.find((ch: any) => ch.type === 'dns-01');
        if (!challenge) continue;
        
        const isVerified = await googleDNS.waitForDNSPropagation(
          recordName,
          challenge.keyAuthorization,
          120000 // 2 minutes timeout
        );
        
        if (!isVerified) {
          throw new Error(`DNS propagation failed for ${recordName}`);
        }
      }
      
      await this.updateStatus(status, 'completing_validation', 'DNS propagation confirmed - completing validation', 70);
      
    } catch (error) {
      Logger.error(`Google Cloud DNS challenge failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async handleCustomDNSChallenge(connectionId: number, connection: ConnectionRecord, _settings: any[], status: RenewalStatus, operationManager?: OperationStatusManager): Promise<void> {
    const fullFQDN = `${connection.hostname}.${connection.domain}`;
    
    try {
      // Import the custom DNS provider
      const { CustomDNSProvider } = await import('./dns-providers/custom');
      if (!this.database) {
        throw new Error('Database not initialized');
      }
      const customDNS = await CustomDNSProvider.create(this.database, fullFQDN);
      
      await this.updateStatus(status, 'waiting_manual_dns', 'Manual DNS entry required - waiting for admin', 60, operationManager);
      
      // Get the challenges that were created in the renewal flow
      const challenges = status.challenges || [];
      
      for (const challenge of challenges) {
        const keyAuth = challenge.keyAuthorization;
        const recordName = `_acme-challenge.${fullFQDN}`;
        
        // Create the DNS record instruction
        await customDNS.createDNSRecord(recordName, keyAuth, 'TXT');
        
        // Log manual instructions
        const instructions = customDNS.getManualInstructions(recordName, keyAuth);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, instructions);
        status.logs.push('Manual DNS entry required - check renewal logs for instructions');
        
        // Store renewal status with manual entry state
        status.manualDNSEntry = {
          recordName,
          recordValue: keyAuth,
          instructions
        };
        
        // Update status to indicate manual intervention needed
        Logger.info(`About to update status to waiting_manual_dns with manualDNSEntry: ${JSON.stringify(status.manualDNSEntry)}`);
        await this.updateStatus(status, 'waiting_manual_dns', 'Waiting for manual DNS entry', 30, operationManager);
        
        // Wait for manual DNS entry (5 minute timeout)
        const maxWaitTime = 300000; // 5 minutes
        Logger.info(`Waiting for manual DNS entry for ${recordName}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Waiting for manual DNS entry. Timeout: ${maxWaitTime / 1000} seconds`);
        
        const isVerified = await customDNS.waitForManualEntry(recordName, keyAuth, maxWaitTime, () => this.isCancelled(status.id));
        
        if (!isVerified) {
          throw new Error(`Manual DNS entry verification timed out after ${maxWaitTime / 1000} seconds`);
        }
        
        // Update progress to show verification completed
        await this.updateStatus(status, 'completing_validation', 'DNS record verified - completing validation', 60, operationManager);
        
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Manual DNS entry verified successfully`);
        status.logs.push(`DNS record verified: ${recordName}`);
      }
      
      await this.updateStatus(status, 'completing_validation', 'Manual DNS entries verified - completing validation', 70, operationManager);
      
    } catch (error) {
      Logger.error(`Custom DNS challenge failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async uploadCertificateViaSSH(
    connectionId: number,
    connection: ConnectionRecord,
    status: RenewalStatus
  ): Promise<{ success: boolean; requiresManualInstall: boolean; message?: string }> {
    const fullFQDN = getDomainFromConnection(connection);
    if (!fullFQDN) {
      return { success: false, requiresManualInstall: true, message: 'Invalid connection configuration: missing hostname/domain' };
    }

    if (!connection.username || !connection.password) {
      status.logs.push('SSH enabled but no username/password configured - files available for manual download');
      return { success: false, requiresManualInstall: true, message: 'No SSH credentials configured' };
    }

    if (!connection.ssh_cert_path && !connection.ssh_key_path) {
      status.logs.push('SSH enabled but no remote paths configured - files available for manual download');
      return { success: false, requiresManualInstall: true, message: 'No remote paths configured' };
    }

    const sshHost = connection.domain
      ? (connection.hostname ? `${connection.hostname}.${connection.domain}` : connection.domain)
      : connection.hostname;

    if (!sshHost) {
      return { success: false, requiresManualInstall: true, message: 'Cannot determine SSH host' };
    }

    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const domainEnvDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);

    const filesToUpload: SFTPUploadParams[] = [];
    const backupSuffix = `bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;

    // Certificate file
    if (connection.ssh_cert_path) {
      const certPath = path.join(domainEnvDir, 'certificate.pem');
      if (fs.existsSync(certPath)) {
        const certContent = fs.readFileSync(certPath, 'utf8');
        filesToUpload.push({ localContent: certContent, remotePath: connection.ssh_cert_path, backupSuffix });
      } else {
        status.logs.push(`Warning: certificate.pem not found at ${certPath}`);
      }
    }

    // Private key file
    if (connection.ssh_key_path) {
      const keyPath = path.join(domainEnvDir, 'private_key.pem');
      if (fs.existsSync(keyPath)) {
        const keyContent = fs.readFileSync(keyPath, 'utf8');
        if (keyContent.trim()) {
          filesToUpload.push({ localContent: keyContent, remotePath: connection.ssh_key_path, backupSuffix });
        }
      } else {
        status.logs.push(`Warning: private_key.pem not found at ${keyPath}`);
      }
    }

    // Full chain file (optional)
    if (connection.ssh_chain_path) {
      const chainPath = path.join(domainEnvDir, 'fullchain.pem');
      if (fs.existsSync(chainPath)) {
        const chainContent = fs.readFileSync(chainPath, 'utf8');
        filesToUpload.push({ localContent: chainContent, remotePath: connection.ssh_chain_path, backupSuffix });
      } else {
        status.logs.push(`Warning: fullchain.pem not found at ${chainPath} - skipping chain upload`);
      }
    }

    if (filesToUpload.length === 0) {
      status.logs.push('No certificate files found to upload');
      return { success: false, requiresManualInstall: true, message: 'No certificate files found' };
    }

    status.logs.push(`Uploading ${filesToUpload.length} file(s) to ${sshHost} via SFTP...`);
    await accountManager.saveRenewalLog(connectionId, fullFQDN, `Uploading ${filesToUpload.length} file(s) to ${sshHost} via SFTP`);

    const result = await SSHClient.uploadCertificateFiles({
      hostname: sshHost,
      username: connection.username,
      password: connection.password,
      files: filesToUpload,
      restartCommand: connection.ssh_restart_command || undefined
    });

    for (const uploadResult of result.uploadResults) {
      if (uploadResult.success) {
        let msg = `Uploaded: ${uploadResult.message}`;
        if (uploadResult.backedUp) {
          msg += ` (backed up to ${uploadResult.backupPath})`;
        }
        status.logs.push(msg);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, msg);
      } else {
        status.logs.push(`Upload failed: ${uploadResult.error}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Upload failed: ${uploadResult.error}`);
      }
    }

    if (result.restartOutput) {
      status.logs.push(`Restart command output: ${result.restartOutput}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Restart command output: ${result.restartOutput}`);
    }

    if (result.success) {
      status.logs.push(`Certificate files successfully installed on ${sshHost}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate files successfully installed on ${sshHost}`);
      return { success: true, requiresManualInstall: false };
    } else {
      status.logs.push(`SFTP upload failed: ${result.error} - files still available for manual download`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `SFTP upload failed: ${result.error}`);
      return { success: false, requiresManualInstall: true, message: result.error };
    }
  }

  private async uploadCertificateToVOS(connectionId: number, connection: ConnectionRecord, certificate: string, status: RenewalStatus): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Parse the certificate chain into individual certificates
        const certParts = certificate.split('-----END CERTIFICATE-----');
        const certificates = certParts
          .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
          .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));

        if (certificates.length === 0) {
          return reject(new Error('No certificates found to upload.'));
        }

        // Upload CA certificates (intermediate + root) to trust store FIRST
        // VOS must have the signing CA in its trust store before it will accept the identity cert
        if (certificates.length > 1) {
          try {
            await this.uploadCaCertificates(connectionId, connection, certificates.slice(1), status);
          } catch (caError: any) {
            const fullFQDN = `${connection.hostname}.${connection.domain}`;
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `CA certificate upload warning: ${caError.message}`);
            status.logs.push(`CA certificates may already exist on server (this is normal)`);
            // Continue anyway - VOS may already have these trust certs
          }
        }

        // Now upload the identity certificate chain (leaf + intermediates)
        await this.uploadLeafCertificate(connectionId, connection, certificate, status);

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  private async uploadLeafCertificate(connectionId: number, connection: ConnectionRecord, certificate: string, status: RenewalStatus): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const fullFQDN = `${connection.hostname}.${connection.domain}`;
      
      if (!connection.username || !connection.password) {
        reject(new Error('Username and password are required for VOS application certificate upload'));
        return;
      }

      // Build complete certificate chain including root
      let certificates: string[] = [];
      
      // Get the accounts directory path using connection-based structure
      const accountsDir = process.env.ACCOUNTS_DIR || './accounts';
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envDir = isStaging ? 'staging' : 'prod';
      const certDir = path.join(accountsDir, `connection-${connectionId}`, envDir);
      
      // First, parse the provided certificate chain (usually fullchain.pem content)
      const certParts = certificate.split('-----END CERTIFICATE-----');
      const parsedCerts = certParts
        .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
        .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));

      if (parsedCerts.length === 0) {
        reject(new Error('No certificates found in certificate chain'));
        return;
      }
      
      // Add the parsed certificates (leaf and intermediate)
      certificates = [...parsedCerts];
      
      // Try to load and add the root certificate if not already present
      // VOS requires the complete chain: leaf + intermediate + root
      try {
        const rootPath = path.join(certDir, 'root.crt');
        const rootCert = await fs.promises.readFile(rootPath, 'utf8');
        if (rootCert.trim()) {
          // Check if root is not already in the chain (avoid duplicates)
          const hasRoot = certificates.some(cert => cert.includes('ISRG Root'));
          if (!hasRoot) {
            certificates.push(rootCert.trim());
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `Added root certificate to chain for VOS upload`);
          }
        }
      } catch (error) {
        // If root.crt doesn't exist, log a warning but continue
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `WARNING: Could not load root certificate: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // VOS expects the full certificate chain: [leaf, intermediate, root]
      const postData = JSON.stringify({
        service: 'tomcat',
        certificates: certificates
      });

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

      Logger.info(`VOS certificate chain upload request body: ${postData}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `VOS certificate chain upload request to ${fullFQDN}:${options.port}${options.path}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Uploading full certificate chain (${certificates.length} certificates) to tomcat service`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate chain includes: leaf${certificates.length > 1 ? ', intermediate' : ''}${certificates.length > 2 ? ', root' : ''}`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', async () => {
          try {
            Logger.info(`VOS certificate chain upload response: ${data}`);
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `VOS certificate chain upload response (${res.statusCode}): ${data}`);
            if (res.statusCode === 200 || res.statusCode === 201) {
              status.logs.push(`Certificate chain uploaded successfully to ${fullFQDN}`);
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate chain uploaded successfully to ${fullFQDN}`);
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
              } catch (parseError) {
                // If response is not JSON, include the raw response
                errorMsg += `: ${data || 'No response body'}`;
              }
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
              reject(new Error(errorMsg));
            }
          } catch (error) {
            const errorMsg = `Failed to parse certificate chain upload response: ${error}. Raw response: ${data}`;
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        });
      });

      req.on('error', async (error) => {
        const errorMsg = `Leaf certificate upload failed: ${error.message}`;
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
        reject(new Error(errorMsg));
      });

      req.write(postData);
      req.end();
    });
  }

  private async getExistingTrustCertificates(connection: ConnectionRecord): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const fullFQDN = `${connection.hostname}.${connection.domain}`;
        
        if (!connection.username || !connection.password) {
          reject(new Error('Username and password are required for VOS application certificate operations'));
          return;
        }

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
                        // Handle both array format and object with certificates property
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

  private async uploadCaCertificates(connectionId: number, connection: ConnectionRecord, certificates: string[], status: RenewalStatus): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const fullFQDN = `${connection.hostname}.${connection.domain}`;
        
        if (!connection.username || !connection.password) {
          reject(new Error('Username and password are required for VOS application certificate upload'));
          return;
        }

        const existingCerts = await this.getExistingTrustCertificates(connection);
        const certsToUpload = certificates.filter(c => !existingCerts.includes(c.trim()));

        if (certsToUpload.length === 0) {
            Logger.info('All CA certificates already exist on the server. Skipping upload.');
            status.logs.push('All CA certificates already exist on the server. Skipping upload.');
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `All CA certificates already exist on ${fullFQDN}. Skipping upload.`);
            await accountManager.saveRenewalLog(connectionId, fullFQDN, `Found ${existingCerts.length} existing trust certificates on server`);
            return resolve();
        }

        const postData = JSON.stringify({
          service: ['tomcat'],
          certificates: certsToUpload,
          description: 'Trust Certificate'
        });

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

        Logger.info(`VOS CA cert upload request body: ${postData}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Uploading ${certsToUpload.length} CA certificate(s) to ${fullFQDN}:${options.port}${options.path}`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `CA cert request body: ${postData}`);

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', async () => {
            try {
              Logger.info(`VOS CA cert upload response: ${data}`);
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `VOS CA cert upload response (${res.statusCode}): ${data}`);
              if (res.statusCode === 200 || res.statusCode === 201) {
                status.logs.push(`CA certificates uploaded successfully to ${fullFQDN}`);
                await accountManager.saveRenewalLog(connectionId, fullFQDN, `CA certificates uploaded successfully to ${fullFQDN}`);
                resolve();
              } else {
                const response = JSON.parse(data);
                const errorMsg = `CA certificate upload failed: ${response.message || response.messages?.[0] || 'Unknown error'}`;
                await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
                await accountManager.saveRenewalLog(connectionId, fullFQDN, `Full response: ${JSON.stringify(response, null, 2)}`);
                reject(new Error(errorMsg));
              }
            } catch (error) {
              const errorMsg = `Failed to parse CA cert upload response: ${error}. Raw response: ${data}`;
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
              reject(new Error(errorMsg));
            }
          });
        });

        req.on('error', async (error) => {
          const errorMsg = `CA certificate upload failed: ${error.message}`;
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
          reject(new Error(errorMsg));
        });

        req.write(postData);
        req.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private async saveCertificateChain(connectionId: number, domain: string, certificateData: string, status: RenewalStatus): Promise<void> {
    try {
      await accountManager.saveRenewalLog(connectionId, domain, `DEBUG: saveCertificateChain called with domain: ${domain}, certificateData length: ${certificateData.length}`);
      Logger.debug(`saveCertificateChain called with domain: ${domain}, certificateData length: ${certificateData.length}`);
      
      // Load private key from database or existing files
      let privateKey = '';
      try {
        // First check if we have a private key in the database (for ISE connections)
        if (this.database) {
          const connections = await this.database.getAllConnections();
          const connection = connections.find(conn => conn.id === Number(connectionId));
          if (connection && connection.ise_private_key) {
            privateKey = connection.ise_private_key;
            await accountManager.saveRenewalLog(connectionId, domain, `DEBUG: Found ISE private key in database, length: ${privateKey.length}`);
          } else if (connection && connection.general_private_key) {
            privateKey = connection.general_private_key;
            await accountManager.saveRenewalLog(connectionId, domain, `DEBUG: Found general private key in database, length: ${privateKey.length}`);
          }
        }
        
        // If no private key in database, try to load from existing certificate files (for general applications with custom CSR)
        if (!privateKey) {
          const existingCert = await accountManager.loadCertificate(connectionId, domain);
          if (existingCert) {
            privateKey = existingCert.privateKey;
            await accountManager.saveRenewalLog(connectionId, domain, `DEBUG: Found existing private key in files, length: ${privateKey.length}`);
          }
        }
      } catch (error) {
        // Private key not found, this is normal for VOS applications
        Logger.debug(`No private key found for ${domain}, this is normal for VOS applications`);
        await accountManager.saveRenewalLog(connectionId, domain, `DEBUG: No private key found for ${domain}`);
      }

      // Use the new chain saving method that extracts individual certificates
      await accountManager.saveRenewalLog(connectionId, domain, `Saving certificate chain for ${domain}`);
      await accountManager.saveRenewalLog(connectionId, domain, `DEBUG: About to call accountManager.saveCertificateChain`);
      await accountManager.saveCertificateChain(connectionId, domain, certificateData, privateKey);
      await accountManager.saveRenewalLog(connectionId, domain, `DEBUG: accountManager.saveCertificateChain completed successfully`);
      
      status.logs.push(`Saved certificate files for ${domain}`);
      status.logs.push(`- Domain certificate: certificate.pem, ${domain}.crt`);
      status.logs.push(`- Intermediate certificate: intermediate.crt`);
      status.logs.push(`- Root certificate: root.crt`);
      status.logs.push(`- CA bundle: ca-bundle.crt`);
      status.logs.push(`- Full chain: fullchain.pem`);
      if (privateKey) {
        status.logs.push(`- Private key: private_key.pem, ${domain}.key`);
      }
      
      // Also save these logs to the renewal log file
      await accountManager.saveRenewalLog(connectionId, domain, `Saved certificate files for ${domain}`);
      await accountManager.saveRenewalLog(connectionId, domain, `- Domain certificate: certificate.pem, ${domain}.crt`);
      await accountManager.saveRenewalLog(connectionId, domain, `- Intermediate certificate: intermediate.crt`);
      await accountManager.saveRenewalLog(connectionId, domain, `- Root certificate: root.crt`);
      await accountManager.saveRenewalLog(connectionId, domain, `- CA bundle: ca-bundle.crt`);
      await accountManager.saveRenewalLog(connectionId, domain, `- Full chain: fullchain.pem`);
      if (privateKey) {
        await accountManager.saveRenewalLog(connectionId, domain, `- Private key: private_key.pem, ${domain}.key`);
      }
      
      Logger.info(`Successfully saved certificate chain for ${domain}`);
    } catch (error) {
      const errorMsg = `Failed to save certificate chain for ${domain}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      Logger.error(errorMsg, error);
      await accountManager.saveRenewalLog(connectionId, domain, `ERROR: ${errorMsg}`);
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

  /**
   * Restart Cisco Tomcat service via SSH if auto_restart_service is enabled
   */
  private async handleServiceRestart(connection: ConnectionRecord, status: RenewalStatus): Promise<{success: boolean; requiresManualRestart: boolean; message?: string}> {
    Logger.info(`handleServiceRestart called for ${connection.hostname}.${connection.domain} - application_type=${connection.application_type}, enable_ssh=${connection.enable_ssh} (${typeof connection.enable_ssh}), auto_restart_service=${connection.auto_restart_service} (${typeof connection.auto_restart_service})`);

    // Only VOS applications support service restart
    if (connection.application_type !== 'vos') {
      Logger.info(`Skipping service restart for ${connection.hostname}.${connection.domain} - Not a VOS application (${connection.application_type})`);
      return { success: true, requiresManualRestart: false };
    }

    // Only proceed if SSH is enabled and auto_restart_service is enabled
    if (!connection.enable_ssh || !connection.auto_restart_service) {
      Logger.info(`Skipping service restart for ${connection.hostname}.${connection.domain} - SSH or auto restart not enabled (enable_ssh=${connection.enable_ssh}, auto_restart_service=${connection.auto_restart_service})`);
      return { success: true, requiresManualRestart: false };
    }

    try {
      const fqdn = `${connection.hostname}.${connection.domain}`;
      Logger.info(`Starting Cisco Tomcat service restart for ${fqdn}`);
      
      status.logs.push(`Restarting Cisco Tomcat service on ${fqdn}`);
      await this.updateStatus(status, 'restarting_service', 'Testing SSH connection...', 92);

      // Test SSH connection first
      const sshTest = await SSHClient.testConnection({
        hostname: fqdn,
        username: connection.username!,
        password: connection.password!
      });

      if (!sshTest.success) {
        const errorMsg = `SSH connection failed for ${fqdn}: ${sshTest.error}`;
        Logger.error(errorMsg);
        status.logs.push(`⚠️ ${errorMsg}`);
        status.logs.push(`📋 Manual action required: Run 'utils service restart Cisco Tomcat' on ${fqdn}`);
        return { 
          success: false, 
          requiresManualRestart: true, 
          message: `SSH failed - Manual service restart required on ${fqdn}` 
        };
      }

      // Update status to show we're starting the service restart
      await this.updateStatus(status, 'restarting_service', 'Restarting Tomcat...', 94);
      
      // Log the start of service restart
      if (connection.id) {
        await accountManager.saveRenewalLog(connection.id, fqdn, `🔄 Initiating Cisco Tomcat service restart on ${fqdn}`);
      }
      status.logs.push(`🔄 Initiating Cisco Tomcat service restart on ${fqdn}`);

      // Execute service restart command with streaming support and extended timeout (5 minutes)
      const restartResult = await SSHClient.executeCommandWithStream({
        hostname: fqdn,
        username: connection.username!,
        password: connection.password!,
        command: 'utils service restart Cisco Tomcat',
        timeout: 300000, // 5 minutes for service restart
        onData: async (chunk: string, totalOutput: string) => {
          // Check for [STARTING] pattern and update progress to 97%
          if (chunk.includes('[STARTING]') || totalOutput.includes('Cisco Tomcat[STARTING]')) {
            Logger.info(`Detected Cisco Tomcat [STARTING] for ${fqdn} during certificate renewal`);
            await this.updateStatus(status, 'restarting_service', 'Tomcat starting...', 97);
            const logMessage = `🔄 Cisco Tomcat service is starting on ${fqdn}`;
            status.logs.push(logMessage);
            // Also save to renewal logs
            if (connection.id) {
              await accountManager.saveRenewalLog(connection.id, fqdn, logMessage);
            }
          }
          // Check for [STOPPING] pattern
          if (chunk.includes('[STOPPING]') || totalOutput.includes('Cisco Tomcat[STOPPING]')) {
            await this.updateStatus(status, 'restarting_service', 'Tomcat stopping...', 95);
            const logMessage = `⏸️ Cisco Tomcat service is stopping on ${fqdn}`;
            status.logs.push(logMessage);
            if (connection.id) {
              await accountManager.saveRenewalLog(connection.id, fqdn, logMessage);
            }
          }
          // Check for [RUNNING] pattern
          if (chunk.includes('[RUNNING]') || totalOutput.includes('Cisco Tomcat[RUNNING]')) {
            await this.updateStatus(status, 'restarting_service', 'Tomcat running', 99);
            const logMessage = `✅ Cisco Tomcat service is now running on ${fqdn}`;
            status.logs.push(logMessage);
            if (connection.id) {
              await accountManager.saveRenewalLog(connection.id, fqdn, logMessage);
            }
          }
        }
      });

      if (restartResult.success) {
        Logger.info(`Successfully restarted Cisco Tomcat service for ${fqdn}`);
        const successMsg = `✅ Cisco Tomcat service restarted successfully on ${fqdn}`;
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
        const errorMsg = `Failed to restart Cisco Tomcat service for ${fqdn}: ${restartResult.error}`;
        Logger.error(errorMsg);
        status.logs.push(`⚠️ ${errorMsg}`);
        if (connection.id) {
          await accountManager.saveRenewalLog(connection.id, fqdn, `⚠️ ${errorMsg}`);
        }
        
        const manualMsg = `📋 Manual action required: Run 'utils service restart Cisco Tomcat' on ${fqdn}`;
        status.logs.push(manualMsg);
        if (connection.id) {
          await accountManager.saveRenewalLog(connection.id, fqdn, manualMsg);
        }
        
        return { 
          success: false, 
          requiresManualRestart: true, 
          message: `Service restart failed - Manual restart required on ${fqdn}` 
        };
      }

    } catch (error: any) {
      const errorMsg = `Error during service restart for ${connection.hostname}: ${error.message}`;
      Logger.error(errorMsg);
      status.logs.push(`⚠️ ${errorMsg}`);
      status.logs.push(`📋 Manual action required: Run 'utils service restart Cisco Tomcat' on ${connection.hostname}.${connection.domain}`);
      return { 
        success: false, 
        requiresManualRestart: true, 
        message: `Service restart error - Manual restart required on ${connection.hostname}.${connection.domain}` 
      };
    }
  }

  private async generateCSRFromISE(connection: ConnectionRecord, status: RenewalStatus, connectionId: number): Promise<string> {
    const fullFQDN = getDomainFromConnection(connection);
    if (!fullFQDN) {
      throw new Error('Invalid connection configuration: missing hostname/domain');
    }

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for ISE CSR generation');
    }

    if (!connection.ise_nodes) {
      throw new Error('ISE nodes must be configured for CSR generation');
    }

    try {
      // Get ISE provider
      const iseProvider = PlatformFactory.createProvider('ise') as ISEProvider;
      
      // Parse ISE nodes and use the first one for CSR generation
      const nodes = connection.ise_nodes.split(',').map(node => node.trim()).filter(node => node);
      if (nodes.length === 0) {
        throw new Error('No valid ISE nodes configured');
      }

      const primaryNode = nodes[0];
      status.logs.push(`Generating CSR from ISE node: ${primaryNode}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Generating CSR from ISE node: ${primaryNode}`);

      // Prepare CSR parameters
      const csrParams = {
        commonName: fullFQDN,
        subjectAltNames: connection.alt_names ? connection.alt_names.split(',').map(name => name.trim()) : [],
        keySize: 2048,
        keyType: 'RSA',
        organizationName: 'Organization',
        organizationalUnit: 'IT Department',
        locality: 'City',
        state: 'State',
        country: 'US'
      };

      // Generate CSR using ISE provider
      const csrResponse = await iseProvider.generateCSR(
        primaryNode,
        connection.username,
        connection.password,
        csrParams
      );

      if (!csrResponse.success || !csrResponse.csr) {
        throw new Error(csrResponse.message || 'Failed to generate CSR from ISE');
      }

      status.logs.push(`CSR generated successfully from ISE: ${csrResponse.csr.length} characters`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `CSR generated successfully from ISE: ${csrResponse.csr.length} characters`);

      // Save the CSR to accounts folder for record keeping
      await accountManager.saveCSR(connectionId, fullFQDN, csrResponse.csr);

      // Save private key if provided by ISE
      if (csrResponse.privateKey) {
        status.logs.push(`Private key received from ISE and saved`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Private key received from ISE and saved`);
        
        // Save private key to accounts folder
        const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
        const envDir = isStaging ? 'staging' : 'prod';
        const domainDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
        
        await fs.promises.mkdir(domainDir, { recursive: true });
        const privateKeyPath = path.join(domainDir, 'private_key.pem');
        await fs.promises.writeFile(privateKeyPath, csrResponse.privateKey);
      }

      return csrResponse.csr;
    } catch (error: any) {
      const errorMsg = `Failed to generate CSR from ISE: ${error.message}`;
      Logger.error(errorMsg);
      status.logs.push(`ERROR: ${errorMsg}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  private async uploadCertificateToISE(connectionId: number, connection: ConnectionRecord, certificate: string, status: RenewalStatus): Promise<void> {
    const fullFQDN = getDomainFromConnection(connection);
    if (!fullFQDN) {
      throw new Error('Invalid connection configuration: missing hostname/domain');
    }

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for ISE certificate upload');
    }

    if (!connection.ise_nodes) {
      throw new Error('ISE nodes must be configured for certificate upload');
    }

    try {
      // Get private key
      let privateKey = '';
      if (connection.ise_private_key && connection.ise_private_key.trim()) {
        privateKey = connection.ise_private_key;
        status.logs.push(`Using provided private key for ISE certificate import`);
      } else {
        // Try to load private key from accounts folder
        const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
        const envDir = isStaging ? 'staging' : 'prod';
        const privateKeyPath = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir, 'private_key.pem');
        
        try {
          privateKey = await fs.promises.readFile(privateKeyPath, 'utf8');
          status.logs.push(`Loaded private key from accounts folder`);
        } catch (error) {
          throw new Error('Private key not found. Please ensure private key is provided or CSR was generated via this system.');
        }
      }

      // Try to load already separated certificate files first, fallback to parsing chain
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envDir = isStaging ? 'staging' : 'prod';
      const certDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
      
      let caCertificates: string[] = [];
      let filesFound = false;
      
      // Try to load intermediate certificate if it exists
      try {
        const intermediatePath = path.join(certDir, 'intermediate.crt');
        const intermediateCert = await fs.promises.readFile(intermediatePath, 'utf8');
        if (intermediateCert.trim()) {
          caCertificates.push(intermediateCert);
          status.logs.push(`Loaded intermediate certificate from file`);
          filesFound = true;
        }
      } catch (error) {
        // File doesn't exist, will fallback to parsing
      }
      
      // Try to load root certificate if it exists
      try {
        const rootPath = path.join(certDir, 'root.crt');
        const rootCert = await fs.promises.readFile(rootPath, 'utf8');
        if (rootCert.trim()) {
          caCertificates.push(rootCert);
          status.logs.push(`Loaded root certificate from file`);
          filesFound = true;
        }
      } catch (error) {
        // File doesn't exist, will fallback to parsing
      }
      
      // If no certificate files found, parse from the certificate chain
      if (!filesFound) {
        status.logs.push(`Certificate files not found, parsing from certificate chain`);
        const certParts = certificate.split('-----END CERTIFICATE-----');
        const certificates = certParts
          .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
          .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));
        
        if (certificates.length === 0) {
          throw new Error('No certificates found to upload');
        }
        
        // All except the first (leaf) certificate are CA certificates
        caCertificates = certificates.slice(1);
      }

      // Get ISE provider
      const iseProvider = PlatformFactory.createProvider('ise') as ISEProvider;
      
      // Parse ISE nodes
      const nodes = connection.ise_nodes.split(',').map(node => node.trim()).filter(node => node);
      
      // Parse custom configuration
      let customConfig = {};
      if (connection.ise_cert_import_config) {
        try {
          customConfig = JSON.parse(connection.ise_cert_import_config);
        } catch (e) {
          status.logs.push(`Warning: Invalid JSON in ISE import config, using defaults`);
        }
      }

      // Upload CA certificates first if there are any
      if (caCertificates.length > 0) {
        status.logs.push(`Uploading ${caCertificates.length} CA certificate(s) to ISE nodes`);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, `Uploading ${caCertificates.length} CA certificate(s) to ISE nodes`);
        
        for (const node of nodes) {
          try {
            const caResult = await iseProvider.uploadTrustCertificates(
              node,
              connection.username,
              connection.password,
              caCertificates
            );
            
            if (caResult.success) {
              status.logs.push(`✅ CA certificates uploaded to ${node}`);
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `✅ CA certificates uploaded to ${node}`);
            } else {
              status.logs.push(`⚠️ CA certificate upload warning for ${node}: ${caResult.message}`);
              await accountManager.saveRenewalLog(connectionId, fullFQDN, `⚠️ CA certificate upload warning for ${node}: ${caResult.message}`);
            }
          } catch (error: any) {
            const errorMsg = `⚠️ CA certificate upload failed for ${node}: ${error.message}`;
            status.logs.push(errorMsg);
            await accountManager.saveRenewalLog(connectionId, fullFQDN, errorMsg);
            
            // Check if this is a connection issue that would prevent certificate import
            if (error.message.includes('SSL certificate') || error.message.includes('Connection failed') || error.message.includes('expired')) {
              Logger.warn(`Connection issue detected for ${node}, this will likely affect certificate import: ${error.message}`);
            }
            // Continue with identity certificate import even if CA upload fails
          }
        }
      }

      // Load the domain certificate from file, or extract from chain
      let domainCertificate = '';
      try {
        const certPath = path.join(certDir, 'certificate.pem');
        domainCertificate = await fs.promises.readFile(certPath, 'utf8');
        status.logs.push(`Loaded domain certificate from file`);
      } catch (error) {
        // If file doesn't exist, extract from certificate chain
        status.logs.push(`Certificate file not found, extracting from certificate chain`);
        const certParts = certificate.split('-----END CERTIFICATE-----');
        const certificates = certParts
          .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
          .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));
        
        if (certificates.length === 0) {
          throw new Error('No certificates found in certificate chain');
        }
        
        domainCertificate = certificates[0]; // First certificate is the domain certificate
      }

      // Import identity certificate to all nodes
      status.logs.push(`Importing identity certificate to ${nodes.length} ISE node(s)`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Importing identity certificate to ${nodes.length} ISE node(s)`);

      const result = await iseProvider.importCertificateToNodes(
        nodes,
        connection.username,
        connection.password,
        domainCertificate,
        privateKey,
        customConfig
      );

      // Log results
      const successCount = result.results.filter(r => r.status === 'success').length;
      const totalCount = result.results.length;

      status.logs.push(`Certificate import completed: ${successCount}/${totalCount} nodes successful`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `Certificate import completed: ${successCount}/${totalCount} nodes successful`);

      // Log individual node results with detailed feedback
      for (const nodeResult of result.results) {
        if (nodeResult.status === 'success') {
          const successMsg = `✅ ${nodeResult.node}: ${nodeResult.message}`;
          status.logs.push(successMsg);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, successMsg);
        } else {
          const errorMsg = `❌ ${nodeResult.node}: ${nodeResult.message}`;
          status.logs.push(errorMsg);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, errorMsg);
          
          // Provide specific guidance for common issues
          if (nodeResult.message && nodeResult.message.includes('SSL certificate') || nodeResult.message.includes('expired')) {
            const guidanceMsg = `💡 Suggestion for ${nodeResult.node}: Update the SSL certificate on this ISE node before attempting certificate import`;
            status.logs.push(guidanceMsg);
            await accountManager.saveRenewalLog(connectionId, fullFQDN, guidanceMsg);
          }
        }
      }

      if (successCount === 0) {
        // Provide specific error message based on common failure patterns
        const firstError = result.results[0]?.message || 'Unknown error';
        if (firstError.includes('SSL certificate') || firstError.includes('expired')) {
          throw new Error(`Failed to import certificate to any ISE nodes. All nodes have SSL certificate issues. Please update the SSL certificates on your ISE servers before proceeding with certificate import.`);
        } else if (firstError.includes('Connection failed')) {
          throw new Error(`Failed to import certificate to any ISE nodes. Connection issues detected. Please verify ISE hostnames, network connectivity, and that ISE services are running.`);
        } else {
          throw new Error(`Failed to import certificate to any ISE nodes. Error: ${firstError}`);
        }
      }

      if (successCount < totalCount) {
        const warningMsg = `⚠️ Warning: Certificate imported to ${successCount}/${totalCount} nodes. Some nodes may require manual certificate installation.`;
        status.logs.push(warningMsg);
        await accountManager.saveRenewalLog(connectionId, fullFQDN, warningMsg);
      }

    } catch (error: any) {
      const errorMsg = `Failed to upload certificate to ISE: ${error.message}`;
      Logger.error(errorMsg);
      status.logs.push(`ERROR: ${errorMsg}`);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
}

export const certificateRenewalService = new CertificateRenewalServiceImpl();