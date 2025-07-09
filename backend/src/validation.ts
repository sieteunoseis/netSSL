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

  if (!data.username || typeof data.username !== 'string') {
    errors.push('Username is required and must be a string');
  } else if (!validator.isAscii(data.username)) {
    errors.push('Username must contain only ASCII characters');
  }

  if (!data.password || typeof data.password !== 'string') {
    errors.push('Password is required and must be a string');
  } else if (!validator.isAscii(data.password)) {
    errors.push('Password must contain only ASCII characters');
  }

  if (!data.ssl_provider || typeof data.ssl_provider !== 'string') {
    errors.push('SSL provider is required and must be a string');
  } else if (!validator.isIn(data.ssl_provider, ['letsencrypt', 'zerossl'])) {
    errors.push('SSL provider must be either "letsencrypt" or "zerossl"');
  }

  if (!data.dns_provider || typeof data.dns_provider !== 'string') {
    errors.push('DNS provider is required and must be a string');
  } else if (!validator.isIn(data.dns_provider, ['cloudflare', 'digitalocean', 'route53', 'azure', 'google'])) {
    errors.push('DNS provider must be one of: cloudflare, digitalocean, route53, azure, google');
  }

  // Version is optional
  if (data.version !== undefined && data.version !== null && data.version !== '') {
    if (typeof data.version !== 'string') {
      errors.push('Version must be a string');
    } else if (!validator.isDecimal(data.version, { force_decimal: false, decimal_digits: '1,2', locale: 'en-US' })) {
      errors.push('Version must be a valid decimal number (e.g., 1.0, 2.5, 10.15)');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const sanitizeConnectionData = (data: any): Partial<ConnectionRecord> => {
  return {
    name: validator.escape(String(data.name || '')),
    hostname: validator.escape(String(data.hostname || '')),
    username: validator.escape(String(data.username || '')),
    password: validator.escape(String(data.password || '')),
    domain: validator.escape(String(data.domain || '')),
    ssl_provider: validator.escape(String(data.ssl_provider || '')),
    dns_provider: validator.escape(String(data.dns_provider || '')),
    version: validator.escape(String(data.version || ''))
  };
};