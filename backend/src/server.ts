import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { DatabaseManager } from './database';
import { validateConnectionData, sanitizeConnectionData } from './validation';
import { Logger } from './logger';
import { ConnectionRecord, ApiResponse } from './types';
import { getCertificateInfoWithFallback } from './certificate';
import { certificateRenewalService } from './certificate-renewal';
import { accountManager } from './account-manager';
import { getAccountsDirectoryStructure, getAccountsSize, formatBytes } from './accounts-utils';
import { SSHClient } from './ssh-client';
import { autoRenewalCron } from './auto-renewal-cron';

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log('TABLE_COLUMNS from env:', process.env.TABLE_COLUMNS);
const TABLE_COLUMNS = (process.env.TABLE_COLUMNS || 'name,hostname,username,password,version')
  .split(',')
  .map(col => col.trim());
console.log('Processed TABLE_COLUMNS:', TABLE_COLUMNS);

// Initialize database
const database = new DatabaseManager('./db/database.db', TABLE_COLUMNS);

// Set database on certificate renewal service
(certificateRenewalService as any).setDatabase(database);

// Set database on auto-renewal cron service and start it
(autoRenewalCron as any).database = database;
autoRenewalCron.start();

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
    'google': ['GOOGLE_PROJECT_ID', 'GOOGLE_ZONE_NAME'],
    'custom': ['CUSTOM_DNS_SERVER_1', 'CUSTOM_DNS_SERVER_2']
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

  // Log the received data for debugging
  Logger.info('Creating connection with data:', { 
    application_type: req.body.application_type,
    name: req.body.name,
    hostname: req.body.hostname 
  });

  // Sanitize input data
  const sanitizedData = sanitizeConnectionData(req.body);
  
  Logger.info('Sanitized data for creation:', { 
    application_type: sanitizedData.application_type,
    name: sanitizedData.name,
    hostname: sanitizedData.hostname 
  });
  
  const connectionId = await database.createConnection(sanitizedData as ConnectionRecord);
  
  // Pre-create Let's Encrypt account if using letsencrypt SSL provider
  if (sanitizedData.ssl_provider === 'letsencrypt') {
    try {
      const { acmeClient } = await import('./acme-client');
      const domain = `${sanitizedData.hostname}.${sanitizedData.domain}`;
      
      // Check if account already exists
      const existingAccount = await acmeClient.loadAccount(domain);
      if (!existingAccount) {
        Logger.info(`Pre-creating Let's Encrypt account for new connection: ${domain}`);
        const sslSettings = await database.getSettingsByProvider('letsencrypt');
        const email = sslSettings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
        
        if (email) {
          // Create account in background without blocking the response
          acmeClient.createAccount(email, domain).then(() => {
            Logger.info(`Successfully pre-created Let's Encrypt account for ${domain}`);
          }).catch((error) => {
            Logger.error(`Failed to pre-create Let's Encrypt account for ${domain}:`, error);
            // Don't fail the connection creation if account creation fails
          });
        }
      }
    } catch (error) {
      Logger.error('Error during Let\'s Encrypt account pre-creation:', error);
      // Don't fail the connection creation if account setup fails
    }
  }
  
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

  // Log the received data for debugging
  Logger.info('Updating connection with data:', { 
    id: id,
    application_type: req.body.application_type,
    name: req.body.name,
    hostname: req.body.hostname,
    enable_ssh: req.body.enable_ssh,
    auto_restart_service: req.body.auto_restart_service,
    auto_renew: req.body.auto_renew
  });

  // Sanitize input data
  const sanitizedData = sanitizeConnectionData(req.body);
  
  Logger.info('Sanitized data for update:', { 
    id: id,
    application_type: sanitizedData.application_type,
    name: sanitizedData.name,
    hostname: sanitizedData.hostname,
    enable_ssh: sanitizedData.enable_ssh,
    auto_restart_service: sanitizedData.auto_restart_service,
    auto_renew: sanitizedData.auto_renew
  });
  
  // Update connection in database
  await database.updateConnection(id, sanitizedData as ConnectionRecord);
  
  // Pre-create Let's Encrypt account if SSL provider was changed to letsencrypt
  if (sanitizedData.ssl_provider === 'letsencrypt') {
    try {
      const { acmeClient } = await import('./acme-client');
      const domain = `${sanitizedData.hostname}.${sanitizedData.domain}`;
      
      // Check if account already exists
      const existingAccount = await acmeClient.loadAccount(domain);
      if (!existingAccount) {
        Logger.info(`Pre-creating Let's Encrypt account for updated connection: ${domain}`);
        const sslSettings = await database.getSettingsByProvider('letsencrypt');
        const email = sslSettings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
        
        if (email) {
          // Create account in background without blocking the response
          acmeClient.createAccount(email, domain).then(() => {
            Logger.info(`Successfully pre-created Let's Encrypt account for ${domain}`);
          }).catch((error) => {
            Logger.error(`Failed to pre-create Let's Encrypt account for ${domain}:`, error);
            // Don't fail the connection update if account creation fails
          });
        }
      }
    } catch (error) {
      Logger.error('Error during Let\'s Encrypt account pre-creation on update:', error);
      // Don't fail the connection update if account setup fails
    }
  }
  
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
    const status = await certificateRenewalService.getRenewalStatus(renewalId);
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

