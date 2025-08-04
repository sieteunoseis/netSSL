// Debug utility for conditional console logging
const isDebugEnabled = import.meta.env.VITE_DEBUG === 'true';
const isWebSocketDebugEnabled = import.meta.env.VITE_DEBUG_WEBSOCKET === 'true';

export const debugLog = (...args: any[]) => {
  if (isDebugEnabled) {
    console.log('[DEBUG]', ...args);
  }
};

export const debugError = (...args: any[]) => {
  if (isDebugEnabled) {
    console.error('[DEBUG ERROR]', ...args);
  }
};

export const debugWarn = (...args: any[]) => {
  if (isDebugEnabled) {
    console.warn('[DEBUG WARN]', ...args);
  }
};

// WebSocket specific debug logging
export const debugWebSocket = (...args: any[]) => {
  if (isWebSocketDebugEnabled || isDebugEnabled) {
    console.log('[WS DEBUG]', ...args);
  }
};