import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Logger } from './logger';
import { DatabaseManager } from './database';
import { ConnectionRecord } from './types';
import { accountManager } from './account-manager';
import { OperationStatusManager } from './services/operation-status-manager';
import { getDomainFromConnection } from './utils/domain-utils';
import { PlatformFactory } from './platform-providers/platform-factory';
import { RenewalContext } from './platform-providers/platform-provider';

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

      // Log connection identifier header for traceability
      const connLabel = `[conn-${connectionId}]`;
      Logger.info(`${connLabel} === Renewal started: name="${connection.name}", domain="${fullFQDN}", type="${connection.application_type}", accounts=connection-${connectionId}/ ===`);
      status.logs.push(`Connection: id=${connectionId}, name="${connection.name}", domain="${fullFQDN}", type="${connection.application_type}"`);

      // Create provider and renewal context — all type-specific logic lives in providers
      const appType = connection.application_type || 'vos';
      const provider = PlatformFactory.createProvider(
        PlatformFactory.mapApplicationTypeToPlatform(appType)
      );
      const ctx: RenewalContext = {
        connectionId,
        connection,
        status,
        updateStatus: (op: string, message: string, progress: number) =>
          updateStatusWithOp(op as RenewalStatus['status'], message, progress),
        saveLog: (msg: string) => accountManager.saveRenewalLog(connectionId, fullFQDN, msg),
      };

      // Check for existing valid certificate
      const existingCert = await this.getExistingCertificate(fullFQDN);

      // Some providers support retrying with a recently generated certificate
      let recentCert = null;
      if (!existingCert && provider.supportsRecentCertRetry) {
        recentCert = await this.getRecentCertificate(connectionId, fullFQDN, 3600000);
        if (recentCert) {
          status.logs.push(`Found recently generated certificate for ${connection.name} (generated within last hour)`);
          await accountManager.saveRenewalLog(connectionId, fullFQDN, `Using recently generated certificate (less than 1 hour old)`);
        }
      }

      const certificateToUse = existingCert || recentCert;
      if (certificateToUse) {
        await updateStatusWithOp('uploading_certificate', 'Using existing valid certificate', 80);
        await provider.installCertificate(ctx, certificateToUse);

        const restartResult = await provider.handleServiceRestart(ctx);
        let completionMessage = 'Certificate renewal completed successfully';
        if (restartResult.requiresManualRestart) {
          completionMessage = `Certificate installed successfully - ${restartResult.message}`;
        }

        await updateStatusWithOp('completed', completionMessage, 100);
        status.endTime = new Date();
        return;
      }

      // Generate CSR via provider
      await updateStatusWithOp('generating_csr', 'Generating CSR...', 10);
      const csr = await provider.prepareCSR(ctx);

      // Check cancellation before certificate request
      checkCancellation();

      // Request certificate from SSL provider (Let's Encrypt / ZeroSSL)
      await updateStatusWithOp('requesting_certificate', 'Requesting certificate from Let\'s Encrypt', 20);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `DEBUG: About to call requestCertificate method`);
      const certificate = await this.requestCertificate(connection, csr, database, status, connectionId, operationManager);
      await accountManager.saveRenewalLog(connectionId, fullFQDN, `DEBUG: requestCertificate returned, certificate length: ${certificate ? certificate.length : 'null/undefined'}`);

      // Install certificate via provider
      await updateStatusWithOp('uploading_certificate', 'Installing certificate...', 85);
      await provider.installCertificate(ctx, certificate);

      // Service restart via provider (VOS restarts Tomcat, others no-op)
      const restartResult = await provider.handleServiceRestart(ctx);

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
    status.logs.push(`[${new Date().toISOString()}] ${message}`);
    Logger.info(`[conn-${status.connectionId}] Renewal ${status.id}: ${message}`);
    
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
      
      // For ISE, the primary FQDN for the cert is the ISE node (not the optional portal hostname).
      // For other types, use hostname.domain as before.
      let fullFQDN: string;
      if (connection.application_type === 'ise' && connection.ise_nodes) {
        const primaryNode = connection.ise_nodes.split(',').map(n => n.trim()).filter(n => n)[0];
        fullFQDN = primaryNode || getDomainFromConnection(connection) || connection.domain;
      } else {
        fullFQDN = getDomainFromConnection(connection) || '';
      }

      // Parse altNames from connection
      const altNames = connection.alt_names
        ? connection.alt_names.split(',').map(name => name.trim()).filter(name => name.length > 0)
        : [];

      // For ISE: auto-include the SAN/monitoring FQDN if it differs from the node FQDN
      if (connection.application_type === 'ise' && connection.hostname) {
        // hostname may be a full FQDN (guest.example.com) or short name (guest)
        const sanFQDN = connection.hostname.includes('.')
          ? connection.hostname
          : (connection.domain ? `${connection.hostname}.${connection.domain}` : '');
        if (sanFQDN && sanFQDN !== fullFQDN && !altNames.includes(sanFQDN)) {
          altNames.unshift(sanFQDN);
        }
      }

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

          // Extract domain from challenge (_domain attached by ACMEClient.requestCertificate)
          const challengeDomain = challenge._domain || domains[0];

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
      const fullFQDN = getDomainFromConnection(connection) || '';
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
      
      const fullFQDN = getDomainFromConnection(connection) || '';
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
    const fullFQDN = getDomainFromConnection(connection) || '';
    
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
    const fullFQDN = getDomainFromConnection(connection) || '';
    
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
    const fullFQDN = getDomainFromConnection(connection) || '';
    
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
    const fullFQDN = getDomainFromConnection(connection) || '';
    
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
    const fullFQDN = getDomainFromConnection(connection) || '';
    
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
}

export const certificateRenewalService = new CertificateRenewalServiceImpl();