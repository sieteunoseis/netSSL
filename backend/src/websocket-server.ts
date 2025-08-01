import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { DatabaseManager } from './database';
import { Logger } from './logger';

// Global WebSocket server instance
let webSocketServer: Server | null = null;

export interface SocketData {
  userId?: string;
  connectionRooms: Set<number>;
}

export function initializeWebSocket(
  httpServer: HttpServer, 
  database: DatabaseManager
): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || [
        'http://localhost:5173', 
        'http://localhost:3000',
        'http://frontend:5173'
      ],
      credentials: true
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling']
  });

  // For now, we'll skip authentication to get the basic functionality working
  // In production, you'd want to add proper JWT authentication here
  io.use(async (socket, next) => {
    try {
      // Basic connection without auth for development
      socket.data.userId = 'dev-user';
      socket.data.connectionRooms = new Set<number>();
      next();
    } catch (err) {
      Logger.error('WebSocket authentication error:', err);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    Logger.info(`Client connected: ${socket.id}`);

    // Join rooms for connections the user wants to monitor
    socket.on('subscribe:connection', async (connectionId: number) => {
      try {
        // For development, allow access to all connections
        // In production, you'd verify user has access to this connection
        const connection = await database.getConnectionById(connectionId);
        
        if (connection) {
          const roomName = `connection:${connectionId}`;
          socket.join(roomName);
          socket.data.connectionRooms.add(connectionId);
          
          Logger.debug(`Client ${socket.id} subscribed to connection ${connectionId}`);
          
          // Send current active operations for this connection
          const activeOperations = await database.getActiveOperationsByConnection(connectionId);
          Logger.debug(`Sending ${activeOperations.length} active operations for connection ${connectionId}:`, activeOperations.map(op => ({ id: op.id, status: op.status, progress: op.progress })));
          socket.emit('connection:operations', { connectionId, operations: activeOperations });
        } else {
          socket.emit('error', { message: 'Connection not found' });
        }
      } catch (error) {
        Logger.error('Error subscribing to connection:', error);
        socket.emit('error', { message: 'Failed to subscribe to connection' });
      }
    });

    // Unsubscribe from connection updates
    socket.on('unsubscribe:connection', (connectionId: number) => {
      const roomName = `connection:${connectionId}`;
      socket.leave(roomName);
      socket.data.connectionRooms.delete(connectionId);
      
      Logger.debug(`Client ${socket.id} unsubscribed from connection ${connectionId}`);
    });

    // Handle refresh - rejoin rooms for active operations
    socket.on('rejoin:connections', async (connectionIds: number[]) => {
      try {
        for (const connectionId of connectionIds) {
          const connection = await database.getConnectionById(connectionId);
          if (connection) {
            const roomName = `connection:${connectionId}`;
            socket.join(roomName);
            socket.data.connectionRooms.add(connectionId);
            
            // Send current active operations
            const activeOperations = await database.getActiveOperationsByConnection(connectionId);
            Logger.debug(`Rejoining: Sending ${activeOperations.length} active operations for connection ${connectionId}:`, activeOperations.map(op => ({ id: op.id, status: op.status, progress: op.progress })));
            socket.emit('connection:operations', { connectionId, operations: activeOperations });
          }
        }
        Logger.debug(`Client ${socket.id} rejoined ${connectionIds.length} connection rooms`);
      } catch (error) {
        Logger.error('Error rejoining connections:', error);
        socket.emit('error', { message: 'Failed to rejoin connections' });
      }
    });

    // Heartbeat to keep connection alive
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      Logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
      // Room cleanup is automatic when socket disconnects
    });
  });

  // Helper function to emit to specific connection room
  const emitToConnection = (connectionId: number, event: string, data: any) => {
    const roomName = `connection:${connectionId}`;
    io.to(roomName).emit(event, data);
    Logger.debug(`Emitted ${event} to connection ${connectionId} room`);
  };

  // Helper function to emit to all connected clients
  const emitToAll = (event: string, data: any) => {
    io.emit(event, data);
    Logger.debug(`Emitted ${event} to all clients`);
  };

  // Attach helper functions to the io instance for external use
  (io as any).emitToConnection = emitToConnection;
  (io as any).emitToAll = emitToAll;

  Logger.info('WebSocket server initialized');
  
  // Store the global instance
  webSocketServer = io;
  
  return io;
}

// Function to get the existing WebSocket server instance
export function getWebSocketServer(): Server | null {
  return webSocketServer;
}

// Type augmentation for the socket.io server with custom methods
declare module 'socket.io' {
  interface Server {
    emitToConnection(connectionId: number, event: string, data: any): void;
    emitToAll(event: string, data: any): void;
  }
}