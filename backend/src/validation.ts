import validator from 'validator';
import { ConnectionRecord } from './types';

export const validateConnectionData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data.name || typeof data.name !== 'string') {
    errors.push('Name is required and must be a string');
  } else if (!validator.isAscii(data.name)) {
    errors.push('Name must contain only ASCII characters');
  }

  // Hostname validation based on application type
  if (data.application_type === 'vos') {
    // VOS applications require a valid hostname (strict)
    if (!data.hostname || typeof data.hostname !== 'string') {
      errors.push('Hostname is required and must be a string');
    } else if (!validator.isAscii(data.hostname)) {
      errors.push('Hostname must contain only ASCII characters');
    } else {
      // Use strict hostname pattern for VOS (no wildcard, no empty)
      const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;
      if (!hostnamePattern.test(data.hostname)) {
        errors.push('Hostname must be a valid hostname (letters, numbers, hyphens only)');
      }
    }
  } else if (data.application_type === 'ise' || data.application_type === 'general') {
    // ISE and General applications allow hostname to be empty, wildcard, or a valid hostname
    if (data.hostname !== undefined && typeof data.hostname !== 'string') {
      errors.push('Hostname must be a string');
    } else if (data.hostname && !validator.isAscii(data.hostname)) {
      errors.push('Hostname must contain only ASCII characters');
    } else if (data.hostname) {
      // Use flexible hostname pattern for ISE/General (allows wildcard and empty)
      const flexibleHostnamePattern = /^(\*|[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)?$/;
      if (!flexibleHostnamePattern.test(data.hostname)) {
        errors.push('Hostname must be a valid hostname, wildcard (*), or blank');
      }
    }
  }

  // Domain is now required for all application types
  if (!data.domain || typeof data.domain !== 'string') {
    errors.push('Domain is required and must be a string');
  } else if (!validator.isFQDN(data.domain, { allow_numeric_tld: true })) {
    errors.push('Domain must be a valid FQDN');
  }

  // Username and password are required for VOS applications only
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
  } else if (data.application_type === 'ise') {
    // ISE-specific validations
    if (data.ise_nodes && typeof data.ise_nodes === 'string' && data.ise_nodes.trim() !== '') {
      if (!validator.isAscii(data.ise_nodes)) {
        errors.push('ISE Node FQDNs must contain only ASCII characters');
      }
    }

    if (data.ise_certificate && typeof data.ise_certificate === 'string' && data.ise_certificate.trim() !== '') {
      if (!data.ise_certificate.includes('-----BEGIN CERTIFICATE REQUEST-----')) {
        errors.push('CSR must be in PEM format');
      }
    }

    if (data.ise_private_key && typeof data.ise_private_key === 'string' && data.ise_private_key.trim() !== '') {
      if (!data.ise_private_key.includes('-----BEGIN PRIVATE KEY-----') && !data.ise_private_key.includes('-----BEGIN RSA PRIVATE KEY-----')) {
        errors.push('Private Key must be in PEM format');
      }
    }

    // Username and password are optional for ISE
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
  } else if (!validator.isIn(data.dns_provider, ['cloudflare', 'digitalocean', 'route53', 'azure', 'google', 'custom'])) {
    errors.push('DNS provider must be one of: cloudflare, digitalocean, route53, azure, google, custom');
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
    if (!validator.isIn(data.application_type, ['vos', 'ise', 'general'])) {
      errors.push('Application type must be one of "vos", "ise", or "general"');
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

  // For general applications, custom CSR and private key are required
  if (data.application_type === 'general') {
    if (!data.custom_csr || data.custom_csr.trim() === '') {
      errors.push('CSR is required for general applications');
    }
    if (!data.general_private_key || data.general_private_key.trim() === '') {
      errors.push('Private key is required for general applications');
    } else if (!data.general_private_key.includes('-----BEGIN PRIVATE KEY-----') && !data.general_private_key.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      errors.push('Private key must be in PEM format');
    }
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
    hostname: data.hostname ? validator.escape(String(data.hostname)) : undefined,
    domain: data.domain ? validator.escape(String(data.domain)) : undefined,
    ssl_provider: validator.escape(String(data.ssl_provider || '')),
    dns_provider: validator.escape(String(data.dns_provider || '')),
    application_type: (['vos', 'ise', 'general'].includes(data.application_type) ? data.application_type : 'vos') as 'vos' | 'ise' | 'general',
    version: validator.escape(String(data.version || '')),
    alt_names: validator.escape(String(data.alt_names || '')),
    custom_csr: data.custom_csr ? String(data.custom_csr) : undefined, // Don't escape CSR content
    general_private_key: data.general_private_key ? String(data.general_private_key) : undefined, // Don't escape private key content
    ise_nodes: data.ise_nodes ? validator.escape(String(data.ise_nodes)) : undefined,
    ise_certificate: data.ise_certificate ? String(data.ise_certificate) : undefined, // Don't escape certificate content
    ise_private_key: data.ise_private_key ? String(data.ise_private_key) : undefined // Don't escape private key content
  };

  // Only include username and password if they are provided (for general applications they are optional)
  if (data.username) {
    sanitized.username = validator.escape(String(data.username));
  }
  if (data.password) {
    sanitized.password = validator.escape(String(data.password));
  }

  // Handle boolean fields for VOS applications
  if (data.enable_ssh !== undefined) {
    sanitized.enable_ssh = Boolean(data.enable_ssh);
  }
  
  if (data.auto_restart_service !== undefined) {
    sanitized.auto_restart_service = Boolean(data.auto_restart_service);
  }
  
  if (data.auto_renew !== undefined) {
    sanitized.auto_renew = Boolean(data.auto_renew);
  }
  
  if (data.auto_renew_status !== undefined) {
    sanitized.auto_renew_status = validator.escape(String(data.auto_renew_status || ''));
  }
  
  if (data.auto_renew_last_attempt !== undefined) {
    sanitized.auto_renew_last_attempt = validator.escape(String(data.auto_renew_last_attempt || ''));
  }

  // Handle is_enabled field - convert to proper boolean/integer
  if (data.is_enabled !== undefined) {
    // Convert to integer for SQLite (0 or 1)
    sanitized.is_enabled = data.is_enabled ? 1 : 0;
  }
  // Note: If is_enabled is undefined, we don't set it in sanitized data,
  // which means the database update will preserve the existing value

  return sanitized;
};