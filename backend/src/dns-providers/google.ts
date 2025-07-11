import { DNS } from '@google-cloud/dns';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';

export interface GoogleDNSRecord {
  id: string;
  name: string;
  type: string;
  ttl: number;
  data: string[];
}

export class GoogleDNSProvider {
  private dns: DNS;
  private zone: any;
  private domain: string;
  private projectId: string;
  private zoneName: string;

  constructor(projectId: string, zoneName: string, domain: string) {
    this.dns = new DNS({ projectId });
    this.zone = this.dns.zone(zoneName);
    this.domain = domain;
    this.projectId = projectId;
    this.zoneName = zoneName;
  }

  static async create(database: DatabaseManager, domain: string): Promise<GoogleDNSProvider> {
    const settings = await database.getSettingsByProvider('google');
    const projectId = settings.find(s => s.key_name === 'GOOGLE_PROJECT_ID')?.key_value;
    const zoneName = settings.find(s => s.key_name === 'GOOGLE_ZONE_NAME')?.key_value;
    
    if (!projectId || !zoneName) {
      throw new Error('Google Cloud DNS credentials not configured. Please add GOOGLE_PROJECT_ID and GOOGLE_ZONE_NAME to your settings.');
    }
    
    const provider = new GoogleDNSProvider(projectId, zoneName, domain);
    Logger.info(`Google Cloud DNS provider initialized for ${domain}`);
    return provider;
  }

  async createDNSRecord(recordName: string, recordValue: string, recordType: string = 'TXT'): Promise<GoogleDNSRecord> {
    try {
      // Ensure record name ends with a dot for Google Cloud DNS
      const fqdn = recordName.endsWith('.') ? recordName : `${recordName}.`;
      
      const record = this.zone.record(recordType.toLowerCase(), {
        name: fqdn,
        ttl: 60,
        data: recordType === 'TXT' ? [`"${recordValue}"`] : [recordValue]
      });

      Logger.info(`Creating Google Cloud DNS record: ${fqdn} (${recordType})`);
      
      const [change] = await this.zone.createChange({
        add: record
      });

      // Wait for change to be done
      await this.waitForChange(change);
      
      const recordId = `${recordType}_${recordName}`;
      
      Logger.info(`Google Cloud DNS record created: ${fqdn}`);
      
      return {
        id: recordId,
        name: fqdn,
        type: recordType,
        ttl: 60,
        data: record.data
      };
    } catch (error) {
      Logger.error(`Google Cloud DNS API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new Error(`Failed to create DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async waitForChange(change: any): Promise<void> {
    const maxWaitTime = 60000; // 1 minute
    const checkInterval = 2000; // 2 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const [metadata] = await change.getMetadata();
      if (metadata.status === 'done') {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error('Timeout waiting for DNS change to complete');
  }

  async verifyDNSPropagation(recordName: string, expectedValue: string): Promise<boolean> {
    try {
      const fqdn = recordName.endsWith('.') ? recordName : `${recordName}.`;
      const [records] = await this.zone.getRecords({
        name: fqdn,
        type: 'TXT'
      });

      const found = records.some((record: any) => 
        record.data && record.data.some((data: string) => 
          data === `"${expectedValue}"` || data === expectedValue
        )
      );
      
      if (found) {
        Logger.info(`DNS record verified on Google Cloud: ${recordName}`);
        return true;
      }

      Logger.debug(`DNS record not found on Google Cloud: ${recordName}`);
      return false;
    } catch (error) {
      Logger.debug(`DNS verification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async deleteDNSRecord(recordId: string): Promise<void> {
    try {
      const [recordType, ...nameParts] = recordId.split('_');
      const recordName = nameParts.join('_');
      const fqdn = recordName.endsWith('.') ? recordName : `${recordName}.`;

      const [records] = await this.zone.getRecords({
        name: fqdn,
        type: recordType
      });

      if (records.length > 0) {
        const [change] = await this.zone.createChange({
          delete: records[0]
        });

        await this.waitForChange(change);
        Logger.info(`Google Cloud DNS record ${recordId} deleted successfully`);
      } else {
        Logger.warn(`DNS record ${recordId} not found for deletion`);
      }
    } catch (error) {
      Logger.error(`Failed to delete DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async waitForDNSPropagation(recordName: string, expectedValue: string, maxWaitTime: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 10000; // Check every 10 seconds

    Logger.info(`Waiting for DNS propagation on Google Cloud...`);

    while (Date.now() - startTime < maxWaitTime) {
      const isVerified = await this.verifyDNSPropagation(recordName, expectedValue);
      if (isVerified) {
        Logger.info(`DNS record propagated successfully after ${Math.round((Date.now() - startTime) / 1000)} seconds`);
        return true;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const remaining = Math.round((maxWaitTime - (Date.now() - startTime)) / 1000);
      Logger.info(`Waiting for DNS propagation... (${elapsed}s elapsed, ${remaining}s remaining)`);

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    Logger.error(`Timeout waiting for DNS propagation after ${maxWaitTime / 1000} seconds`);
    return false;
  }
}