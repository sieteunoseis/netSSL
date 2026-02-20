import { 
  PlatformProvider, 
  PlatformConfig, 
  CSRGenerationParams, 
  CSRResponse, 
  CertificateData, 
  CertificateUploadResponse 
} from './platform-provider';
import { Logger } from '../logger';
import * as crypto from 'crypto';

export interface ISECertificateImportResult {
  node: string;
  status: 'success' | 'error';
  message: string;
  data?: any;
  error?: string;
}

export interface ISECertificateImportResponse {
  message: string;
  results: ISECertificateImportResult[];
  config: any;
}

export interface ISEImportConfig {
  admin?: boolean;
  allowExtendedValidity?: boolean;
  allowOutOfDateCert?: boolean;
  allowPortalTagTransferForSameSubject?: boolean;
  allowReplacementOfCertificates?: boolean;
  allowReplacementOfPortalGroupTag?: boolean;
  allowRoleTransferForSameSubject?: boolean;
  allowSHA1Certificates?: boolean;
  allowWildCardCertificates?: boolean;
  eap?: boolean;
  ims?: boolean;
  name?: string;
  password?: string;
  portal?: boolean;
  portalGroupTag?: string;
  pxgrid?: boolean;
  radius?: boolean;
  saml?: boolean;
  validateCertificateExtensions?: boolean;
}

export class ISEProvider extends PlatformProvider {
  constructor() {
    const config: PlatformConfig = {
      platformType: 'ise',
      apiEndpoints: {
        generateCSR: '/api/v1/certs/certificate-signing-request',
        uploadIdentityCert: '/api/v1/certs/system-certificate/import',
        getTrustCerts: '/api/v1/certs/trusted-certificate',
        uploadTrustCerts: '/api/v1/certs/trusted-certificate/import'
      },
      sshConfig: {
        promptPattern: 'ise/',
        serviceRestartCommand: 'application restart ise',
        connectionAlgorithms: {
          kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1'],
          cipher: ['aes256-ctr', 'aes192-ctr', 'aes128-ctr'],
          hmac: ['hmac-sha2-256', 'hmac-sha1'],
          serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256']
        }
      },
      certificateConfig: {
        serviceName: 'ise',
        supportedKeyTypes: ['RSA'],
        maxKeySize: 4096
      }
    };
    
    super(config);
  }

