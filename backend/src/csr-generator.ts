import forge from 'node-forge';

export interface CSRRequest {
  commonName: string;
  country: string;
  state: string;
  locality: string;
  organization?: string;
  organizationalUnit?: string;
  keySize?: number;
}

export interface CSRResponse {
  csr: string;
  privateKey: string;
  publicKey: string;
  subject: string;
}

export function generateCSR(request: CSRRequest): CSRResponse {
  try {
    // Set default key size if not provided
    const keySize = request.keySize || 2048;
    
    // Generate a key pair
    const keys = forge.pki.rsa.generateKeyPair(keySize);
    
    // Create a certificate signing request (CSR)
    const csr = forge.pki.createCertificationRequest();
    
    // Set the public key
    csr.publicKey = keys.publicKey;
    
    // Build the subject attributes
    const subjectAttrs = [
      { name: 'commonName', value: request.commonName }
    ];
    
    if (request.country) {
      subjectAttrs.push({ name: 'countryName', value: request.country });
    }
    
    if (request.state) {
      subjectAttrs.push({ name: 'stateOrProvinceName', value: request.state });
    }
    
    if (request.locality) {
      subjectAttrs.push({ name: 'localityName', value: request.locality });
    }
    
    if (request.organization) {
      subjectAttrs.push({ name: 'organizationName', value: request.organization });
    }
    
    if (request.organizationalUnit) {
      subjectAttrs.push({ name: 'organizationalUnitName', value: request.organizationalUnit });
    }
    
    // Set subject attributes
    csr.setSubject(subjectAttrs);
    
    // Sign the CSR with the private key
    csr.sign(keys.privateKey, forge.md.sha256.create());
    
    // Convert to PEM format
    const csrPem = forge.pki.certificationRequestToPem(csr);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const publicKeyPem = forge.pki.publicKeyToPem(keys.publicKey);
    
    // Build subject string for display
    const subjectString = subjectAttrs
      .map(attr => {
        const shortName = getShortName(attr.name);
        return `${shortName}=${attr.value}`;
      })
      .join(', ');
    
    return {
      csr: csrPem,
      privateKey: privateKeyPem,
      publicKey: publicKeyPem,
      subject: subjectString
    };
  } catch (error: any) {
    throw new Error(`Failed to generate CSR: ${error.message}`);
  }
}

function getShortName(longName: string): string {
  const nameMap: Record<string, string> = {
    'commonName': 'CN',
    'countryName': 'C',
    'stateOrProvinceName': 'ST',
    'localityName': 'L',
    'organizationName': 'O',
    'organizationalUnitName': 'OU'
  };
  
  return nameMap[longName] || longName;
}

export function validateCSRRequest(request: any): string | null {
  if (!request.commonName || typeof request.commonName !== 'string') {
    return 'Common Name is required and must be a string';
  }
  
  if (!request.country || typeof request.country !== 'string' || request.country.length !== 2) {
    return 'Country must be a 2-letter country code';
  }
  
  if (!request.state || typeof request.state !== 'string') {
    return 'State/Province is required and must be a string';
  }
  
  if (!request.locality || typeof request.locality !== 'string') {
    return 'City/Locality is required and must be a string';
  }
  
  if (request.keySize && (typeof request.keySize !== 'number' || ![1024, 2048, 4096].includes(request.keySize))) {
    return 'Key size must be 1024, 2048, or 4096';
  }
  
  return null;
}