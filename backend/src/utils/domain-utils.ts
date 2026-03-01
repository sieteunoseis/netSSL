import { ConnectionRecord } from '../types';

/**
 * Extract the domain/hostname from a connection based on its application type
 * @param connection The connection record
 * @returns The domain/hostname or null if not available
 */
export function getDomainFromConnection(connection: ConnectionRecord): string | null {
  if (connection.application_type === 'ise') {
    // ISE: hostname may be a full FQDN (portal/service URL), short name, wildcard, or empty
    const hostname = connection.hostname || '';
    if (hostname === '*') return connection.domain || null;
    // Full FQDN in hostname (e.g., guest.automate.builders) — return directly
    if (hostname && hostname.includes('.')) return hostname;
    // Short hostname — combine with domain (backward compat)
    if (hostname && connection.domain) return `${hostname}.${connection.domain}`;
    // No hostname — return ISE node FQDN if available, else domain
    if (connection.ise_nodes) {
      const primaryNode = connection.ise_nodes.split(',').map(n => n.trim()).filter(n => n)[0];
      if (primaryNode) return primaryNode;
    }
    return connection.domain || null;
  }

  if (connection.application_type === 'general') {
    // General: flexible hostname support (unchanged)
    if (connection.hostname !== undefined && connection.domain) {
      const hostname = connection.hostname || '';
      if (hostname === '*') return connection.domain;
      if (hostname) return `${hostname}.${connection.domain}`;
      return connection.domain;
    }
    return null;
  }

  // VOS / Catalyst Center (strict hostname required)
  if (!connection.hostname || !connection.domain) return null;
  return `${connection.hostname}.${connection.domain}`;
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