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
    const url = `https://${hostname}${endpoint}`;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    const defaultHeaders = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const response = await fetch(url, {
      method,
      headers: { ...defaultHeaders, ...headers },
      body: data ? JSON.stringify(data) : undefined,
      // Disable certificate verification for internal Cisco systems
      // @ts-ignore
      rejectUnauthorized: false
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    
    return await response.text();
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