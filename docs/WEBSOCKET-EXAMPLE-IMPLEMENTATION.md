# WebSocket Implementation Examples

## Backend Implementation Examples

### 1. Operation Status Manager
```typescript
// backend/src/services/operation-status-manager.ts
import { EventEmitter } from 'events';
import { Database } from '../database';
import { Server as SocketIOServer } from 'socket.io';

export interface Operation {
  id: string;
  connectionId: number;
  type: 'ssh_test' | 'service_restart' | 'certificate_renewal';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  metadata?: any;
  createdBy: 'user' | 'cron' | 'auto';
}

export class OperationStatusManager extends EventEmitter {
  private operations: Map<string, Operation> = new Map();
  private io: SocketIOServer | null = null;

  constructor(private database: Database) {
    super();
  }

  setSocketServer(io: SocketIOServer) {
    this.io = io;
  }

  async checkActiveOperation(connectionId: number, type: Operation['type']): Promise<Operation | null> {
    // Check in-memory first
    for (const [_, op] of this.operations) {
      if (op.connectionId === connectionId && 
          op.type === type && 
          ['pending', 'in_progress'].includes(op.status)) {
        return op;
      }
    }

    // Check database
    const dbOp = await this.database.getActiveOperation(connectionId, type);
    if (dbOp) {
      this.operations.set(dbOp.id, dbOp);
      return dbOp;
    }

    return null;
  }

  async startOperation(
    connectionId: number, 
    type: Operation['type'], 
    createdBy: Operation['createdBy'] = 'user'
  ): Promise<Operation> {
    // Check for existing operation
    const existing = await this.checkActiveOperation(connectionId, type);
    if (existing) {
      return existing;
    }

    const operation: Operation = {
      id: `${type}_${connectionId}_${Date.now()}`,
      connectionId,
      type,
      status: 'pending',
      progress: 0,
      message: `Starting ${type.replace('_', ' ')}...`,
      startedAt: new Date(),
      createdBy
    };

    this.operations.set(operation.id, operation);
    await this.database.saveOperation(operation);
    
    this.emitUpdate(operation);
    return operation;
  }

  async updateOperation(
    operationId: string, 
    updates: Partial<Operation>
  ): Promise<void> {
    const operation = this.operations.get(operationId);
    if (!operation) return;

    Object.assign(operation, updates);
    
    if (updates.status === 'completed' || updates.status === 'failed') {
      operation.completedAt = new Date();
    }

    await this.database.updateOperation(operationId, updates);
    this.emitUpdate(operation);

    // Clean up completed operations after 5 minutes
    if (operation.status === 'completed' || operation.status === 'failed') {
      setTimeout(() => {
        this.operations.delete(operationId);
      }, 5 * 60 * 1000);
    }
  }

  private emitUpdate(operation: Operation) {
    if (!this.io) return;

    // Emit to specific connection room
    this.io.to(`connection:${operation.connectionId}`).emit('operation:update', {
      operation
    });

    // Emit to all admins
    this.io.to('admins').emit('operation:update', { operation });

    // Emit local event for backend listeners
    this.emit('operation:update', operation);
  }
}
```

### 2. WebSocket Server Setup
```typescript
// backend/src/websocket-server.ts
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { Database } from './database';
import { OperationStatusManager } from './services/operation-status-manager';
import jwt from 'jsonwebtoken';

export function initializeWebSocket(
  httpServer: HttpServer, 
  database: Database,
  operationManager: OperationStatusManager
): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true
    },
    path: '/socket.io/'
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      // Verify JWT token (adjust based on your auth system)
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      socket.data.userId = decoded.userId;
      
      next();
    } catch (err) {
      next(new Error('Invalid authentication'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Join rooms for connections the user has access to
    socket.on('subscribe:connection', async (connectionId: number) => {
      // Verify user has access to this connection
      const hasAccess = await database.userHasConnectionAccess(
        socket.data.userId, 
        connectionId
      );
      
      if (hasAccess) {
        socket.join(`connection:${connectionId}`);
        
        // Send current operation status
        const operations = await database.getActiveOperationsForConnection(connectionId);
        socket.emit('connection:operations', { connectionId, operations });
      }
    });

    socket.on('unsubscribe:connection', (connectionId: number) => {
      socket.leave(`connection:${connectionId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  operationManager.setSocketServer(io);
  
  return io;
}
```

### 3. Updated SSH Test Endpoint
```typescript
// In backend/src/server.ts
app.post('/api/data/:id/test-connection', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  
  // Check for active operation
  const existingOp = await operationManager.checkActiveOperation(id, 'ssh_test');
  if (existingOp) {
    return res.json({
      operationId: existingOp.id,
      status: 'already_running',
      message: 'SSH test already in progress'
    });
  }

  // Start new operation
  const operation = await operationManager.startOperation(id, 'ssh_test');
  
  // Run SSH test asynchronously
  performSSHTest(id, operation.id);
  
  res.json({
    operationId: operation.id,
    status: 'started',
    message: 'SSH test initiated'
  });
}));

