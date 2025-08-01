import https from 'https';
import tls from 'tls';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { Logger } from './logger';
import { DatabaseManager } from './database';

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

          // Extract algorithm information from TLS certificate
          let keyAlgorithm = 'unknown';
          let keySize = 0;
          let signatureAlgorithm = 'unknown';
          
          try {
            // In Node.js, getPeerCertificate() returns an object with specific properties
            // Try to get key size from 'bits' property (this should exist)
            if ((cert as any).bits) {
              keySize = (cert as any).bits;
            }
            
            // Try to determine key algorithm from modulus/exponent (RSA) or other properties
            if ((cert as any).modulus && (cert as any).exponent) {
              keyAlgorithm = 'RSA';
            } else if ((cert as any).asn1Curve) {
              keyAlgorithm = 'EC';
            }
            
            // For signature algorithm, it might be in different properties
            // Node.js certificate objects sometimes have these properties
            if ((cert as any).sigalg) {
              signatureAlgorithm = (cert as any).sigalg;
            } else if ((cert as any).signatureAlgorithm) {
              signatureAlgorithm = (cert as any).signatureAlgorithm;
            } else if ((cert as any).sig_alg) {
              signatureAlgorithm = (cert as any).sig_alg;
            }
            
            // Try to parse the raw certificate if available
            if ((cert as any).raw && signatureAlgorithm === 'unknown') {
              try {
                const x509Cert = new crypto.X509Certificate((cert as any).raw);
                // Try to use OpenSSL to parse the certificate
                const tempFile = `/tmp/temp_cert_${Date.now()}.pem`;
                fs.writeFileSync(tempFile, x509Cert.toString());
                
                try {
                  const opensslOutput = execSync(`openssl x509 -in "${tempFile}" -text -noout`, { 
                    encoding: 'utf8',
                    maxBuffer: 1024 * 1024
                  });
                  
                  const sigAlgMatch = opensslOutput.match(/Signature Algorithm: ([^\n]+)/i);
                  if (sigAlgMatch) {
                    signatureAlgorithm = sigAlgMatch[1].trim();
                  }
                  
                  // Clean up temp file
                  fs.unlinkSync(tempFile);
                } catch (opensslError) {
                  Logger.debug('OpenSSL parsing failed for live certificate');
                  // Clean up temp file on error
                  try { fs.unlinkSync(tempFile); } catch {}
                }
              } catch (x509Error) {
                Logger.debug('Failed to parse raw certificate for signature algorithm');
              }
            }
            
            // Last resort: try common signature algorithms based on key type and size
            if (signatureAlgorithm === 'unknown' && keyAlgorithm === 'RSA') {
              // Most common signature algorithms for RSA
              signatureAlgorithm = 'sha256WithRSAEncryption'; // Default assumption
            }
            
            // Log available properties for debugging
            Logger.info(`Certificate properties for ${hostname}:`, {
              allKeys: Object.keys(cert),
              hasPublicKey: !!(cert as any).pubkey,
              hasBits: !!(cert as any).bits,
              hasSigalg: !!(cert as any).sigalg,
              hasSignatureAlgorithm: !!(cert as any).signatureAlgorithm,
              pubkeyType: typeof (cert as any).pubkey,
              bitsValue: (cert as any).bits,
              sigalgValue: (cert as any).sigalg,
              signatureAlgorithmValue: (cert as any).signatureAlgorithm,
              // Log some common certificate properties
              modulus: (cert as any).modulus ? 'present' : 'missing',
              exponent: (cert as any).exponent ? 'present' : 'missing',
              publicKey: (cert as any).publicKey ? 'present' : 'missing'
            });
            
          } catch (algError) {
            Logger.error('Error extracting algorithm information from TLS certificate:', algError);
          }

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
 * Get certificate information and save metrics to database
 * @param hostname The hostname to check
 * @param port The port to check (default 443)
 * @param connectionId The connection ID for database storage
 * @param database The database manager instance
 * @returns CertificateInfo object or null if failed
 */
