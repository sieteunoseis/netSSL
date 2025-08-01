import { DatabaseManager } from './database';
import { accountManager } from './account-manager';
import { acmeClient } from './acme-client';
import { Logger } from './logger';
import { hasValidDomain, getDomainFromConnection } from './utils/domain-utils';

export class LetsEncryptAccountChecker {
  private database: DatabaseManager;

  constructor(database: DatabaseManager) {
    this.database = database;
  }

  async checkAndCreateAccounts(): Promise<void> {
    try {
      Logger.info('Starting Let\'s Encrypt account verification...');
      
      // Get Let's Encrypt settings
      const settings = await this.database.getSettingsByProvider('letsencrypt');
      const email = settings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
      
      if (!email) {
        Logger.warn('LETSENCRYPT_EMAIL not configured in settings. Skipping account verification.');
        return;
      }

      // Get all connections using Let's Encrypt
      const connections = await this.database.getAllConnections();
      
      Logger.info(`Total connections in database: ${connections.length}`);
      
      // Log details for Let's Encrypt connections only
      const allLetsEncryptConnections = connections.filter(conn => conn.ssl_provider === 'letsencrypt');
      allLetsEncryptConnections.forEach(conn => {
        const domain = getDomainFromConnection(conn);
        const validDomain = hasValidDomain(conn);
        Logger.info(`LE Connection: ${conn.name} - Type: ${conn.application_type || 'vos'}, Valid domain: ${validDomain}, Domain: ${domain}`);
        
        if (!validDomain) {
          if (conn.application_type === 'ise') {
            Logger.warn(`  ISE connection missing hostname/domain: ${conn.hostname}/${conn.domain}`);
          } else {
            Logger.warn(`  VOS/General connection missing hostname/domain: ${conn.hostname}/${conn.domain}`);
          }
        }
      });
      
      const letsEncryptConnections = connections.filter(conn => 
        conn.ssl_provider === 'letsencrypt' &&
        hasValidDomain(conn)
      );

      Logger.info(`Connections matching Let's Encrypt criteria: ${letsEncryptConnections.length}`);
      letsEncryptConnections.forEach(conn => {
        const domain = getDomainFromConnection(conn);
        Logger.info(`Will check/create account for: ${conn.name} -> ${domain}`);
      });

      if (letsEncryptConnections.length === 0) {
        Logger.info('No connections configured for Let\'s Encrypt.');
        return;
      }

      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      Logger.info(`Checking accounts for ${letsEncryptConnections.length} Let's Encrypt connections (${isStaging ? 'STAGING' : 'PRODUCTION'} mode)`);

      // Check each connection
      for (const connection of letsEncryptConnections) {
        const domain = getDomainFromConnection(connection);
        if (!domain || !connection.id) {
          Logger.warn(`Skipping connection ${connection.name} - no valid domain or connection ID found`);
          continue;
        }
        
        try {
          // Check if account exists
          const existingAccount = await acmeClient.loadAccount(domain, connection.id);
          
          if (!existingAccount) {
            Logger.info(`Creating Let's Encrypt account for ${domain}...`);
            
            // Create new account
            await acmeClient.createAccount(email, domain, connection.id);
            
            Logger.info(`Successfully created Let's Encrypt account for ${domain}`);
            await accountManager.saveRenewalLog(connection.id, domain, `Account created during startup verification (${isStaging ? 'STAGING' : 'PRODUCTION'}) - ${new Date().toISOString()}`);
          } else {
            Logger.info(`Let's Encrypt account already exists for ${domain}`);
          }
        } catch (error) {
          Logger.error(`Failed to verify/create account for ${domain}:`, error);
          await accountManager.saveRenewalLog(connection.id, domain, `Account verification failed during startup: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      Logger.info('Let\'s Encrypt account verification completed.');
    } catch (error) {
      Logger.error('Error during Let\'s Encrypt account verification:', error);
    }
  }
}