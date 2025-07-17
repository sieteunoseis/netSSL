/**
 * Utility functions for connection management
 */

/**
 * Check if a connection is enabled
 * @param {Object} connection - The connection object
 * @returns {boolean} - True if enabled, false if disabled
 */
export const isConnectionEnabled = (connection) => {
  // Handle both boolean false and string "0" as disabled
  // Default to enabled if is_enabled is undefined/null (for existing records)
  return connection.is_enabled !== false && 
         connection.is_enabled !== "0" && 
         connection.is_enabled !== 0;
};

/**
 * Filter connections to only enabled ones
 * @param {Array} connections - Array of connection objects
 * @returns {Array} - Array of enabled connections
 */
export const filterEnabledConnections = (connections) => {
  return connections.filter(isConnectionEnabled);
};

/**
 * Get the display hostname for a connection based on its type
 * @param {Object} connection - The connection object
 * @returns {string} - The hostname to display
 */
export const getConnectionDisplayHostname = (connection) => {
  if (connection.application_type === 'ise' || connection.application_type === 'general') {
    // For ISE and General, use hostname and domain with flexible hostname support
    if (connection.domain) {
      const hostname = connection.hostname || '';
      if (hostname === '*') {
        // Return wildcard.domain for display
        return `*.${connection.domain}`;
      } else if (hostname) {
        return `${hostname}.${connection.domain}`;
      } else {
        // Empty hostname, return just domain
        return connection.domain;
      }
    }
    // Fallback when domain is missing
    return connection.hostname || (connection.application_type === 'ise' ? 'ISE Portal' : 'General Application');
  } else {
    // For VOS applications (strict hostname required)
    if (connection.hostname && connection.domain) {
      return `${connection.hostname}.${connection.domain}`;
    }
    return connection.hostname || 'Unknown';
  }
};

/**
 * Check if a connection uses a wildcard certificate
 * @param {Object} connection - The connection object
 * @returns {boolean} - True if wildcard certificate
 */
export const isWildcardCertificate = (connection) => {
  if (connection.application_type === 'ise' || connection.application_type === 'general') {
    return connection.hostname === '*';
  }
  return false;
};

/**
 * Get the certificate validation domain for a connection
 * For wildcard certificates, this returns just the base domain
 * @param {Object} connection - The connection object
 * @returns {string|null} - The domain to validate certificate against
 */
export const getCertificateValidationDomain = (connection) => {
  if (connection.application_type === 'ise' || connection.application_type === 'general') {
    if (connection.hostname !== undefined && connection.domain) {
      const hostname = connection.hostname || '';
      if (hostname === '*') {
        // For wildcard, validate against base domain
        return connection.domain;
      } else if (hostname) {
        return `${hostname}.${connection.domain}`;
      } else {
        return connection.domain;
      }
    }
    return null;
  } else {
    // For VOS applications (strict hostname required)
    if (connection.hostname && connection.domain) {
      return `${connection.hostname}.${connection.domain}`;
    }
    return null;
  }
};