import { ConnectionRecord } from '../types';

/**
 * Extract the domain/hostname from a connection based on its application type
 * @param connection The connection record
 * @returns The domain/hostname or null if not available
 */
export function getDomainFromConnection(connection: ConnectionRecord): string | null {
  if (connection.application_type === 'ise' || connection.application_type === 'general') {
    // For ISE and General, use hostname and domain with flexible hostname support
    if (connection.hostname !== undefined && connection.domain) {
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
    }
    
    return null;
  } else {
    // For VOS applications (strict hostname required)
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