  async generateCSR(
    hostname: string,
    username: string,
    password: string,
    params: CSRGenerationParams
  ): Promise<CSRResponse> {
    try {
      Logger.info(`Generating CSR for ISE platform: ${hostname}`);

      const csrData = {
        subjectCommonName: params.commonName,
        subjectOrgName: params.organizationName || 'Default Organization',
        subjectOrgUnit: params.organizationalUnit || 'IT Department',
        subjectLocation: params.locality || 'Default City',
        subjectState: params.state || 'Default State',
        subjectCountry: params.country || 'US',
        keyType: params.keyType || 'RSA',
        keyLength: params.keySize || 2048,
        digestType: 'SHA256',
        certificateUsage: 'PORTAL',
        subjectAlternativeNames: params.subjectAltNames || []
      };

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.generateCSR,
        'POST',
        csrData
      );

      if (response && response.response) {
        return {
          csr: response.response.certificateSigningRequest,
          privateKey: response.response.privateKey,
          success: true,
          message: 'CSR generated successfully'
        };
      }

      throw new Error('Invalid response from ISE CSR generation API');
    } catch (error: any) {
      Logger.error(`Failed to generate CSR for ISE ${hostname}:`, error);
      return {
        csr: '',
        success: false,
        message: error.message || 'Failed to generate CSR'
      };
    }
  }

  async uploadIdentityCertificate(
    hostname: string,
    username: string,
    password: string,
    certificateData: CertificateData
  ): Promise<CertificateUploadResponse> {
    try {
      Logger.info(`Uploading identity certificate to ISE: ${hostname}`);

      const uploadData = {
        data: certificateData.certificate,
        privateKeyData: certificateData.privateKey || '',
        admin: false,
        allowExtendedValidity: true,
        allowOutOfDateCert: true,
        allowPortalTagTransferForSameSubject: true,
        allowReplacementOfCertificates: true,
        allowReplacementOfPortalGroupTag: true,
        allowRoleTransferForSameSubject: true,
        allowSHA1Certificates: true,
        allowWildCardCertificates: false,
        eap: false,
        ims: false,
        name: 'netSSL Imported Certificate',
        password: '',
        portal: true,
        portalGroupTag: 'My Default Portal Certificate Group',
        pxgrid: false,
        radius: false,
        saml: false,
        validateCertificateExtensions: false
      };

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.uploadIdentityCert,
        'POST',
        uploadData
      );

      return {
        success: true,
        message: 'Certificate uploaded successfully',
        certificateId: response?.response?.id || 'unknown'
      };
    } catch (error: any) {
      Logger.error(`Failed to upload certificate to ISE ${hostname}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to upload certificate'
      };
    }
  }

  async uploadTrustCertificates(
    hostname: string,
    username: string,
    password: string,
    caCertificates: string[]
  ): Promise<CertificateUploadResponse> {
    try {
      Logger.info(`Uploading trust certificates to ISE: ${hostname}`);

      // Get existing certificate fingerprints
      const existingFingerprints = await this.getExistingTrustCertificateFingerprints(
        hostname,
        username,
        password
      );

      const results = [];
      let skippedCount = 0;
      
      for (const cert of caCertificates) {
        // Calculate fingerprint of the certificate we're about to upload
        const certFingerprint = this.calculateCertificateFingerprint(cert);
        
        // Check if certificate already exists
        if (existingFingerprints.has(certFingerprint)) {
          Logger.info(`Certificate already exists on ${hostname}, skipping upload. Fingerprint: ${certFingerprint}`);
          skippedCount++;
          continue;
        }

        const uploadData = {
          allowBasicConstraintCAFalse: true,
          allowOutOfDateCert: true,
          allowSHA1Certificates: true,
          data: cert,
          description: "Imported Trust Certificate",
          name: `Trust Certificate ${Date.now()}`,
          trustForCertificateBasedAdminAuth: false,
          trustForCiscoServicesAuth: false,
          trustForClientAuth: false,
          trustForIseAuth: false,
          validateCertificateExtensions: false
        };

        try {
          const response = await this.makeApiRequest(
            hostname,
            username,
            password,
            this.config.apiEndpoints.uploadTrustCerts,
            'POST',
            uploadData
          );
          results.push(response);
          Logger.info(`Successfully uploaded trust certificate to ${hostname}. Fingerprint: ${certFingerprint}`);
        } catch (error: any) {
          Logger.error(`Failed to upload trust certificate to ${hostname}:`, error);
          
          // Provide user-friendly error message
          let userMessage = error.message || 'Failed to upload trust certificate';
          if (error.message && error.message.includes('expired')) {
            userMessage = `SSL certificate expired on ${hostname} - Please update the SSL certificate first`;
          } else if (error.message && error.message.includes('Connection failed')) {
            userMessage = `Connection failed to ${hostname} - Please verify hostname and network connectivity`;
          }
          
          throw new Error(userMessage);
        }
      }

      const uploadedCount = results.length;
      let message = '';
      
      if (uploadedCount > 0 && skippedCount > 0) {
        message = `Successfully uploaded ${uploadedCount} trust certificates, skipped ${skippedCount} existing certificates`;
      } else if (uploadedCount > 0) {
        message = `Successfully uploaded ${uploadedCount} trust certificates`;
      } else if (skippedCount > 0) {
        message = `All ${skippedCount} certificates already exist, no new certificates uploaded`;
      } else {
        message = 'No certificates to upload';
      }

      return {
        success: true,
        message: message
      };
    } catch (error: any) {
      Logger.error(`Failed to upload trust certificates to ISE ${hostname}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to upload trust certificates'
      };
    }
  }

  /**
   * Calculate SHA256 fingerprint of a certificate
   */
  private calculateCertificateFingerprint(certPem: string): string {
    // Remove PEM headers/footers and decode base64
    const base64 = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    
    const certBuffer = Buffer.from(base64, 'base64');
    return crypto.createHash('sha256').update(certBuffer).digest('hex');
  }

  /**
   * Get list of existing trust certificate fingerprints from ISE
   */
  async getExistingTrustCertificateFingerprints(
    hostname: string,
    username: string,
    password: string
  ): Promise<Set<string>> {
    try {
      Logger.info(`Getting existing trust certificate fingerprints from ISE: ${hostname}`);

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.getTrustCerts,
        'GET'
      );

      const fingerprints = new Set<string>();

      if (response && response.response && Array.isArray(response.response)) {
        for (const cert of response.response) {
          if (cert.sha256Fingerprint) {
            // ISE returns fingerprints without colons, normalize to lowercase
            fingerprints.add(cert.sha256Fingerprint.toLowerCase());
          }
        }
      }

      Logger.info(`Found ${fingerprints.size} existing trust certificates on ${hostname}`);
      return fingerprints;
    } catch (error: any) {
      Logger.error(`Failed to get trust certificate fingerprints from ISE ${hostname}:`, error);
      return new Set<string>();
    }
  }

  async getTrustCertificates(
    hostname: string,
    username: string,
    password: string
  ): Promise<string[]> {
    try {
      Logger.info(`Getting trust certificates from ISE: ${hostname}`);

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.getTrustCerts,
        'GET'
      );

      if (response && response.SearchResult && response.SearchResult.resources) {
        const certificates = [];
        for (const resource of response.SearchResult.resources) {
          // Get individual certificate details
          const certResponse = await this.makeApiRequest(
            hostname,
            username,
            password,
            `${this.config.apiEndpoints.getTrustCerts}/${resource.id}`,
            'GET'
          );
          
          if (certResponse && certResponse.TrustedCertificate && certResponse.TrustedCertificate.certificateContent) {
            certificates.push(certResponse.TrustedCertificate.certificateContent);
          }
        }
        return certificates;
      }

      return [];
    } catch (error: any) {
      Logger.error(`Failed to get trust certificates from ISE ${hostname}:`, error);
      return [];
    }
  }

  async restartServices(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      Logger.info(`Restarting ISE services on: ${hostname}`);

      await this.connectSSH(hostname, username, password);
      
      // Execute the restart command
      const result = await this.executeSSHCommand(this.config.sshConfig.serviceRestartCommand);
      
      await this.disconnectSSH();

      Logger.info(`ISE service restart completed on ${hostname}: ${result}`);
      return true;
    } catch (error: any) {
      Logger.error(`Failed to restart ISE services on ${hostname}:`, error);
      await this.disconnectSSH();
      return false;
    }
  }

  async validateConnection(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      Logger.info(`Validating ISE connection: ${hostname}`);

      // Try API connection first
      try {
        const response = await this.makeApiRequest(
          hostname,
          username,
          password,
          '/api/v1/deployment/node',
          'GET'
        );

        if (response) {
          Logger.info(`ISE API connection successful for ${hostname}`);
          return true;
        }
      } catch (apiError) {
        Logger.warn(`ISE API connection failed for ${hostname}, trying SSH:`, apiError);
      }

      // Fallback to SSH connection
      await this.connectSSH(hostname, username, password);
      await this.disconnectSSH();
      
      Logger.info(`ISE SSH connection successful for ${hostname}`);
      return true;
    } catch (error: any) {
      Logger.error(`ISE connection validation failed for ${hostname}:`, error);
      await this.disconnectSSH();
      return false;
    }
  }

  /**
   * Import certificate to multiple ISE nodes using custom configuration
   */
  async importCertificateToNodes(
    nodes: string[],
    username: string,
    password: string,
    certificateData: string,
    privateKeyData: string,
    customConfig?: ISEImportConfig
  ): Promise<ISECertificateImportResponse> {
    // Default import configuration
    const defaultConfig: ISEImportConfig = {
      admin: false,
      allowExtendedValidity: true,
      allowOutOfDateCert: true,
      allowPortalTagTransferForSameSubject: true,
      allowReplacementOfCertificates: true,
      allowReplacementOfPortalGroupTag: true,
      allowRoleTransferForSameSubject: true,
      allowSHA1Certificates: true,
      allowWildCardCertificates: false,
      eap: false,
      ims: false,
      name: 'netSSL Imported Certificate',
      password: '',
      portal: true,
      portalGroupTag: 'My Default Portal Certificate Group',
      pxgrid: false,
      radius: false,
      saml: false,
      validateCertificateExtensions: false
    };

    // Merge with custom configuration
    const finalConfig = { ...defaultConfig, ...customConfig };

    // Add certificate data
    const importPayload = {
      ...finalConfig,
      data: certificateData,
      privateKeyData: privateKeyData
    };

    const results: ISECertificateImportResult[] = [];

    for (const node of nodes) {
      if (!node.trim()) continue;

      try {
        Logger.info(`Importing certificate to ISE node: ${node}`);

        const response = await this.makeApiRequest(
          node,
          username,
          password,
          this.config.apiEndpoints.uploadIdentityCert,
          'POST',
          importPayload
        );

        results.push({
          node: node,
          status: 'success',
          message: 'Certificate imported successfully',
          data: response
        });
        
        Logger.info(`Successfully imported certificate to ${node}`);
      } catch (error: any) {
        // Provide user-friendly error messages
        let userMessage = error.message || 'Failed to import certificate';
        
        // Check for specific error patterns and provide helpful guidance
        if (error.message && error.message.includes('expired')) {
          userMessage = `SSL certificate expired - Please update the SSL certificate on this ISE node first`;
        } else if (error.message && error.message.includes('Connection failed')) {
          userMessage = `Connection failed - Please verify hostname and network connectivity`;
        } else if (error.message && error.message.includes('Unable to connect')) {
          userMessage = `Unable to connect - Please verify the ISE service is running and hostname is correct`;
        } else if (error.message && error.message.includes('API request failed: 401')) {
          userMessage = `Authentication failed - Please verify ISE username and password`;
        } else if (error.message && error.message.includes('API request failed: 403')) {
          userMessage = `Access denied - Please verify user has certificate management permissions in ISE`;
        } else if (error.message && error.message.includes('API request failed: 404')) {
          userMessage = `API endpoint not found - Please verify ISE version supports certificate import API`;
        }

        results.push({
          node: node,
          status: 'error',
          message: userMessage,
          error: error.message
        });
        
        Logger.error(`Error importing certificate to ${node}:`, error);
      }
    }

    // Check if any imports were successful
    const successCount = results.filter(r => r.status === 'success').length;
    const totalCount = results.length;

    return {
      message: `Certificate import completed. ${successCount}/${totalCount} nodes successful.`,
      results: results,
      config: finalConfig
    };
  }
}