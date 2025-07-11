import { DnsManagementClient } from '@azure/arm-dns';
import { DefaultAzureCredential } from '@azure/identity';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';

export interface AzureDNSRecord {
  id: string;
  name: string;
  type: string;
  ttl: number;
  recordValue: string;
}

export class AzureDNSProvider {
  private client: DnsManagementClient;
  private domain: string;
  private resourceGroup: string;
  private zoneName: string;
  private subscriptionId: string;

  constructor(subscriptionId: string, resourceGroup: string, zoneName: string, domain: string) {
    const credential = new DefaultAzureCredential();
    this.client = new DnsManagementClient(credential, subscriptionId);
    this.domain = domain;
    this.resourceGroup = resourceGroup;
    this.zoneName = zoneName;
    this.subscriptionId = subscriptionId;
  }

  static async create(database: DatabaseManager, domain: string): Promise<AzureDNSProvider> {
    const settings = await database.getSettingsByProvider('azure');
    const subscriptionId = settings.find(s => s.key_name === 'AZURE_SUBSCRIPTION_ID')?.key_value;
    const resourceGroup = settings.find(s => s.key_name === 'AZURE_RESOURCE_GROUP')?.key_value;
    const zoneName = settings.find(s => s.key_name === 'AZURE_ZONE_NAME')?.key_value;
    
    if (!subscriptionId || !resourceGroup || !zoneName) {
      throw new Error('Azure DNS credentials not configured. Please add AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and AZURE_ZONE_NAME to your settings.');
    }
    
    const provider = new AzureDNSProvider(subscriptionId, resourceGroup, zoneName, domain);
    Logger.info(`Azure DNS provider initialized for ${domain}`);
    return provider;
  }

  async createDNSRecord(recordName: string, recordValue: string, recordType: string = 'TXT'): Promise<AzureDNSRecord> {
    try {
      // Remove zone name from record name if present
      let relativeRecordName = recordName;
      if (recordName.endsWith(`.${this.zoneName}`)) {
        relativeRecordName = recordName.slice(0, -(this.zoneName.length + 1));
      }
      
      // Handle root domain
      if (relativeRecordName === this.zoneName || relativeRecordName === '') {
        relativeRecordName = '@';
      }

      const recordSet = {
        TTL: 60,
        metadata: {},
        ...(recordType === 'TXT' ? {
          txtRecords: [{ value: [recordValue] }]
        } : recordType === 'CNAME' ? {
          cnameRecord: { cname: recordValue }
        } : {})
      };

      Logger.info(`Creating Azure DNS record: ${relativeRecordName}.${this.zoneName} (${recordType})`);
      
      const response = await this.client.recordSets.createOrUpdate(
        this.resourceGroup,
        this.zoneName,
        relativeRecordName,
        recordType as any,
        recordSet
      );

      const recordId = `${recordType}_${relativeRecordName}`;
      
      Logger.info(`Azure DNS record created: ${relativeRecordName}`);
      
      return {
        id: recordId,
        name: relativeRecordName,
        type: recordType,
        ttl: 60,
        recordValue
      };
    } catch (error) {
      Logger.error(`Azure DNS API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new Error(`Failed to create DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async verifyDNSPropagation(recordName: string, expectedValue: string): Promise<boolean> {
    try {
      let relativeRecordName = recordName;
      if (recordName.endsWith(`.${this.zoneName}`)) {
        relativeRecordName = recordName.slice(0, -(this.zoneName.length + 1));
      }

      const response = await this.client.recordSets.get(
        this.resourceGroup,
        this.zoneName,
        relativeRecordName,
        'TXT'
      );

      if (response.txtRecords) {
        const found = response.txtRecords.some(record => 
          record.value && record.value.includes(expectedValue)
        );
        
        if (found) {
          Logger.info(`DNS record verified on Azure: ${recordName}`);
          return true;
        }
      }

      Logger.debug(`DNS record not found on Azure: ${recordName}`);
      return false;
    } catch (error) {
      Logger.debug(`DNS verification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async deleteDNSRecord(recordId: string): Promise<void> {
    try {
      const [recordType, relativeRecordName] = recordId.split('_');

      await this.client.recordSets.delete(
        this.resourceGroup,
        this.zoneName,
        relativeRecordName,
        recordType as any
      );
      
      Logger.info(`Azure DNS record ${recordId} deleted successfully`);
    } catch (error) {
      Logger.error(`Failed to delete DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async waitForDNSPropagation(recordName: string, expectedValue: string, maxWaitTime: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 10000; // Check every 10 seconds

    Logger.info(`Waiting for DNS propagation on Azure...`);

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