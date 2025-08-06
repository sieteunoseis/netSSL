import { EventEmitter } from 'events';
import { DatabaseManager } from '../database';
import { Logger } from '../logger';
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

  constructor(private database: DatabaseManager) {
    super();
    
    // Load active operations from database on startup
    this.loadActiveOperations();
  }

  setSocketServer(io: SocketIOServer) {
    this.io = io;
    Logger.info('OperationStatusManager: WebSocket server attached');
  }

  private async loadActiveOperations(): Promise<void> {
    try {
      // Load all active operations from database
      const activeOps = await this.database.getActiveOperationsByType(0, '', false);
      
      for (const op of activeOps) {
        if (['pending', 'in_progress'].includes(op.status)) {
          const operation: Operation = {
            id: op.id,
            connectionId: op.connection_id,
            type: op.operation_type as Operation['type'],
            status: op.status as Operation['status'],
            progress: op.progress || 0,
            message: op.message || '',
            error: op.error,
            startedAt: new Date(op.started_at),
            completedAt: op.completed_at ? new Date(op.completed_at) : undefined,
            metadata: op.metadata,
            createdBy: op.created_by as Operation['createdBy']
          };
          
          this.operations.set(operation.id, operation);
        }
      }
      
      Logger.info(`Loaded ${this.operations.size} active operations from database`);
    } catch (error) {
      Logger.error('Failed to load active operations from database:', error);
    }
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

    // Check database for any missed operations
    try {
      const dbOps = await this.database.getActiveOperationsByType(connectionId, type, true);
      if (dbOps.length > 0) {
        const dbOp = dbOps[0]; // Get the most recent one
        const operation: Operation = {
          id: dbOp.id,
          connectionId: dbOp.connection_id,
          type: dbOp.operation_type as Operation['type'],
          status: dbOp.status as Operation['status'],
          progress: dbOp.progress || 0,
          message: dbOp.message || '',
          error: dbOp.error,
          startedAt: new Date(dbOp.started_at),
          completedAt: dbOp.completed_at ? new Date(dbOp.completed_at) : undefined,
          metadata: dbOp.metadata,
          createdBy: dbOp.created_by as Operation['createdBy']
        };
        
        this.operations.set(operation.id, operation);
        return operation;
      }
    } catch (error) {
      Logger.error('Error checking database for active operations:', error);
    }

    return null;
  }

  async startOperation(
    connectionId: number, 
    type: Operation['type'], 
    createdBy: Operation['createdBy'] = 'user',
    metadata?: any
  ): Promise<Operation> {
    // Check for existing operation
    const existing = await this.checkActiveOperation(connectionId, type);
    if (existing) {
      Logger.info(`Operation ${type} already active for connection ${connectionId}`);
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
      createdBy,
      metadata
    };

    this.operations.set(operation.id, operation);
    
    try {
      await this.database.saveActiveOperation(
        operation.id,
        operation.connectionId,
        operation.type,
        operation.status,
        operation.progress,
        operation.message,
        undefined,
        operation.metadata,
        operation.createdBy
      );
      
      this.emitUpdate(operation);
      this.emit('operation:started', operation);
      
      // For certificate renewal operations, emit to admin room
      if (operation.type === 'certificate_renewal' && this.io) {
        // Get connection details for admin notification
        this.database.getConnectionById(connectionId).then(connection => {
          this.io?.to('admin').emit('admin:renewal:started', {
            id: operation.id,
            connectionId: operation.connectionId,
            connectionName: connection?.name || 'Unknown',
            hostname: connection?.hostname || 'Unknown',
            type: operation.type,
            status: operation.status,
            progress: operation.progress,
            message: operation.message,
            startedAt: operation.startedAt.toISOString(),
            createdBy: operation.createdBy,
            metadata: operation.metadata
          });
        }).catch(err => Logger.error('Failed to emit admin renewal start:', err));
      }
      
      Logger.info(`Started operation ${operation.id}: ${type} for connection ${connectionId}`);
    } catch (error) {
      Logger.error('Failed to save operation to database:', error);
      this.operations.delete(operation.id);
      throw error;
    }

    return operation;
  }

  async updateOperation(
    operationId: string, 
    updates: Partial<Pick<Operation, 'status' | 'progress' | 'message' | 'error' | 'metadata'>>
  ): Promise<void> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      Logger.warn(`Operation ${operationId} not found in memory`);
      return;
    }

    // Update in-memory operation
    Object.assign(operation, updates);
    
    if (updates.status === 'completed' || updates.status === 'failed') {
      operation.completedAt = new Date();
    }

    try {
      // Update in database
      await this.database.updateActiveOperation(operationId, {
        ...updates,
        completedAt: operation.completedAt
      });
      
      this.emitUpdate(operation);
      this.emit('operation:updated', operation);
      
      Logger.debug(`Updated operation ${operationId}: ${JSON.stringify(updates)}`);
      
      // Clean up completed operations after 5 minutes
      if (operation.status === 'completed' || operation.status === 'failed') {
        setTimeout(() => {
          this.operations.delete(operationId);
          Logger.debug(`Cleaned up completed operation ${operationId} from memory`);
        }, 5 * 60 * 1000);
      }
    } catch (error) {
      Logger.error('Failed to update operation in database:', error);
      throw error;
    }
  }

  async getOperation(operationId: string): Promise<Operation | null> {
    // Check memory first
    const memoryOp = this.operations.get(operationId);
    if (memoryOp) {
      return memoryOp;
    }

    // Check database
    try {
      const dbOp = await this.database.getActiveOperation(operationId);
      if (dbOp) {
        const operation: Operation = {
          id: dbOp.id,
          connectionId: dbOp.connection_id,
          type: dbOp.operation_type as Operation['type'],
          status: dbOp.status as Operation['status'],
          progress: dbOp.progress || 0,
          message: dbOp.message || '',
          error: dbOp.error,
          startedAt: new Date(dbOp.started_at),
          completedAt: dbOp.completed_at ? new Date(dbOp.completed_at) : undefined,
          metadata: dbOp.metadata,
          createdBy: dbOp.created_by as Operation['createdBy']
        };
        return operation;
      }
    } catch (error) {
      Logger.error('Error getting operation from database:', error);
    }

    return null;
  }

  getActiveOperationsForConnection(connectionId: number, type?: Operation['type']): Operation[] {
    const operations: Operation[] = [];
    
    for (const [_, op] of this.operations) {
      if (op.connectionId === connectionId) {
        if (!type || op.type === type) {
          if (['pending', 'in_progress'].includes(op.status)) {
            operations.push(op);
          }
        }
      }
    }
    
    return operations.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  private emitUpdate(operation: Operation) {
    if (!this.io) {
      Logger.debug('WebSocket server not available, skipping emit');
      return;
    }

    // Emit to specific connection room
    (this.io as any).emitToConnection(operation.connectionId, 'operation:update', {
      operation: {
        ...operation,
        startedAt: operation.startedAt.toISOString(),
        completedAt: operation.completedAt?.toISOString()
      }
    });

    // For certificate renewal operations, also emit to admin room
    if (operation.type === 'certificate_renewal') {
      const eventName = operation.status === 'completed' ? 'admin:renewal:completed' :
                       operation.status === 'failed' ? 'admin:renewal:cancelled' :
                       'admin:renewal:updated';
      
      if (eventName === 'admin:renewal:completed' || eventName === 'admin:renewal:cancelled') {
        this.io.to('admin').emit(eventName, operation.id);
      } else {
        this.io.to('admin').emit(eventName, {
          id: operation.id,
          status: operation.status,
          progress: operation.progress,
          message: operation.message
        });
      }
    }

    Logger.debug(`Emitted operation update for ${operation.id} to connection ${operation.connectionId}`);
  }

  // Cleanup methods
  async cleanupCompletedOperations(olderThanMinutes: number = 60): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const toDelete: string[] = [];

    for (const [id, op] of this.operations) {
      if ((op.status === 'completed' || op.status === 'failed') && 
          op.completedAt && 
          op.completedAt < cutoff) {
        toDelete.push(id);
      }
    }

    toDelete.forEach(id => this.operations.delete(id));
    
    if (toDelete.length > 0) {
      Logger.info(`Cleaned up ${toDelete.length} completed operations from memory`);
    }

    // Also cleanup database
    try {
      await this.database.cleanupOldActiveOperations(Math.floor(olderThanMinutes / 60) || 1);
    } catch (error) {
      Logger.error('Failed to cleanup old operations from database:', error);
    }
  }
}