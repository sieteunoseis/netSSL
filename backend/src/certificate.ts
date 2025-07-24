import https from 'https';
import tls from 'tls';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { Logger } from './logger';

export interface CertificateInfo {
  subject: {
    CN?: string;
    O?: string;
    OU?: string;
  };
  issuer: {
    CN?: string;
    O?: string;
    OU?: string;
  };
  validFrom: string;
  validTo: string;
  fingerprint: string;
  fingerprint256: string;
  serialNumber: string;
  subjectAltNames?: string[];
  keyUsage?: string[];
  isValid: boolean;
  daysUntilExpiry: number;
  error?: string;
  // Certificate algorithm information
  keyAlgorithm?: string;
  keySize?: number;
  signatureAlgorithm?: string;
  // Performance timing metrics (in milliseconds)
  timings?: {
    dnsResolve?: number;
    tcpConnect?: number;
    tlsHandshake?: number;
    certificateProcessing?: number;
    totalTime?: number;
  };
}

export async function getCertificateInfo(hostname: string, port: number = 443): Promise<CertificateInfo | null> {
  return new Promise((resolve) => {
    Logger.info(`Attempting to get certificate for ${hostname}:${port}`);
    
    // Timing variables
    const startTime = Date.now();
    let dnsResolveTime: number | undefined;
    let tcpConnectTime: number | undefined;
    let tlsHandshakeTime: number | undefined;
    let processingStartTime: number;

    // Step 1: DNS Resolution
    const dnsStartTime = Date.now();
    dns.lookup(hostname, (dnsErr, address) => {
      dnsResolveTime = Date.now() - dnsStartTime;
      
      if (dnsErr) {
        Logger.error(`DNS resolution failed for ${hostname}:`, dnsErr);
        const totalTime = Date.now() - startTime;
        resolve({
          subject: { CN: '<DNS Resolution Failed>' },
          issuer: { CN: '<DNS Resolution Failed>' },
          validFrom: '',
          validTo: '',
          fingerprint: '',
          fingerprint256: '',
          serialNumber: '',
          isValid: false,
          daysUntilExpiry: 0,
          error: `DNS resolution failed: ${dnsErr.message}`,
          timings: {
            dnsResolve: dnsResolveTime,
            totalTime: totalTime
          }
        });
        return;
      }

      Logger.info(`DNS resolved ${hostname} to ${address} in ${dnsResolveTime}ms`);

      // Step 2: TCP Connection
      const tcpStartTime = Date.now();
      const options = {
        host: hostname,
        port: port,
        rejectUnauthorized: false, // Allow self-signed certificates
        timeout: 5000, // 5 second timeout
      };

      const socket = tls.connect(options, () => {
        try {
          tlsHandshakeTime = Date.now() - tcpStartTime;
          tcpConnectTime = tlsHandshakeTime; // TCP + TLS combined for now
          processingStartTime = Date.now();
          
          Logger.info(`TLS handshake completed for ${hostname}:${port} in ${tlsHandshakeTime}ms`);
          
          const cert = socket.getPeerCertificate(true);
          
          if (!cert || Object.keys(cert).length === 0) {
            Logger.error(`No certificate found for ${hostname}:${port}`);
            resolve(null);
            return;
          }

          const now = new Date();
          const validFrom = new Date(cert.valid_from);
          const validTo = new Date(cert.valid_to);
          const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          // Extract algorithm information
          const keyAlgorithm = (cert as any).pubkey?.asymmetricKeyType || 'unknown';
          const keySize = (cert as any).bits || (cert as any).pubkey?.asymmetricKeySize || 0;
          const signatureAlgorithm = (cert as any).sigalg || 'unknown';

          const processingTime = Date.now() - processingStartTime;
          const totalTime = Date.now() - startTime;

          const certInfo: CertificateInfo = {
            subject: {
              CN: cert.subject?.CN || '<Not Part Of Certificate>',
              O: cert.subject?.O || '<Not Part Of Certificate>',
              OU: cert.subject?.OU || '<Not Part Of Certificate>',
            },
            issuer: {
              CN: cert.issuer?.CN || '<Not Part Of Certificate>',
              O: cert.issuer?.O || '<Not Part Of Certificate>',
              OU: cert.issuer?.OU || '<Not Part Of Certificate>',
            },
            validFrom: validFrom.toLocaleString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: 'numeric',
              second: 'numeric',
              timeZoneName: 'short'
            }),
            validTo: validTo.toLocaleString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: 'numeric',
              second: 'numeric',
              timeZoneName: 'short'
            }),
            fingerprint: cert.fingerprint || '',
            fingerprint256: cert.fingerprint256 || '',
            serialNumber: cert.serialNumber || '',
            subjectAltNames: cert.subjectaltname ? cert.subjectaltname.split(', ') : [],
            isValid: now >= validFrom && now <= validTo,
            daysUntilExpiry: daysUntilExpiry,
            keyAlgorithm: keyAlgorithm,
            keySize: keySize,
            signatureAlgorithm: signatureAlgorithm,
            timings: {
              dnsResolve: dnsResolveTime,
              tcpConnect: tcpConnectTime,
              tlsHandshake: tlsHandshakeTime,
              certificateProcessing: processingTime,
              totalTime: totalTime
            }
          };

          Logger.info(`Retrieved certificate for ${hostname} from live TLS connection on port ${port} - DNS: ${dnsResolveTime}ms, TLS: ${tlsHandshakeTime}ms, Processing: ${processingTime}ms, Total: ${totalTime}ms`);
          resolve(certInfo);
        } catch (error) {
          Logger.error(`Error parsing certificate for ${hostname}:${port}:`, error);
          resolve(null);
        } finally {
          socket.destroy();
        }
      });

      socket.on('error', (error) => {
        const totalTime = Date.now() - startTime;
        Logger.error(`TLS connection error for ${hostname}:${port}:`, error);
        resolve({
          subject: { CN: '<Connection Failed>' },
          issuer: { CN: '<Connection Failed>' },
          validFrom: '',
          validTo: '',
          fingerprint: '',
          fingerprint256: '',
          serialNumber: '',
          isValid: false,
          daysUntilExpiry: 0,
          error: `Connection failed: ${error.message}`,
          timings: {
            dnsResolve: dnsResolveTime,
            totalTime: totalTime
          }
        });
      });

      socket.on('timeout', () => {
        const totalTime = Date.now() - startTime;
        Logger.error(`TLS connection timeout for ${hostname}:${port}`);
        socket.destroy();
        resolve({
          subject: { CN: '<Connection Timeout>' },
          issuer: { CN: '<Connection Timeout>' },
          validFrom: '',
          validTo: '',
          fingerprint: '',
          fingerprint256: '',
          serialNumber: '',
          isValid: false,
          daysUntilExpiry: 0,
          error: 'Connection timeout',
          timings: {
            dnsResolve: dnsResolveTime,
            totalTime: totalTime
          }
        });
      });

      socket.setTimeout(5000);
    });
  });
}

