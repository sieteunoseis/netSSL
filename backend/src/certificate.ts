import https from 'https';
import tls from 'tls';
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
}

export async function getCertificateInfo(hostname: string, port: number = 443): Promise<CertificateInfo | null> {
  return new Promise((resolve) => {
    Logger.info(`Attempting to get certificate for ${hostname}:${port}`);
    
    const options = {
      host: hostname,
      port: port,
      rejectUnauthorized: false, // Allow self-signed certificates
      timeout: 10000, // 10 second timeout
    };

    const socket = tls.connect(options, () => {
      try {
        Logger.info(`Connected to ${hostname}:${port}, getting certificate`);
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
        };

        Logger.info(`Successfully retrieved certificate info for ${hostname}:${port}`);
        resolve(certInfo);
      } catch (error) {
        Logger.error(`Error parsing certificate for ${hostname}:${port}:`, error);
        resolve(null);
      } finally {
        socket.destroy();
      }
    });

    socket.on('error', (error) => {
      Logger.error(`TLS connection error for ${hostname}:${port}:`, error);
      resolve(null);
    });

    socket.on('timeout', () => {
      Logger.error(`TLS connection timeout for ${hostname}:${port}`);
      socket.destroy();
      resolve(null);
    });

    socket.setTimeout(10000);
  });
}

export async function getCertificateInfoWithFallback(hostname: string): Promise<CertificateInfo | null> {
  // Try common HTTPS ports
  const ports = [443, 8443, 9443];
  
  for (const port of ports) {
    try {
      const certInfo = await getCertificateInfo(hostname, port);
      if (certInfo) {
        return certInfo;
      }
    } catch (error) {
      Logger.debug(`Failed to get certificate on port ${port} for ${hostname}:`, error);
    }
  }
  
  return null;
}