// Certificate download endpoints
app.get('/api/data/:id/certificates/:type', asyncHandler(async (req: Request, res: Response) => {
  const connectionId = parseInt(req.params.id);
  const certType = req.params.type; // 'certificate', 'private_key', 'chain', 'fullchain'
  
  if (isNaN(connectionId)) {
    return res.status(400).json({ error: 'Invalid connection ID parameter' });
  }

  // Check if connection exists
  const connection = await database.getConnectionById(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const domain = `${connection.hostname}.${connection.domain}`;
  const accountsPath = path.join(__dirname, '..', 'accounts', domain);
  
  let filePath: string;
  let filename: string;
  let contentType: string = 'application/x-pem-file';

  switch (certType) {
    case 'certificate':
      filePath = path.join(accountsPath, 'certificate.pem');
      filename = `${domain}_certificate.pem`;
      break;
    case 'private_key':
      filePath = path.join(accountsPath, 'private_key.pem');
      filename = `${domain}_private_key.pem`;
      break;
    case 'chain':
      filePath = path.join(accountsPath, 'chain.pem');
      filename = `${domain}_chain.pem`;
      break;
    case 'fullchain':
      filePath = path.join(accountsPath, 'fullchain.pem');
      filename = `${domain}_fullchain.pem`;
      break;
    case 'csr':
      filePath = path.join(accountsPath, 'certificate.csr');
      filename = `${domain}_certificate.csr`;
      break;
    default:
      return res.status(400).json({ error: 'Invalid certificate type' });
  }

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Certificate file not found: ${certType}` });
    }

    // Set headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error) {
    Logger.error(`Error downloading certificate ${certType} for connection ${connectionId}:`, error);
    return res.status(500).json({ 
      error: 'Failed to download certificate',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

app.get('/api/data/:id/certificates', asyncHandler(async (req: Request, res: Response) => {
  const connectionId = parseInt(req.params.id);
  
  if (isNaN(connectionId)) {
    return res.status(400).json({ error: 'Invalid connection ID parameter' });
  }

  // Check if connection exists
  const connection = await database.getConnectionById(connectionId);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  const domain = `${connection.hostname}.${connection.domain}`;
  const accountsPath = path.join(__dirname, '..', 'accounts', domain);
  
  // Check which certificate files are available
  const availableFiles: { type: string; filename: string; size: number; lastModified: string }[] = [];
  
  const fileTypes = [
    { type: 'certificate', filename: 'certificate.pem', displayName: 'Certificate' },
    { type: 'private_key', filename: 'private_key.pem', displayName: 'Private Key' },
    { type: 'chain', filename: 'chain.pem', displayName: 'Certificate Chain' },
    { type: 'fullchain', filename: 'fullchain.pem', displayName: 'Full Chain' },
    { type: 'csr', filename: 'certificate.csr', displayName: 'Certificate Signing Request' }
  ];

  for (const fileType of fileTypes) {
    const filePath = path.join(accountsPath, fileType.filename);
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        availableFiles.push({
          type: fileType.type,
          filename: fileType.displayName,
          size: stats.size,
          lastModified: stats.mtime.toISOString()
        });
      }
    } catch (error) {
      Logger.debug(`Error checking file ${filePath}:`, error);
    }
  }

  return res.json({
    domain,
    availableFiles,
    downloadBaseUrl: `/api/data/${connectionId}/certificates`
  });
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
    'google': ['GOOGLE_PROJECT_ID', 'GOOGLE_ZONE_NAME'],
    'custom': ['CUSTOM_DNS_SERVER_1', 'CUSTOM_DNS_SERVER_2']
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

// SSH test endpoint
app.post('/api/ssh/test', asyncHandler(async (req: Request, res: Response) => {
  const { hostname, username, password } = req.body;

  if (!hostname || !username || !password) {
    return res.status(400).json({ 
      error: 'Missing required fields', 
      details: 'hostname, username, and password are required' 
    });
  }

  Logger.info(`Testing SSH connection to ${hostname}`);

  try {
    const result = await SSHClient.testConnection({
      hostname,
      username,
      password
    });

    return res.json(result);
  } catch (error: any) {
    Logger.error(`SSH test failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during SSH test'
    });
  }
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

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  Logger.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  Logger.info(`Server running on port ${PORT}`);
  Logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;