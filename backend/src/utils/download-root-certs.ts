import fs from 'fs';
import path from 'path';
import https from 'https';
import { Logger } from '../logger';

export interface RootCertificate {
  name: string;
  url: string;
  filename: string;
  description: string;
}

export const ROOT_CERTIFICATES: RootCertificate[] = [
  {
    name: 'ISRG Root X1',
    url: 'https://letsencrypt.org/certs/isrgrootx1.pem',
    filename: 'isrgrootx1.pem',
    description: 'Let\'s Encrypt\'s primary root certificate, required for ISE certificate chain validation'
  },
  {
    name: 'ISRG Root X2',
    url: 'https://letsencrypt.org/certs/isrg-root-x2.pem',
    filename: 'isrg-root-x2.pem',
    description: 'Let\'s Encrypt\'s ECDSA root certificate (self-signed, valid until 2035)'
  }
];

export async function downloadRootCertificate(cert: RootCertificate, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const targetPath = path.join(targetDir, cert.filename);
    
    Logger.info(`Downloading ${cert.name} from ${cert.url}`);
    
    https.get(cert.url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${cert.name}: HTTP ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(targetPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        Logger.info(`Successfully downloaded ${cert.name} to ${targetPath}`);
        resolve();
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(targetPath, () => {}); // Delete the file on error
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Deprecated certificate files that should be cleaned up
const DEPRECATED_CERTIFICATES = [
  'isrg-root-x2-cross-signed.pem'  // Expired September 2025, replaced by isrg-root-x2.pem
];

export async function downloadAllRootCertificates(targetDir: string): Promise<void> {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Clean up deprecated certificate files
  for (const filename of DEPRECATED_CERTIFICATES) {
    const deprecatedPath = path.join(targetDir, filename);
    if (fs.existsSync(deprecatedPath)) {
      fs.unlinkSync(deprecatedPath);
      Logger.info(`Removed deprecated certificate: ${filename}`);
    }
  }

  for (const cert of ROOT_CERTIFICATES) {
    const targetPath = path.join(targetDir, cert.filename);
    if (fs.existsSync(targetPath)) {
      Logger.info(`${cert.name} already exists at ${targetPath}`);
      continue;
    }
    
    try {
      await downloadRootCertificate(cert, targetDir);
    } catch (error) {
      Logger.error(`Failed to download ${cert.name}:`, error);
      // Continue with other certificates even if one fails
    }
  }
}

export function checkRootCertificates(targetDir: string): { present: string[], missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];
  
  for (const cert of ROOT_CERTIFICATES) {
    const targetPath = path.join(targetDir, cert.filename);
    if (fs.existsSync(targetPath)) {
      present.push(cert.name);
    } else {
      missing.push(cert.name);
    }
  }
  
  return { present, missing };
}