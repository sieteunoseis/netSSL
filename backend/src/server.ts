import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { DatabaseManager } from './database';
import { validateConnectionData, sanitizeConnectionData } from './validation';
import { Logger } from './logger';
import { ConnectionRecord, ApiResponse } from './types';
import { getCertificateInfoWithFallback } from './certificate';
import { certificateRenewalService } from './certificate-renewal';
import { accountManager } from './account-manager';
import { getAccountsDirectoryStructure, getAccountsSize, formatBytes } from './accounts-utils';

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5000;
console.log('TABLE_COLUMNS from env:', process.env.TABLE_COLUMNS);
const TABLE_COLUMNS = (process.env.TABLE_COLUMNS || 'name,hostname,username,password,version')
  .split(',')
  .map(col => col.trim());
console.log('Processed TABLE_COLUMNS:', TABLE_COLUMNS);

// Initialize database
const database = new DatabaseManager('./db/database.db', TABLE_COLUMNS);

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

// Get connection certificate status
app.get('/api/data/:id/cert-status', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }
  
  return res.json({
    last_cert_issued: connection.last_cert_issued,
    cert_count_this_week: connection.cert_count_this_week,
    cert_count_reset_date: connection.cert_count_reset_date
  });
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

  // Check if required API keys exist for SSL and DNS providers
  const { ssl_provider, dns_provider } = req.body;
  
  // Define required keys for each provider
  const requiredKeys: Record<string, string[]> = {
    'letsencrypt': ['LETSENCRYPT_EMAIL'],
    'zerossl': ['ZEROSSL_KEY'],
    'cloudflare': ['CF_KEY', 'CF_ZONE'],
    'digitalocean': ['DO_KEY'],
    'route53': ['AWS_ACCESS_KEY', 'AWS_SECRET_KEY', 'AWS_ZONE_ID'],
    'azure': ['AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_ZONE_NAME'],
    'google': ['GOOGLE_PROJECT_ID', 'GOOGLE_ZONE_NAME']
  };
  
  if (ssl_provider) {
    const sslSettings = await database.getSettingsByProvider(ssl_provider);
    const required = requiredKeys[ssl_provider] || [];
    const existingKeys = sslSettings.map(s => s.key_name);
    const missingKeys = required.filter(key => !existingKeys.includes(key));
    
    if (missingKeys.length > 0) {
      return res.status(400).json({
        error: 'SSL provider configuration incomplete',
        details: `Missing required keys for ${ssl_provider}: ${missingKeys.join(', ')}`
      });
    }
  }

  if (dns_provider) {
    const dnsSettings = await database.getSettingsByProvider(dns_provider);
    const required = requiredKeys[dns_provider] || [];
    const existingKeys = dnsSettings.map(s => s.key_name);
    const missingKeys = required.filter(key => !existingKeys.includes(key));
    
    if (missingKeys.length > 0) {
      return res.status(400).json({
        error: 'DNS provider configuration incomplete',
        details: `Missing required keys for ${dns_provider}: ${missingKeys.join(', ')}`
      });
    }
  }

  // Sanitize input data
  const sanitizedData = sanitizeConnectionData(req.body);
  
  const connectionId = await database.createConnection(sanitizedData as ConnectionRecord);
  
  return res.status(201).json({ 
    id: connectionId,
    message: 'Connection created successfully' 
  });
}));

// Duplicate connection
app.post('/api/data/:id/duplicate', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  const { newName, password } = req.body;
  if (!newName || !password) {
    return res.status(400).json({ error: 'newName and password are required' });
  }

  // Get the existing connection
  const existingConnection = await database.getConnectionById(id);
  if (!existingConnection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  // Create new connection data with the new name and password
  const newConnectionData = {
    name: newName,
    hostname: existingConnection.hostname,
    username: existingConnection.username,
    password: password,
    domain: existingConnection.domain,
    ssl_provider: existingConnection.ssl_provider,
    dns_provider: existingConnection.dns_provider
  };

  // Validate the new connection data
  const validation = validateConnectionData(newConnectionData);
  if (!validation.isValid) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: validation.errors 
    });
  }

  // Create the new connection
  const newId = await database.createConnection(newConnectionData);
  return res.status(201).json({ 
    message: 'Connection duplicated successfully',
    id: newId 
  });
}));

