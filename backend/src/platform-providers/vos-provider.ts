import { 
  PlatformProvider, 
  PlatformConfig, 
  CSRGenerationParams, 
  CSRResponse, 
  CertificateData, 
  CertificateUploadResponse 
} from './platform-provider';
import { Logger } from '../logger';

export class VOSProvider extends PlatformProvider {
  constructor() {
    const config: PlatformConfig = {
      platformType: 'vos',
      apiEndpoints: {
        generateCSR: '/platformcom/api/v1/certmgr/config/csr',
        uploadIdentityCert: '/platformcom/api/v1/certmgr/config/identity/certificates',
        getTrustCerts: '/platformcom/api/v1/certmgr/config/trust/certificate?service=tomcat',
        uploadTrustCerts: '/platformcom/api/v1/certmgr/config/trust/certificates'
      },
      sshConfig: {
        promptPattern: 'admin:',
        serviceRestartCommand: 'utils service restart Cisco Tomcat',
        connectionAlgorithms: {
          kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'],
          cipher: ['aes256-ctr', 'aes192-ctr', 'aes128-ctr', 'aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc'],
          hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5'],
          serverHostKey: ['ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa', 'ssh-dss']
        }
      },
      certificateConfig: {
        serviceName: 'tomcat',
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
      Logger.info(`Generating CSR for VOS platform: ${hostname}`);

      const csrData = {
        certificateRequestData: {
          subject: {
            commonName: params.commonName,
            organizationName: params.organizationName || 'Cisco',
            organizationalUnit: params.organizationalUnit || 'IT',
            locality: params.locality || 'San Jose',
            state: params.state || 'CA',
            country: params.country || 'US'
          },
          keySize: params.keySize || 2048,
          keyType: params.keyType || 'RSA',
          subjectAltNames: params.subjectAltNames || []
        }
      };

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.generateCSR,
        'POST',
        csrData
      );

      if (response && response.certificateSigningRequest) {
        Logger.info(`Successfully generated CSR for ${hostname}`);
        return {
          csr: response.certificateSigningRequest,
          success: true,
          message: 'CSR generated successfully'
        };
      } else {
        throw new Error('Invalid response format from VOS API');
      }
    } catch (error) {
      Logger.error(`Failed to generate CSR for ${hostname}:`, error);
      return {
        csr: '',
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
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
      Logger.info(`Uploading identity certificate to VOS platform: ${hostname}`);

      // First upload the leaf certificate
      const leafUploadResult = await this.uploadLeafCertificate(
        hostname,
        username,
        password,
        certificateData.certificate,
        certificateData.privateKey
      );

      if (!leafUploadResult.success) {
        return leafUploadResult;
      }

      // Then upload CA certificates if provided
      if (certificateData.caCertificates && certificateData.caCertificates.length > 0) {
        const caUploadResult = await this.uploadTrustCertificates(
          hostname,
          username,
          password,
          certificateData.caCertificates
        );

        if (!caUploadResult.success) {
          Logger.warn(`CA certificate upload failed, but leaf certificate was uploaded successfully`);
        }
      }

      return {
        success: true,
        message: 'Certificate uploaded successfully',
        certificateId: leafUploadResult.certificateId
      };
    } catch (error) {
      Logger.error(`Failed to upload certificate to ${hostname}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async uploadLeafCertificate(
    hostname: string,
    username: string,
    password: string,
    certificate: string,
    privateKey?: string
  ): Promise<CertificateUploadResponse> {
    const uploadData = {
      certificateData: {
        certificate: certificate,
        privateKey: privateKey || undefined,
        certificateType: 'identity'
      }
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
      message: 'Leaf certificate uploaded successfully',
      certificateId: response?.certificateId
    };
  }

  async uploadTrustCertificates(
    hostname: string,
    username: string,
    password: string,
    caCertificates: string[]
  ): Promise<CertificateUploadResponse> {
    try {
      Logger.info(`Uploading ${caCertificates.length} CA certificates to VOS platform: ${hostname}`);

      // Get existing trust certificates to avoid duplicates
      const existingCerts = await this.getTrustCertificates(hostname, username, password);
      
      const certsToUpload = caCertificates.filter(cert => {
        return !existingCerts.some(existing => existing.includes(cert.trim()));
      });

      if (certsToUpload.length === 0) {
        return {
          success: true,
          message: 'All CA certificates already exist in trust store'
        };
      }

      for (const cert of certsToUpload) {
        const uploadData = {
          certificateData: {
            certificate: cert,
            certificateType: 'trust'
          }
        };

        await this.makeApiRequest(
          hostname,
          username,
          password,
          this.config.apiEndpoints.uploadTrustCerts,
          'POST',
          uploadData
        );
      }

      Logger.info(`Successfully uploaded ${certsToUpload.length} CA certificates to ${hostname}`);
      return {
        success: true,
        message: `Uploaded ${certsToUpload.length} CA certificates`
      };
    } catch (error) {
      Logger.error(`Failed to upload CA certificates to ${hostname}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getTrustCertificates(
    hostname: string,
    username: string,
    password: string
  ): Promise<string[]> {
    try {
      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.getTrustCerts,
        'GET'
      );

      if (response && response.certificates) {
        return response.certificates.map((cert: any) => cert.certificateData || cert.certificate || '');
      }

      return [];
    } catch (error) {
      Logger.error(`Failed to get trust certificates from ${hostname}:`, error);
      return [];
    }
  }

  async restartServices(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      Logger.info(`Restarting Cisco Tomcat service on VOS platform: ${hostname}`);

      await this.connectSSH(hostname, username, password);
      
      // Execute the service restart command
      const output = await this.executeSSHCommand(this.config.sshConfig.serviceRestartCommand);
      
      await this.disconnectSSH();

      // Check if restart was successful (VOS typically returns service status)
      const success = !output.toLowerCase().includes('error') && 
                     !output.toLowerCase().includes('failed');

      if (success) {
        Logger.info(`Successfully restarted Cisco Tomcat service on ${hostname}`);
      } else {
        Logger.warn(`Service restart may have failed on ${hostname}: ${output}`);
      }

      return success;
    } catch (error) {
      Logger.error(`Failed to restart services on ${hostname}:`, error);
      try {
        await this.disconnectSSH();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      return false;
    }
  }

  async validateConnection(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      Logger.info(`Validating VOS platform connection: ${hostname}`);

      // Test SSH connection
      await this.connectSSH(hostname, username, password);
      
      // Execute a simple command to verify connectivity
      const output = await this.executeSSHCommand('show version');
      
      await this.disconnectSSH();

      // Check if we got expected VOS output
      const isVOS = output.toLowerCase().includes('cisco') || 
                   output.toLowerCase().includes('unified');

      if (isVOS) {
        Logger.info(`Successfully validated VOS platform connection: ${hostname}`);
      } else {
        Logger.warn(`Connection validated but may not be a VOS platform: ${hostname}`);
      }

      return true;
    } catch (error) {
      Logger.error(`Failed to validate VOS platform connection ${hostname}:`, error);
      try {
        await this.disconnectSSH();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      return false;
    }
  }

  // VOS-specific utility methods
  async getSystemInfo(
    hostname: string,
    username: string,
    password: string
  ): Promise<any> {
    try {
      await this.connectSSH(hostname, username, password);
      const version = await this.executeSSHCommand('show version');
      const status = await this.executeSSHCommand('show status');
      await this.disconnectSSH();

      return {
        version: version.trim(),
        status: status.trim(),
        platform: 'vos'
      };
    } catch (error) {
      Logger.error(`Failed to get system info from ${hostname}:`, error);
      try {
        await this.disconnectSSH();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      return null;
    }
  }
}