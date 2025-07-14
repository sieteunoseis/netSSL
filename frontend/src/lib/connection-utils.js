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