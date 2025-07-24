import cron from 'node-cron';
import { DatabaseManager } from './database';
import { Logger } from './logger';
import { certificateRenewalService } from './certificate-renewal';
import { SSHClient } from './ssh-client';

export class AutoRenewalCron {
  private database: DatabaseManager;
  
  constructor(database: DatabaseManager) {
    this.database = database;
  }

  /**
   * Start the auto-renewal cron job
   * Runs at the configured time and checks for certificates that expire within configured days
   */
  async start() {
    // Get cron schedule from settings, default to midnight
    const cronSchedule = await this.getCronSchedule();
    
    cron.schedule(cronSchedule, async () => {
      Logger.info('Starting auto-renewal check...');
      await this.checkAndRenewCertificates();
    });

    Logger.info(`Auto-renewal cron job scheduled with pattern: ${cronSchedule}`);
  }

  /**
   * Check for certificates expiring within configured days and renew them
   */
  private async checkAndRenewCertificates() {
    try {
      const connections = await this.database.getAllConnections();
      const expiringConnections = [];

      for (const connection of connections) {
        // Only process VOS applications with auto_renew enabled
        if (connection.application_type !== 'vos' || !connection.auto_renew) {
          continue;
        }

        // Check if certificate expires within configured days
        const expiresWithinThreshold = await this.checkCertificateExpiration(connection);
        if (expiresWithinThreshold) {
          expiringConnections.push(connection);
        }
      }

      const renewalDays = await this.getRenewalDays();
      Logger.info(`Found ${expiringConnections.length} connections with certificates expiring within ${renewalDays} days`);

      // Process renewals
      for (const connection of expiringConnections) {
        await this.renewCertificate(connection);
      }

    } catch (error: any) {
      Logger.error('Error during auto-renewal check:', error);
    }
  }

  /**
   * Check if a certificate expires within configured days
   */
  private async checkCertificateExpiration(connection: any): Promise<boolean> {
    try {
      const { getCertificateInfoWithFallback } = await import('./certificate');
      const domain = `${connection.hostname}.${connection.domain}`;
      
      const certInfo = await getCertificateInfoWithFallback(domain, connection);
      if (!certInfo || !certInfo.isValid || !certInfo.validTo) {
        Logger.warn(`No valid certificate found for ${domain}`);
        return false;
      }

      const expirationDate = new Date(certInfo.validTo);
      const now = new Date();
      const daysUntilExpiration = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      Logger.info(`Certificate for ${domain} expires in ${daysUntilExpiration} days`);
      
      const renewalDays = await this.getRenewalDays();
      return daysUntilExpiration <= renewalDays;
    } catch (error: any) {
      Logger.error(`Error checking certificate expiration for ${connection.hostname}:`, error);
      return false;
    }
  }

  /**
   * Renew certificate for a connection
   */
  private async renewCertificate(connection: any) {
    try {
      Logger.info(`Starting auto-renewal for ${connection.hostname}.${connection.domain}`);

      // Update status to "in_progress"
      await this.updateAutoRenewalStatus(connection.id, 'in_progress', new Date().toISOString());

      // Issue new certificate
      const renewalStatus = await certificateRenewalService.renewCertificate(connection.id!, this.database);
      
      if (!renewalStatus) {
        Logger.error(`Failed to start certificate renewal for connection ${connection.id}`);
        await this.updateAutoRenewalStatus(connection.id, 'failed', new Date().toISOString());
        return;
      }

      // Wait for renewal to complete (with timeout)
      const maxWaitTime = 300000; // 5 minutes
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        const status = await certificateRenewalService.getRenewalStatus(renewalStatus.id);
        
        if (status && status.status === 'completed') {
          Logger.info(`Certificate renewal completed for ${connection.hostname}.${connection.domain}`);
          
          // If auto_restart_service is enabled and SSH is available, restart Tomcat service
          if (connection.auto_restart_service && connection.enable_ssh) {
            await this.restartTomcatService(connection);
          }
          
          // Update status to "success"
          await this.updateAutoRenewalStatus(connection.id, 'success', new Date().toISOString());
          return;
        } else if (status && status.status === 'failed') {
          Logger.error(`Certificate renewal failed for ${connection.hostname}.${connection.domain}: ${status.error}`);
          await this.updateAutoRenewalStatus(connection.id, 'failed', new Date().toISOString());
          return;
        }

        // Wait 10 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 10000));
      }

      Logger.error(`Certificate renewal timed out for ${connection.hostname}.${connection.domain}`);
      await this.updateAutoRenewalStatus(connection.id, 'timeout', new Date().toISOString());
      
    } catch (error: any) {
      Logger.error(`Error during certificate renewal for ${connection.hostname}:`, error);
      await this.updateAutoRenewalStatus(connection.id, 'failed', new Date().toISOString());
    }
  }

  /**
   * Update auto-renewal status for a connection
   */
  private async updateAutoRenewalStatus(connectionId: number, status: string, timestamp: string) {
    try {
      await this.database.updateConnection(connectionId, {
        auto_renew_status: status,
        auto_renew_last_attempt: timestamp
      });
      Logger.info(`Updated auto-renewal status for connection ${connectionId}: ${status}`);
    } catch (error: any) {
      Logger.error(`Failed to update auto-renewal status for connection ${connectionId}:`, error);
    }
  }

  /**
   * Get renewal days threshold from settings
   */
  private async getRenewalDays(): Promise<number> {
    try {
      const setting = await this.database.getSetting('CERT_RENEWAL_DAYS');
      return setting ? parseInt(setting.key_value) : 7; // Default to 7 days
    } catch (error) {
      Logger.warn('Failed to get CERT_RENEWAL_DAYS setting, using default of 7 days');
      return 7;
    }
  }

  /**
   * Get cron schedule from settings
   */
  private async getCronSchedule(): Promise<string> {
    try {
      const setting = await this.database.getSetting('CERT_CHECK_SCHEDULE');
      return setting ? setting.key_value : '0 0 * * *'; // Default to midnight
    } catch (error) {
      Logger.warn('Failed to get CERT_CHECK_SCHEDULE setting, using default of midnight');
      return '0 0 * * *';
    }
  }

  /**
   * Restart Cisco Tomcat service via SSH
   */
  private async restartTomcatService(connection: any) {
    try {
      Logger.info(`Restarting Cisco Tomcat service for ${connection.hostname}.${connection.domain}`);

      const fqdn = `${connection.hostname}.${connection.domain}`;
      
      // Test SSH connection first
      const sshTest = await SSHClient.testConnection({
        hostname: fqdn,
        username: connection.username,
        password: connection.password
      });

      if (!sshTest.success) {
        Logger.error(`SSH connection failed for ${fqdn}: ${sshTest.error}`);
        return;
      }

      // Execute service restart command
      const restartResult = await SSHClient.executeCommand({
        hostname: fqdn,
        username: connection.username,
        password: connection.password,
        command: 'utils service restart Cisco Tomcat'
      });

      if (restartResult.success) {
        Logger.info(`Successfully restarted Cisco Tomcat service for ${fqdn}`);
      } else {
        Logger.error(`Failed to restart Cisco Tomcat service for ${fqdn}: ${restartResult.error}`);
      }

    } catch (error: any) {
      Logger.error(`Error restarting Tomcat service for ${connection.hostname}:`, error);
    }
  }

  /**
   * Stop the cron job
   */
  stop() {
    cron.getTasks().forEach(task => task.stop());
    Logger.info('Auto-renewal cron job stopped');
  }
}

// Export singleton instance
export const autoRenewalCron = new AutoRenewalCron(null as any); // Will be set by server.ts