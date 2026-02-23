import https from 'https';
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
import { generateCSR as generateLocalCSR } from '../csr-generator';

/**
 * Catalyst Center (formerly DNAC) certificate management provider.
 *
 * Key differences from VOS/ISE:
 * - Token-based auth (not Basic Auth on every request)
 * - Multipart file upload for cert import (not JSON)
 * - Async task-based operations (poll for completion)
 * - No CSR generation API — CSR generated locally via node-forge
 * - No SSH — CC handles service restart internally
 */
export class CatalystCenterProvider extends PlatformProvider {
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    const config: PlatformConfig = {
      platformType: 'catalyst_center',
      apiEndpoints: {
        generateCSR: '', // Not available — CSR generated locally
        uploadIdentityCert: '/dna/intent/api/v1/certificate',
        getTrustCerts: '', // No GET endpoint
        uploadTrustCerts: '/dna/intent/api/v1/trustedCertificates/import',
      },
      sshConfig: {
        promptPattern: '',
        serviceRestartCommand: '',
      },
      certificateConfig: {
        serviceName: 'catalyst-center',
        supportedKeyTypes: ['RSA'],
        maxKeySize: 4096,
      },
    };
    super(config);
  }

  // ---------------------------------------------------------------------------
  // Token-based authentication
  // ---------------------------------------------------------------------------

  private async authenticate(hostname: string, username: string, password: string): Promise<string> {
    // Return cached token if still valid (with 5 min buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiry - 300000) {
      return this.cachedToken;
    }

    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    return new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          port: 443,
          path: '/dna/system/api/v1/auth/token',
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          rejectUnauthorized: false,
          timeout: 30000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const body = JSON.parse(data);
                if (body.Token) {
                  this.cachedToken = body.Token;
                  this.tokenExpiry = Date.now() + 55 * 60 * 1000; // ~55 min
                  resolve(body.Token);
                } else {
                  reject(new Error('Token not found in authentication response'));
                }
              } catch (e) {
                reject(new Error(`Failed to parse auth response: ${data}`));
              }
            } else {
              reject(new Error(`Authentication failed: ${res.statusCode} ${res.statusMessage} — ${data}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(new Error(`Authentication request failed: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Authentication request timed out')); });
      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP helper — uses X-Auth-Token instead of Basic Auth
  // ---------------------------------------------------------------------------

  private async makeCCRequest(
    hostname: string,
    token: string,
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    data?: any,
    headers?: Record<string, string>
  ): Promise<any> {
    const defaultHeaders: Record<string, string> = {
      'X-Auth-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    const allHeaders = { ...defaultHeaders, ...headers };
    const body = data ? JSON.stringify(data) : undefined;

    if (body) {
      allHeaders['Content-Length'] = Buffer.byteLength(body).toString();
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          port: 443,
          path: endpoint,
          method,
          headers: allHeaders,
          rejectUnauthorized: false,
          timeout: 30000,
        },
        (res) => {
          let responseBody = '';
          res.on('data', (chunk) => (responseBody += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(responseBody));
              } catch {
                resolve(responseBody);
              }
            } else {
              reject(new Error(`CC API ${method} ${endpoint} failed: ${res.statusCode} ${res.statusMessage} — ${responseBody}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(new Error(`CC API request failed: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('CC API request timed out')); });

      if (body) req.write(body);
      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // Task polling
  // ---------------------------------------------------------------------------

  private async pollTaskCompletion(
    hostname: string,
    token: string,
    taskId: string,
    maxWaitMs: number = 120000
  ): Promise<any> {
    const pollInterval = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const taskResponse = await this.makeCCRequest(hostname, token, `/dna/intent/api/v1/task/${taskId}`);
      const task = taskResponse?.response;

      if (task?.endTime) {
        if (task.isError) {
          throw new Error(`Task failed: ${task.failureReason || task.progress || 'Unknown error'}`);
        }
        return task;
      }

      // Wait before next poll
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(`Task ${taskId} did not complete within ${maxWaitMs / 1000}s`);
  }

  // ---------------------------------------------------------------------------
  // Multipart upload using native fetch + FormData
  // ---------------------------------------------------------------------------

  private async uploadCertificateMultipart(
    hostname: string,
    token: string,
    certPem: string,
    keyPem: string,
    listOfUsers: string = 'server'
  ): Promise<any> {
    const { FormData, Blob } = await import('node:buffer')
      .then(() => ({ FormData: globalThis.FormData, Blob: globalThis.Blob }));

    const form = new FormData();
    form.append('certFilePath', new Blob([certPem], { type: 'application/x-pem-file' }), 'certificate.pem');
    form.append('pkFilePath', new Blob([keyPem], { type: 'application/x-pem-file' }), 'private_key.pem');

    const url = `https://${hostname}/dna/intent/api/v1/certificate?listOfUsers=${encodeURIComponent(listOfUsers)}`;

    // Use native fetch for multipart — node:https doesn't handle FormData natively
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-Auth-Token': token },
      body: form,
      // @ts-expect-error Node 20 fetch supports this
      dispatcher: new (await import('node:http')).Agent({ rejectUnauthorized: false }),
    }).catch(async () => {
      // Fallback: use undici-compatible approach for self-signed certs
      const agent = new https.Agent({ rejectUnauthorized: false });
      // Node 20 native fetch doesn't support custom agents directly,
      // so we fall back to a manual multipart approach
      return this.uploadCertificateMultipartFallback(hostname, token, certPem, keyPem, listOfUsers);
    });

    if (response && typeof response === 'object' && 'ok' in response) {
      if (!response.ok) {
        const text = await (response as Response).text();
        throw new Error(`Certificate upload failed: ${(response as Response).status} — ${text}`);
      }
      return (response as Response).json();
    }
    // Fallback returned the parsed result directly
    return response;
  }

  /**
   * Fallback multipart upload using raw https for environments where native
   * fetch doesn't support rejectUnauthorized: false (self-signed certs).
   */
  private async uploadCertificateMultipartFallback(
    hostname: string,
    token: string,
    certPem: string,
    keyPem: string,
    listOfUsers: string
  ): Promise<any> {
    const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;

    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="certFilePath"; filename="certificate.pem"\r\n`;
    body += `Content-Type: application/x-pem-file\r\n\r\n`;
    body += certPem + '\r\n';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="pkFilePath"; filename="private_key.pem"\r\n`;
    body += `Content-Type: application/x-pem-file\r\n\r\n`;
    body += keyPem + '\r\n';
    body += `--${boundary}--\r\n`;

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          port: 443,
          path: `/dna/intent/api/v1/certificate?listOfUsers=${encodeURIComponent(listOfUsers)}`,
          method: 'POST',
          headers: {
            'X-Auth-Token': token,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': Buffer.byteLength(body),
          },
          rejectUnauthorized: false,
          timeout: 60000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(data);
              }
            } else {
              reject(new Error(`Certificate upload failed: ${res.statusCode} ${res.statusMessage} — ${data}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(new Error(`Certificate upload request failed: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Certificate upload timed out')); });
      req.write(body);
      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // Original abstract method implementations (low-level, param-based)
  // ---------------------------------------------------------------------------

  async generateCSR(
    _hostname: string,
    _username: string,
    _password: string,
    params: CSRGenerationParams
  ): Promise<CSRResponse> {
    try {
      const result = generateLocalCSR({
        commonName: params.commonName,
        country: params.country || 'US',
        state: params.state || 'California',
        locality: params.locality || 'San Jose',
        organization: params.organizationName,
        organizationalUnit: params.organizationalUnit,
        keySize: params.keySize || 2048,
      });
      return {
        csr: result.csr,
        privateKey: result.privateKey,
        success: true,
        message: 'CSR generated locally',
      };
    } catch (error: any) {
      return { csr: '', success: false, message: error.message };
    }
  }

  async uploadIdentityCertificate(
    hostname: string,
    username: string,
    password: string,
    certificateData: CertificateData
  ): Promise<CertificateUploadResponse> {
    try {
      const token = await this.authenticate(hostname, username, password);
      const result = await this.uploadCertificateMultipart(
        hostname,
        token,
        certificateData.certificate,
        certificateData.privateKey || '',
        'server'
      );

      // Poll task
      if (result?.response?.taskId) {
        await this.pollTaskCompletion(hostname, token, result.response.taskId);
      }

      return { success: true, message: 'Certificate uploaded to Catalyst Center' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async uploadTrustCertificates(
    hostname: string,
    username: string,
    password: string,
    caCertificates: string[]
  ): Promise<CertificateUploadResponse> {
    try {
      const token = await this.authenticate(hostname, username, password);

      for (const cert of caCertificates) {
        try {
          // Use multipart upload for trusted certs too
          const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
          let body = '';
          body += `--${boundary}\r\n`;
          body += `Content-Disposition: form-data; name="certFilePath"; filename="ca-cert.pem"\r\n`;
          body += `Content-Type: application/x-pem-file\r\n\r\n`;
          body += cert + '\r\n';
          body += `--${boundary}--\r\n`;

          await new Promise<void>((resolve, reject) => {
            const req = https.request(
              {
                hostname,
                port: 443,
                path: '/dna/intent/api/v1/trustedCertificates/import',
                method: 'POST',
                headers: {
                  'X-Auth-Token': token,
                  'Content-Type': `multipart/form-data; boundary=${boundary}`,
                  'Content-Length': Buffer.byteLength(body),
                },
                rejectUnauthorized: false,
                timeout: 30000,
              },
              (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                  if (res.statusCode === 409) {
                    Logger.info(`Trusted certificate already exists on ${hostname}`);
                    resolve();
                  } else if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                  } else {
                    reject(new Error(`Trust cert upload failed: ${res.statusCode} — ${data}`));
                  }
                });
              }
            );
            req.on('error', (err) => reject(err));
            req.on('timeout', () => { req.destroy(); reject(new Error('Trust cert upload timed out')); });
            req.write(body);
            req.end();
          });
        } catch (error: any) {
          Logger.warn(`Failed to upload trust cert to ${hostname}: ${error.message}`);
        }
      }

      return { success: true, message: 'Trust certificates processed' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async getTrustCertificates(
    _hostname: string,
    _username: string,
    _password: string
  ): Promise<string[]> {
    // CC has no GET endpoint for certificates
    return [];
  }

  async restartServices(
    _hostname: string,
    _username: string,
    _password: string
  ): Promise<boolean> {
    // CC handles restart internally after cert import
    return true;
  }

  async validateConnection(
    hostname: string,
    username: string,
    password: string
  ): Promise<boolean> {
    try {
      await this.authenticate(hostname, username, password);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Renewal lifecycle methods
  // ---------------------------------------------------------------------------

  async prepareCSR(ctx: RenewalContext): Promise<string> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = `${connection.hostname}.${connection.domain}`;

    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const domainDir = path.join(accountManager['accountsDir'], `connection-${connectionId}`, envDir);
    await fs.promises.mkdir(domainDir, { recursive: true });

    // Check for user-provided CSR (from CSR wizard or pasted manually)
    if (connection.custom_csr) {
      const csrMatch = connection.custom_csr.match(/-----BEGIN CERTIFICATE REQUEST-----[\s\S]*?-----END CERTIFICATE REQUEST-----/);
      if (csrMatch) {
        const csr = csrMatch[0];
        status.logs.push(`Using provided CSR for Catalyst Center: ${connection.name}`);
        await ctx.saveLog(`Using provided CSR for ${fullFQDN}`);
        await ctx.saveLog(`CSR length: ${csr.length} characters`);
        await accountManager.saveCSR(connectionId, fullFQDN, csr);

        // Extract or load private key
        let privateKey: string | null = null;
        const pkMatch = connection.custom_csr.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA )?PRIVATE KEY-----/);
        if (pkMatch) {
          privateKey = pkMatch[0];
          status.logs.push(`Private key found in CSR field`);
        } else if (connection.general_private_key && connection.general_private_key.trim()) {
          const gkMatch = connection.general_private_key.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA )?PRIVATE KEY-----/);
          if (gkMatch) {
            privateKey = gkMatch[0];
            status.logs.push(`Private key found in private key field`);
          }
        }

        if (privateKey) {
          const privateKeyPath = path.join(domainDir, 'private_key.pem');
          await fs.promises.writeFile(privateKeyPath, privateKey);
          await ctx.saveLog(`Private key saved to accounts folder`);
        } else {
          status.logs.push(`Warning: No private key found — certificate upload to CC requires a private key`);
          await ctx.saveLog(`No private key found in CSR or private key fields`);
        }

        return csr;
      }
    }

    // No user-provided CSR — generate one locally
    status.logs.push(`Generating CSR locally for Catalyst Center: ${connection.name}`);
    await ctx.saveLog(`Generating CSR locally for ${fullFQDN} (Catalyst Center has no CSR API)`);

    const result = generateLocalCSR({
      commonName: fullFQDN,
      country: 'US',
      state: 'California',
      locality: 'San Jose',
      organization: 'Organization',
      organizationalUnit: 'IT',
      keySize: 2048,
    });

    // Save CSR
    await accountManager.saveCSR(connectionId, fullFQDN, result.csr);
    await ctx.saveLog(`CSR generated locally: ${result.csr.length} characters`);
    status.logs.push(`CSR generated locally for ${fullFQDN}`);

    // Save private key
    const privateKeyPath = path.join(domainDir, 'private_key.pem');
    await fs.promises.writeFile(privateKeyPath, result.privateKey);
    await ctx.saveLog(`Private key saved to accounts folder`);
    status.logs.push(`Private key generated and saved`);

    return result.csr;
  }

  async installCertificate(ctx: RenewalContext, certificate: string): Promise<void> {
    const { connectionId, connection, status } = ctx;
    const fullFQDN = `${connection.hostname}.${connection.domain}`;

    if (!connection.username || !connection.password) {
      throw new Error('Username and password are required for Catalyst Center');
    }

    // Load private key from accounts folder
    const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
    const envDir = isStaging ? 'staging' : 'prod';
    const privateKeyPath = path.join(
      accountManager['accountsDir'],
      `connection-${connectionId}`,
      envDir,
      'private_key.pem'
    );

    let privateKey: string;
    try {
      privateKey = await fs.promises.readFile(privateKeyPath, 'utf8');
    } catch {
      throw new Error('Private key not found in accounts folder. CSR may not have been generated by this system.');
    }

    const listOfUsers = connection.cc_list_of_users || 'server';

    status.logs.push(`Authenticating with Catalyst Center at ${fullFQDN}`);
    await ctx.saveLog(`Authenticating with Catalyst Center at ${fullFQDN}`);

    const token = await this.authenticate(fullFQDN, connection.username, connection.password);
    await ctx.saveLog(`Authentication successful`);

    status.logs.push(`Uploading certificate to Catalyst Center (listOfUsers=${listOfUsers})`);
    await ctx.saveLog(`Uploading certificate via multipart POST to /dna/intent/api/v1/certificate?listOfUsers=${listOfUsers}`);

    const uploadResult = await this.uploadCertificateMultipartFallback(
      fullFQDN,
      token,
      certificate,
      privateKey,
      listOfUsers
    );

    // Poll task for completion
    if (uploadResult?.response?.taskId) {
      const taskId = uploadResult.response.taskId;
      status.logs.push(`Certificate import task started: ${taskId}`);
      await ctx.saveLog(`Task ID: ${taskId} — polling for completion...`);

      const task = await this.pollTaskCompletion(fullFQDN, token, taskId);
      status.logs.push(`Certificate import completed on Catalyst Center`);
      await ctx.saveLog(`Task completed: ${JSON.stringify(task)}`);
    } else {
      status.logs.push(`Certificate uploaded to Catalyst Center (no task ID returned)`);
      await ctx.saveLog(`Upload response: ${JSON.stringify(uploadResult)}`);
    }
  }

  // handleServiceRestart — inherited default no-op is correct for CC
}