/**
 * Parse a PEM certificate file and extract certificate information
 * @param certPath Path to the certificate.pem file
 * @returns CertificateInfo object or null if parsing fails
 */
export async function getCertificateInfoFromFile(certPath: string): Promise<CertificateInfo | null> {
  try {
    if (!fs.existsSync(certPath)) {
      Logger.debug(`Certificate file not found: ${certPath}`);
      return null;
    }

    const certContent = fs.readFileSync(certPath, 'utf8');
    
    // Use Node.js crypto module to parse the certificate
    const crypto = require('crypto');
    const cert = new crypto.X509Certificate(certContent);
    
    const now = new Date();
    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);
    const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Parse subject and issuer
    const subject = cert.subject.split('\n').reduce((acc: any, line: string) => {
      const [key, value] = line.split('=');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});

    const issuer = cert.issuer.split('\n').reduce((acc: any, line: string) => {
      const [key, value] = line.split('=');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});

    // Extract algorithm information from X509Certificate
    const publicKey = cert.publicKey;
    const keyAlgorithm = publicKey.asymmetricKeyType || 'unknown';
    const keySize = publicKey.asymmetricKeySize || 0;
    const signatureAlgorithm = cert.signatureAlgorithm || 'unknown';

    const certInfo: CertificateInfo = {
      subject: {
        CN: subject.CN || '<Not Part Of Certificate>',
        O: subject.O || '<Not Part Of Certificate>',
        OU: subject.OU || '<Not Part Of Certificate>',
      },
      issuer: {
        CN: issuer.CN || '<Not Part Of Certificate>',
        O: issuer.O || '<Not Part Of Certificate>',
        OU: issuer.OU || '<Not Part Of Certificate>',
      },
      validFrom: validFrom.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'short'
      }),
      validTo: validTo.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        timeZoneName: 'short'
      }),
      fingerprint: cert.fingerprint || '',
      fingerprint256: cert.fingerprint256 || '',
      serialNumber: cert.serialNumber || '',
      subjectAltNames: cert.subjectAltName ? cert.subjectAltName.split(', ') : [],
      isValid: now >= validFrom && now <= validTo,
      daysUntilExpiry: daysUntilExpiry,
      keyAlgorithm: keyAlgorithm,
      keySize: keySize,
      signatureAlgorithm: signatureAlgorithm,
    };

    Logger.info(`Successfully parsed certificate from file: ${certPath}`);
    return certInfo;
  } catch (error) {
    Logger.error(`Error parsing certificate file ${certPath}:`, error);
    return null;
  }
}

