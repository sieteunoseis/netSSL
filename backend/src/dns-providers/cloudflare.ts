import https from 'https';
import dns from 'dns';
import { Logger } from '../logger';
import { DatabaseManager } from '../database';
import dnsServers from '../dns-servers.json';

export interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  zone_id: string;
  created_on: string;
  modified_on: string;
}

export interface CloudflareResponse {
  success: boolean;
  errors: any[];
  messages: any[];
  result: CloudflareRecord | CloudflareRecord[];
}

export class CloudflareProvider {
  private apiKey: string;
  private zoneId: string;
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor(apiKey: string, zoneId: string) {
    this.apiKey = apiKey;
    this.zoneId = zoneId;
  }

  static async create(database: DatabaseManager, domain: string): Promise<CloudflareProvider> {
    try {
      const settings = await database.getSettingsByProvider('cloudflare');
      const apiKey = settings.find(s => s.key_name === 'CF_KEY')?.key_value;
      const zoneId = settings.find(s => s.key_name === 'CF_ZONE')?.key_value;

      if (!apiKey || !zoneId) {
        throw new Error('Cloudflare API key or zone ID not configured in settings');
      }

      return new CloudflareProvider(apiKey, zoneId);
    } catch (error) {
      Logger.error('Failed to create Cloudflare provider:', error);
      throw error;
    }
  }

  async createTxtRecord(domain: string, value: string): Promise<CloudflareRecord> {
    try {
      const recordName = `_acme-challenge.${domain}`;
      Logger.info(`Creating TXT record: ${recordName} = ${value}`);

      const postData = JSON.stringify({
        type: 'TXT',
        name: recordName,
        content: value,
        ttl: 120 // 2 minutes for faster propagation
      });

      const response = await this.makeRequest(
        'POST',
        `/zones/${this.zoneId}/dns_records`,
        postData
      );

      if (!response.success) {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response.errors)}`);
      }

      const record = response.result as CloudflareRecord;
      Logger.info(`Successfully created TXT record: ${record.id}`);
      return record;
    } catch (error) {
      Logger.error(`Failed to create TXT record for ${domain}:`, error);
      throw error;
    }
  }

  async deleteTxtRecord(recordId: string): Promise<void> {
    try {
      Logger.info(`Deleting TXT record: ${recordId}`);

      const response = await this.makeRequest(
        'DELETE',
        `/zones/${this.zoneId}/dns_records/${recordId}`
      );

      if (!response.success) {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response.errors)}`);
      }

      Logger.info(`Successfully deleted TXT record: ${recordId}`);
    } catch (error) {
      Logger.error(`Failed to delete TXT record ${recordId}:`, error);
      throw error;
    }
  }

  async findTxtRecord(domain: string): Promise<CloudflareRecord | null> {
    try {
      const recordName = `_acme-challenge.${domain}`;
      Logger.info(`Looking for TXT record: ${recordName}`);

      const response = await this.makeRequest(
        'GET',
        `/zones/${this.zoneId}/dns_records?type=TXT&name=${recordName}`
      );

      if (!response.success) {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response.errors)}`);
      }

      const records = response.result as CloudflareRecord[];
      if (records.length === 0) {
        Logger.info(`No TXT record found for ${recordName}`);
        return null;
      }

      const record = records[0];
      Logger.info(`Found TXT record: ${record.id}`);
      return record;
    } catch (error) {
      Logger.error(`Failed to find TXT record for ${domain}:`, error);
      return null;
    }
  }

  async findAllTxtRecords(domain: string): Promise<CloudflareRecord[]> {
    try {
      const recordName = `_acme-challenge.${domain}`;
      Logger.info(`Looking for all TXT records: ${recordName}`);

      const response = await this.makeRequest(
        'GET',
        `/zones/${this.zoneId}/dns_records?type=TXT&name=${recordName}`
      );

      if (!response.success) {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response.errors)}`);
      }

      const records = response.result as CloudflareRecord[];
      Logger.info(`Found ${records.length} TXT records for ${recordName}`);
      return records;
    } catch (error) {
      Logger.error(`Failed to find TXT records for ${domain}:`, error);
      return [];
    }
  }

  async cleanupTxtRecords(domain: string): Promise<void> {
    try {
      const records = await this.findAllTxtRecords(domain);
      if (records.length === 0) {
        Logger.info(`No existing TXT records to cleanup for ${domain}`);
        return;
      }

      Logger.info(`Cleaning up ${records.length} existing TXT records for ${domain}`);
      for (const record of records) {
        await this.deleteTxtRecord(record.id);
      }
    } catch (error) {
      Logger.error(`Failed to cleanup TXT records for ${domain}:`, error);
      throw error;
    }
  }

  async verifyTxtRecord(domain: string, expectedValue: string, maxWaitTime: number = 300000): Promise<boolean> {
    try {
      const recordName = `_acme-challenge.${domain}`;
      Logger.info(`Verifying TXT record propagation for ${recordName}`);

      const startTime = Date.now();
      const checkInterval = 10000; // 10 seconds

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const isVerified = await this.checkDNSPropagation(recordName, expectedValue);
          if (isVerified) {
            Logger.info(`TXT record propagation verified for ${recordName}`);
            return true;
          }
        } catch (error) {
          Logger.debug(`DNS check failed, retrying: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        Logger.info(`Waiting for DNS propagation... (${Math.round((Date.now() - startTime) / 1000)}s)`);
        await this.sleep(checkInterval);
      }

      Logger.error(`DNS propagation verification timed out for ${recordName}`);
      return false;
    } catch (error) {
      Logger.error(`Failed to verify TXT record for ${domain}:`, error);
      return false;
    }
  }

  private async checkDNSPropagation(recordName: string, expectedValue: string): Promise<boolean> {
    // Use Cloudflare's DNS servers for faster propagation checking
    const nameservers = dnsServers.cloudflare || dnsServers.default;
    
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
      
      resolver.resolveTxt(recordName, (err: any, addresses: string[][]) => {
        if (err) {
          reject(new Error(`DNS resolution failed on ${nameserver}: ${err.message}`));
          return;
        }

        // Check if any TXT record contains the expected value
        const found = addresses.some(txtArray => 
          txtArray.some(txt => txt === expectedValue)
        );

        resolve(found);
      });
    });
  }

  private async makeRequest(method: string, path: string, data?: string): Promise<CloudflareResponse> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.cloudflare.com',
        port: 443,
        path: `/client/v4${path}`,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'CUCM-Certificate-Renewal/1.0'
        } as any
      };

      if (data) {
        options.headers['Content-Length'] = Buffer.byteLength(data);
      }

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(responseData);
            resolve(response);
          } catch (error) {
            reject(new Error(`Failed to parse Cloudflare response: ${error instanceof Error ? error.message : 'Unknown error'}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Cloudflare API request failed: ${error.message}`));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Cloudflare API request timed out'));
      });

      if (data) {
        req.write(data);
      }
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default CloudflareProvider;