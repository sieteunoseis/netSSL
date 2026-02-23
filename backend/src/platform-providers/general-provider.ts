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
import { SSHClient, SFTPUploadParams } from '../ssh-client';
import { getDomainFromConnection } from '../utils/domain-utils';

export class GeneralProvider extends PlatformProvider {
  constructor() {
    const config: PlatformConfig = {
      platformType: 'general',
      apiEndpoints: {
        generateCSR: '',
        uploadIdentityCert: '',
        getTrustCerts: '',
        uploadTrustCerts: '',
      },
      sshConfig: {
        promptPattern: '',
        serviceRestartCommand: '',
      },
      certificateConfig: {
        serviceName: 'general',
        supportedKeyTypes: ['RSA'],
        maxKeySize: 4096,
      },
    };
    super(config);
  }

  // ---------------------------------------------------------------------------
  // Original abstract method implementations (low-level, param-based)
  // ---------------------------------------------------------------------------

  async generateCSR(
    _hostname: string,
    _username: string,
    _password: string,
    _params: CSRGenerationParams
  ): Promise<CSRResponse> {
    return {
      csr: '',
      success: false,
      message: 'General applications use custom CSR — not generated via API',
    };
  }

  async uploadIdentityCertificate(
    _hostname: string,
    _username: string,
    _password: string,
    _certificateData: CertificateData
  ): Promise<CertificateUploadResponse> {
    return {
      success: false,
      message: 'General applications use SSH/SFTP or manual download',
    };
  }

  async uploadTrustCertificates(
    _hostname: string,
    _username: string,
    _password: string,
    _caCertificates: string[]
  ): Promise<CertificateUploadResponse> {
    return { success: false, message: 'Not supported for general applications' };
  }

  async getTrustCertificates(
    _hostname: string,
    _username: string,
    _password: string
  ): Promise<string[]> {
    return [];
  }

  async restartServices(
    _hostname: string,
    _username: string,
    _password: string
  ): Promise<boolean> {
    return true;
  }

  async validateConnection(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    if (!hostname || !username || !password) return false;
    try {
      const result = await SSHClient.testGenericConnection({ hostname, username, password });
      return result.success;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Renewal lifecycle methods (moved from certificate-renewal.ts)
  // ---------------------------------------------------------------------------

  async prepareCSR(ctx: RenewalContext): Promise<string> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = getDomainFromConnection(connection) || `${connection.hostname}.${connection.domain}`;

    if (!connection.custom_csr) {
      throw new Error('Custom CSR is required for general applications');
    }

    const customCsrContent = connection.custom_csr;

    // Extract CSR
    const csrMatch = customCsrContent.match(/-----BEGIN CERTIFICATE REQUEST-----[\s\S]*?-----END CERTIFICATE REQUEST-----/);
    if (!csrMatch) {
      throw new Error('Valid CSR not found in custom CSR field');
    }
    const csr = csrMatch[0];

    // Extract private key (supports both PRIVATE KEY and RSA PRIVATE KEY formats)
    const privateKeyMatch = customCsrContent.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA )?PRIVATE KEY-----/);

    status.logs.push(`Using custom CSR for general application: ${connection.name}`);
    await ctx.saveLog(`Using custom CSR for general application: ${connection.name}`);
    await ctx.saveLog(`CSR length: ${csr.length} characters`);

    // Save the CSR to accounts folder
    await accountManager.saveCSR(connectionId, fullFQDN, csr);

