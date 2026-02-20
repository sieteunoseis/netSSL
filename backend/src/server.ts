import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
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
import { LetsEncryptAccountChecker } from './letsencrypt-account-check';
import { getDomainFromConnection } from './utils/domain-utils';
import { migrateAccountFiles } from './migrate-accounts';
import { initializeWebSocket, getWebSocketServer } from './websocket-server';
import { OperationStatusManager } from './services/operation-status-manager';
import { PlatformFactory } from './platform-providers/platform-factory';
import { ISEProvider } from './platform-providers/ise-provider';
import { downloadAllRootCertificates, checkRootCertificates } from './utils/download-root-certs';
import { generateCSR, validateCSRRequest, CSRRequest } from './csr-generator';

dotenv.config({ path: '../.env' });

// Function to calculate next cron run time
function calculateNextCronRun(cronExpression: string): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(' ');
  
  const now = new Date();
  const nextRun = new Date(now);
  
  // Set the time to the specified hour and minute
  nextRun.setHours(parseInt(hour), parseInt(minute), 0, 0);
  
  // If the time has already passed today, move to tomorrow
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  
  return nextRun.toISOString();
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Hardcoded table columns - these define the database schema and should not be modified
const TABLE_COLUMNS = [
  'name',
  'hostname', 
  'username',
  'password',
  'domain',
  'ssl_provider',
  'dns_provider',
  'dns_challenge_mode',
  'portal_url',
  'ise_nodes',
  'ise_certificate',
  'ise_private_key',
  'ise_cert_import_config',
  'ise_application_subtype',
  'general_private_key',
  'alt_names',
  'enable_ssh',
  'auto_restart_service',
  'auto_renew',
  'auto_renew_status',
  'auto_renew_last_attempt',
  'ssh_cert_path',
  'ssh_key_path',
  'ssh_chain_path',
  'ssh_restart_command'
];

console.log('Using hardcoded TABLE_COLUMNS:', TABLE_COLUMNS);

// Initialize database
const database = new DatabaseManager('./db/database.db', TABLE_COLUMNS);

