import { Route53Client, ChangeResourceRecordSetsCommand, ListHostedZonesByNameCommand, ChangeAction, RRType } from '@aws-sdk/client-route-53';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';

export interface Route53DNSRecord {
  id: string;
  changeId: string;
  recordName: string;
  recordValue: string;
  recordType: string;
}

export class Route53DNSProvider {
  private client: Route53Client;
  private domain: string;
  private zoneId: string;
  private recordData: Map<string, { changeId: string; value: string }> = new Map();

  constructor(accessKeyId: string, secretAccessKey: string, zoneId: string, domain: string, endpoint?: string) {
    this.client = new Route53Client({
      region: 'us-east-1', // Route53 is a global service
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      ...(endpoint && { endpoint })
    });
    this.domain = domain;
    this.zoneId = zoneId;
  }

  static async create(database: DatabaseManager, domain: string): Promise<Route53DNSProvider> {
    const settings = await database.getSettingsByProvider('route53');
    const accessKeyId = settings.find(s => s.key_name === 'AWS_ACCESS_KEY')?.key_value;
    const secretAccessKey = settings.find(s => s.key_name === 'AWS_SECRET_KEY')?.key_value;
    const zoneId = settings.find(s => s.key_name === 'AWS_ZONE_ID')?.key_value;
    
    if (!accessKeyId || !secretAccessKey || !zoneId) {
      throw new Error('AWS Route53 credentials not configured. Please add AWS_ACCESS_KEY, AWS_SECRET_KEY, and AWS_ZONE_ID to your settings.');
    }

    // Optional custom endpoint (e.g., LocalStack for testing)
    const endpoint = settings.find(s => s.key_name === 'AWS_ENDPOINT')?.key_value || undefined;

    const provider = new Route53DNSProvider(accessKeyId, secretAccessKey, zoneId, domain, endpoint);
    Logger.info(`AWS Route53 DNS provider initialized for ${domain}${endpoint ? ` (endpoint: ${endpoint})` : ''}`);
    return provider;
  }

  async createDNSRecord(recordName: string, recordValue: string, recordType: string = 'TXT'): Promise<Route53DNSRecord> {
    try {
      // Ensure record name ends with a dot for Route53
      const fqdn = recordName.endsWith('.') ? recordName : `${recordName}.`;
      
      // For TXT records, values need to be quoted
      const value = recordType === 'TXT' ? `"${recordValue}"` : recordValue;

      const params = {
        HostedZoneId: this.zoneId,
        ChangeBatch: {
          Changes: [{
            Action: 'UPSERT' as ChangeAction,
            ResourceRecordSet: {
              Name: fqdn,
              Type: recordType as RRType,
              TTL: 60,
              ResourceRecords: [{
                Value: value
              }]
            }
          }]
        }
      };

      Logger.info(`Creating Route53 DNS record: ${fqdn} (${recordType})`);
      
      const command = new ChangeResourceRecordSetsCommand(params);
      const response = await this.client.send(command);
      
      const recordId = `${recordType}_${recordName}`;
      this.recordData.set(recordId, { changeId: response.ChangeInfo?.Id || '', value });
      
      Logger.info(`Route53 DNS record created with change ID: ${response.ChangeInfo?.Id}`);
      
      return {
        id: recordId,
        changeId: response.ChangeInfo?.Id || '',
        recordName: fqdn,
        recordValue: value,
        recordType
      };
    } catch (error) {
      Logger.error(`Route53 API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new Error(`Failed to create DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async verifyDNSPropagation(recordName: string, expectedValue: string): Promise<boolean> {
    try {
      // Use AWS DNS servers for verification
      const dns = await import('dns').then(m => m.promises);
      const resolver = new dns.Resolver();
      resolver.setServers(['8.8.8.8', '1.1.1.1']); // Use public DNS for verification

      const records = await resolver.resolveTxt(recordName);
      const flatRecords = records.flat();
      
      const found = flatRecords.some(record => record === expectedValue);
      
      if (found) {
        Logger.info(`DNS record verified: ${recordName}`);
        return true;
      }

      Logger.debug(`DNS record not yet propagated: ${recordName}`);
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

      // Retrieve the stored record value for the DELETE request
      const stored = this.recordData.get(recordId);
      if (!stored) {
        Logger.warn(`No stored record data for ${recordId}, skipping delete`);
        return;
      }

      const params = {
        HostedZoneId: this.zoneId,
        ChangeBatch: {
          Changes: [{
            Action: 'DELETE' as ChangeAction,
            ResourceRecordSet: {
              Name: fqdn,
              Type: recordType as RRType,
              TTL: 60,
              ResourceRecords: [{
                Value: stored.value
              }]
            }
          }]
        }
      };

      const command = new ChangeResourceRecordSetsCommand(params);
      await this.client.send(command);
      
      Logger.info(`Route53 DNS record ${recordId} deleted successfully`);
    } catch (error) {
      Logger.error(`Failed to delete DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async waitForDNSPropagation(recordName: string, expectedValue: string, maxWaitTime: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 10000; // Check every 10 seconds

    Logger.info(`Waiting for DNS propagation on Route53...`);

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