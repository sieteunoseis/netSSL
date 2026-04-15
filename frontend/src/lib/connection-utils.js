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
  return (
    connection.is_enabled !== false &&
    connection.is_enabled !== "0" &&
    connection.is_enabled !== 0
  );
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
  if (connection.application_type === "ise") {
    // ISE: hostname is the PAN FQDN — return directly if it's a full FQDN
    const hostname = connection.hostname || "";
    if (hostname.includes(".")) return hostname;
    // Fallback to ISE node FQDN, then domain
    if (connection.ise_nodes) {
      const primaryNode = connection.ise_nodes
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n)[0];
      if (primaryNode) return primaryNode;
    }
    return connection.domain || "ISE Portal";
  } else if (connection.application_type === "general") {
    // General: use hostname and domain with flexible hostname support
    if (connection.domain) {
      const hostname = connection.hostname || "";
      if (hostname === "*") {
        return `*.${connection.domain}`;
      } else if (hostname) {
        return `${hostname}.${connection.domain}`;
      } else {
        return connection.domain;
      }
    }
    return connection.hostname || "General Application";
  } else {
    // For VOS applications (strict hostname required)
    if (connection.hostname && connection.domain) {
      return `${connection.hostname}.${connection.domain}`;
    }
    return connection.hostname || "Unknown";
  }
};

/**
 * Derive the ISE monitored-endpoint FQDN based on the cert's selected purposes.
 * Mirrors backend getIseProbeTarget. Returns null for non-ISE or admin-interface
 * purposes (admin/eap/saml/…) since those probe the admin node, which the primary
 * hostname subtitle already displays.
 * @param {Object} connection
 * @returns {string|null}
 */
export const getIseMonitoredHostname = (connection) => {
  if (!connection || connection.application_type !== "ise") return null;

  let purposes = new Set();
  try {
    const cfg = JSON.parse(connection.ise_cert_import_config || "{}");
    if (Array.isArray(cfg._selectedPurposes)) {
      for (const p of cfg._selectedPurposes) purposes.add(String(p));
    }
  } catch {
    /* ignore */
  }
  if (purposes.size === 0 && connection.ise_application_subtype) {
    const st = connection.ise_application_subtype;
    if (st && st !== "multi_use") purposes.add(st);
  }
  if (purposes.size === 0) return null;

  // Admin-interface purposes share the admin node FQDN — already shown as primary.
  const adminInterface = ["admin", "eap", "saml", "dtls", "pxgrid", "ims"];
  if (adminInterface.some((p) => purposes.has(p))) return null;

  const altNames = (connection.alt_names || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  let localCn = "";
  if (connection.ise_csr_source === "local") {
    try {
      const cfg = JSON.parse(connection.ise_csr_config || "{}");
      if (typeof cfg.commonName === "string" && cfg.commonName.trim()) {
        localCn = cfg.commonName.trim();
      }
    } catch {
      /* ignore */
    }
  }

  if (purposes.has("guest") || purposes.has("portal")) {
    return localCn || altNames[0] || null;
  }
  return null;
};

/**
 * Check if a connection uses a wildcard certificate
 * @param {Object} connection - The connection object
 * @returns {boolean} - True if wildcard certificate
 */
export const isWildcardCertificate = (connection) => {
  if (
    connection.application_type === "ise" ||
    connection.application_type === "general"
  ) {
    return connection.hostname === "*";
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
  if (connection.application_type === "ise") {
    // ISE: hostname is the PAN FQDN — return directly if it's a full FQDN
    const hostname = connection.hostname || "";
    if (hostname.includes(".")) return hostname;
    // Fallback to ISE node FQDN
    if (connection.ise_nodes) {
      const primaryNode = connection.ise_nodes
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n)[0];
      if (primaryNode) return primaryNode;
    }
    return connection.domain || null;
  } else if (connection.application_type === "general") {
    if (connection.hostname !== undefined && connection.domain) {
      const hostname = connection.hostname || "";
      if (hostname === "*") {
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
