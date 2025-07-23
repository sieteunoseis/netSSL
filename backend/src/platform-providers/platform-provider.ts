import { SSHClient } from '../ssh-client';
import { Logger } from '../logger';

export interface PlatformConfig {
  platformType: string;
  apiEndpoints: {
    generateCSR: string;
    uploadIdentityCert: string;
    getTrustCerts: string;
    uploadTrustCerts: string;
  };
  sshConfig: {
    promptPattern: string;
    serviceRestartCommand: string;
    connectionAlgorithms?: {
      kex?: string[];
      cipher?: string[];
      hmac?: string[];
      serverHostKey?: string[];
    };
  };
  certificateConfig: {
    serviceName: string;
    supportedKeyTypes: string[];
    maxKeySize: number;
  };
}

export interface CertificateData {
  certificate: string;
  privateKey?: string;
  caCertificates?: string[];
}

export interface CSRGenerationParams {
  commonName: string;
  subjectAltNames?: string[];
  keySize?: number;
  keyType?: string;
  organizationName?: string;
  organizationalUnit?: string;
  locality?: string;
  state?: string;
  country?: string;
}

export interface CSRResponse {
  csr: string;
  privateKey?: string;
  success: boolean;
  message?: string;
}

export interface CertificateUploadResponse {
  success: boolean;
  message?: string;
  certificateId?: string;
}

export abstract class PlatformProvider {
  protected config: PlatformConfig;
  protected sshClient: SSHClient;

  constructor(config: PlatformConfig) {
    this.config = config;
    this.sshClient = new SSHClient();
  }

  abstract generateCSR(
    hostname: string,
    username: string,
    password: string,
    params: CSRGenerationParams
  ): Promise<CSRResponse>;

  abstract uploadIdentityCertificate(
    hostname: string,
    username: string,
    password: string,
    certificateData: CertificateData
  ): Promise<CertificateUploadResponse>;

  abstract uploadTrustCertificates(
    hostname: string,
    username: string,
    password: string,
    caCertificates: string[]
  ): Promise<CertificateUploadResponse>;

  abstract getTrustCertificates(
    hostname: string,
    username: string,
    password: string
  ): Promise<string[]>;

  abstract restartServices(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean>;

  abstract validateConnection(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean>;

  // Common utility methods
  protected async makeApiRequest(
    hostname: string,
    username: string,
    password: string,
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    data?: any,
    headers?: Record<string, string>
  ): Promise<any> {
    const https = require('https');
    const url = require('url');
    
    const fullUrl = `https://${hostname}${endpoint}`;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    const defaultHeaders: Record<string, string> = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const allHeaders = { ...defaultHeaders, ...headers };
    const body = data ? JSON.stringify(data) : undefined;
    
    if (body) {
      allHeaders['Content-Length'] = Buffer.byteLength(body).toString();
    }

    try {
      Logger.info(`Making API request to ${fullUrl} with username: ${username}`);
      
      const parsedUrl = url.parse(fullUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: method,
        headers: allHeaders,
        rejectUnauthorized: false, // Disable SSL certificate verification for internal Cisco systems
        timeout: 30000 // 30 second timeout
      };

      const response = await new Promise<any>((resolve, reject) => {
        const req = https.request(options, (res: any) => {
          let responseBody = '';
          
          res.on('data', (chunk: any) => {
            responseBody += chunk;
          });
          
          res.on('end', () => {
            try {
              const result = {
                status: res.statusCode,
                statusText: res.statusMessage,
                ok: res.statusCode >= 200 && res.statusCode < 300,
                body: responseBody,
                json: () => {
                  try {
                    return JSON.parse(responseBody);
                  } catch (e) {
                    throw new Error(`Invalid JSON response: ${responseBody}`);
                  }
                }
              };
              resolve(result);
            } catch (error) {
              reject(error);
            }
          });
        });

        req.on('error', (error: any) => {
          reject(error);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        if (body) {
          req.write(body);
        }
        
        req.end();
      });

      if (!response.ok) {
        let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
        
        // Try to get more detailed error information
        if (response.body) {
          errorMessage += ` - ${response.body}`;
        }
        
        throw new Error(errorMessage);
      }
      
      // Parse JSON response or return raw text
      try {
        return response.json();
      } catch (e) {
        // If not JSON, return raw text
        return response.body;
      }
    } catch (error: any) {
      // Handle specific connection errors with user-friendly messages
      if (error.cause) {
        const cause = error.cause;
        
        if (cause.code === 'CERT_HAS_EXPIRED') {
          throw new Error(`Connection failed: The SSL certificate on ${hostname} has expired. Please update the certificate on the ISE server before proceeding.`);
        }
        
        if (cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          throw new Error(`Connection failed: Unable to verify SSL certificate on ${hostname}. This may be due to a self-signed certificate or certificate chain issue.`);
        }
        
        if (cause.code === 'ECONNREFUSED') {
          throw new Error(`Connection failed: Unable to connect to ${hostname}. Please verify the hostname and ensure the ISE service is running.`);
        }
        
        if (cause.code === 'ENOTFOUND') {
          throw new Error(`Connection failed: Hostname ${hostname} could not be resolved. Please verify the hostname is correct and DNS is configured properly.`);
        }
        
        if (cause.code === 'ETIMEDOUT') {
          throw new Error(`Connection failed: Connection to ${hostname} timed out. Please verify the hostname and network connectivity.`);
        }
      }
      
      // Handle generic fetch errors
      if (error.message === 'fetch failed') {
        throw new Error(`Connection failed: Unable to connect to ${hostname}. Please verify the hostname, network connectivity, and that the ISE service is running.`);
      }
      
      // Re-throw the original error if we can't provide a better message
      throw error;
    }
  }

  protected async connectSSH(
    hostname: string,
    username: string,
    password: string
  ): Promise<void> {
    const sshConfig = {
      host: hostname,
      username,
      password,
      // Temporarily remove algorithm restrictions to test
      // algorithms: this.config.sshConfig.connectionAlgorithms
    };

    Logger.info(`Connecting to SSH with algorithms:`, this.config.sshConfig.connectionAlgorithms);
    
    try {
      await this.sshClient.connect(sshConfig);
    } catch (error) {
      Logger.error(`SSH connection failed for ${hostname}:`, error);
      throw error;
    }
  }

  protected async executeSSHCommand(command: string): Promise<string> {
    return await this.sshClient.executeCommand(command);
  }

  protected async disconnectSSH(): Promise<void> {
    await this.sshClient.disconnect();
  }

  // Getter methods for configuration
  public getPlatformType(): string {
    return this.config.platformType;
  }

  public getApiEndpoints(): PlatformConfig['apiEndpoints'] {
    return this.config.apiEndpoints;
  }

  public getSSHConfig(): PlatformConfig['sshConfig'] {
    return this.config.sshConfig;
  }

  public getCertificateConfig(): PlatformConfig['certificateConfig'] {
    return this.config.certificateConfig;
  }
}