// Update connection by ID
app.put('/api/data/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  // Check if connection exists
  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

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
  
  // Update connection in database
  await database.updateConnection(id, sanitizedData as ConnectionRecord);
  
  return res.json({ 
    id: id,
    message: 'Connection updated successfully' 
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

// Issue certificate for connection
app.post('/api/data/:id/issue-cert', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  // Check if connection exists
  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  // Start certificate renewal process
  const renewalStatus = await certificateRenewalService.renewCertificate(id, database);
  
  return res.json({ 
    message: 'Certificate renewal initiated', 
    connectionId: id,
    renewalId: renewalStatus.id,
    status: renewalStatus.status
  });
}));

// Get renewal status
app.get('/api/data/:id/renewal-status/:renewalId', asyncHandler(async (req: Request, res: Response) => {
  const renewalId = req.params.renewalId;
  
  Logger.info(`Fetching renewal status for ID: ${renewalId}`);
  
  try {
    const status = certificateRenewalService.getRenewalStatus(renewalId);
    if (!status) {
      Logger.warn(`Renewal status not found for ID: ${renewalId}`);
      return res.status(404).json({ error: 'Renewal status not found' });
    }

    // Convert Date objects to strings for JSON serialization
    const serializedStatus = {
      ...status,
      startTime: status.startTime instanceof Date ? status.startTime.toISOString() : status.startTime,
      endTime: status.endTime ? (status.endTime instanceof Date ? status.endTime.toISOString() : status.endTime) : undefined
    };

    return res.json(serializedStatus);
  } catch (error) {
    Logger.error(`Error fetching renewal status for ID ${renewalId}:`, error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// Settings/API Keys management endpoints
app.get('/api/settings', asyncHandler(async (req: Request, res: Response) => {
  const settings = await database.getAllSettings();
  return res.json(settings);
}));

app.get('/api/settings/:provider', asyncHandler(async (req: Request, res: Response) => {
  const provider = req.params.provider;
  const settings = await database.getSettingsByProvider(provider);
  return res.json(settings);
}));

app.post('/api/settings', asyncHandler(async (req: Request, res: Response) => {
  const { key_name, key_value, provider, description } = req.body;
  
  if (!key_name || !key_value || !provider) {
    return res.status(400).json({ error: 'key_name, key_value, and provider are required' });
  }

  await database.upsertSetting(key_name, key_value, provider, description);
  return res.status(201).json({ message: 'Setting saved successfully' });
}));

app.delete('/api/settings/:keyName', asyncHandler(async (req: Request, res: Response) => {
  const keyName = req.params.keyName;
  await database.deleteSetting(keyName);
  return res.status(204).send();
}));

// Check if required keys exist for a provider
app.get('/api/settings/:provider/validate', asyncHandler(async (req: Request, res: Response) => {
  const provider = req.params.provider;
  const settings = await database.getSettingsByProvider(provider);
  
  // Define required keys for each provider
  const requiredKeys: Record<string, string[]> = {
    'letsencrypt': ['LETSENCRYPT_EMAIL'],
    'zerossl': ['ZEROSSL_KEY'],
    'cloudflare': ['CF_KEY', 'CF_ZONE'],
    'digitalocean': ['DO_KEY'],
    'route53': ['AWS_ACCESS_KEY', 'AWS_SECRET_KEY', 'AWS_ZONE_ID'],
    'azure': ['AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_ZONE_NAME'],
    'google': ['GOOGLE_PROJECT_ID', 'GOOGLE_ZONE_NAME']
  };

  const required = requiredKeys[provider] || [];
  const existingKeys = settings.map(s => s.key_name);
  const missingKeys = required.filter(key => !existingKeys.includes(key));
  
  return res.json({
    provider,
    required_keys: required,
    existing_keys: existingKeys,
    missing_keys: missingKeys,
    is_valid: missingKeys.length === 0
  });
}));

// Get certificate information for a connection
app.get('/api/data/:id/certificate', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const fullFQDN = `${connection.hostname}.${connection.domain}`;
  const certInfo = await getCertificateInfoWithFallback(fullFQDN);
  
  if (!certInfo) {
    return res.status(404).json({ 
      error: 'Certificate not found',
      details: `Unable to retrieve certificate information for ${fullFQDN}`
    });
  }

  return res.json(certInfo);
}));

// Get certificate information by hostname (for quick checks)
app.get('/api/certificate/:hostname', asyncHandler(async (req: Request, res: Response) => {
  const hostname = req.params.hostname;
  
  if (!hostname || hostname.trim() === '') {
    return res.status(400).json({ error: 'Hostname parameter is required' });
  }

  const certInfo = await getCertificateInfoWithFallback(hostname);
  
  if (!certInfo) {
    return res.status(404).json({ 
      error: 'Certificate not found',
      details: `Unable to retrieve certificate information for ${hostname}`
    });
  }

  return res.json(certInfo);
}));

// Debug endpoint to view accounts directory structure
app.get('/api/accounts/debug', asyncHandler(async (req: Request, res: Response) => {
  const accountsDir = process.env.ACCOUNTS_DIR || './accounts';
  const structure = getAccountsDirectoryStructure(accountsDir);
  const size = getAccountsSize(accountsDir);
  
  return res.json({
    accounts_directory: accountsDir,
    structure,
    stats: {
      total_files: size.totalFiles,
      total_size: formatBytes(size.totalSize)
    }
  });
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