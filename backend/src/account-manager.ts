import fs from 'fs';
import path from 'path';
import { Logger } from './logger';

export interface LetsEncryptAccount {
  account: {
    body: {
      key: {
        n: string;
        e: string;
        kty: string;
      };
      contact: string[];
      status: string;
    };
    uri: string;
    terms_of_service: string;
  };
  account_key: string;
  directory: string;
  verify_ssl: boolean;
  domains: string[];
  certificate: string;
  private_key: string;
}

export interface CertificateAccount {
  connectionId: number;
  domain: string;
  provider: 'letsencrypt' | 'zerossl';
  account_data: LetsEncryptAccount | any;
  created_at: Date;
  updated_at: Date;
}

export class AccountManager {
  private accountsDir: string;

  constructor(baseDir?: string) {
    // Use environment variable for Docker compatibility, fallback to ./accounts
    const accountsPath = baseDir || process.env.ACCOUNTS_DIR || './accounts';
    this.accountsDir = path.resolve(accountsPath);
    this.ensureDirectoryExists(this.accountsDir);
    Logger.info(`Using accounts directory: ${this.accountsDir}`);
  }

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      Logger.info(`Created accounts directory: ${dir}`);
    }
  }

  private getAccountPath(connectionId: number, provider: string): string {
    // Create connection ID directory structure with staging/prod subdirectories
    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const connectionDir = path.join(this.accountsDir, `connection-${connectionId}`, envDir);
    this.ensureDirectoryExists(connectionDir);
    return path.join(connectionDir, `${provider}.json`);
  }

  private getConnectionDir(connectionId: number): string {
    const connectionDir = path.join(this.accountsDir, `connection-${connectionId}`);
    this.ensureDirectoryExists(connectionDir);
    return connectionDir;
  }

  private getConnectionEnvDir(connectionId: number): string {
    // Get connection directory with environment subdirectory for certificates/CSRs
    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const connectionEnvDir = path.join(this.accountsDir, `connection-${connectionId}`, envDir);
    this.ensureDirectoryExists(connectionEnvDir);
    return connectionEnvDir;
  }


  // Helper method to get certificate file path for a specific connection
  getCertificateFilePath(connectionId: number, filename: string): string {
    const connectionEnvDir = this.getConnectionEnvDir(connectionId);
    return path.join(connectionEnvDir, filename);
  }

  // Helper method to check if certificate files exist for a connection
  async hasCertificateFiles(connectionId: number): Promise<boolean> {
    const connectionEnvDir = this.getConnectionEnvDir(connectionId);
    const certPath = path.join(connectionEnvDir, 'certificate.pem');
    const keyPath = path.join(connectionEnvDir, 'private_key.pem');
    
    return fs.existsSync(certPath) && fs.existsSync(keyPath);
  }


  async saveAccount(connectionId: number, domain: string, provider: 'letsencrypt' | 'zerossl', accountData: any): Promise<void> {
    try {
      const account: CertificateAccount = {
        connectionId,
        domain,
        provider,
        account_data: accountData,
        created_at: new Date(),
        updated_at: new Date()
      };

      const accountPath = this.getAccountPath(connectionId, provider);
      await fs.promises.writeFile(accountPath, JSON.stringify(account, null, 2));
      
      Logger.info(`Saved ${provider} account for connection ${connectionId} (${domain})`);
    } catch (error) {
      Logger.error(`Failed to save account for connection ${connectionId} (${domain}):`, error);
      throw error;
    }
  }

  async loadAccount(connectionId: number, domain: string, provider: 'letsencrypt' | 'zerossl'): Promise<CertificateAccount | null> {
    try {
      const accountPath = this.getAccountPath(connectionId, provider);
      
      if (!fs.existsSync(accountPath)) {
        Logger.debug(`No account file found for connection ${connectionId} (${domain}) with provider ${provider}`);
        return null;
      }

      const accountData = await fs.promises.readFile(accountPath, 'utf8');
      const account: CertificateAccount = JSON.parse(accountData);
      
      Logger.info(`Loaded ${provider} account for connection ${connectionId} (${domain})`);
      return account;
    } catch (error) {
      Logger.error(`Failed to load account for connection ${connectionId} (${domain}):`, error);
      return null;
    }
  }

  async updateAccount(connectionId: number, domain: string, provider: 'letsencrypt' | 'zerossl', updates: Partial<any>): Promise<void> {
    try {
      const account = await this.loadAccount(connectionId, domain, provider);
      if (!account) {
        throw new Error(`Account not found for connection ${connectionId} (${domain}) with provider ${provider}`);
      }

      // Update account data
      account.account_data = { ...account.account_data, ...updates };
      account.updated_at = new Date();

      await this.saveAccount(connectionId, domain, provider, account.account_data);
      Logger.info(`Updated ${provider} account for connection ${connectionId} (${domain})`);
    } catch (error) {
      Logger.error(`Failed to update account for connection ${connectionId} (${domain}):`, error);
      throw error;
    }
  }

  async saveCertificate(connectionId: number, domain: string, certificate: string, privateKey: string): Promise<void> {
    try {
      const connectionEnvDir = this.getConnectionEnvDir(connectionId);
      const certPath = path.join(connectionEnvDir, 'certificate.pem');
      const keyPath = path.join(connectionEnvDir, 'private_key.pem');

      await fs.promises.writeFile(certPath, certificate);
      await fs.promises.writeFile(keyPath, privateKey);
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Saved certificate and private key for connection ${connectionId} (${domain}) (${envType})`);
    } catch (error) {
      Logger.error(`Failed to save certificate for connection ${connectionId} (${domain}):`, error);
      throw error;
    }
  }

  async saveCertificateChain(connectionId: number, domain: string, fullChainData: string, privateKey: string): Promise<void> {
    try {
      const connectionEnvDir = this.getConnectionEnvDir(connectionId);
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';

      // Save the complete chain
      const fullChainPath = path.join(connectionEnvDir, 'fullchain.pem');
      await fs.promises.writeFile(fullChainPath, fullChainData);

      // Parse and extract individual certificates
      const certParts = fullChainData.split('-----END CERTIFICATE-----');
      const certificates = certParts
        .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
        .map(part => part.trim() + '\n-----END CERTIFICATE-----');

      if (certificates.length === 0) {
        throw new Error('No certificates found in chain data');
      }

      // Extract individual components
      const leafCert = certificates[0]; // Domain certificate
      const chainCerts = certificates.slice(1); // Intermediate + Root certificates
      
      // Save individual certificate files
      await fs.promises.writeFile(path.join(connectionEnvDir, 'certificate.pem'), leafCert);
      await fs.promises.writeFile(path.join(connectionEnvDir, 'private_key.pem'), privateKey);

      // Save chain certificates (intermediate + root)
      if (chainCerts.length > 0) {
        const chainData = chainCerts.join('\n');
        await fs.promises.writeFile(path.join(connectionEnvDir, 'chain.pem'), chainData);

        // Save individual CA certificates for easier application integration
        if (chainCerts.length >= 1) {
          // First chain cert is usually the intermediate
          await fs.promises.writeFile(path.join(connectionEnvDir, 'intermediate.crt'), chainCerts[0]);
        }
        
        if (chainCerts.length >= 2) {
          // Second chain cert is usually the root
          await fs.promises.writeFile(path.join(connectionEnvDir, 'root.crt'), chainCerts[1]);
        }

        // For applications that need all CA certs in one file
        await fs.promises.writeFile(path.join(connectionEnvDir, 'ca-bundle.crt'), chainData);
      }

      // Create application-friendly formats
      await fs.promises.writeFile(path.join(connectionEnvDir, `${domain}.crt`), leafCert);
      await fs.promises.writeFile(path.join(connectionEnvDir, `${domain}.key`), privateKey);

      Logger.info(`Saved complete certificate chain for connection ${connectionId} (${domain}) (${envType})`);
      Logger.info(`Certificate files: certificate.pem, ${domain}.crt, intermediate.crt, root.crt, ca-bundle.crt`);

    } catch (error) {
      Logger.error(`Failed to save certificate chain for connection ${connectionId} (${domain}):`, error);
      throw error;
    }
  }

  async loadCertificate(connectionId: number, domain: string): Promise<{ certificate: string; privateKey: string } | null> {
    try {
      const connectionEnvDir = this.getConnectionEnvDir(connectionId);
      const certPath = path.join(connectionEnvDir, 'certificate.pem');
      const keyPath = path.join(connectionEnvDir, 'private_key.pem');

      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        Logger.debug(`Certificate files not found for connection ${connectionId} (${domain}) in current environment`);
        return null;
      }

      const certificate = await fs.promises.readFile(certPath, 'utf8');
      const privateKey = await fs.promises.readFile(keyPath, 'utf8');
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Loaded certificate and private key for connection ${connectionId} (${domain}) (${envType})`);
      return { certificate, privateKey };
    } catch (error) {
      Logger.error(`Failed to load certificate for connection ${connectionId} (${domain}):`, error);
      return null;
    }
  }

  async saveCSR(connectionId: number, domain: string, csr: string): Promise<void> {
    try {
      const connectionEnvDir = this.getConnectionEnvDir(connectionId);
      const csrPath = path.join(connectionEnvDir, 'certificate.csr');

      await fs.promises.writeFile(csrPath, csr);
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Saved CSR for connection ${connectionId} (${domain}) (${envType})`);
    } catch (error) {
      Logger.error(`Failed to save CSR for connection ${connectionId} (${domain}):`, error);
      throw error;
    }
  }

  async loadCSR(connectionId: number, domain: string): Promise<string | null> {
    try {
      const connectionEnvDir = this.getConnectionEnvDir(connectionId);
      const csrPath = path.join(connectionEnvDir, 'certificate.csr');

      if (!fs.existsSync(csrPath)) {
        Logger.debug(`CSR file not found for connection ${connectionId} (${domain}) in current environment`);
        return null;
      }

      const csr = await fs.promises.readFile(csrPath, 'utf8');
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Loaded CSR for connection ${connectionId} (${domain}) (${envType})`);
      return csr;
    } catch (error) {
      Logger.error(`Failed to load CSR for connection ${connectionId} (${domain}):`, error);
      return null;
    }
  }

  async saveRenewalLog(connectionId: number, domain: string, log: string): Promise<void> {
    try {
      const connectionDir = this.getConnectionDir(connectionId);
      const logPath = path.join(connectionDir, 'renewal.log');
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${log}\n`;

      await fs.promises.appendFile(logPath, logEntry);
      Logger.debug(`Saved renewal log for connection ${connectionId} (${domain})`);
    } catch (error) {
      Logger.error(`Failed to save renewal log for connection ${connectionId} (${domain}):`, error);
    }
  }

  async getRenewalLog(connectionId: number, domain: string): Promise<string[]> {
    try {
      const connectionDir = this.getConnectionDir(connectionId);
      const logPath = path.join(connectionDir, 'renewal.log');

      if (!fs.existsSync(logPath)) {
        return [];
      }

      const logContent = await fs.promises.readFile(logPath, 'utf8');
      return logContent.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
      Logger.error(`Failed to read renewal log for connection ${connectionId} (${domain}):`, error);
      return [];
    }
  }

  async listAccountsByConnection(connectionId: number): Promise<string[]> {
    try {
      const connectionDir = path.join(this.accountsDir, `connection-${connectionId}`);
      if (!fs.existsSync(connectionDir)) {
        return [];
      }

      const providers = new Set<string>();
      
      // Check both staging and prod directories
      for (const envDir of ['staging', 'prod']) {
        const envPath = path.join(connectionDir, envDir);
        if (fs.existsSync(envPath)) {
          const files = await fs.promises.readdir(envPath);
          const accountFiles = files.filter(file => file.endsWith('.json'));
          accountFiles.forEach(file => {
            const provider = file.replace('.json', '');
            providers.add(provider);
          });
        }
      }
      
      return Array.from(providers);
    } catch (error) {
      Logger.error(`Failed to list accounts for connection ${connectionId}:`, error);
      return [];
    }
  }

  async deleteAccount(connectionId: number, domain: string, provider: 'letsencrypt' | 'zerossl'): Promise<void> {
    try {
      const accountPath = this.getAccountPath(connectionId, provider);
      
      if (fs.existsSync(accountPath)) {
        await fs.promises.unlink(accountPath);
        Logger.info(`Deleted ${provider} account for connection ${connectionId} (${domain})`);
      }
    } catch (error) {
      Logger.error(`Failed to delete account for connection ${connectionId} (${domain}):`, error);
      throw error;
    }
  }

  async cleanupConnectionFiles(connectionId: number): Promise<void> {
    try {
      const connectionDir = this.getConnectionDir(connectionId);
      
      if (fs.existsSync(connectionDir)) {
        await fs.promises.rmdir(connectionDir, { recursive: true });
        Logger.info(`Cleaned up files for connection ${connectionId}`);
      }
    } catch (error) {
      Logger.error(`Failed to cleanup files for connection ${connectionId}:`, error);
      throw error;
    }
  }

  async getAccountStats(): Promise<{ totalAccounts: number; connections: string[]; providers: string[] }> {
    try {
      let totalAccounts = 0;
      const connections = new Set<string>();
      const providers = new Set<string>();
      
      const connectionDirs = await fs.promises.readdir(this.accountsDir);
      
      for (const connectionDir of connectionDirs) {
        const connectionPath = path.join(this.accountsDir, connectionDir);
        const stat = await fs.promises.stat(connectionPath);
        
        if (stat.isDirectory()) {
          connections.add(connectionDir);
          
          // Check staging and prod directories
          for (const envDir of ['staging', 'prod']) {
            const envPath = path.join(connectionPath, envDir);
            if (fs.existsSync(envPath)) {
              const files = await fs.promises.readdir(envPath);
              const accountFiles = files.filter(file => file.endsWith('.json'));
              totalAccounts += accountFiles.length;
              
              accountFiles.forEach(file => {
                const provider = file.replace('.json', '');
                providers.add(provider);
              });
            }
          }
        }
      }

      return {
        totalAccounts,
        connections: Array.from(connections),
        providers: Array.from(providers)
      };
    } catch (error) {
      Logger.error('Failed to get account stats:', error);
      return { totalAccounts: 0, connections: [], providers: [] };
    }
  }
}

// Create a singleton instance
export const accountManager = new AccountManager();