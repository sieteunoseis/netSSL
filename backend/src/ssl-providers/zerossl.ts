import axios from 'axios';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';

export interface ZeroSSLCertificate {
  id: string;
  status: string;
  common_name: string;
  alternative_names: string[];
  validation: {
    email_validation?: any;
    other_methods?: any;
  };
  replacement_for?: string;
  created: string;
  expires: string;
  certificate?: {
    certificate?: string;
    ca_bundle?: string;
  };
}

export interface ZeroSSLValidation {
  domain: string;
  method: string;
  status: string;
  details?: {
    cname_validation_p1?: string;
    cname_validation_p2?: string;
  };
}

export class ZeroSSLProvider {
  private apiKey: string;
  private baseUrl: string = 'https://api.zerossl.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static async create(database: DatabaseManager): Promise<ZeroSSLProvider> {
    const settings = await database.getSettingsByProvider('zerossl');
    const apiKey = settings.find(s => s.key_name === 'ZEROSSL_KEY')?.key_value;
    
    if (!apiKey) {
      throw new Error('ZeroSSL API key not configured. Please add ZEROSSL_KEY to your settings.');
    }
    
    const provider = new ZeroSSLProvider(apiKey);
    Logger.info('ZeroSSL provider initialized');
    return provider;
  }

  async createCertificate(domains: string[], csr?: string): Promise<ZeroSSLCertificate> {
    try {
      const url = `${this.baseUrl}/certificates`;
      
      const data: any = {
        access_key: this.apiKey,
        certificate_domains: domains.join(','),
        certificate_validity_days: 90,
        certificate_csr: csr || undefined
      };

      Logger.info(`Creating ZeroSSL certificate for domains: ${domains.join(', ')}`);
      
      const response = await axios.post(url, new URLSearchParams(data), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const certificate = response.data;
      Logger.info(`ZeroSSL certificate created with ID: ${certificate.id}`);
      return certificate;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`ZeroSSL API error: ${error.response?.data?.error?.message || error.message}`);
        throw new Error(`Failed to create certificate: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  async getCertificate(certificateId: string): Promise<ZeroSSLCertificate> {
    try {
      const url = `${this.baseUrl}/certificates/${certificateId}`;
      
      const response = await axios.get(url, {
        params: {
          access_key: this.apiKey
        }
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`ZeroSSL API error: ${error.response?.data?.error?.message || error.message}`);
        throw new Error(`Failed to get certificate: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  async getValidationDetails(certificateId: string): Promise<ZeroSSLValidation[]> {
    try {
      const url = `${this.baseUrl}/certificates/${certificateId}/challenges`;
      
      const response = await axios.get(url, {
        params: {
          access_key: this.apiKey
        }
      });

      const validationData = response.data;
      const validations: ZeroSSLValidation[] = [];

      // Parse validation data for each domain
      for (const [domain, details] of Object.entries(validationData)) {
        if (typeof details === 'object' && details !== null) {
          const domainDetails = details as any;
          validations.push({
            domain,
            method: 'CNAME_CSR_HASH',
            status: 'pending',
            details: {
              cname_validation_p1: domainDetails.other_methods?.['CNAME_CSR_HASH']?.cname_validation_p1,
              cname_validation_p2: domainDetails.other_methods?.['CNAME_CSR_HASH']?.cname_validation_p2
            }
          });
        }
      }

      Logger.info(`Retrieved validation details for ${validations.length} domains`);
      return validations;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`ZeroSSL API error: ${error.response?.data?.error?.message || error.message}`);
        throw new Error(`Failed to get validation details: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  async verifyDomain(certificateId: string, domain: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/certificates/${certificateId}/challenges`;
      
      const data = new URLSearchParams({
        access_key: this.apiKey,
        validation_method: 'CNAME_CSR_HASH'
      });

      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      Logger.info(`Domain verification initiated for ${domain}`);
      return response.status === 200;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`ZeroSSL verification error: ${error.response?.data?.error?.message || error.message}`);
        return false;
      }
      return false;
    }
  }

  async downloadCertificate(certificateId: string): Promise<string> {
    try {
      const url = `${this.baseUrl}/certificates/${certificateId}/download/return`;
      
      const response = await axios.get(url, {
        params: {
          access_key: this.apiKey
        }
      });

      const certificateData = response.data;
      
      if (certificateData['certificate.crt'] && certificateData['ca_bundle.crt']) {
        const fullChain = certificateData['certificate.crt'] + '\n' + certificateData['ca_bundle.crt'];
        Logger.info(`Downloaded ZeroSSL certificate ${certificateId}`);
        return fullChain;
      } else {
        throw new Error('Certificate data incomplete');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        Logger.error(`ZeroSSL download error: ${error.response?.data?.error?.message || error.message}`);
        throw new Error(`Failed to download certificate: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  async waitForCertificate(certificateId: string, maxWaitTime: number = 300000): Promise<string> {
    const startTime = Date.now();
    const checkInterval = 30000; // Check every 30 seconds

    Logger.info(`Waiting for ZeroSSL certificate ${certificateId} to be issued...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const certificate = await this.getCertificate(certificateId);
        
        if (certificate.status === 'issued') {
          Logger.info(`Certificate ${certificateId} has been issued, downloading...`);
          return await this.downloadCertificate(certificateId);
        } else if (certificate.status === 'cancelled' || certificate.status === 'expired') {
          throw new Error(`Certificate ${certificateId} status: ${certificate.status}`);
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const remaining = Math.round((maxWaitTime - (Date.now() - startTime)) / 1000);
        Logger.info(`Certificate status: ${certificate.status}. Waiting... (${elapsed}s elapsed, ${remaining}s remaining)`);

        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        Logger.error(`Error checking certificate status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }
    }

    throw new Error(`Timeout waiting for certificate ${certificateId} after ${maxWaitTime / 1000} seconds`);
  }
}