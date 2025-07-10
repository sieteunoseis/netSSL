import dns from 'dns';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';
import dnsServers from '../dns-servers.json';

export interface InternalDNSRecord {
  id: string;
  domain: string;
  recordName: string;
  recordValue: string;
  recordType: string;
  status: 'pending' | 'verified' | 'failed';
  createdAt: Date;
  verifiedAt?: Date;
}

export class InternalDNSProvider {
  private database: DatabaseManager;
  private domain: string;
  private customDnsServers: string[] = [];

  constructor(database: DatabaseManager, domain: string) {
    this.database = database;
    this.domain = domain;
  }

  static async create(database: DatabaseManager, domain: string): Promise<InternalDNSProvider> {
    const provider = new InternalDNSProvider(database, domain);
    
    // Load custom DNS servers from settings
    const settings = await database.getSettingsByProvider('internal');
    const dnsServer1 = settings.find(s => s.key_name === 'INTERNAL_DNS_SERVER_1')?.key_value;
    const dnsServer2 = settings.find(s => s.key_name === 'INTERNAL_DNS_SERVER_2')?.key_value;
    
    if (dnsServer1) provider.customDnsServers.push(dnsServer1);
    if (dnsServer2) provider.customDnsServers.push(dnsServer2);
    
    Logger.info(`Internal DNS provider initialized for ${domain} with custom servers: ${provider.customDnsServers.join(', ')}`);
    return provider;
  }

  async createDNSRecord(recordName: string, recordValue: string, recordType: string = 'TXT'): Promise<InternalDNSRecord> {
    const record: InternalDNSRecord = {
      id: `internal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      domain: this.domain,
      recordName,
      recordValue,
      recordType,
      status: 'pending',
      createdAt: new Date()
    };

    Logger.info(`Internal DNS: Created record ${recordName} = ${recordValue}`);
    Logger.info(`Manual DNS Entry Required:`);
    Logger.info(`  Record Type: ${recordType}`);
    Logger.info(`  Name: ${recordName}`);
    Logger.info(`  Value: ${recordValue}`);
    Logger.info(`  TTL: 300 (or lower for faster propagation)`);
    
    return record;
  }

  async verifyDNSPropagation(recordName: string, expectedValue: string): Promise<boolean> {
    // Use custom DNS servers if configured, otherwise use defaults
    const nameservers = this.customDnsServers.length > 0 
      ? this.customDnsServers 
      : (dnsServers.internal || dnsServers.default);
    
    Logger.info(`Verifying DNS propagation for ${recordName} using servers: ${nameservers.join(', ')}`);
    
    // Try each nameserver until we get a successful response
    for (const nameserver of nameservers) {
      try {
        const result = await this.queryDNSServer(nameserver, recordName, expectedValue);
        if (result) {
          Logger.info(`DNS propagation verified on ${nameserver}: ${recordName}`);
          return true;
        }
      } catch (error) {
        Logger.debug(`DNS query failed on ${nameserver}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    Logger.debug(`DNS propagation not yet complete for ${recordName}`);
    return false;
  }

  private async queryDNSServer(nameserver: string, recordName: string, expectedValue: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const resolver = new dns.Resolver();
      resolver.setServers([nameserver]);
      
      resolver.resolveTxt(recordName, (err, records) => {
        if (err) {
          reject(new Error(`DNS resolution failed on ${nameserver}: ${err.message}`));
          return;
        }
        
        // Flatten the TXT records and check for our expected value
        const flatRecords = records.flat();
        const found = flatRecords.some(record => record === expectedValue);
        
        if (found) {
          Logger.debug(`Found expected TXT record on ${nameserver}: ${expectedValue}`);
          resolve(true);
        } else {
          Logger.debug(`Expected value not found on ${nameserver}. Found: ${flatRecords.join(', ')}`);
          resolve(false);
        }
      });
    });
  }

  async deleteDNSRecord(recordId: string): Promise<void> {
    // For internal DNS, we just log the deletion - admin needs to manually remove
    Logger.info(`Internal DNS: Record ${recordId} marked for deletion`);
    Logger.info(`Manual DNS Entry Removal Required - please remove the TXT record manually`);
  }

  async waitForManualEntry(recordName: string, expectedValue: string, maxWaitTime: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 10000; // Check every 10 seconds
    
    Logger.info(`Waiting for manual DNS entry. You have ${maxWaitTime / 1000} seconds to add the record.`);
    Logger.info(`Checking every ${checkInterval / 1000} seconds...`);
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const isVerified = await this.verifyDNSPropagation(recordName, expectedValue);
        if (isVerified) {
          Logger.info(`DNS record verified successfully after ${Math.round((Date.now() - startTime) / 1000)} seconds`);
          return true;
        }
        
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const remaining = Math.round((maxWaitTime - (Date.now() - startTime)) / 1000);
        Logger.info(`Waiting for DNS entry... (${elapsed}s elapsed, ${remaining}s remaining)`);
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        Logger.error(`Error during DNS verification: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    Logger.error(`Timeout waiting for manual DNS entry after ${maxWaitTime / 1000} seconds`);
    return false;
  }

  getManualInstructions(recordName: string, recordValue: string): string {
    return `
Manual DNS Configuration Required:

1. Log into your DNS management interface
2. Add a new TXT record with these details:
   - Record Type: TXT
   - Name/Host: ${recordName}
   - Value/Content: ${recordValue}
   - TTL: 300 (or minimum allowed)

3. Save the record and wait for propagation
4. The system will automatically verify the record every 10 seconds

DNS Servers being monitored: ${this.customDnsServers.length > 0 ? this.customDnsServers.join(', ') : 'Default (8.8.8.8, 1.1.1.1)'}
`;
  }
}