    // Handle private key — from CSR field or separate general_private_key field
    let privateKey: string | null = null;
    if (privateKeyMatch) {
      privateKey = privateKeyMatch[0];
      status.logs.push(`Private key found in CSR field for ${connection.name}`);
    } else if (connection.general_private_key && connection.general_private_key.trim()) {
      const gkMatch = connection.general_private_key.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA )?PRIVATE KEY-----/);
      if (gkMatch) {
        privateKey = gkMatch[0];
        status.logs.push(`Private key found in general_private_key field for ${connection.name}`);
      }
    }

    if (privateKey) {
      await ctx.saveLog(`Private key found and saved for ${connection.name}`);
      await ctx.saveLog(`Private key length: ${privateKey.length} characters`);

      const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
      const envDir = isStaging ? 'staging' : 'prod';
      const domainDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
      await fs.promises.mkdir(domainDir, { recursive: true });
      const privateKeyPath = path.join(domainDir, 'private_key.pem');
      await fs.promises.writeFile(privateKeyPath, privateKey);
    } else {
      status.logs.push(`No private key found - only CSR will be processed. Certificate will be issued but key must be uploaded manually.`);
      await ctx.saveLog(`No private key found in CSR or general_private_key fields`);
    }

    return csr;
  }

  async installCertificate(ctx: RenewalContext, certificate: string): Promise<void> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = getDomainFromConnection(connection) || `${connection.hostname}.${connection.domain}`;

    status.logs.push(`Certificate generated for ${connection.name}`);
    await ctx.saveLog(`Certificate generated for ${connection.name}`);

    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    await ctx.saveLog(`Certificate files available in: ./accounts/connection-${connectionId}/${envDir}/`);

    // Create CRT and KEY files for easier manual import
    try {
      const domainEnvDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
      const certPath = path.join(domainEnvDir, 'certificate.pem');
      const privateKeyPath = path.join(domainEnvDir, 'private_key.pem');

      if (fs.existsSync(certPath)) {
        const certContent = await fs.promises.readFile(certPath, 'utf8');
        const crtPath = path.join(domainEnvDir, `${fullFQDN}.crt`);
        await fs.promises.writeFile(crtPath, certContent);
        status.logs.push(`Created ${fullFQDN}.crt file`);
        await ctx.saveLog(`Created ${fullFQDN}.crt file`);
      }

      if (fs.existsSync(privateKeyPath)) {
        const keyContent = await fs.promises.readFile(privateKeyPath, 'utf8');
        if (keyContent.trim()) {
          const keyPath = path.join(domainEnvDir, `${fullFQDN}.key`);
          await fs.promises.writeFile(keyPath, keyContent);
          status.logs.push(`Created ${fullFQDN}.key file`);
          await ctx.saveLog(`Created ${fullFQDN}.key file`);
        }
      }
    } catch (error) {
      const msg = `Warning: Could not create CRT/KEY files: ${error instanceof Error ? error.message : 'Unknown error'}`;
      status.logs.push(msg);
      await ctx.saveLog(msg);
    }

    // Upload via SSH/SFTP if configured
    if (connection.enable_ssh && (connection.ssh_cert_path || connection.ssh_key_path)) {
      await ctx.updateStatus('uploading_certificate', 'Uploading certificate via SSH/SFTP...', 90);
      const sshResult = await this.uploadCertificateViaSSH(ctx);
      if (sshResult.success) {
        status.logs.push('Certificate installed on remote server via SSH/SFTP');
      } else {
        status.logs.push(`SSH/SFTP upload failed: ${sshResult.message} - files still available for manual download`);
      }
    } else {
      await ctx.updateStatus('uploading_certificate', 'Certificate ready for download', 90);
      status.logs.push(`Certificate ready for manual installation on ${connection.name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async uploadCertificateViaSSH(
    ctx: RenewalContext
  ): Promise<{ success: boolean; requiresManualInstall: boolean; message?: string }> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = getDomainFromConnection(connection);
    if (!fullFQDN) {
      return { success: false, requiresManualInstall: true, message: 'Invalid connection configuration: missing hostname/domain' };
    }

    if (!connection.username || !connection.password) {
      status.logs.push('SSH enabled but no username/password configured - files available for manual download');
      return { success: false, requiresManualInstall: true, message: 'No SSH credentials configured' };
    }

    if (!connection.ssh_cert_path && !connection.ssh_key_path) {
      status.logs.push('SSH enabled but no remote paths configured - files available for manual download');
      return { success: false, requiresManualInstall: true, message: 'No remote paths configured' };
    }

    const sshHost = connection.domain
      ? (connection.hostname ? `${connection.hostname}.${connection.domain}` : connection.domain)
      : connection.hostname;

    if (!sshHost) {
      return { success: false, requiresManualInstall: true, message: 'Cannot determine SSH host' };
    }

    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const domainEnvDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);

    const filesToUpload: SFTPUploadParams[] = [];
    const backupSuffix = `bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;

    // Certificate file
    if (connection.ssh_cert_path) {
      const certPath = path.join(domainEnvDir, 'certificate.pem');
      if (fs.existsSync(certPath)) {
        const certContent = fs.readFileSync(certPath, 'utf8');
        filesToUpload.push({ localContent: certContent, remotePath: connection.ssh_cert_path, backupSuffix });
      } else {
        status.logs.push(`Warning: certificate.pem not found at ${certPath}`);
      }
    }

    // Private key file
    if (connection.ssh_key_path) {
      const keyPath = path.join(domainEnvDir, 'private_key.pem');
      if (fs.existsSync(keyPath)) {
        const keyContent = fs.readFileSync(keyPath, 'utf8');
        if (keyContent.trim()) {
          filesToUpload.push({ localContent: keyContent, remotePath: connection.ssh_key_path, backupSuffix });
        }
      } else {
        status.logs.push(`Warning: private_key.pem not found at ${keyPath}`);
      }
    }

    // Full chain file (optional)
    if (connection.ssh_chain_path) {
      const chainPath = path.join(domainEnvDir, 'fullchain.pem');
      if (fs.existsSync(chainPath)) {
        const chainContent = fs.readFileSync(chainPath, 'utf8');
        filesToUpload.push({ localContent: chainContent, remotePath: connection.ssh_chain_path, backupSuffix });
      } else {
        status.logs.push(`Warning: fullchain.pem not found at ${chainPath} - skipping chain upload`);
      }
    }

    if (filesToUpload.length === 0) {
      status.logs.push('No certificate files found to upload');
      return { success: false, requiresManualInstall: true, message: 'No certificate files found' };
    }

    status.logs.push(`Uploading ${filesToUpload.length} file(s) to ${sshHost} via SFTP...`);
    await ctx.saveLog(`Uploading ${filesToUpload.length} file(s) to ${sshHost} via SFTP`);

    const result = await SSHClient.uploadCertificateFiles({
      hostname: sshHost,
      username: connection.username,
      password: connection.password,
      files: filesToUpload,
      restartCommand: connection.ssh_restart_command || undefined,
    });

    for (const uploadResult of result.uploadResults) {
      if (uploadResult.success) {
        let msg = `Uploaded: ${uploadResult.message}`;
        if (uploadResult.backedUp) {
          msg += ` (backed up to ${uploadResult.backupPath})`;
        }
        status.logs.push(msg);
        await ctx.saveLog(msg);
      } else {
        status.logs.push(`Upload failed: ${uploadResult.error}`);
        await ctx.saveLog(`Upload failed: ${uploadResult.error}`);
      }
    }

    if (result.restartOutput) {
      status.logs.push(`Restart command output: ${result.restartOutput}`);
      await ctx.saveLog(`Restart command output: ${result.restartOutput}`);
    }

    if (result.success) {
      status.logs.push(`Certificate files successfully installed on ${sshHost}`);
      await ctx.saveLog(`Certificate files successfully installed on ${sshHost}`);
      return { success: true, requiresManualInstall: false };
    } else {
      status.logs.push(`SFTP upload failed: ${result.error} - files still available for manual download`);
      await ctx.saveLog(`SFTP upload failed: ${result.error}`);
      return { success: false, requiresManualInstall: true, message: result.error };
    }
  }
}
