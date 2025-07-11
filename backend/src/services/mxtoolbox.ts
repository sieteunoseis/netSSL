import axios from 'axios';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';

export interface MXToolboxResponse {
  uid: string;
  type: string;
  status: string;
  command: string;
  timeToComplete: string;
  reportId: number;
  information: Array<{
    data: string;
    type: string;
    value?: string;
    name?: string;
  }>;
  errors: any[];
  warnings: any[];
  failed: any[];
  timestamp: string;
}

export class MXToolboxService {
  private apiKey: string;
  private baseUrl: string = 'https://mxtoolbox.com/api/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static async create(database: DatabaseManager): Promise<MXToolboxService> {
    const settings = await database.getSettingsByProvider('zerossl');
    const apiKey = settings.find(s => s.key_name === 'MXTOOLBOX_KEY')?.key_value;
    
    if (!apiKey) {
      throw new Error('MXToolbox API key not configured. Please add MXTOOLBOX_KEY to your settings.');
    }
    
    const service = new MXToolboxService(apiKey);
    Logger.info('MXToolbox service initialized');
    return service;
  }

  async verifyTXTRecord(domain: string, expectedValue: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/Lookup/TXT/`;
      
      const response = await axios.get(url, {
        params: {
          argument: domain
        },
        headers: {
          'Authorization': this.apiKey
        }
      });

      const data: MXToolboxResponse = response.data;
      
      if (data.status === 'success' && data.information) {
        // Check if any TXT record matches our expected value
        const found = data.information.some(record => {
          if (record.type === 'TXT' && record.data) {
            // Clean the TXT record data (remove quotes if present)
            const cleanData = record.data.replace(/^"|"$/g, '');
            return cleanData === expectedValue;
          }
          return false;
        });

        if (found) {
          Logger.info(`TXT record verified for ${domain}: ${expectedValue}`);
          return true;
        } else {
          Logger.debug(`TXT record not found for ${domain}. Found records: ${data.information.map(r => r.data).join(', ')}`);
          return false;
        }
      } else {
        Logger.debug(`MXToolbox lookup failed for ${domain}: ${data.status}`);
        return false;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`MXToolbox API error: ${error.response?.data?.message || error.message}`);
        return false;
      }
      Logger.error(`MXToolbox verification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async verifyCNAMERecord(domain: string, expectedValue: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/Lookup/CNAME/`;
      
      const response = await axios.get(url, {
        params: {
          argument: domain
        },
        headers: {
          'Authorization': this.apiKey
        }
      });

      const data: MXToolboxResponse = response.data;
      
      if (data.status === 'success' && data.information) {
        // Check if any CNAME record matches our expected value
        const found = data.information.some(record => {
          if (record.type === 'CNAME' && (record.data || record.value)) {
            const recordValue = record.data || record.value || '';
            // Remove trailing dot if present
            const cleanValue = recordValue.replace(/\.$/, '');
            const cleanExpected = expectedValue.replace(/\.$/, '');
            return cleanValue === cleanExpected;
          }
          return false;
        });

        if (found) {
          Logger.info(`CNAME record verified for ${domain}: ${expectedValue}`);
          return true;
        } else {
          Logger.debug(`CNAME record not found for ${domain}. Found records: ${data.information.map(r => r.data || r.value).join(', ')}`);
          return false;
        }
      } else {
        Logger.debug(`MXToolbox CNAME lookup failed for ${domain}: ${data.status}`);
        return false;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`MXToolbox API error: ${error.response?.data?.message || error.message}`);
        return false;
      }
      Logger.error(`MXToolbox verification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async waitForDNSPropagation(domain: string, expectedValue: string, recordType: 'TXT' | 'CNAME' = 'TXT', maxWaitTime: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 30000; // Check every 30 seconds

    Logger.info(`Waiting for ${recordType} record propagation for ${domain}...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        let isVerified = false;
        
        if (recordType === 'TXT') {
          isVerified = await this.verifyTXTRecord(domain, expectedValue);
        } else if (recordType === 'CNAME') {
          isVerified = await this.verifyCNAMERecord(domain, expectedValue);
        }

        if (isVerified) {
          Logger.info(`${recordType} record propagated successfully after ${Math.round((Date.now() - startTime) / 1000)} seconds`);
          return true;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const remaining = Math.round((maxWaitTime - (Date.now() - startTime)) / 1000);
        Logger.info(`Waiting for ${recordType} propagation... (${elapsed}s elapsed, ${remaining}s remaining)`);

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        Logger.error(`Error during DNS verification: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    Logger.error(`Timeout waiting for ${recordType} record propagation after ${maxWaitTime / 1000} seconds`);
    return false;
  }

  async getDNSRecords(domain: string, recordType: 'TXT' | 'CNAME' | 'A' | 'MX' = 'TXT'): Promise<string[]> {
    try {
      const url = `${this.baseUrl}/Lookup/${recordType}/`;
      
      const response = await axios.get(url, {
        params: {
          argument: domain
        },
        headers: {
          'Authorization': this.apiKey
        }
      });

      const data: MXToolboxResponse = response.data;
      
      if (data.status === 'success' && data.information) {
        return data.information
          .filter(record => record.type === recordType)
          .map(record => record.data || record.value || '')
          .filter(value => value.length > 0);
      } else {
        Logger.debug(`MXToolbox ${recordType} lookup failed for ${domain}: ${data.status}`);
        return [];
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`MXToolbox API error: ${error.response?.data?.message || error.message}`);
        return [];
      }
      Logger.error(`MXToolbox lookup error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }
}