export async function getCertificateInfoWithMetrics(
  hostname: string, 
  port: number = 443, 
  connectionId: number, 
  database: DatabaseManager
): Promise<CertificateInfo | null> {
  const certInfo = await getCertificateInfo(hostname, port);
  
  if (certInfo) {
    // Save metrics to database
    try {
      await database.saveCertificateMetrics(
        connectionId,
        hostname,
        port,
        'live_tls',
        certInfo.timings,
        certInfo.keyAlgorithm,
        certInfo.keySize,
        certInfo.signatureAlgorithm,
        certInfo.isValid,
        certInfo.daysUntilExpiry,
        certInfo.error
      );
    } catch (error) {
      Logger.error('Failed to save certificate metrics to database:', error);
      // Don't fail the whole operation if metrics storage fails
    }
  } else {
    // Save error metrics
    try {
      await database.saveCertificateMetrics(
        connectionId,
        hostname,
        port,
        'live_tls',
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        'Certificate check failed'
      );
    } catch (error) {
      Logger.error('Failed to save error metrics to database:', error);
    }
  }
  
  return certInfo;
}

/**
 * Get certificate information from file and save metrics to database
 * @param certPath Path to the certificate file
 * @param connectionId The connection ID for database storage
 * @param database The database manager instance
 * @param hostname The hostname for metrics storage
 * @returns CertificateInfo object or null if failed
 */
export async function getCertificateInfoFromFileWithMetrics(
  certPath: string, 
  connectionId: number, 
  database: DatabaseManager,
  hostname: string
): Promise<CertificateInfo | null> {
  const certInfo = await getCertificateInfoFromFile(certPath);
  
  if (certInfo) {
    // Save metrics to database
    try {
      await database.saveCertificateMetrics(
        connectionId,
        hostname,
        443, // Default port for file-based checks
        'file_based',
        undefined, // No timing metrics for file-based checks
        certInfo.keyAlgorithm,
        certInfo.keySize,
        certInfo.signatureAlgorithm,
        certInfo.isValid,
        certInfo.daysUntilExpiry,
        certInfo.error
      );
    } catch (error) {
      Logger.error('Failed to save file-based certificate metrics to database:', error);
    }
  }
  
  return certInfo;
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
    const keyAlgorithm = (publicKey as any).asymmetricKeyType || 'unknown';
    const keySize = (publicKey as any).asymmetricKeySize || 0;
    
    // Get signature algorithm using OpenSSL
    let signatureAlgorithm = 'unknown';
    try {
      // Verify the certificate file exists
      if (!fs.existsSync(certPath)) {
        console.error(`Certificate file not found: ${certPath}`);
      } else {
        // Use OpenSSL to extract detailed certificate information
        try {
          const opensslOutput = execSync(`openssl x509 -in "${certPath}" -text -noout`, { 
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 // 1MB buffer
          });
          
          // Extract signature algorithm from OpenSSL output
          const sigAlgMatch = opensslOutput.match(/Signature Algorithm: ([^\n]+)/i);
          if (sigAlgMatch) {
            signatureAlgorithm = sigAlgMatch[1].trim();
          }
        } catch (opensslError: any) {
          console.error('OpenSSL command failed:', opensslError.message);
          console.error('Certificate path:', certPath);
        }
      }
    } catch (e: any) {
      console.error('Error in signature algorithm extraction:', e.message);
    }
    
    // Fallback: try to extract from the PEM content if OpenSSL failed
    if (signatureAlgorithm === 'unknown') {
      try {
        // For PEM certificates, the signature algorithm isn't in the base64 content
        // We'd need to decode it properly, so let's just leave it as unknown for now
        console.log('Signature algorithm extraction failed, leaving as unknown');
      } catch (fallbackError) {
        console.error('Fallback failed:', fallbackError);
      }
    }

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

export async function getCertificateInfoWithFallback(hostname: string, connection?: any, database?: any): Promise<CertificateInfo | null> {
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
      // Use metrics version if database and connection are available
      const certInfo = (database && connection?.id) 
        ? await getCertificateInfoWithMetrics(hostname, port, connection.id, database)
        : await getCertificateInfo(hostname, port);
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