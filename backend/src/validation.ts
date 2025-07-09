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
  } else if (!validator.isFQDN(data.hostname, { allow_numeric_tld: true })) {
    errors.push('Hostname must be a valid FQDN');
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
    version: validator.escape(String(data.version || ''))
  };
};