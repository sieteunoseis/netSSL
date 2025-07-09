import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Database } from './database';
import { validateConnectionData, sanitizeConnectionData } from './validation';
import { Logger } from './logger';
import { ConnectionRecord, ApiResponse } from './types';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5000;
const TABLE_COLUMNS = (process.env.VITE_TABLE_COLUMNS || 'name,hostname,username,password,version')
  .split(',')
  .map(col => col.trim())
  .filter(col => col !== 'password'); // Remove password from visible columns

// Initialize database
const database = new Database('./db/database.db', TABLE_COLUMNS);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL || 'http://localhost:3000'
    : true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  Logger.info(`${req.method} ${req.path}`, { 
    ip: req.ip, 
    userAgent: req.get('User-Agent') 
  });
  next();
});

// Error handling middleware
const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  Logger.error('Unhandled error:', err);
  
  if (res.headersSent) {
    return next(err);
  }

  const response: ApiResponse = {
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  };
  
  res.status(500).json(response);
};

// Async handler wrapper
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all connections or specific connection by ID
app.get('/api/data', asyncHandler(async (req: Request, res: Response) => {
  const id = req.query.id;

  if (id) {
    const connectionId = parseInt(id as string);
    if (isNaN(connectionId)) {
      return res.status(400).json({ error: 'Invalid ID parameter' });
    }

    const connection = await database.getConnectionById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    return res.json(connection);
  } else {
    const connections = await database.getAllConnections();
    return res.json(connections);
  }
}));

// Get selected connection
app.get('/api/data/selected', asyncHandler(async (req: Request, res: Response) => {
  const selectedConnection = await database.getSelectedConnection();
  if (!selectedConnection) {
    return res.status(404).json({ error: 'No selected connection found' });
  }
  
  return res.json(selectedConnection);
}));

// Create new connection
app.post('/api/data', asyncHandler(async (req: Request, res: Response) => {
  // Validate input data
  const validation = validateConnectionData(req.body);
  if (!validation.isValid) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: validation.errors 
    });
  }

  // Sanitize input data
  const sanitizedData = sanitizeConnectionData(req.body);
  
  const connectionId = await database.createConnection(sanitizedData as ConnectionRecord);
  
  return res.status(201).json({ 
    id: connectionId,
    message: 'Connection created successfully' 
  });
}));

// Delete connection by ID
app.delete('/api/data/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  // Check if connection exists
  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  await database.deleteConnection(id);
  return res.status(204).send();
}));

// Select connection by ID
app.put('/api/data/select/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  // Check if connection exists
  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  await database.selectConnection(id);
  return res.json({ message: 'Connection selected successfully' });
}));

// Apply error handling middleware
app.use(errorHandler);

// Handle 404 for unmatched routes
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
const gracefulShutdown = () => {
  Logger.info('Received shutdown signal, closing server...');
  database.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  Logger.info(`Server running on port ${PORT}`);
  Logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;