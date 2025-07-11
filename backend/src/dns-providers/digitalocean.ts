import axios from 'axios';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';

export interface DigitalOceanDNSRecord {
  id: number;
  type: string;
  name: string;
  data: string;
  ttl: number;
}

export class DigitalOceanDNSProvider {
  private apiKey: string;
  private domain: string;
  private baseDomain: string;

  constructor(apiKey: string, domain: string) {
    this.apiKey = apiKey;
    this.domain = domain;
    // Extract base domain (e.g., example.com from server.example.com)
    const parts = domain.split('.');
    this.baseDomain = parts.slice(-2).join('.');
  }

  static async create(database: DatabaseManager, domain: string): Promise<DigitalOceanDNSProvider> {
    const settings = await database.getSettingsByProvider('digitalocean');
    const apiKey = settings.find(s => s.key_name === 'DO_KEY')?.key_value;
    
    if (!apiKey) {
      throw new Error('DigitalOcean API key not configured. Please add DO_KEY to your settings.');
    }
    
    const provider = new DigitalOceanDNSProvider(apiKey, domain);
    Logger.info(`DigitalOcean DNS provider initialized for ${domain}`);
    return provider;
  }

  async createDNSRecord(recordName: string, recordValue: string, recordType: string = 'TXT'): Promise<DigitalOceanDNSRecord> {
    try {
      // Remove base domain from record name if present
      let name = recordName;
      if (recordName.endsWith(`.${this.baseDomain}`)) {
        name = recordName.slice(0, -(this.baseDomain.length + 1));
      }
      // Handle @ for root domain
      if (name === this.baseDomain || name === '') {
        name = '@';
      }

      const url = `https://api.digitalocean.com/v2/domains/${this.baseDomain}/records`;
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      };

      const data = {
        type: recordType,
        name: name,
        data: recordValue,
        ttl: 30 // Low TTL for faster propagation
      };

      Logger.info(`Creating DigitalOcean DNS record: ${name}.${this.baseDomain} (${recordType})`);
      
      const response = await axios.post(url, data, { headers });
      const record = response.data.domain_record;
      
      Logger.info(`DigitalOcean DNS record created with ID: ${record.id}`);
      return record;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`DigitalOcean API error: ${error.response?.data?.message || error.message}`);
        throw new Error(`Failed to create DNS record: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  async verifyDNSPropagation(recordName: string, expectedValue: string): Promise<boolean> {
    try {
      const url = `https://api.digitalocean.com/v2/domains/${this.baseDomain}/records`;
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`
      };

      const response = await axios.get(url, { headers });
      const records = response.data.domain_records;

      // Remove base domain from record name for comparison
      let searchName = recordName;
      if (recordName.endsWith(`.${this.baseDomain}`)) {
        searchName = recordName.slice(0, -(this.baseDomain.length + 1));
      }

      const found = records.some((record: DigitalOceanDNSRecord) => 
        record.type === 'TXT' && 
        (record.name === searchName || record.name === '@' && searchName === this.baseDomain) &&
        record.data === expectedValue
      );

      if (found) {
        Logger.info(`DNS record verified on DigitalOcean: ${recordName}`);
        return true;
      }

      Logger.debug(`DNS record not found on DigitalOcean: ${recordName}`);
      return false;
    } catch (error) {
      Logger.error(`Error verifying DNS propagation: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async deleteDNSRecord(recordId: string | number): Promise<void> {
    try {
      const url = `https://api.digitalocean.com/v2/domains/${this.baseDomain}/records/${recordId}`;
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`
      };

      await axios.delete(url, { headers });
      Logger.info(`DigitalOcean DNS record ${recordId} deleted successfully`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`Failed to delete DNS record: ${error.response?.data?.message || error.message}`);
      } else {
        Logger.error(`Failed to delete DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  async waitForDNSPropagation(recordName: string, expectedValue: string, maxWaitTime: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 10000; // Check every 10 seconds

    Logger.info(`Waiting for DNS propagation on DigitalOcean...`);

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