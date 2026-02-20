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
      const startTime = new Date().toISOString();
      Logger.info(`[CRON] Auto-renewal check started at ${startTime}`);
      
      try {
        await this.checkAndRenewCertificates();
        Logger.info(`[CRON] Auto-renewal check completed successfully at ${new Date().toISOString()}`);
      } catch (error: any) {
        Logger.error(`[CRON] Auto-renewal check failed at ${new Date().toISOString()}:`, error);
      }
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
        // Only process connections that are enabled, have auto_renew enabled, and use API-based DNS providers
        if (!connection.is_enabled || !connection.auto_renew || connection.dns_provider === 'custom') {
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

      // Use daysUntilExpiry directly from certInfo instead of parsing validTo string
      const daysUntilExpiration = certInfo.daysUntilExpiry || 0;

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

      // Update status to "in_progress" and notify WebSocket clients
      await this.updateAutoRenewalStatus(connection.id, 'in_progress', new Date().toISOString());
      
      // Notify WebSocket clients of auto-renewal start
      try {
        const { getWebSocketServer } = await import('./websocket-server');
        const io = getWebSocketServer();
        if (io) {
          io.emit('auto-renewal-status', {
            connectionId: connection.id,
            status: 'in_progress',
            message: `Auto-renewal started for ${connection.hostname}.${connection.domain}`,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        Logger.debug('WebSocket server not available for auto-renewal notification');
      }

      // Issue new certificate
      const renewalStatus = await certificateRenewalService.renewCertificate(connection.id!, this.database);
      
      if (!renewalStatus) {
        Logger.error(`Failed to start certificate renewal for connection ${connection.id}`);
        await this.updateAutoRenewalStatus(connection.id, 'failed', new Date().toISOString());
        return;
      }

      // Wait for renewal to complete (with timeout)
      const maxWaitTime = 900000; // 15 minutes (must exceed service restart timeout of 10 min)
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        const status = await certificateRenewalService.getRenewalStatus(renewalStatus.id);
        
        if (status && status.status === 'completed') {
          Logger.info(`Certificate renewal completed for ${connection.hostname}.${connection.domain}`);
          
          // Note: Tomcat service restart is already handled by the certificate renewal service
          // No need to restart again here
          
          // Update status to "success" and notify WebSocket clients
          await this.updateAutoRenewalStatus(connection.id, 'success', new Date().toISOString());
          
          // Notify WebSocket clients of auto-renewal success
          try {
            const { getWebSocketServer } = await import('./websocket-server');
            const io = getWebSocketServer();
            if (io) {
              io.emit('auto-renewal-status', {
                connectionId: connection.id,
                status: 'success',
                message: `Auto-renewal completed successfully for ${connection.hostname}.${connection.domain}`,
                timestamp: new Date().toISOString()
              });
            }
          } catch (error) {
            Logger.debug('WebSocket server not available for auto-renewal notification');
          }
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
   * Get renewal days threshold from environment variable
   */
  private async getRenewalDays(): Promise<number> {
    const renewalDays = process.env.CERT_RENEWAL_DAYS ? parseInt(process.env.CERT_RENEWAL_DAYS) : 7;
    Logger.debug(`Using CERT_RENEWAL_DAYS: ${renewalDays}`);
    return renewalDays;
  }

  /**
   * Get cron schedule from environment variable
   */
  private async getCronSchedule(): Promise<string> {
    const cronSchedule = process.env.CERT_CHECK_SCHEDULE || '0 0 * * *';
    Logger.debug(`Using CERT_CHECK_SCHEDULE: ${cronSchedule}`);
    return cronSchedule;
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

      // Execute service restart command (10 minute timeout for Tomcat restart - CUC can be very slow)
      const restartResult = await SSHClient.executeCommand({
        hostname: fqdn,
        username: connection.username,
        password: connection.password,
        command: 'utils service restart Cisco Tomcat',
        timeout: 600000
      });

      if (restartResult.success) {
        Logger.info(`Successfully restarted Cisco Tomcat service for ${fqdn}`);
      } else if (restartResult.error?.includes('timeout')) {
        Logger.warn(`Service restart confirmation timed out for ${fqdn} - service is likely still restarting. Manual verification recommended.`);
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