import fs from 'fs';
import path from 'path';
import {
  PlatformProvider,
  PlatformConfig,
  CSRGenerationParams,
  CSRResponse,
  CertificateData,
  CertificateUploadResponse,
  RenewalContext,
} from './platform-provider';
import { Logger } from '../logger';
import { accountManager } from '../account-manager';
import { getDomainFromConnection } from '../utils/domain-utils';
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
        hostnames: [hostname],
        subjectCommonName: params.commonName,
        subjectOrg: params.organizationName || 'Default Organization',
        subjectOrgUnit: params.organizationalUnit || 'IT Department',
        subjectCity: params.locality || 'Default City',
        subjectState: params.state || 'Default State',
        subjectCountry: params.country || 'US',
        keyType: params.keyType || 'RSA',
        keyLength: String(params.keySize || 2048),
        digestType: 'SHA-256',
        usedFor: params.usedFor || 'MULTI-USE',
        sanDNS: params.subjectAltNames || []
      };

      let response: any;
      try {
        response = await this.makeApiRequest(
          hostname,
          username,
          password,
          this.config.apiEndpoints.generateCSR,
          'POST',
          csrData
        );
      } catch (apiError: any) {
        // Handle 409 — a CSR with the same friendly name already exists
        if (apiError.message?.includes('409')) {
          Logger.info(`CSR conflict on ISE (409), deleting existing CSR and retrying...`);
          await this.deleteConflictingCSR(hostname, username, password);
          response = await this.makeApiRequest(
            hostname,
            username,
            password,
            this.config.apiEndpoints.generateCSR,
            'POST',
            csrData
          );
        } else {
          throw apiError;
        }
      }

      // ISE returns response as an array of CSR records with IDs
      if (response && response.response && Array.isArray(response.response) && response.response.length > 0) {
        const csrRecord = response.response[0];
        const csrId = csrRecord.id;

        if (!csrId) {
          throw new Error('CSR generation succeeded but no CSR ID was returned');
        }

        Logger.info(`CSR generated on ISE with ID: ${csrId}, exporting CSR PEM...`);

        // Export the CSR PEM content (ISE doesn't return it inline)
        const csrPem = await this.exportCSR(hostname, username, password, csrId);

        return {
          csr: csrPem,
          csrId: csrId,
          hostName: hostname,
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

  /**
   * Delete all pending CSRs on an ISE node to resolve 409 conflicts
   */
  private async deleteConflictingCSR(
    hostname: string,
    username: string,
    password: string
  ): Promise<void> {
    const pendingCSRs = await this.listPendingCSRs(hostname, username, password);
    for (const csr of pendingCSRs) {
      try {
        Logger.info(`Deleting stale CSR on ISE: ${csr.friendlyName} (ID: ${csr.id}, host: ${csr.hostName})`);
        await this.makeApiRequest(
          hostname,
          username,
          password,
          `${this.config.apiEndpoints.generateCSR}/${csr.hostName}/${csr.id}`,
          'DELETE'
        );
        Logger.info(`Deleted CSR ${csr.id} successfully`);
      } catch (error: any) {
        Logger.warn(`Failed to delete CSR ${csr.id}: ${error.message}`);
      }
    }
  }

  /**
   * Export CSR PEM content from ISE by hostname and CSR ID
   */
  async exportCSR(
    hostname: string,
    username: string,
    password: string,
    csrId: string
  ): Promise<string> {
    const exportPath = `/api/v1/certs/certificate-signing-request/export/${hostname}/${csrId}`;
    const response = await this.makeApiRequest(
      hostname,
      username,
      password,
      exportPath,
      'GET'
    );

    // The export endpoint returns the CSR PEM as text
    if (typeof response === 'string' && response.includes('BEGIN CERTIFICATE REQUEST')) {
      return response;
    }

    // If response is JSON with a data field
    if (response && response.response) {
      return response.response;
    }

    throw new Error(`Failed to export CSR PEM from ISE for CSR ID: ${csrId}`);
  }

  /**
   * List pending CSRs on ISE node
   */
  async listPendingCSRs(
    hostname: string,
    username: string,
    password: string
  ): Promise<Array<{ id: string; hostName: string; subject: string; friendlyName: string }>> {
    try {
      Logger.info(`Listing pending CSRs on ISE: ${hostname}`);

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        this.config.apiEndpoints.generateCSR, // Same endpoint, GET method
        'GET'
      );

      if (response && response.response && Array.isArray(response.response)) {
        return response.response.map((csr: any) => ({
          id: csr.id,
          hostName: csr.hostName || hostname,
          subject: csr.subject || '',
          friendlyName: csr.friendlyName || ''
        }));
      }

      return [];
    } catch (error: any) {
      Logger.warn(`Failed to list pending CSRs on ISE ${hostname}: ${error.message}`);
      return [];
    }
  }

  /**
   * Neutralise trusted certificates that conflict with the cert being bound.
   * ISE blocks bind if there's a trusted cert with the same subject CN but different serial.
   * Strategy: first try stripping all trust roles via PUT (makes the cert untrusted so the
   * bind conflict check may ignore it), then try DELETE.  Either action resolving the
   * conflict is sufficient — failures are logged but non-fatal.
   */
  async neutraliseConflictingTrustedCerts(
    hostname: string,
    username: string,
    password: string,
    subjectCN: string
  ): Promise<number> {
    try {
      Logger.info(`Checking for conflicting trusted certs with CN=${subjectCN} on ${hostname}`);

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        `${this.config.apiEndpoints.getTrustCerts}?size=100`,
        'GET'
      );

      if (!response?.response || !Array.isArray(response.response)) {
        return 0;
      }

      let resolvedCount = 0;
      for (const cert of response.response) {
        const subject = cert.subject || '';
        const friendlyName = cert.friendlyName || '';
        if (subject.includes(`CN=${subjectCN}`) || friendlyName.includes(subjectCN)) {
          // --- Attempt 1: strip all trust roles via PUT ---
          try {
            Logger.info(`Stripping trust roles from conflicting cert: "${friendlyName}" (ID: ${cert.id}, subject: ${subject})`);
            await this.makeApiRequest(
              hostname,
              username,
              password,
              `${this.config.apiEndpoints.getTrustCerts}/${cert.id}`,
              'PUT',
              {
                id: cert.id,
                name: friendlyName,
                description: cert.description || '',
                trustForIseAuth: false,
                trustForClientAuth: false,
                trustForCiscoServicesAuth: false,
                trustForCertificateBasedAdminAuth: false,
                enableServerIdentityCheck: false,
              }
            );
            resolvedCount++;
            Logger.info(`Successfully stripped trust roles from cert ${cert.id}`);
            continue; // No need to also try DELETE
          } catch (putError: any) {
            Logger.warn(`Failed to strip trust roles from cert ${cert.id}: ${putError.message}`);
          }

          // --- Attempt 2: delete the cert outright ---
          try {
            Logger.info(`Attempting to delete conflicting trusted cert: "${friendlyName}" (ID: ${cert.id})`);
            await this.makeApiRequest(
              hostname,
              username,
              password,
              `${this.config.apiEndpoints.getTrustCerts}/${cert.id}`,
              'DELETE'
            );
            resolvedCount++;
            Logger.info(`Successfully deleted conflicting trusted cert: ${cert.id}`);
          } catch (deleteError: any) {
            Logger.warn(`Failed to delete conflicting trusted cert ${cert.id}: ${deleteError.message}`);
          }
        }
      }

      if (resolvedCount > 0) {
        Logger.info(`Resolved ${resolvedCount} conflicting trusted cert(s) for CN=${subjectCN}`);
      }
      return resolvedCount;
    } catch (error: any) {
      Logger.warn(`Could not check/resolve conflicting trusted certs: ${error.message}`);
      return 0;
    }
  }

  /**
   * Bind a signed certificate to a pending CSR on ISE
   */
  async bindSignedCertificate(
    hostname: string,
    username: string,
    password: string,
    csrId: string,
    signedCertPem: string,
    roles?: { admin?: boolean; portal?: boolean; eap?: boolean; radius?: boolean; pxgrid?: boolean; ims?: boolean; saml?: boolean }
  ): Promise<{ success: boolean; message: string }> {
    try {
      Logger.info(`Binding signed certificate to CSR ${csrId} on ISE: ${hostname}`);

      const bindData = {
        hostName: hostname,
        id: csrId,
        data: signedCertPem,
        name: `netSSL-${new Date().toISOString().slice(0, 10)}`,
        admin: roles?.admin ?? false,
        eap: roles?.eap ?? false,
        radius: roles?.radius ?? false,
        portal: roles?.portal ?? true,
        pxgrid: roles?.pxgrid ?? false,
        ims: roles?.ims ?? false,
        saml: roles?.saml ?? false,
        allowExtendedValidity: true,
        allowOutOfDateCert: true,
        allowReplacementOfCertificates: true,
        allowReplacementOfPortalGroupTag: true,
        allowRoleTransferForSameSubject: true,
        allowPortalTagTransferForSameSubject: true,
        validateCertificateExtensions: false
      };

      const response = await this.makeApiRequest(
        hostname,
        username,
        password,
        '/api/v1/certs/signed-certificate/bind',
        'POST',
        bindData
      );

      Logger.info(`Successfully bound certificate to CSR ${csrId} on ${hostname}`);
      return {
        success: true,
        message: response?.response?.message || 'Certificate was successfully bound'
      };
    } catch (error: any) {
      Logger.error(`Failed to bind certificate to CSR ${csrId} on ${hostname}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to bind certificate'
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
   * Fetch all deployment nodes from the ISE cluster.
   * Calls GET /api/v1/deployment/node and returns an array of node objects
   * with hostname, fqdn, roles, and services.
   */
  async getDeploymentNodes(
    hostname: string,
    username: string,
    password: string
  ): Promise<Array<{ hostname: string; fqdn: string; roles: string[]; services: string[]; nodeStatus: string }>> {
    Logger.info(`Fetching deployment nodes from ISE: ${hostname}`);

    const response = await this.makeApiRequest(
      hostname,
      username,
      password,
      '/api/v1/deployment/node',
      'GET'
    );

    if (response && response.response && Array.isArray(response.response)) {
      return response.response.map((node: any) => ({
        hostname: node.hostname || '',
        fqdn: node.fqdn || node.hostname || '',
        roles: Array.isArray(node.roles) ? node.roles : [],
        services: Array.isArray(node.services) ? node.services : [],
        nodeStatus: node.nodeStatus || 'Unknown',
      }));
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Renewal lifecycle methods (moved from certificate-renewal.ts)
  // ---------------------------------------------------------------------------

  /**
   * Map ISE certificate usage (ise_application_subtype) to CSR `usedFor` param
   * and bind/import role flags.
   */
  private getCertificateRoles(usage: string | undefined): { usedFor: string; roles: Record<string, boolean> } {
    const roleMap: Record<string, { usedFor: string; roles: Record<string, boolean> }> = {
      multi_use: { usedFor: 'MULTI-USE', roles: { admin: true, portal: true, eap: true } },
      admin:     { usedFor: 'ADMIN',     roles: { admin: true } },
      eap:       { usedFor: 'EAP-AUTH',  roles: { eap: true } },
      dtls:      { usedFor: 'DTLS-AUTH', roles: { radius: true } },
      guest:     { usedFor: 'PORTAL',    roles: { portal: true } },
      portal:    { usedFor: 'PORTAL',    roles: { portal: true } },
      pxgrid:    { usedFor: 'PXGRID',    roles: { pxgrid: true } },
      saml:      { usedFor: 'SAML',      roles: { saml: true } },
      ims:       { usedFor: 'IMS',       roles: { ims: true } },
    };
    return roleMap[usage || 'multi_use'] || roleMap['multi_use'];
  }

  get supportsRecentCertRetry(): boolean {
    return true;
  }

  async prepareCSR(ctx: RenewalContext): Promise<string> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = getDomainFromConnection(connection);
    if (!fullFQDN) {
      throw new Error('Invalid connection configuration: missing hostname/domain');
    }

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for ISE CSR generation');
    }

    // Helper to save CSR metadata (ID + hostname) for use during installCertificate
    const saveCSRMetadata = async (csrId: string, csrHostName: string) => {
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envDir = isStaging ? 'staging' : 'prod';
      const metadataDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
      await fs.promises.mkdir(metadataDir, { recursive: true });
      const metadataPath = path.join(metadataDir, 'csr_metadata.json');
      await fs.promises.writeFile(metadataPath, JSON.stringify({ csrId, hostName: csrHostName }));
      Logger.info(`Saved CSR metadata: id=${csrId}, hostName=${csrHostName}`);
    };

    // If a custom CSR is provided (pasted from ISE GUI), use it directly
    if (connection.ise_certificate && connection.ise_certificate.trim()) {
      const csrMatch = connection.ise_certificate.match(/-----BEGIN CERTIFICATE REQUEST-----[\s\S]*?-----END CERTIFICATE REQUEST-----/);
      if (!csrMatch) {
        throw new Error('Valid CSR not found in ISE certificate field');
      }
      const csr = csrMatch[0];

      status.logs.push(`Using provided CSR for ISE application: ${connection.name}`);
      await ctx.saveLog(`Using provided CSR for ISE application: ${connection.name}`);

      // Look up the pending CSR ID on ISE so we can bind later instead of importing
      if (connection.ise_nodes) {
        const nodes = connection.ise_nodes.split(',').map(node => node.trim()).filter(node => node);
        if (nodes.length > 0) {
          try {
            const primaryNode = nodes[0];
            const pendingCSRs = await this.listPendingCSRs(primaryNode, connection.username!, connection.password!);

            // Find the CSR that matches our domain
            const matchingCSR = pendingCSRs.find(c =>
              c.subject?.includes(fullFQDN) || c.friendlyName?.includes(fullFQDN)
            );

            if (matchingCSR) {
              await saveCSRMetadata(matchingCSR.id, matchingCSR.hostName);
              status.logs.push(`Found pending CSR on ISE (ID: ${matchingCSR.id}) — will use bind for installation`);
              await ctx.saveLog(`Found pending CSR on ISE (ID: ${matchingCSR.id}) — will use bind for installation`);
            } else {
              status.logs.push(`No matching pending CSR found on ISE — will use import for installation`);
              await ctx.saveLog(`No matching pending CSR found on ISE — will use import for installation`);
            }
          } catch (lookupError: any) {
            Logger.warn(`Could not look up pending CSRs on ISE: ${lookupError.message}`);
            status.logs.push(`Could not look up pending CSRs — will use import for installation`);
          }
        }
      }

      return csr;
    }

    // Generate CSR via ISE API
    if (!connection.ise_nodes) {
      throw new Error('ISE nodes must be configured for CSR generation');
    }

    try {
      const nodes = connection.ise_nodes.split(',').map(node => node.trim()).filter(node => node);
      if (nodes.length === 0) {
        throw new Error('No valid ISE nodes configured');
      }

      const primaryNode = nodes[0];
      status.logs.push(`Generating CSR from ISE node: ${primaryNode}`);
      await ctx.saveLog(`Generating CSR from ISE node: ${primaryNode}`);

      // Parse CSR config from connection (user-configured via wizard)
      let csrConfig = { country: 'US', state: 'State', locality: 'City',
                        organization: '', organizationalUnit: '', keySize: '2048' };
      if (connection.ise_csr_config) {
        try { csrConfig = { ...csrConfig, ...JSON.parse(connection.ise_csr_config) }; }
        catch (e) { Logger.warn('Invalid ise_csr_config JSON, using defaults'); }
      }

      // Derive usedFor from certificate usage selection
      const { usedFor } = this.getCertificateRoles(connection.ise_application_subtype);

      // Build SAN list: primary node (ISE requires it in SAN, not just CN)
      // + other ISE nodes + portal/additional SANs from alt_names.
      // The CSR must include ALL domains that will be in the ACME order
      // so Let's Encrypt finalization succeeds (CSR identifiers must match order).
      const csrSANs = [primaryNode, ...nodes.slice(1)];
      if (connection.alt_names) {
        const altNames = connection.alt_names.split(',').map((s: string) => s.trim()).filter((s: string) => s);
        for (const name of altNames) {
          if (!csrSANs.includes(name)) {
            csrSANs.push(name);
          }
        }
      }

      const csrParams = {
        commonName: primaryNode,
        subjectAltNames: csrSANs,
        keySize: parseInt(csrConfig.keySize) || 2048,
        keyType: 'RSA',
        organizationName: csrConfig.organization || undefined,
        organizationalUnit: csrConfig.organizationalUnit || undefined,
        locality: csrConfig.locality || undefined,
        state: csrConfig.state || undefined,
        country: csrConfig.country || 'US',
        usedFor,
      };

      const csrResponse = await this.generateCSR(
        primaryNode,
        connection.username,
        connection.password,
        csrParams
      );

      if (!csrResponse.success || !csrResponse.csr) {
        throw new Error(csrResponse.message || 'Failed to generate CSR from ISE');
      }

      status.logs.push(`CSR generated successfully from ISE: ${csrResponse.csr.length} characters`);
      await ctx.saveLog(`CSR generated successfully from ISE: ${csrResponse.csr.length} characters`);

      await accountManager.saveCSR(connectionId, fullFQDN, csrResponse.csr);

      // Save CSR ID for bind during installation
      if (csrResponse.csrId) {
        await saveCSRMetadata(csrResponse.csrId, csrResponse.hostName || primaryNode);
        status.logs.push(`CSR ID saved (${csrResponse.csrId}) — will use bind for installation`);
        await ctx.saveLog(`CSR ID saved (${csrResponse.csrId}) — will use bind for installation`);
      }

      // Save private key if provided by ISE (shouldn't happen with new API, but keep for safety)
      if (csrResponse.privateKey) {
        status.logs.push(`Private key received from ISE and saved`);
        await ctx.saveLog(`Private key received from ISE and saved`);

        const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
        const envDir = isStaging ? 'staging' : 'prod';
        const domainDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
        await fs.promises.mkdir(domainDir, { recursive: true });
        const privateKeyPath = path.join(domainDir, 'private_key.pem');
        await fs.promises.writeFile(privateKeyPath, csrResponse.privateKey);
      }

      return csrResponse.csr;
    } catch (error: any) {
      const errorMsg = `Failed to generate CSR from ISE: ${error.message}`;
      Logger.error(errorMsg);
      status.logs.push(`ERROR: ${errorMsg}`);
      await ctx.saveLog(`ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  async installCertificate(ctx: RenewalContext, certificate: string): Promise<void> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = getDomainFromConnection(connection);
    if (!fullFQDN) {
      throw new Error('Invalid connection configuration: missing hostname/domain');
    }

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for ISE certificate upload');
    }

    if (!connection.ise_nodes) {
      throw new Error('ISE nodes must be configured for certificate upload');
    }

    try {
      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envDir = isStaging ? 'staging' : 'prod';
      const certDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);

      // Parse ISE nodes
      const nodes = connection.ise_nodes.split(',').map(node => node.trim()).filter(node => node);

      // Load CA certificates for trust store upload
      let caCertificates: string[] = [];
      let filesFound = false;

      try {
        const intermediatePath = path.join(certDir, 'intermediate.crt');
        const intermediateCert = await fs.promises.readFile(intermediatePath, 'utf8');
        if (intermediateCert.trim()) {
          caCertificates.push(intermediateCert);
          status.logs.push(`Loaded intermediate certificate from file`);
          filesFound = true;
        }
      } catch { /* file doesn't exist */ }

      try {
        const rootPath = path.join(certDir, 'root.crt');
        const rootCert = await fs.promises.readFile(rootPath, 'utf8');
        if (rootCert.trim()) {
          caCertificates.push(rootCert);
          status.logs.push(`Loaded root certificate from file`);
          filesFound = true;
        }
      } catch { /* file doesn't exist */ }

      if (!filesFound) {
        status.logs.push(`Certificate files not found, parsing from certificate chain`);
        const certParts = certificate.split('-----END CERTIFICATE-----');
        const certificates = certParts
          .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
          .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));

        if (certificates.length === 0) {
          throw new Error('No certificates found to upload');
        }
        caCertificates = certificates.slice(1);
      }

      // Upload CA certificates first (needed for both bind and import flows)
      if (caCertificates.length > 0) {
        status.logs.push(`Uploading ${caCertificates.length} CA certificate(s) to ISE nodes`);
        await ctx.saveLog(`Uploading ${caCertificates.length} CA certificate(s) to ISE nodes`);

        for (const node of nodes) {
          try {
            const caResult = await this.uploadTrustCertificates(node, connection.username, connection.password, caCertificates);
            if (caResult.success) {
              status.logs.push(`CA certificates uploaded to ${node}`);
              await ctx.saveLog(`CA certificates uploaded to ${node}`);
            } else {
              status.logs.push(`CA certificate upload warning for ${node}: ${caResult.message}`);
              await ctx.saveLog(`CA certificate upload warning for ${node}: ${caResult.message}`);
            }
          } catch (error: any) {
            const errorMsg = `CA certificate upload failed for ${node}: ${error.message}`;
            status.logs.push(errorMsg);
            await ctx.saveLog(errorMsg);

            if (error.message.includes('SSL certificate') || error.message.includes('Connection failed') || error.message.includes('expired')) {
              Logger.warn(`Connection issue detected for ${node}: ${error.message}`);
            }
          }
        }
      }

      // Load the leaf certificate for bind and import
      let domainCertificate = '';
      try {
        const certPath = path.join(certDir, 'certificate.pem');
        domainCertificate = await fs.promises.readFile(certPath, 'utf8');
        status.logs.push(`Loaded domain certificate from file`);
      } catch {
        status.logs.push(`Certificate file not found, extracting from certificate chain`);
        const certParts = certificate.split('-----END CERTIFICATE-----');
        const certificates = certParts
          .filter(part => part.includes('-----BEGIN CERTIFICATE-----'))
          .map(part => (part.trim() + '\n-----END CERTIFICATE-----'));
        if (certificates.length === 0) {
          throw new Error('No certificates found in certificate chain');
        }
        domainCertificate = certificates[0];
      }

      // --- Try BIND approach first (for CSR-generated certs) ---
      let csrMetadata: { csrId: string; hostName: string } | null = null;
      try {
        const metadataPath = path.join(certDir, 'csr_metadata.json');
        const metadataRaw = await fs.promises.readFile(metadataPath, 'utf8');
        csrMetadata = JSON.parse(metadataRaw);
      } catch { /* no CSR metadata — will fall back to import */ }

      if (csrMetadata && csrMetadata.csrId) {
        status.logs.push(`Using CSR bind approach (CSR ID: ${csrMetadata.csrId})`);
        await ctx.saveLog(`Using CSR bind approach (CSR ID: ${csrMetadata.csrId})`);

        // Neutralise conflicting trusted certs before bind — ISE blocks bind if a
        // trusted cert with the same CN but different serial exists (e.g., the
        // default self-signed server cert or a previously imported cert).
        // Strategy: strip trust roles first (PUT), then try DELETE as fallback.
        const primaryNode = nodes[0];
        try {
          const resolvedCount = await this.neutraliseConflictingTrustedCerts(
            primaryNode,
            connection.username!,
            connection.password!,
            fullFQDN
          );
          if (resolvedCount > 0) {
            status.logs.push(`Resolved ${resolvedCount} conflicting trusted cert(s) with CN=${fullFQDN}`);
            await ctx.saveLog(`Resolved ${resolvedCount} conflicting trusted cert(s) with CN=${fullFQDN}`);
          }
        } catch (cleanupError: any) {
          status.logs.push(`Warning: Could not resolve conflicting trusted certs: ${cleanupError.message}`);
          await ctx.saveLog(`Warning: Could not resolve conflicting trusted certs: ${cleanupError.message}`);
        }

        // Derive roles from certificate usage selection, with import config as override
        const { roles: derivedRoles } = this.getCertificateRoles(connection.ise_application_subtype);
        let roles: { admin?: boolean; portal?: boolean; eap?: boolean; radius?: boolean; pxgrid?: boolean; ims?: boolean; saml?: boolean } = { ...derivedRoles };
        if (connection.ise_cert_import_config) {
          try {
            const importConfig = JSON.parse(connection.ise_cert_import_config);
            // Override derived roles with explicit import config values
            if (importConfig.admin !== undefined) roles.admin = importConfig.admin;
            if (importConfig.portal !== undefined) roles.portal = importConfig.portal;
            if (importConfig.eap !== undefined) roles.eap = importConfig.eap;
            if (importConfig.radius !== undefined) roles.radius = importConfig.radius;
            if (importConfig.pxgrid !== undefined) roles.pxgrid = importConfig.pxgrid;
            if (importConfig.ims !== undefined) roles.ims = importConfig.ims;
            if (importConfig.saml !== undefined) roles.saml = importConfig.saml;
          } catch {
            status.logs.push(`Warning: Invalid JSON in ISE import config, using derived roles from certificate usage`);
          }
        }

        // Let's Encrypt certs only have serverAuth EKU — pxGrid and IMS require
        // both clientAuth and serverAuth. Strip these roles to avoid bind rejection.
        if (connection.ssl_provider === 'letsencrypt' || connection.ssl_provider === 'lets_encrypt') {
          if (roles.pxgrid || roles.ims) {
            const stripped: string[] = [];
            if (roles.pxgrid) { roles.pxgrid = false; stripped.push('pxGrid'); }
            if (roles.ims) { roles.ims = false; stripped.push('IMS'); }
            const msg = `Removed ${stripped.join(', ')} role(s) from bind — Let's Encrypt certs lack clientAuth EKU`;
            status.logs.push(msg);
            await ctx.saveLog(msg);
          }
        }

        // Use leaf cert only for bind — ISE builds the chain from its trust store.
        // Sending the full chain can trigger ISE's content security filter.
        const bindResult = await this.bindSignedCertificate(
          csrMetadata.hostName,
          connection.username,
          connection.password,
          csrMetadata.csrId,
          domainCertificate,
          roles
        );

        if (bindResult.success) {
          status.logs.push(`Certificate successfully bound to CSR on ${csrMetadata.hostName}`);
          await ctx.saveLog(`Certificate successfully bound to CSR on ${csrMetadata.hostName}`);

          // Clean up CSR metadata file after successful bind
          try {
            await fs.promises.unlink(path.join(certDir, 'csr_metadata.json'));
          } catch { /* ignore */ }

          return;
        }

        // Bind failed — log and fall through to import
        status.logs.push(`CSR bind failed: ${bindResult.message} — falling back to import`);
        await ctx.saveLog(`CSR bind failed: ${bindResult.message} — falling back to import`);
      }

      // --- Fallback: IMPORT approach (requires private key) ---
      status.logs.push(`Using certificate import approach`);
      await ctx.saveLog(`Using certificate import approach`);

      let privateKey = '';
      if (connection.ise_private_key && connection.ise_private_key.trim()) {
        privateKey = connection.ise_private_key;
        status.logs.push(`Using provided private key for ISE certificate import`);
      } else {
        const privateKeyPath = path.join(certDir, 'private_key.pem');
        try {
          privateKey = await fs.promises.readFile(privateKeyPath, 'utf8');
          status.logs.push(`Loaded private key from accounts folder`);
        } catch {
          throw new Error('Private key not found and CSR bind not available. Please ensure private key is provided or generate CSR via ISE/netSSL.');
        }
      }

      // Parse custom configuration
      let customConfig = {};
      if (connection.ise_cert_import_config) {
        try {
          customConfig = JSON.parse(connection.ise_cert_import_config);
        } catch {
          status.logs.push(`Warning: Invalid JSON in ISE import config, using defaults`);
        }
      }

      // Import identity certificate to all nodes
      status.logs.push(`Importing identity certificate to ${nodes.length} ISE node(s)`);
      await ctx.saveLog(`Importing identity certificate to ${nodes.length} ISE node(s)`);

      const result = await this.importCertificateToNodes(
        nodes,
        connection.username,
        connection.password,
        domainCertificate,
        privateKey,
        customConfig
      );

      const successCount = result.results.filter(r => r.status === 'success').length;
      const totalCount = result.results.length;

      status.logs.push(`Certificate import completed: ${successCount}/${totalCount} nodes successful`);
      await ctx.saveLog(`Certificate import completed: ${successCount}/${totalCount} nodes successful`);

      for (const nodeResult of result.results) {
        if (nodeResult.status === 'success') {
          const successMsg = `${nodeResult.node}: ${nodeResult.message}`;
          status.logs.push(successMsg);
          await ctx.saveLog(successMsg);
        } else {
          const errorMsg = `${nodeResult.node}: ${nodeResult.message}`;
          status.logs.push(errorMsg);
          await ctx.saveLog(errorMsg);

          if (nodeResult.message && (nodeResult.message.includes('SSL certificate') || nodeResult.message.includes('expired'))) {
            const guidanceMsg = `Suggestion for ${nodeResult.node}: Update the SSL certificate on this ISE node before attempting certificate import`;
            status.logs.push(guidanceMsg);
            await ctx.saveLog(guidanceMsg);
          }
        }
      }

      if (successCount === 0) {
        const firstError = result.results[0]?.message || 'Unknown error';
        if (firstError.includes('SSL certificate') || firstError.includes('expired')) {
          throw new Error(`Failed to import certificate to any ISE nodes. All nodes have SSL certificate issues. Please update the SSL certificates on your ISE servers before proceeding.`);
        } else if (firstError.includes('Connection failed')) {
          throw new Error(`Failed to import certificate to any ISE nodes. Connection issues detected. Please verify ISE hostnames, network connectivity, and that ISE services are running.`);
        } else {
          throw new Error(`Failed to import certificate to any ISE nodes. Error: ${firstError}`);
        }
      }

      if (successCount < totalCount) {
        const warningMsg = `Warning: Certificate imported to ${successCount}/${totalCount} nodes. Some nodes may require manual certificate installation.`;
        status.logs.push(warningMsg);
        await ctx.saveLog(warningMsg);
      }

      // Clean up CSR metadata if it existed but bind failed and import succeeded
      try {
        await fs.promises.unlink(path.join(certDir, 'csr_metadata.json'));
      } catch { /* ignore */ }
    } catch (error: any) {
      const errorMsg = `Failed to upload certificate to ISE: ${error.message}`;
      Logger.error(errorMsg);
      status.logs.push(`ERROR: ${errorMsg}`);
      await ctx.saveLog(`ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
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
        } else if (error.message && error.message.includes('API request failed: 409')) {
          userMessage = `Certificate conflict - A certificate with the same public key already exists on ISE. Delete the existing certificate from ISE (Administration > Certificates > System Certificates) and retry, or generate a new certificate with a fresh private key`;
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