async function performSSHTest(connectionId: number, operationId: string) {
  try {
    await operationManager.updateOperation(operationId, {
      status: 'in_progress',
      progress: 20,
      message: 'Retrieving connection details...'
    });

    const connection = await database.getConnectionById(connectionId);
    if (!connection) throw new Error('Connection not found');

    await operationManager.updateOperation(operationId, {
      progress: 40,
      message: 'Establishing SSH connection...'
    });

    const sshClient = new SSHClient();
    const result = await sshClient.testConnection(
      connection.hostname,
      connection.username,
      connection.password
    );

    await operationManager.updateOperation(operationId, {
      status: 'completed',
      progress: 100,
      message: result.message || 'SSH connection successful'
    });
  } catch (error) {
    await operationManager.updateOperation(operationId, {
      status: 'failed',
      progress: 100,
      error: error.message
    });
  }
}
```

## Frontend Implementation Examples

### 1. WebSocket Context
```tsx
// frontend/src/contexts/WebSocketContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

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
}

interface WebSocketContextType {
  socket: Socket | null;
  connected: boolean;
  operations: Map<string, Operation>;
  subscribeToConnection: (connectionId: number) => void;
  unsubscribeFromConnection: (connectionId: number) => void;
  getConnectionOperations: (connectionId: number) => Operation[];
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [operations, setOperations] = useState<Map<string, Operation>>(new Map());

  useEffect(() => {
    if (!token) return;

    const newSocket = io(import.meta.env.VITE_API_URL || 'http://localhost:3000', {
      auth: { token },
      path: '/socket.io/',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    });

    newSocket.on('operation:update', ({ operation }: { operation: Operation }) => {
      setOperations(prev => {
        const newMap = new Map(prev);
        newMap.set(operation.id, operation);
        return newMap;
      });
    });

    newSocket.on('connection:operations', ({ operations: ops }: { operations: Operation[] }) => {
      setOperations(prev => {
        const newMap = new Map(prev);
        ops.forEach(op => newMap.set(op.id, op));
        return newMap;
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token]);

  const subscribeToConnection = (connectionId: number) => {
    socket?.emit('subscribe:connection', connectionId);
  };

  const unsubscribeFromConnection = (connectionId: number) => {
    socket?.emit('unsubscribe:connection', connectionId);
  };

  const getConnectionOperations = (connectionId: number): Operation[] => {
    return Array.from(operations.values()).filter(op => op.connectionId === connectionId);
  };

  return (
    <WebSocketContext.Provider value={{
      socket,
      connected,
      operations,
      subscribeToConnection,
      unsubscribeFromConnection,
      getConnectionOperations
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
```

### 2. Operation Status Hook
```tsx
// frontend/src/hooks/useOperationStatus.ts
import { useEffect, useState } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';

export function useOperationStatus(connectionId: number, operationType?: string) {
  const { subscribeToConnection, unsubscribeFromConnection, getConnectionOperations } = useWebSocket();
  const [activeOperations, setActiveOperations] = useState<Operation[]>([]);

  useEffect(() => {
    subscribeToConnection(connectionId);
    
    return () => {
      unsubscribeFromConnection(connectionId);
    };
  }, [connectionId]);

  useEffect(() => {
    const updateOperations = () => {
      const ops = getConnectionOperations(connectionId);
      if (operationType) {
        setActiveOperations(ops.filter(op => op.type === operationType));
      } else {
        setActiveOperations(ops);
      }
    };

    updateOperations();
    
    // Re-run when operations change
    const interval = setInterval(updateOperations, 100);
    return () => clearInterval(interval);
  }, [connectionId, operationType, getConnectionOperations]);

  const hasActiveOperation = (type: string) => {
    return activeOperations.some(op => 
      op.type === type && ['pending', 'in_progress'].includes(op.status)
    );
  };

  const getActiveOperation = (type: string) => {
    return activeOperations.find(op => 
      op.type === type && ['pending', 'in_progress'].includes(op.status)
    );
  };

  return {
    activeOperations,
    hasActiveOperation,
    getActiveOperation
  };
}
```

### 3. Updated UI Components
```tsx
// Example: SSH Test Button with WebSocket status
import { Button } from "@/components/ui/button";
import { useOperationStatus } from "@/hooks/useOperationStatus";
import { Loader2 } from "lucide-react";

export function SSHTestButton({ connectionId, onTest }) {
  const { getActiveOperation } = useOperationStatus(connectionId);
  const activeSSHTest = getActiveOperation('ssh_test');

  const handleClick = async () => {
    const response = await apiCall(`/data/${connectionId}/test-connection`, { 
      method: 'POST' 
    });
    const data = await response.json();
    
    if (data.status === 'already_running') {
      toast({
        title: "Test Already Running",
        description: "An SSH test is already in progress for this connection",
        variant: "warning"
      });
    }
  };

  if (activeSSHTest) {
    return (
      <Button disabled variant="outline" size="sm">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {activeSSHTest.message || 'Testing...'}
      </Button>
    );
  }

  return (
    <Button onClick={handleClick} variant="outline" size="sm">
      Test SSH
    </Button>
  );
}

// Example: Certificate Renewal Button
export function CertificateRenewalButton({ connectionId, onRenew }) {
  const { getActiveOperation } = useOperationStatus(connectionId);
  const activeRenewal = getActiveOperation('certificate_renewal');

  if (activeRenewal) {
    return (
      <Button disabled variant="outline">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Processing Renewal ({activeRenewal.progress}%)
      </Button>
    );
  }

  return (
    <Button onClick={onRenew} variant="outline">
      Renew Certificate
    </Button>
  );
}
```

This implementation provides real-time status updates, prevents duplicate operations, and maintains state across page refreshes.