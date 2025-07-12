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

  private getAccountPath(domain: string, provider: string): string {
    // Create domain directory structure with staging/prod subdirectories
    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const domainDir = path.join(this.accountsDir, domain, envDir);
    this.ensureDirectoryExists(domainDir);
    return path.join(domainDir, `${provider}.json`);
  }

  private getDomainDir(domain: string): string {
    const domainDir = path.join(this.accountsDir, domain);
    this.ensureDirectoryExists(domainDir);
    return domainDir;
  }

  private getDomainEnvDir(domain: string): string {
    // Get domain directory with environment subdirectory for certificates/CSRs
    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const domainEnvDir = path.join(this.accountsDir, domain, envDir);
    this.ensureDirectoryExists(domainEnvDir);
    return domainEnvDir;
  }

  async saveAccount(domain: string, provider: 'letsencrypt' | 'zerossl', accountData: any): Promise<void> {
    try {
      const account: CertificateAccount = {
        domain,
        provider,
        account_data: accountData,
        created_at: new Date(),
        updated_at: new Date()
      };

      const accountPath = this.getAccountPath(domain, provider);
      await fs.promises.writeFile(accountPath, JSON.stringify(account, null, 2));
      
      Logger.info(`Saved ${provider} account for domain: ${domain}`);
    } catch (error) {
      Logger.error(`Failed to save account for ${domain}:`, error);
      throw error;
    }
  }

  async loadAccount(domain: string, provider: 'letsencrypt' | 'zerossl'): Promise<CertificateAccount | null> {
    try {
      const accountPath = this.getAccountPath(domain, provider);
      
      if (!fs.existsSync(accountPath)) {
        Logger.debug(`No account file found for ${domain} with provider ${provider}`);
        return null;
      }

      const accountData = await fs.promises.readFile(accountPath, 'utf8');
      const account: CertificateAccount = JSON.parse(accountData);
      
      Logger.info(`Loaded ${provider} account for domain: ${domain}`);
      return account;
    } catch (error) {
      Logger.error(`Failed to load account for ${domain}:`, error);
      return null;
    }
  }

  async updateAccount(domain: string, provider: 'letsencrypt' | 'zerossl', updates: Partial<any>): Promise<void> {
    try {
      const account = await this.loadAccount(domain, provider);
      if (!account) {
        throw new Error(`Account not found for ${domain} with provider ${provider}`);
      }

      // Update account data
      account.account_data = { ...account.account_data, ...updates };
      account.updated_at = new Date();

      await this.saveAccount(domain, provider, account.account_data);
      Logger.info(`Updated ${provider} account for domain: ${domain}`);
    } catch (error) {
      Logger.error(`Failed to update account for ${domain}:`, error);
      throw error;
    }
  }

  async saveCertificate(domain: string, certificate: string, privateKey: string): Promise<void> {
    try {
      const domainEnvDir = this.getDomainEnvDir(domain);
      const certPath = path.join(domainEnvDir, 'certificate.pem');
      const keyPath = path.join(domainEnvDir, 'private_key.pem');

      await fs.promises.writeFile(certPath, certificate);
      await fs.promises.writeFile(keyPath, privateKey);
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Saved certificate and private key for domain: ${domain} (${envType})`);
    } catch (error) {
      Logger.error(`Failed to save certificate for ${domain}:`, error);
      throw error;
    }
  }

  async loadCertificate(domain: string): Promise<{ certificate: string; privateKey: string } | null> {
    try {
      const domainEnvDir = this.getDomainEnvDir(domain);
      const certPath = path.join(domainEnvDir, 'certificate.pem');
      const keyPath = path.join(domainEnvDir, 'private_key.pem');

      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        Logger.debug(`Certificate files not found for domain: ${domain} in current environment`);
        return null;
      }

      const certificate = await fs.promises.readFile(certPath, 'utf8');
      const privateKey = await fs.promises.readFile(keyPath, 'utf8');
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Loaded certificate and private key for domain: ${domain} (${envType})`);
      return { certificate, privateKey };
    } catch (error) {
      Logger.error(`Failed to load certificate for ${domain}:`, error);
      return null;
    }
  }

  async saveCSR(domain: string, csr: string): Promise<void> {
    try {
      const domainEnvDir = this.getDomainEnvDir(domain);
      const csrPath = path.join(domainEnvDir, 'certificate.csr');

      await fs.promises.writeFile(csrPath, csr);
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Saved CSR for domain: ${domain} (${envType})`);
    } catch (error) {
      Logger.error(`Failed to save CSR for ${domain}:`, error);
      throw error;
    }
  }

  async loadCSR(domain: string): Promise<string | null> {
    try {
      const domainEnvDir = this.getDomainEnvDir(domain);
      const csrPath = path.join(domainEnvDir, 'certificate.csr');

      if (!fs.existsSync(csrPath)) {
        Logger.debug(`CSR file not found for domain: ${domain} in current environment`);
        return null;
      }

      const csr = await fs.promises.readFile(csrPath, 'utf8');
      
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envType = isStaging ? 'staging' : 'production';
      Logger.info(`Loaded CSR for domain: ${domain} (${envType})`);
      return csr;
    } catch (error) {
      Logger.error(`Failed to load CSR for ${domain}:`, error);
      return null;
    }
  }

  async saveRenewalLog(domain: string, log: string): Promise<void> {
    try {
      const domainDir = this.getDomainDir(domain);
      const logPath = path.join(domainDir, 'renewal.log');
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${log}\n`;

      await fs.promises.appendFile(logPath, logEntry);
      Logger.debug(`Saved renewal log for domain: ${domain}`);
    } catch (error) {
      Logger.error(`Failed to save renewal log for ${domain}:`, error);
    }
  }

  async getRenewalLog(domain: string): Promise<string[]> {
    try {
      const domainDir = this.getDomainDir(domain);
      const logPath = path.join(domainDir, 'renewal.log');

      if (!fs.existsSync(logPath)) {
        return [];
      }

      const logContent = await fs.promises.readFile(logPath, 'utf8');
      return logContent.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
      Logger.error(`Failed to read renewal log for ${domain}:`, error);
      return [];
    }
  }

  async listAccountsByDomain(domain: string): Promise<string[]> {
    try {
      const domainDir = path.join(this.accountsDir, domain);
      if (!fs.existsSync(domainDir)) {
        return [];
      }

      const providers = new Set<string>();
      
      // Check both staging and prod directories
      for (const envDir of ['staging', 'prod']) {
        const envPath = path.join(domainDir, envDir);
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
      Logger.error(`Failed to list accounts for ${domain}:`, error);
      return [];
    }
  }

  async deleteAccount(domain: string, provider: 'letsencrypt' | 'zerossl'): Promise<void> {
    try {
      const accountPath = this.getAccountPath(domain, provider);
      
      if (fs.existsSync(accountPath)) {
        await fs.promises.unlink(accountPath);
        Logger.info(`Deleted ${provider} account for domain: ${domain}`);
      }
    } catch (error) {
      Logger.error(`Failed to delete account for ${domain}:`, error);
      throw error;
    }
  }

  async cleanupDomainFiles(domain: string): Promise<void> {
    try {
      const domainDir = this.getDomainDir(domain);
      
      if (fs.existsSync(domainDir)) {
        await fs.promises.rmdir(domainDir, { recursive: true });
        Logger.info(`Cleaned up files for domain: ${domain}`);
      }
    } catch (error) {
      Logger.error(`Failed to cleanup files for ${domain}:`, error);
      throw error;
    }
  }

  async getAccountStats(): Promise<{ totalAccounts: number; domains: string[]; providers: string[] }> {
    try {
      let totalAccounts = 0;
      const domains = new Set<string>();
      const providers = new Set<string>();
      
      const domainDirs = await fs.promises.readdir(this.accountsDir);
      
      for (const domainDir of domainDirs) {
        const domainPath = path.join(this.accountsDir, domainDir);
        const stat = await fs.promises.stat(domainPath);
        
        if (stat.isDirectory()) {
          domains.add(domainDir);
          
          // Check staging and prod directories
          for (const envDir of ['staging', 'prod']) {
            const envPath = path.join(domainPath, envDir);
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
        domains: Array.from(domains),
        providers: Array.from(providers)
      };
    } catch (error) {
      Logger.error('Failed to get account stats:', error);
      return { totalAccounts: 0, domains: [], providers: [] };
    }
  }
}

export const accountManager = new AccountManager();