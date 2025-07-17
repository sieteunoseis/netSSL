import { ConnectionRecord } from '../types';

/**
 * Extract the domain/hostname from a connection based on its application type
 * @param connection The connection record
 * @returns The domain/hostname or null if not available
 */
export function getDomainFromConnection(connection: ConnectionRecord): string | null {
  if (connection.application_type === 'ise') {
    // For ISE, use hostname and domain or fall back to legacy portal_url
    if (connection.hostname !== undefined && connection.domain) {
      // New structure: hostname + domain
      const hostname = connection.hostname || ''; // Can be empty, wildcard, or a name
      if (hostname === '*') {
        // Return just the domain for wildcard certificates
        return connection.domain;
      } else if (hostname) {
        // Return hostname.domain
        return `${hostname}.${connection.domain}`;
      } else {
        // Empty hostname, return just domain
        return connection.domain;
      }
    } else if (connection.portal_url) {
      // Legacy structure: portal_url
      let domain = connection.portal_url;
      
      if (domain.startsWith('*.')) {
        domain = domain.substring(2);
      }
      
      // If it's a full URL, extract just the hostname
      try {
        if (domain.includes('://')) {
          const url = new URL(domain);
          return url.hostname;
        }
      } catch (error) {
        // Not a valid URL, treat as domain
      }
      
      // Remove port if present
      const portIndex = domain.indexOf(':');
      if (portIndex > -1) {
        domain = domain.substring(0, portIndex);
      }
      
      return domain;
    }
    
    return null;
  } else {
    // For VOS and general applications
    if (!connection.hostname || !connection.domain) {
      return null;
    }
    return `${connection.hostname}.${connection.domain}`;
  }
}

/**
 * Check if a connection has valid domain configuration
 * @param connection The connection record
 * @returns true if the connection has valid domain configuration
 */
export function hasValidDomain(connection: ConnectionRecord): boolean {
  const domain = getDomainFromConnection(connection);
  return domain !== null && domain.trim() !== '';
}