/**
 * Get certificate information from local files or fallback to live TLS connection
 * @param hostname The hostname to get certificate for
 * @returns CertificateInfo object or null if not found
 */
// Helper function to determine which ports to test based on connection type
function getPortsForConnection(connection?: any): number[] {
  // If no connection provided, use default ports (for backward compatibility)
  if (!connection) {
    return [443, 8443, 9443];
  }

  // Check if this is an ISE connection with application subtype
  if (connection.application_type === 'ise' && connection.ise_application_subtype) {
    switch (connection.ise_application_subtype) {
      case 'guest':
        return [8443]; // Guest portal
      case 'portal': 
        return [8445]; // Portal (sponsor portal)
      case 'admin':
        return [443];  // Admin interface
      default:
        return [8443]; // Default to guest
    }
  }

  // For non-ISE connections or ISE without subtype, use multiple ports
  return [443, 8443, 9443];
}

export async function getCertificateInfoWithFallback(hostname: string, connection?: any): Promise<CertificateInfo | null> {
  Logger.info(`Getting certificate info for ${hostname}`);
  
  // First, try to get certificate from local files
  const accountsDir = process.env.ACCOUNTS_DIR || path.join(__dirname, '..', 'accounts');
  const domainDir = path.join(accountsDir, hostname);
  
  // Check for staging environment setting (consistent with account-manager.ts)
  const isStaging = process.env.LETSENCRYPT_STAGING !== 'false';
  const certSubDir = isStaging ? 'staging' : 'prod';
  
  const certPath = path.join(domainDir, certSubDir, 'certificate.pem');
  
  // Primary: Try to get certificate from live TLS connection (what's actually deployed)
  const ports = getPortsForConnection(connection);
  
  for (const port of ports) {
    try {
      Logger.info(`Attempting to get certificate for ${hostname}:${port}`);
      const certInfo = await getCertificateInfo(hostname, port);
      if (certInfo) {
        Logger.info(`Retrieved certificate for ${hostname} from live TLS connection on port ${port}`);
        return certInfo;
      }
    } catch (error) {
      Logger.debug(`Failed to connect to ${hostname}:${port}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  Logger.info(`No live TLS connection available for ${hostname}, falling back to local certificate files`);
  
  // Fallback 1: Try local certificate in primary directory
  Logger.debug(`Checking for local certificate at: ${certPath}`);
  const localCertInfo = await getCertificateInfoFromFile(certPath);
  if (localCertInfo) {
    Logger.info(`Found local certificate for ${hostname} in ${certSubDir} directory`);
    return localCertInfo;
  }
  
  // Fallback 2: Try local certificate in alternate directory (staging/prod)
  const alternateCertSubDir = isStaging ? 'prod' : 'staging';
  const alternateCertPath = path.join(domainDir, alternateCertSubDir, 'certificate.pem');
  
  Logger.debug(`Checking for alternate local certificate at: ${alternateCertPath}`);
  const alternateCertInfo = await getCertificateInfoFromFile(alternateCertPath);
  if (alternateCertInfo) {
    Logger.info(`Found local certificate for ${hostname} in ${alternateCertSubDir} directory`);
    return alternateCertInfo;
  }
  
  // No certificate found anywhere
  Logger.warn(`No certificate found for ${hostname} in live TLS connection or local files`);
  return null;
}