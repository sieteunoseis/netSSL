import validator from 'validator';
import { ConnectionRecord } from './types';

export const validateConnectionData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data.name || typeof data.name !== 'string') {
    errors.push('Name is required and must be a string');
  } else if (!validator.isAscii(data.name)) {
    errors.push('Name must contain only ASCII characters');
  }

  if (!data.hostname || typeof data.hostname !== 'string') {
    errors.push('Hostname is required and must be a string');
  } else if (!validator.isAscii(data.hostname)) {
    errors.push('Hostname must contain only ASCII characters');
  }

  if (!data.domain || typeof data.domain !== 'string') {
    errors.push('Domain is required and must be a string');
  } else if (!validator.isFQDN(data.domain, { allow_numeric_tld: true })) {
    errors.push('Domain must be a valid FQDN');
  }

  // Username and password are only required for VOS applications
  const isVosApplication = data.application_type === 'vos' || !data.application_type; // Default to VOS if not specified
  
  if (isVosApplication) {
    if (!data.username || typeof data.username !== 'string') {
      errors.push('Username is required and must be a string for VOS applications');
    } else if (!validator.isAscii(data.username)) {
      errors.push('Username must contain only ASCII characters');
    }

    if (!data.password || typeof data.password !== 'string') {
      errors.push('Password is required and must be a string for VOS applications');
    } else if (!validator.isAscii(data.password)) {
      errors.push('Password must contain only ASCII characters');
    }
  } else {
    // For general applications, validate username and password if provided
    if (data.username && typeof data.username !== 'string') {
      errors.push('Username must be a string');
    } else if (data.username && !validator.isAscii(data.username)) {
      errors.push('Username must contain only ASCII characters');
    }

    if (data.password && typeof data.password !== 'string') {
      errors.push('Password must be a string');
    } else if (data.password && !validator.isAscii(data.password)) {
      errors.push('Password must contain only ASCII characters');
    }
  }

  if (!data.ssl_provider || typeof data.ssl_provider !== 'string') {
    errors.push('SSL provider is required and must be a string');
  } else if (!validator.isIn(data.ssl_provider, ['letsencrypt', 'zerossl'])) {
    errors.push('SSL provider must be either "letsencrypt" or "zerossl"');
  }

  if (!data.dns_provider || typeof data.dns_provider !== 'string') {
    errors.push('DNS provider is required and must be a string');
  } else if (!validator.isIn(data.dns_provider, ['cloudflare', 'digitalocean', 'route53', 'azure', 'google', 'internal'])) {
    errors.push('DNS provider must be one of: cloudflare, digitalocean, route53, azure, google, internal');
  }

  // Version is optional
  if (data.version !== undefined && data.version !== null && data.version !== '') {
    if (typeof data.version !== 'string') {
      errors.push('Version must be a string');
    } else if (!validator.isDecimal(data.version, { force_decimal: false, decimal_digits: '1,2', locale: 'en-US' })) {
      errors.push('Version must be a valid decimal number (e.g., 1.0, 2.5, 10.15)');
    }
  }

  // Application type is optional, defaults to 'vos'
  if (data.application_type !== undefined && data.application_type !== null && data.application_type !== '') {
    if (!validator.isIn(data.application_type, ['vos', 'general'])) {
      errors.push('Application type must be either "vos" or "general"');
    }
  }

  // Custom CSR is optional for general applications
  if (data.custom_csr !== undefined && data.custom_csr !== null && data.custom_csr !== '') {
    if (typeof data.custom_csr !== 'string') {
      errors.push('Custom CSR must be a string');
    } else if (!data.custom_csr.includes('-----BEGIN CERTIFICATE REQUEST-----') || !data.custom_csr.includes('-----END CERTIFICATE REQUEST-----')) {
      errors.push('Custom CSR must be a valid PEM formatted certificate request');
    }
  }

  // For general applications, custom CSR is required
  if (data.application_type === 'general' && (!data.custom_csr || data.custom_csr.trim() === '')) {
    errors.push('Custom CSR is required for general applications');
  }

  // Alt names is optional
  if (data.alt_names !== undefined && data.alt_names !== null && data.alt_names !== '') {
    if (typeof data.alt_names !== 'string') {
      errors.push('Alt names must be a string');
    } else if (!validator.isAscii(data.alt_names)) {
      errors.push('Alt names must contain only ASCII characters');
    } else {
      // Validate each alt name if comma-separated
      const altNames = data.alt_names.split(',').map((name: string) => name.trim());
      for (const altName of altNames) {
        if (altName && !validator.isFQDN(altName, { allow_numeric_tld: true })) {
          errors.push(`Alt name "${altName}" must be a valid FQDN`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const sanitizeConnectionData = (data: any): Partial<ConnectionRecord> => {
  const sanitized: Partial<ConnectionRecord> = {
    name: validator.escape(String(data.name || '')),
    hostname: validator.escape(String(data.hostname || '')),
    domain: validator.escape(String(data.domain || '')),
    ssl_provider: validator.escape(String(data.ssl_provider || '')),
    dns_provider: validator.escape(String(data.dns_provider || '')),
    application_type: (data.application_type === 'general' ? 'general' : 'vos') as 'vos' | 'general',
    version: validator.escape(String(data.version || '')),
    alt_names: validator.escape(String(data.alt_names || '')),
    custom_csr: data.custom_csr ? String(data.custom_csr) : undefined // Don't escape CSR content
  };

  // Only include username and password if they are provided (for general applications they are optional)
  if (data.username) {
    sanitized.username = validator.escape(String(data.username));
  }
  if (data.password) {
    sanitized.password = validator.escape(String(data.password));
  }

  return sanitized;
};