// Initialize operation status manager
const operationManager = new OperationStatusManager(database);

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
app.get('/api/health', (req: Request, res: Response) => {
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
  // Log the incoming request for debugging (redact sensitive fields)
  const { password: _pw, ise_private_key: _ipk, general_private_key: _gpk, ...safeBody } = req.body;
  Logger.info('POST /api/data request body:', JSON.stringify(safeBody, null, 2));
  
  // Validate input data
  const validation = validateConnectionData(req.body);
  if (!validation.isValid) {
    Logger.error('Validation failed for /api/data:', validation.errors);
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
      Logger.error(`SSL provider ${ssl_provider} missing keys:`, missingKeys);
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
      Logger.error(`DNS provider ${dns_provider} missing keys:`, missingKeys);
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
      const existingAccount = await acmeClient.loadAccount(domain, connectionId);
      if (!existingAccount) {
        Logger.info(`Pre-creating Let's Encrypt account for new connection: ${domain}`);
        const sslSettings = await database.getSettingsByProvider('letsencrypt');
        const email = sslSettings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
        
        if (email) {
          // Create account in background without blocking the response
          acmeClient.createAccount(email, domain, connectionId).then(() => {
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
    Logger.warn('Validation failed for connection update:', { id, errors: validation.errors });
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.errors
    });
  }

  // Log the received data for debugging
  Logger.info('Updating connection with data:', { 
    id: id,
    application_type: req.body.application_type,
    ise_application_subtype: req.body.ise_application_subtype,
    name: req.body.name,
    hostname: req.body.hostname,
    enable_ssh: req.body.enable_ssh,
    auto_restart_service: req.body.auto_restart_service,
    auto_renew: req.body.auto_renew,
    is_enabled: req.body.is_enabled
  });

  // Sanitize input data
  const sanitizedData = sanitizeConnectionData(req.body);
  
  Logger.info('Sanitized data for update:', { 
    id: id,
    application_type: sanitizedData.application_type,
    ise_application_subtype: sanitizedData.ise_application_subtype,
    name: sanitizedData.name,
    hostname: sanitizedData.hostname,
    enable_ssh: sanitizedData.enable_ssh,
    auto_restart_service: sanitizedData.auto_restart_service,
    auto_renew: sanitizedData.auto_renew,
    is_enabled: sanitizedData.is_enabled
  });
  
  // Update connection in database
  await database.updateConnection(id, sanitizedData as ConnectionRecord);
  
  // Pre-create Let's Encrypt account if SSL provider was changed to letsencrypt
  if (sanitizedData.ssl_provider === 'letsencrypt') {
    try {
      const { acmeClient } = await import('./acme-client');
      const domain = `${sanitizedData.hostname}.${sanitizedData.domain}`;
      
      // Check if account already exists
      const existingAccount = await acmeClient.loadAccount(domain, id);
      if (!existingAccount) {
        Logger.info(`Pre-creating Let's Encrypt account for updated connection: ${domain}`);
        const sslSettings = await database.getSettingsByProvider('letsencrypt');
        const email = sslSettings.find(s => s.key_name === 'LETSENCRYPT_EMAIL')?.key_value;
        
        if (email) {
          // Create account in background without blocking the response
          acmeClient.createAccount(email, domain, id).then(() => {
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

// Issue certificate for connection with WebSocket support
app.post('/api/data/:id/issue-cert', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  // Check for existing certificate renewal operation
  const existingOperation = await operationManager.checkActiveOperation(id, 'certificate_renewal');
  if (existingOperation) {
    return res.json({
      operationId: existingOperation.id,
      status: 'already_running',
      message: 'Certificate renewal already in progress',
      progress: existingOperation.progress,
      startedAt: existingOperation.startedAt.toISOString()
    });
  }

  // Check if connection exists
  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    // Start certificate renewal process with operation manager
    const renewalStatus = await certificateRenewalService.renewCertificate(id, database, operationManager);
    
    return res.json({ 
      operationId: renewalStatus.id,
      status: 'started',
      message: 'Certificate renewal initiated',
      connectionId: id,
      renewalId: renewalStatus.id, // For backward compatibility
      estimatedDuration: 180000 // 3 minutes
    });
  } catch (error: any) {
    Logger.error(`Error starting certificate renewal for connection ${id}: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to start certificate renewal',
      details: error.message
    });
  }
}));

// ISE Certificate Import using Platform Provider
app.post('/api/data/:id/import-ise-cert', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  // Check if connection exists and is ISE type
  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  if (connection.application_type !== 'ise') {
    return res.status(400).json({ error: 'Connection must be of type ISE for certificate import' });
  }

  // Validate required fields
  if (!connection.username || !connection.password) {
    return res.status(400).json({ error: 'ISE username and password are required for certificate import' });
  }

  if (!connection.ise_nodes) {
    return res.status(400).json({ error: 'ISE nodes must be configured for certificate import' });
  }

  const { certificateData, privateKeyData, caCertificates } = req.body;

  if (!certificateData || !privateKeyData) {
    return res.status(400).json({ error: 'Certificate data and private key data are required' });
  }

  try {
    // Parse ISE certificate import configuration
    let customConfig = {};
    if (connection.ise_cert_import_config) {
      try {
        customConfig = JSON.parse(connection.ise_cert_import_config);
      } catch (e) {
        Logger.warn(`Invalid JSON in ise_cert_import_config for connection ${id}, using defaults`);
      }
    }

    // Get ISE provider
    const iseProvider = PlatformFactory.createProvider('ise') as ISEProvider;
    
    // Parse ISE nodes
    const nodes = connection.ise_nodes.split(',').map(node => node.trim()).filter(node => node);

    // Import CA certificates first if provided
    if (caCertificates && Array.isArray(caCertificates) && caCertificates.length > 0) {
      for (const node of nodes) {
        try {
          Logger.info(`Uploading CA certificates to ISE node: ${node}`);
          const caResult = await iseProvider.uploadTrustCertificates(
            node,
            connection.username,
            connection.password,
            caCertificates
          );
          
          if (!caResult.success) {
            Logger.warn(`Failed to upload CA certificates to ${node}: ${caResult.message}`);
          } else {
            Logger.info(`Successfully uploaded CA certificates to ${node}`);
          }
        } catch (error: any) {
          Logger.error(`Error uploading CA certificates to ${node}:`, error);
          // Continue with certificate import even if CA upload fails
        }
      }
    }

    // Import identity certificate to all nodes
    const result = await iseProvider.importCertificateToNodes(
      nodes,
      connection.username,
      connection.password,
      certificateData,
      privateKeyData,
      customConfig
    );

    return res.json(result);

  } catch (error: any) {
    Logger.error(`Error during ISE certificate import for connection ${id}:`, error);
    return res.status(500).json({
      error: 'Failed to import certificate to ISE',
      details: error.message
    });
  }
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

// Operations management endpoints
app.get('/api/operations', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Get all operations from database
    const operations = await database.getActiveOperationsByType(0, '', false);
    
    // Add age information
    const operationsWithAge = operations.map(op => ({
      ...op,
      ageMinutes: Math.floor((Date.now() - new Date(op.started_at).getTime()) / 1000 / 60)
    }));

    return res.json(operationsWithAge);
  } catch (error: any) {
    Logger.error('Error getting operations:', error);
    return res.status(500).json({ 
      error: 'Failed to get operations',
      message: error.message 
    });
  }
}));

app.post('/api/operations/:operationId/force-complete', asyncHandler(async (req: Request, res: Response) => {
  const operationId = req.params.operationId;
  const { status = 'failed', error = 'Operation manually cancelled' } = req.body;

  if (!['completed', 'failed'].includes(status)) {
    return res.status(400).json({ 
      error: 'Invalid status. Must be "completed" or "failed"' 
    });
  }

  try {
    // Check if operation exists
    const operation = await operationManager.getOperation(operationId);
    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    // Update operation status
    await operationManager.updateOperation(operationId, {
      status: status as 'completed' | 'failed',
      progress: 100,
      error: status === 'failed' ? error : undefined,
      message: status === 'completed' ? 'Operation completed manually' : 'Operation cancelled manually'
    });

    Logger.info(`Operation ${operationId} manually set to ${status} status`);
    
    return res.json({ 
      message: `Operation ${operationId} has been marked as ${status}`,
      operationId,
      status
    });

  } catch (error: any) {
    Logger.error(`Error updating operation ${operationId}:`, error);
    return res.status(500).json({
      error: 'Failed to update operation',
      message: error.message
    });
  }
}));

app.delete('/api/operations/:operationId', asyncHandler(async (req: Request, res: Response) => {
  const operationId = req.params.operationId;

  try {
    // Check if operation exists
    const operation = await operationManager.getOperation(operationId);
    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    // If it's a certificate renewal, cancel it in the renewal service
    if (operation.type === 'certificate_renewal') {
      await certificateRenewalService.cancelRenewal(operationId);
      Logger.info(`Certificate renewal ${operationId} cancelled`);
    }

    // Delete from database
    await database.deleteActiveOperation(operationId);
    
    Logger.info(`Operation ${operationId} deleted from database`);
    
    return res.json({ 
      message: `Operation ${operationId} has been deleted`,
      operationId
    });

  } catch (error: any) {
    Logger.error(`Error deleting operation ${operationId}:`, error);
    return res.status(500).json({
      error: 'Failed to delete operation',
      message: error.message
    });
  }
}));

app.post('/api/operations/cleanup', asyncHandler(async (req: Request, res: Response) => {
  const { hoursOld = 24, forceStuck = false } = req.body;

  try {
    let deletedCount = 0;
    
    if (forceStuck) {
      // Force complete all stuck operations first
      const stuckOps = await database.getActiveOperationsByType(0, '', false);
      const stuckOperations = stuckOps.filter(op => 
        ['pending', 'in_progress'].includes(op.status) &&
        (Date.now() - new Date(op.started_at).getTime()) > 30 * 60 * 1000 // older than 30 minutes
      );

      for (const op of stuckOperations) {
        await operationManager.updateOperation(op.id, {
          status: 'failed',
          progress: 100,
          error: 'Operation cancelled due to stuck state'
        });
        deletedCount++;
      }
      
      Logger.info(`Force completed ${stuckOperations.length} stuck operations`);
    }

    // Clean up old completed operations
    await operationManager.cleanupCompletedOperations(hoursOld * 60);
    
    return res.json({ 
      message: `Cleanup completed. ${deletedCount} stuck operations were force completed.`,
      forceCompletedCount: deletedCount,
      hoursOld
    });

  } catch (error: any) {
    Logger.error('Error during operations cleanup:', error);
    return res.status(500).json({
      error: 'Failed to cleanup operations',
      message: error.message
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

  const domain = getDomainFromConnection(connection);
  if (!domain) {
    return res.status(400).json({ 
      error: 'Invalid connection configuration',
      details: 'Missing hostname/domain for certificate lookup'
    });
  }
  
  let baseFilename: string;
  let filename: string;
  let contentType: string = 'application/x-pem-file';

  switch (certType) {
    case 'certificate':
      baseFilename = 'certificate.pem';
      filename = `${domain}_certificate.pem`;
      break;
    case 'private_key':
      baseFilename = 'private_key.pem';
      filename = `${domain}_private_key.pem`;
      break;
    case 'chain':
      baseFilename = 'chain.pem';
      filename = `${domain}_chain.pem`;
      break;
    case 'fullchain':
      baseFilename = 'fullchain.pem';
      filename = `${domain}_fullchain.pem`;
      break;
    case 'csr':
      baseFilename = 'certificate.csr';
      filename = `${domain}_certificate.csr`;
      break;
    default:
      return res.status(400).json({ error: 'Invalid certificate type' });
  }

  try {
    // Use AccountManager to get the certificate file path
    const filePath = accountManager.getCertificateFilePath(connectionId, baseFilename);
    
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

  const domain = getDomainFromConnection(connection);
  if (!domain) {
    return res.status(400).json({ 
      error: 'Invalid connection configuration',
      details: 'Missing hostname/domain for certificate lookup'
    });
  }
  
  // Check which certificate files are available
  const availableFiles: { type: string; filename: string; size: number; lastModified: string }[] = [];
  
  const fileTypes = [
    { type: 'certificate', filename: 'certificate.pem', displayName: 'Certificate' },
    { type: 'private_key', filename: 'private_key.pem', displayName: 'Private Key' },
    { type: 'chain', filename: 'chain.pem', displayName: 'Certificate Chain' },
    { type: 'fullchain', filename: 'fullchain.pem', displayName: 'Full Chain' },
    { type: 'csr', filename: 'certificate.csr', displayName: 'Certificate Signing Request' }
  ];

  Logger.debug(`Certificate listing for connection ${connectionId} (${domain})`);
  
  // Use AccountManager to check for certificate files
  for (const fileType of fileTypes) {
    const filePath = accountManager.getCertificateFilePath(connectionId, fileType.filename);
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
  
  // Return certificate renewal settings from environment variables
  if (provider === 'renewal') {
    const renewalSettings = [
      {
        key_name: 'CERT_RENEWAL_DAYS',
        key_value: process.env.CERT_RENEWAL_DAYS || '7',
        provider: 'renewal',
        description: 'Number of days before certificate expiration to automatically renew'
      },
      {
        key_name: 'CERT_WARNING_DAYS',
        key_value: process.env.CERT_WARNING_DAYS || '30',
        provider: 'renewal',
        description: 'Number of days before expiration to display warning in UI'
      },
      {
        key_name: 'CERT_CHECK_SCHEDULE',
        key_value: process.env.CERT_CHECK_SCHEDULE || '0 0 * * *',
        provider: 'renewal',
        description: 'Cron expression for when to check certificates'
      }
    ];
    return res.json(renewalSettings);
  }
  
  // For other providers, get from database
  const settings = await database.getSettingsByProvider(provider);
  return res.json(settings);
}));

app.post('/api/settings', asyncHandler(async (req: Request, res: Response) => {
  const { key_name, key_value, provider, description } = req.body;
  
  if (!key_name || !key_value || !provider) {
    return res.status(400).json({ error: 'key_name, key_value, and provider are required' });
  }

  // Prevent updating certificate renewal settings that are now in .env
  const envOnlySettings = ['CERT_RENEWAL_DAYS', 'CERT_WARNING_DAYS', 'CERT_CHECK_SCHEDULE'];
  if (envOnlySettings.includes(key_name)) {
    return res.status(400).json({ error: `${key_name} must be configured in the .env file` });
  }

  await database.upsertSetting(key_name, key_value, provider, description);
  return res.status(201).json({ message: 'Setting saved successfully' });
}));

app.delete('/api/settings/:keyName', asyncHandler(async (req: Request, res: Response) => {
  const keyName = req.params.keyName;
  
  // Prevent deleting certificate renewal settings that are now in .env
  const envOnlySettings = ['CERT_RENEWAL_DAYS', 'CERT_WARNING_DAYS', 'CERT_CHECK_SCHEDULE'];
  if (envOnlySettings.includes(keyName)) {
    return res.status(400).json({ error: `${keyName} must be configured in the .env file` });
  }
  
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

// Test DNS provider connectivity
app.post('/api/settings/:provider/test', asyncHandler(async (req: Request, res: Response) => {
  const provider = req.params.provider;
  const settings = await database.getSettingsByProvider(provider);
  const getKey = (name: string) => settings.find(s => s.key_name === name)?.key_value;

  Logger.info(`Testing provider: ${provider}, found ${settings.length} settings: ${settings.map(s => s.key_name).join(', ')}`);

  try {
    switch (provider) {
      case 'cloudflare': {
        const apiKey = getKey('CF_KEY');
        const zoneId = getKey('CF_ZONE');
        if (!apiKey || !zoneId) {
          return res.json({ success: false, message: `Missing ${!apiKey ? 'CF_KEY' : ''}${!apiKey && !zoneId ? ' and ' : ''}${!zoneId ? 'CF_ZONE' : ''}` });
        }
        // Verify zone access to confirm credentials
        const cfResponse = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        const cfData = await cfResponse.json() as any;
        if (cfData.success && cfData.result?.name) {
          return res.json({ success: true, message: `Connected to zone: ${cfData.result.name}` });
        }
        return res.json({ success: false, message: cfData.errors?.[0]?.message || `HTTP ${cfResponse.status}: Authentication failed` });
      }
      case 'digitalocean': {
        const doKey = getKey('DO_KEY');
        if (!doKey) {
          return res.json({ success: false, message: 'Missing DO_KEY' });
        }
        const doResponse = await fetch('https://api.digitalocean.com/v2/account', {
          headers: { 'Authorization': `Bearer ${doKey}` }
        });
        if (doResponse.ok) {
          const doData = await doResponse.json() as any;
          return res.json({ success: true, message: `Connected as: ${doData.account?.email || 'verified'}` });
        }
        return res.json({ success: false, message: `HTTP ${doResponse.status}: Authentication failed` });
      }
      case 'route53': {
        const accessKey = getKey('AWS_ACCESS_KEY');
        const secretKey = getKey('AWS_SECRET_KEY');
        const zoneId = getKey('AWS_ZONE_ID');
        if (!accessKey || !secretKey || !zoneId) {
          return res.json({ success: false, message: 'Missing required AWS credentials' });
        }
        return res.json({ success: true, message: `Credentials present for zone ${zoneId}` });
      }
      case 'letsencrypt': {
        const email = getKey('LETSENCRYPT_EMAIL');
        if (!email) {
          return res.json({ success: false, message: 'Missing LETSENCRYPT_EMAIL' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.json({ success: false, message: `Invalid email format: ${email}` });
        }
        return res.json({ success: true, message: `Email valid: ${email}` });
      }
      case 'zerossl': {
        const key = getKey('ZEROSSL_KEY');
        if (!key) {
          return res.json({ success: false, message: 'Missing ZEROSSL_KEY' });
        }
        return res.json({ success: true, message: 'ZeroSSL API key present' });
      }
      case 'azure': {
        const subId = getKey('AZURE_SUBSCRIPTION_ID');
        const rg = getKey('AZURE_RESOURCE_GROUP');
        const zone = getKey('AZURE_ZONE_NAME');
        if (!subId || !rg || !zone) {
          return res.json({ success: false, message: 'Missing required Azure credentials' });
        }
        return res.json({ success: true, message: `Credentials present for zone ${zone}` });
      }
      case 'google': {
        const projectId = getKey('GOOGLE_PROJECT_ID');
        const zoneName = getKey('GOOGLE_ZONE_NAME');
        if (!projectId || !zoneName) {
          return res.json({ success: false, message: 'Missing required Google Cloud credentials' });
        }
        return res.json({ success: true, message: `Credentials present for project ${projectId}` });
      }
      case 'custom': {
        const dns1 = getKey('CUSTOM_DNS_SERVER_1');
        if (!dns1) {
          return res.json({ success: false, message: 'Missing CUSTOM_DNS_SERVER_1' });
        }
        return res.json({ success: true, message: `DNS server: ${dns1}` });
      }
      default:
        return res.json({ success: false, message: `Unknown provider: ${provider}` });
    }
  } catch (error: any) {
    Logger.error(`Provider test failed for ${provider}:`, error);
    return res.json({ success: false, message: error.message || 'Connection test failed' });
  }
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

  // Skip certificate checks for disabled connections
  if (!connection.is_enabled) {
    return res.status(200).json({ 
      error: 'Connection disabled',
      details: 'Certificate information not available for disabled connections'
    });
  }

  const domain = getDomainFromConnection(connection);
  if (!domain) {
    return res.status(400).json({ 
      error: 'Invalid connection configuration',
      details: 'Missing hostname/domain for certificate lookup'
    });
  }

  const certInfo = await getCertificateInfoWithFallback(domain, connection, database);
  
  if (!certInfo) {
    return res.status(404).json({ 
      error: 'Certificate not found',
      details: `Unable to retrieve certificate information for ${domain}`
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

  const certInfo = await getCertificateInfoWithFallback(hostname, null, database);
  
  if (!certInfo) {
    return res.status(404).json({ 
      error: 'Certificate not found',
      details: `Unable to retrieve certificate information for ${hostname}`
    });
  }

  return res.json(certInfo);
}));

// Get renewal logs for a specific connection
app.get('/api/data/:id/renewal-logs', asyncHandler(async (req: Request, res: Response) => {
  const connectionId = parseInt(req.params.id);
  
  if (isNaN(connectionId)) {
    return res.status(400).json({ error: 'Invalid connection ID parameter' });
  }

  try {
    const connection = await database.getConnectionById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const { getDomainFromConnection } = await import('./utils/domain-utils');
    const domain = getDomainFromConnection(connection);
    
    if (!domain) {
      return res.status(400).json({ error: 'Invalid domain configuration for this connection' });
    }
    
    const logs = await accountManager.getRenewalLog(connectionId, domain);
    
    return res.json({
      domain,
      logs,
      connection: {
        id: connection.id,
        name: connection.name,
        hostname: connection.hostname,
        domain: connection.domain
      }
    });
  } catch (error) {
    Logger.error('Error retrieving renewal logs:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// Get certificate metrics for a specific connection
app.get('/api/data/:id/metrics', asyncHandler(async (req: Request, res: Response) => {
  const connectionId = parseInt(req.params.id);
  const limit = parseInt(req.query.limit as string) || 100;
  const hours = parseInt(req.query.hours as string) || 24;
  
  if (isNaN(connectionId)) {
    return res.status(400).json({ error: 'Invalid connection ID parameter' });
  }

  try {
    const connection = await database.getConnectionById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const metrics = await database.getCertificateMetrics(connectionId, limit, hours);
    const averageMetrics = await database.getAverageMetrics(connectionId, hours);
    
    return res.json({
      connection: {
        id: connection.id,
        name: connection.name,
        hostname: connection.hostname
      },
      metrics,
      averageMetrics,
      timeRange: { hours, limit }
    });
  } catch (error) {
    Logger.error('Error retrieving certificate metrics:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// Get average metrics for a specific connection
app.get('/api/data/:id/metrics/average', asyncHandler(async (req: Request, res: Response) => {
  const connectionId = parseInt(req.params.id);
  const hours = parseInt(req.query.hours as string) || 24;
  
  if (isNaN(connectionId)) {
    return res.status(400).json({ error: 'Invalid connection ID parameter' });
  }

  try {
    const connection = await database.getConnectionById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const averageMetrics = await database.getAverageMetrics(connectionId, hours);
    
    return res.json({
      connection: {
        id: connection.id,
        name: connection.name,
        hostname: connection.hostname
      },
      averageMetrics,
      timeRange: { hours }
    });
  } catch (error) {
    Logger.error('Error retrieving average metrics:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// Get logs for all connections (for logs page)
// Get auto-renewal monitoring data
app.get('/api/auto-renewal/status', asyncHandler(async (req: Request, res: Response) => {
  try {
    const connections = await database.getAllConnections();
    
    // Filter to only connections with auto-renewal enabled
    const autoRenewConnections = connections.filter(conn => 
      conn.is_enabled && conn.auto_renew && conn.dns_provider !== 'custom'
    );
    
    // Calculate how many connections are actually due for renewal
    const renewalThresholdDays = parseInt(process.env.CERT_RENEWAL_DAYS || '7');
    const { getCertificateInfoWithFallback } = await import('./certificate');
    
    let connectionsDueForRenewal = 0;
    
    // Check each auto-renew connection to see if it's actually due for renewal
    for (const connection of autoRenewConnections) {
      try {
        const hostname = `${connection.hostname}.${connection.domain}`;
        const certInfo = await getCertificateInfoWithFallback(hostname, connection, database);
        
        if (certInfo && certInfo.daysUntilExpiry !== null && certInfo.daysUntilExpiry <= renewalThresholdDays) {
          connectionsDueForRenewal++;
        }
      } catch (error) {
        // If we can't get cert info, we can't determine if it's due for renewal
        Logger.debug(`Could not check certificate info for ${connection.hostname}.${connection.domain}: ${error}`);
      }
    }
    
    // Calculate next cron run time
    const cronSchedule = process.env.CERT_CHECK_SCHEDULE || '0 0 * * *';
    const nextRunTime = calculateNextCronRun(cronSchedule);
    
    const monitoring = {
      total_auto_renew_connections: autoRenewConnections.length,
      connections_due_for_renewal: connectionsDueForRenewal,
      cron_schedule: cronSchedule,
      next_run_time: nextRunTime,
      renewal_threshold_days: renewalThresholdDays,
      last_check_time: new Date().toISOString(), // This would be better stored in DB
      connections: autoRenewConnections.map(conn => ({
        id: conn.id,
        name: conn.name,
        hostname: conn.hostname,
        domain: conn.domain,
        auto_renew_status: conn.auto_renew_status || 'unknown',
        auto_renew_last_attempt: conn.auto_renew_last_attempt || 'never'
      }))
    };
    
    return res.json(monitoring);
  } catch (error: any) {
    Logger.error('Error getting auto-renewal status:', error);
    return res.status(500).json({ error: 'Failed to get auto-renewal status' });
  }
}));

app.get('/api/logs/all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const connections = await database.getAllConnections();
    const { AccountManager } = await import('./account-manager');
    const { getDomainFromConnection } = await import('./utils/domain-utils');
    const accountManager = new AccountManager();
    
    const logsData = await Promise.all(
      connections.map(async (connection) => {
        const domain = getDomainFromConnection(connection);
        
        if (!domain) {
          return {
            connection: {
              id: connection.id,
              name: connection.name,
              hostname: connection.hostname,
              domain: connection.domain,
              application_type: connection.application_type
            },
            domain: null,
            logs: [],
            hasLogs: false,
            error: 'Invalid domain configuration'
          };
        }
        
        try {
          const logs = await accountManager.getRenewalLog(connection.id!, domain);
          return {
            connection: {
              id: connection.id,
              name: connection.name,
              hostname: connection.hostname,
              domain: connection.domain,
              application_type: connection.application_type
            },
            domain,
            logs,
            hasLogs: logs.length > 0
          };
        } catch (error) {
          Logger.warn(`Failed to get logs for ${domain}:`, error);
          return {
            connection: {
              id: connection.id,
              name: connection.name,
              hostname: connection.hostname,
              domain: connection.domain,
              application_type: connection.application_type
            },
            domain,
            logs: [],
            hasLogs: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    return res.json({
      accounts: logsData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    Logger.error('Error retrieving all logs:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
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
  const { hostname, username, password, application_type } = req.body;

  if (!hostname || !username || !password) {
    return res.status(400).json({
      error: 'Missing required fields',
      details: 'hostname, username, and password are required'
    });
  }

  Logger.info(`Testing SSH connection to ${hostname} (type: ${application_type || 'vos'})`);

  try {
    const result = application_type === 'general'
      ? await SSHClient.testGenericConnection({ hostname, username, password })
      : await SSHClient.testConnection({ hostname, username, password });

    return res.json(result);
  } catch (error: any) {
    Logger.error(`SSH test failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during SSH test'
    });
  }
}));

// SSH test endpoint for specific connection
app.post('/api/data/:id/test-ssh', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  
  // Get connection details
  const connection = await database.getConnectionById(id);
  
  if (!connection) {
    return res.status(404).json({ 
      error: 'Connection not found' 
    });
  }
  
  if (!connection.username || !connection.password) {
    return res.status(400).json({ 
      error: 'Missing SSH credentials', 
      details: 'Username and password are required for SSH testing' 
    });
  }
  
  // Construct the FQDN
  const fqdn = connection.domain ? 
    `${connection.hostname}.${connection.domain}` : 
    connection.hostname;
  
  Logger.info(`Testing SSH connection to ${fqdn} for connection ${id}`);
  
  try {
    const result = connection.application_type === 'general'
      ? await SSHClient.testGenericConnection({ hostname: fqdn, username: connection.username, password: connection.password })
      : await SSHClient.testConnection({ hostname: fqdn, username: connection.username, password: connection.password });
    
    return res.json(result);
  } catch (error: any) {
    Logger.error(`SSH test failed for connection ${id}: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during SSH test'
    });
  }
}));

// Manual service restart endpoint for VOS applications with WebSocket support
app.post('/api/data/:id/restart-service', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID parameter' });
  }

  // Check for existing service restart operation
  const existingOperation = await operationManager.checkActiveOperation(id, 'service_restart');
  if (existingOperation) {
    return res.json({
      operationId: existingOperation.id,
      status: 'already_running',
      message: 'Service restart already in progress',
      progress: existingOperation.progress,
      startedAt: existingOperation.startedAt.toISOString()
    });
  }

  // Get the connection
  const connection = await database.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  // Check if SSH is enabled
  if (!connection.enable_ssh) {
    return res.status(400).json({ 
      error: 'SSH not enabled for this connection',
      details: 'SSH must be enabled to restart services remotely'
    });
  }

  // Check if this is a VOS application
  if (connection.application_type !== 'vos' && !connection.application_type) {
    return res.status(400).json({ 
      error: 'Service restart only supported for VOS applications',
      details: 'This endpoint is designed for Cisco VOS applications (CUCM, CUC, CER)'
    });
  }

  if (!connection.username || !connection.password) {
    return res.status(400).json({ 
      error: 'Missing credentials',
      details: 'Username and password are required for SSH connection'
    });
  }

  const fqdn = `${connection.hostname}.${connection.domain}`;
  Logger.info(`Manual Cisco Tomcat service restart requested for ${fqdn}`);

  try {
    // Start the operation
    const operation = await operationManager.startOperation(id, 'service_restart', 'user', {
      hostname: fqdn,
      command: 'utils service restart Cisco Tomcat'
    });

    // Return immediately with operation details
    res.json({
      operationId: operation.id,
      status: 'started',
      message: 'Service restart initiated',
      estimatedDuration: 600000 // 10 minutes
    });

    // Perform the restart asynchronously
    performServiceRestart(operation.id, connection, fqdn);

  } catch (error: any) {
    Logger.error(`Error starting service restart operation for ${fqdn}: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to start service restart operation',
      details: error.message
    });
  }
}));

// Async function to perform service restart with real-time updates
async function performServiceRestart(operationId: string, connection: any, fqdn: string) {
  const domain = getDomainFromConnection(connection);
  
  try {
    // Log restart initiation
    if (domain) {
      await accountManager.saveRenewalLog(connection.id, domain, `Service restart initiated for ${fqdn}`);
    }

    // Update to in_progress
    await operationManager.updateOperation(operationId, {
      status: 'in_progress',
      progress: 10,
      message: 'Testing SSH connection...'
    });

    if (domain) {
      await accountManager.saveRenewalLog(connection.id, domain, `Testing SSH connection to ${fqdn}...`);
    }

    // Test SSH connection first
    const sshTest = await SSHClient.testConnection({
      hostname: fqdn,
      username: connection.username,
      password: connection.password
    });

    if (!sshTest.success) {
      if (domain) {
        await accountManager.saveRenewalLog(connection.id, domain, `SSH connection failed: ${sshTest.error}`);
      }
      await operationManager.updateOperation(operationId, {
        status: 'failed',
        progress: 100,
        error: `SSH connection failed: ${sshTest.error}`
      });
      return;
    }

    if (domain) {
      await accountManager.saveRenewalLog(connection.id, domain, `SSH connection successful - admin user detected`);
    }

    await operationManager.updateOperation(operationId, {
      progress: 30,
      message: 'SSH connection successful. Starting Cisco Tomcat service restart...'
    });

    // Execute service restart command with progress updates
    // Start with progress at 50% since we're beginning the actual restart
    await operationManager.updateOperation(operationId, {
      progress: 50,
      message: 'Executing Cisco Tomcat service restart command...'
    });

    if (domain) {
      await accountManager.saveRenewalLog(connection.id, domain, `Executing command: utils service restart Cisco Tomcat`);
    }

    // Use the streaming version to get real-time updates
    const restartResult = await SSHClient.executeCommandWithStream({
      hostname: fqdn,
      username: connection.username,
      password: connection.password,
      command: 'utils service restart Cisco Tomcat',
      timeout: 600000, // 10 minutes (CUC Tomcat can be very slow)
      onData: async (chunk: string, totalOutput: string) => {
        // Log various status patterns we detect
        if (domain) {
          if (chunk.includes('[STOPPING]') || totalOutput.includes('Cisco Tomcat[STOPPING]')) {
            await accountManager.saveRenewalLog(connection.id, domain, `Detected Cisco Tomcat [STOPPING] - service is shutting down`);
          }
          if (chunk.includes('[STARTING]') || totalOutput.includes('Cisco Tomcat[STARTING]')) {
            await accountManager.saveRenewalLog(connection.id, domain, `Detected Cisco Tomcat [STARTING] - service is starting up`);
            Logger.info(`Detected Cisco Tomcat [STARTING] for ${fqdn}`);
            await operationManager.updateOperation(operationId, {
              progress: 75,
              message: 'Cisco Tomcat service is starting...'
            });
          }
          if (chunk.includes('[RUNNING]') || totalOutput.includes('Cisco Tomcat[RUNNING]')) {
            await accountManager.saveRenewalLog(connection.id, domain, `Detected Cisco Tomcat [RUNNING] - service is now running`);
          }
        }
      }
    });

    // Update progress to 90% while processing results
    await operationManager.updateOperation(operationId, {
      progress: 90,
      message: 'Processing restart results...'
    });

    if (restartResult.success) {
      if (domain) {
        await accountManager.saveRenewalLog(connection.id, domain, `Service restart completed successfully`);
      }
      await operationManager.updateOperation(operationId, {
        status: 'completed',
        progress: 100,
        message: 'Cisco Tomcat service restart completed successfully',
        metadata: {
          output: restartResult.output || 'Service restart command executed'
        }
      });
      Logger.info(`Successfully restarted Cisco Tomcat service for ${fqdn}`);
    } else {
      const isTimeout = restartResult.error?.includes('timeout');

      if (isTimeout) {
        if (domain) {
          await accountManager.saveRenewalLog(connection.id, domain, `Service restart initiated but confirmation timed out. The service is likely still restarting.`);
        }
        await operationManager.updateOperation(operationId, {
          status: 'completed',
          progress: 100,
          message: 'Service restart initiated - confirmation timed out. Manual verification recommended.',
          metadata: {
            output: restartResult.output,
            timedOut: true
          }
        });
        Logger.warn(`Service restart confirmation timed out for ${fqdn} - service is likely still restarting`);
      } else {
        if (domain) {
          await accountManager.saveRenewalLog(connection.id, domain, `Service restart failed: ${restartResult.error}`);
        }
        await operationManager.updateOperation(operationId, {
          status: 'failed',
          progress: 100,
          error: `Service restart failed: ${restartResult.error}`,
          metadata: {
            output: restartResult.output
          }
        });
        Logger.error(`Failed to restart Cisco Tomcat service for ${fqdn}: ${restartResult.error}`);
      }
    }

  } catch (error: any) {
    if (domain) {
      await accountManager.saveRenewalLog(connection.id, domain, `Internal error during service restart: ${error.message}`);
    }
    await operationManager.updateOperation(operationId, {
      status: 'failed',
      progress: 100,
      error: `Internal error during service restart: ${error.message}`
    });
    Logger.error(`Error during service restart operation ${operationId} for ${fqdn}: ${error.message}`);
  }
}

// CSR Generation endpoint
app.post('/api/generate-csr', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Validate the request
    const validationError = validateCSRRequest(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const csrRequest: CSRRequest = {
      commonName: req.body.commonName,
      country: req.body.country,
      state: req.body.state,
      locality: req.body.locality,
      organization: req.body.organization,
      organizationalUnit: req.body.organizationalUnit,
      keySize: req.body.keySize || 2048
    };

    Logger.info(`Generating CSR for CN=${csrRequest.commonName}`);

    const result = generateCSR(csrRequest);

    Logger.info(`CSR generated successfully for CN=${csrRequest.commonName}`);

    return res.json({
      success: true,
      data: result
    });

  } catch (error: any) {
    Logger.error(`CSR generation failed: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to generate CSR',
      details: error.message
    });
  }
}));

// Admin endpoints for monitoring active renewals
app.get('/api/admin/active-renewals', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Get all active operations of type certificate_renewal (only pending and in_progress)
    const activeOps = await database.getActiveOperationsByType(0, 'certificate_renewal', true);
    
    // Enrich with connection details
    const enrichedOps = await Promise.all(activeOps.map(async (op) => {
      const connection = await database.getConnectionById(op.connectionId);
      return {
        id: op.id,
        connectionId: op.connectionId,
        connectionName: connection?.name || 'Unknown',
        hostname: connection?.hostname || 'Unknown',
        type: op.type,
        status: op.status,
        progress: op.progress || 0,
        message: op.message || '',
        startedAt: op.startedAt ? new Date(op.startedAt).toISOString() : new Date().toISOString(),
        createdBy: op.createdBy || 'system',
        metadata: op.metadata
      };
    }));
    
    res.json(enrichedOps);
  } catch (error: any) {
    Logger.error('Failed to fetch active renewals:', error);
    res.status(500).json({ error: 'Failed to fetch active renewals' });
  }
}));

app.post('/api/admin/cancel-renewal/:renewalId', asyncHandler(async (req: Request, res: Response) => {
  const { renewalId } = req.params;
  
  try {
    // Get the operation to find connection ID
    const operations = await database.getActiveOperationsByType(0, '', false);
    const operation = operations.find(op => op.id === renewalId);
    
    if (!operation) {
      return res.status(404).json({ error: 'Renewal not found' });
    }
    
    // Mark the operation as cancelled
    await operationManager.updateOperation(renewalId, {
      status: 'failed',
      error: 'Cancelled by admin',
      message: 'Renewal cancelled by administrator'
    });
    
    // Cancel the actual renewal process if possible
    const renewalService = certificateRenewalService as any;
    if (renewalService.cancelRenewal) {
      await renewalService.cancelRenewal(renewalId);
    }
    
    // Emit WebSocket event
    const io = getWebSocketServer();
    if (io) {
      io.emit('admin:renewal:cancelled', renewalId);
      (io as any).emitToConnection(operation.connection_id, 'renewal:cancelled', {
        renewalId,
        message: 'Renewal cancelled by administrator'
      });
    }
    
    Logger.info(`Admin cancelled renewal ${renewalId} for connection ${operation.connection_id}`);
    res.json({ success: true, message: 'Renewal cancelled' });
  } catch (error: any) {
    Logger.error(`Failed to cancel renewal ${renewalId}:`, error);
    res.status(500).json({ error: 'Failed to cancel renewal' });
  }
}));

// Admin diagnostics endpoint
app.get('/api/admin/diagnostics', asyncHandler(async (req: Request, res: Response) => {
  try {
    // WebSocket client count
    const io = getWebSocketServer();
    const wsClientCount = io ? (io.engine as any).clientsCount ?? 0 : 0;

    // Permission checks — write test on accounts/, db/, logs/
    const directories: Record<string, string> = {
      accounts: process.env.ACCOUNTS_DIR || './accounts',
      db: './db',
      logs: process.env.LOG_DIR || './logs'
    };

    const permissionResults: Record<string, { readable: boolean; writable: boolean; exists: boolean; error?: string }> = {};

    for (const [name, dir] of Object.entries(directories)) {
      try {
        const resolvedDir = path.resolve(dir);
        const dirExists = fs.existsSync(resolvedDir);
        if (!dirExists) {
          permissionResults[name] = { exists: false, readable: false, writable: false, error: 'Directory does not exist' };
          continue;
        }

        let readable = false;
        try {
          fs.readdirSync(resolvedDir);
          readable = true;
        } catch { readable = false; }

        let writable = false;
        const testFile = path.join(resolvedDir, `.diagnostic-test-${Date.now()}.tmp`);
        try {
          fs.writeFileSync(testFile, 'diagnostic-test');
          const content = fs.readFileSync(testFile, 'utf-8');
          writable = content === 'diagnostic-test';
          fs.unlinkSync(testFile);
        } catch {
          writable = false;
          try { fs.unlinkSync(testFile); } catch {}
        }

        permissionResults[name] = { exists: true, readable, writable };
      } catch (error: any) {
        permissionResults[name] = { exists: false, readable: false, writable: false, error: error.message };
      }
    }

    // Process info
    const processInfo = {
      uid: process.getuid ? process.getuid() : null,
      gid: process.getgid ? process.getgid() : null,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      pid: process.pid
    };

    // Environment config (non-sensitive allowlist)
    const envConfig: Record<string, string> = {
      LETSENCRYPT_STAGING: process.env.LETSENCRYPT_STAGING || 'true',
      CERT_RENEWAL_DAYS: process.env.CERT_RENEWAL_DAYS || '7',
      CERT_CHECK_SCHEDULE: process.env.CERT_CHECK_SCHEDULE || '0 0 * * *',
      CERT_WARNING_DAYS: process.env.CERT_WARNING_DAYS || '30',
      LOG_TO_FILE: process.env.LOG_TO_FILE || 'false',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      NODE_ENV: process.env.NODE_ENV || 'development',
      PORT: process.env.PORT || '3000'
    };

    // Accounts directory stats
    const accountsDir = process.env.ACCOUNTS_DIR || './accounts';
    const accountsSize = getAccountsSize(accountsDir);

    res.json({
      websocket: { clientCount: wsClientCount },
      permissions: permissionResults,
      process: processInfo,
      environment: envConfig,
      accounts: {
        directory: accountsDir,
        totalFiles: accountsSize.totalFiles,
        totalSize: formatBytes(accountsSize.totalSize),
        totalSizeBytes: accountsSize.totalSize
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    Logger.error('Failed to run diagnostics:', error);
    res.status(500).json({ error: 'Failed to run diagnostics' });
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

// Create HTTP server
const httpServer = createServer(app);

// Initialize WebSocket server
const io = initializeWebSocket(httpServer, database);
operationManager.setSocketServer(io);

// Start server
httpServer.listen(PORT, '0.0.0.0', async () => {
  Logger.info(`Server running on port ${PORT}`);
  Logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  Logger.info('WebSocket server initialized');
  
  // Migrate account files to new structure
  const accountsDir = process.env.ACCOUNTS_DIR || './accounts';
  await migrateAccountFiles(accountsDir);
  
  // Check and download root certificates if missing
  const certStatus = checkRootCertificates(accountsDir);
  if (certStatus.missing.length > 0) {
    Logger.info(`Missing root certificates: ${certStatus.missing.join(', ')}`);
    Logger.info('Attempting to download missing root certificates...');
    await downloadAllRootCertificates(accountsDir);
  } else {
    Logger.info(`All root certificates present: ${certStatus.present.join(', ')}`);
  }
  
  // Check and create Let's Encrypt accounts on startup
  const accountChecker = new LetsEncryptAccountChecker(database);
  await accountChecker.checkAndCreateAccounts();
});

export default app;