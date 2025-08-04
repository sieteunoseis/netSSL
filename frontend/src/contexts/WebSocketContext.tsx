import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { debugWebSocket, debugError } from '@/lib/debug';

interface Operation {
  id: string;
  connectionId: number;
  type: 'ssh_test' | 'service_restart' | 'certificate_renewal';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  metadata?: any;
  createdBy: 'user' | 'cron' | 'auto';
}

interface AutoRenewalNotification {
  connectionId: number;
  status: 'in_progress' | 'success' | 'failed';
  message: string;
  timestamp: string;
}

interface WebSocketContextType {
  socket: Socket | null;
  connected: boolean;
  operations: Map<string, Operation>;
  autoRenewalNotifications: AutoRenewalNotification[];
  subscribeToConnection: (connectionId: number) => void;
  unsubscribeFromConnection: (connectionId: number) => void;
  getConnectionOperations: (connectionId: number, type?: string) => Operation[];
  getActiveOperation: (connectionId: number, type: string) => Operation | null;
  hasActiveOperation: (connectionId: number, type: string) => boolean;
  clearAutoRenewalNotifications: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [operations, setOperations] = useState<Map<string, Operation>>(new Map());
  const [autoRenewalNotifications, setAutoRenewalNotifications] = useState<AutoRenewalNotification[]>([]);
  const subscribedConnections = useRef<Set<number>>(new Set());

  useEffect(() => {
    // Determine the backend URL
    const isDevelopment = import.meta.env.DEV;
    const backendUrl = isDevelopment 
      ? 'http://localhost:3000'
      : ''; // Use relative path in production for nginx proxy

    debugWebSocket('Connecting to WebSocket server at:', backendUrl || 'relative path');

    // Create socket connection
    const newSocket = io(backendUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      timeout: 20000
    });

    newSocket.on('connect', () => {
      debugWebSocket('WebSocket connected');
      setConnected(true);
      
      // Rejoin rooms for subscribed connections
      if (subscribedConnections.current.size > 0) {
        const connectionIds = Array.from(subscribedConnections.current);
        newSocket.emit('rejoin:connections', connectionIds);
      }
    });

    newSocket.on('disconnect', (reason) => {
      debugWebSocket('WebSocket disconnected:', reason);
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      debugError('WebSocket connection error:', error);
      setConnected(false);
    });

    newSocket.on('operation:update', ({ operation }: { operation: Operation }) => {
      debugWebSocket('Received operation update:', operation);
      setOperations(prev => {
        const newMap = new Map(prev);
        newMap.set(operation.id, operation);
        return newMap;
      });
    });

    newSocket.on('connection:operations', ({ connectionId, operations: ops }: { 
      connectionId: number; 
      operations: Operation[] 
    }) => {
      debugWebSocket(`Received operations for connection ${connectionId}:`, ops);
      debugWebSocket('Active operations:', ops.filter(op => ['pending', 'in_progress'].includes(op.status)));
      setOperations(prev => {
        const newMap = new Map(prev);
        // Clear old operations for this connection first
        Array.from(prev.values())
          .filter(op => op.connectionId === connectionId)
          .forEach(op => newMap.delete(op.id));
        // Add new operations
        ops.forEach(op => newMap.set(op.id, op));
        debugWebSocket('Updated operations map size:', newMap.size);
        return newMap;
      });
    });

    newSocket.on('auto-renewal-status', ({ connectionId, status, message, timestamp }: {
      connectionId: number;
      status: string;
      message: string;
      timestamp: string;
    }) => {
      debugWebSocket('Auto-renewal status update:', { connectionId, status, message, timestamp });
      
      // Add to notifications list
      const notification: AutoRenewalNotification = {
        connectionId,
        status: status as 'in_progress' | 'success' | 'failed',
        message,
        timestamp
      };
      
      setAutoRenewalNotifications(prev => {
        // Keep only the last 10 notifications
        const updated = [notification, ...prev].slice(0, 10);
        return updated;
      });
      
      // Show notification to user
      if (status === 'in_progress') {
        console.log(`🔄 Auto-renewal started: ${message}`);
      } else if (status === 'success') {
        console.log(`✅ Auto-renewal completed: ${message}`);
      } else if (status === 'failed') {
        console.log(`❌ Auto-renewal failed: ${message}`);
      }
    });

    newSocket.on('error', ({ message }: { message: string }) => {
      debugError('WebSocket error:', message);
    });

    newSocket.on('pong', () => {
      // Heartbeat response
    });

    setSocket(newSocket);

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (newSocket.connected) {
        newSocket.emit('ping');
      }
    }, 30000); // Every 30 seconds

    return () => {
      clearInterval(heartbeatInterval);
      newSocket.close();
    };
  }, []);

  const subscribeToConnection = useCallback((connectionId: number) => {
    if (!socket || !connected) {
      debugWebSocket('Socket not connected, cannot subscribe to connection', connectionId);
      return;
    }

    // Check if already subscribed to prevent duplicate subscriptions
    if (subscribedConnections.current.has(connectionId)) {
      debugWebSocket(`Already subscribed to connection ${connectionId}, skipping`);
      return;
    }

    subscribedConnections.current.add(connectionId);
    socket.emit('subscribe:connection', connectionId);
    debugWebSocket(`Subscribed to connection ${connectionId}`);
    debugWebSocket('Currently subscribed connections:', Array.from(subscribedConnections.current));
  }, [socket, connected]);

  const unsubscribeFromConnection = useCallback((connectionId: number) => {
    if (!socket) return;

    // Check if actually subscribed before unsubscribing
    if (!subscribedConnections.current.has(connectionId)) {
      return;
    }

    subscribedConnections.current.delete(connectionId);
    socket.emit('unsubscribe:connection', connectionId);
    debugWebSocket(`Unsubscribed from connection ${connectionId}`);
  }, [socket]);

  const getConnectionOperations = useCallback((connectionId: number, type?: string): Operation[] => {
    const allOps = Array.from(operations.values());
    let filtered = allOps.filter(op => op.connectionId === connectionId);
    
    if (type) {
      filtered = filtered.filter(op => op.type === type);
    }
    
    return filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [operations]);

  const getActiveOperation = useCallback((connectionId: number, type: string): Operation | null => {
    const ops = getConnectionOperations(connectionId, type);
    const activeOp = ops.find(op => ['pending', 'in_progress'].includes(op.status)) || null;
    debugWebSocket(`getActiveOperation for connection ${connectionId}, type ${type}:`, {
      allOps: ops.length,
      activeOp: activeOp ? { id: activeOp.id, status: activeOp.status, progress: activeOp.progress } : null
    });
    return activeOp;
  }, [getConnectionOperations]);

  const hasActiveOperation = useCallback((connectionId: number, type: string): boolean => {
    return getActiveOperation(connectionId, type) !== null;
  }, [getActiveOperation]);

  const clearAutoRenewalNotifications = useCallback(() => {
    setAutoRenewalNotifications([]);
  }, []);

  return (
    <WebSocketContext.Provider value={{
      socket,
      connected,
      operations,
      autoRenewalNotifications,
      subscribeToConnection,
      unsubscribeFromConnection,
      getConnectionOperations,
      getActiveOperation,
      hasActiveOperation,
      clearAutoRenewalNotifications
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
};

// Specific hook for service restart operations
export const useServiceRestart = (connectionId: number) => {
  const { getActiveOperation, hasActiveOperation, subscribeToConnection, unsubscribeFromConnection, connected, operations } = useWebSocket();

  useEffect(() => {
    if (connectionId && connected) {
      debugWebSocket(`useServiceRestart: Subscribing to connection ${connectionId}`);
      subscribeToConnection(connectionId);
      return () => {
        debugWebSocket(`useServiceRestart: Unsubscribing from connection ${connectionId}`);
        unsubscribeFromConnection(connectionId);
      };
    }
  }, [connectionId, connected, subscribeToConnection, unsubscribeFromConnection]);

  const activeOperation = getActiveOperation(connectionId, 'service_restart');
  const isRestarting = hasActiveOperation(connectionId, 'service_restart');

  debugWebSocket(`useServiceRestart hook for connection ${connectionId}:`, {
    activeOperation: activeOperation ? { id: activeOperation.id, status: activeOperation.status, progress: activeOperation.progress } : null,
    isRestarting,
    totalOperations: Array.from(operations.values()).length,
    connectionOperations: Array.from(operations.values()).filter(op => op.connectionId === connectionId).length
  });

  return {
    activeOperation,
    isRestarting,
    progress: activeOperation?.progress || 0,
    message: activeOperation?.message || '',
    error: activeOperation?.error,
    status: activeOperation?.status || 'idle'
  };
};

// Specific hook for certificate renewal operations
export const useCertificateRenewal = (connectionId: number) => {
  const { getActiveOperation, hasActiveOperation, subscribeToConnection, unsubscribeFromConnection, connected, operations } = useWebSocket();

  useEffect(() => {
    if (connectionId && connected) {
      debugWebSocket(`useCertificateRenewal: Subscribing to connection ${connectionId}`);
      subscribeToConnection(connectionId);
      return () => {
        debugWebSocket(`useCertificateRenewal: Unsubscribing from connection ${connectionId}`);
        unsubscribeFromConnection(connectionId);
      };
    }
  }, [connectionId, connected, subscribeToConnection, unsubscribeFromConnection]);

  const activeOperation = getActiveOperation(connectionId, 'certificate_renewal');
  const isRenewing = hasActiveOperation(connectionId, 'certificate_renewal');

  debugWebSocket(`useCertificateRenewal hook for connection ${connectionId}:`, {
    activeOperation: activeOperation ? { id: activeOperation.id, status: activeOperation.status, progress: activeOperation.progress } : null,
    isRenewing,
    totalOperations: Array.from(operations.values()).length,
    connectionOperations: Array.from(operations.values()).filter(op => op.connectionId === connectionId).length
  });

  return {
    activeOperation,
    isRenewing,
    progress: activeOperation?.progress || 0,
    message: activeOperation?.message || '',
    error: activeOperation?.error,
    status: activeOperation?.status || 'idle',
    renewalStatus: activeOperation?.metadata?.renewal_status || 'pending'
  };
};