#!/usr/bin/env node
import { DatabaseManager } from './database';
import { Logger } from './logger';
import path from 'path';

// Script to clear stuck active operations
async function clearStuckOperations() {
  const dbPath = path.join(__dirname, '..', 'db', 'database.db');
  
  // Use the same hardcoded table columns as the server
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
    'ise_csr_source',
    'ise_csr_config',
    'general_private_key',
    'alt_names',
    'enable_ssh',
    'auto_restart_service',
    'auto_renew',
    'auto_renew_status',
    'auto_renew_last_attempt'
  ];
  
  const database = new DatabaseManager(dbPath, TABLE_COLUMNS);
  
  try {
    // Wait a moment for database initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Connected to database');

    // Get all active operations
    const activeOps = await database.getActiveOperationsByType(0, '', false);
    console.log(`\nFound ${activeOps.length} total operations`);

    // Filter for stuck operations (pending or in_progress)
    const stuckOps = activeOps.filter(op => 
      ['pending', 'in_progress'].includes(op.status)
    );

    console.log(`\nFound ${stuckOps.length} stuck operations:`);
    
    for (const op of stuckOps) {
      const ageMinutes = Math.floor((Date.now() - new Date(op.started_at).getTime()) / 1000 / 60);
      console.log(`\n- ID: ${op.id}`);
      console.log(`  Connection: ${op.connection_id}`);
      console.log(`  Type: ${op.operation_type}`);
      console.log(`  Status: ${op.status}`);
      console.log(`  Progress: ${op.progress}%`);
      console.log(`  Message: ${op.message}`);
      console.log(`  Started: ${op.started_at} (${ageMinutes} minutes ago)`);
      console.log(`  Created by: ${op.created_by}`);
    }

    if (stuckOps.length === 0) {
      console.log('\nNo stuck operations found.');
      process.exit(0);
    }

    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will mark these operations as failed.');
    console.log('Press Ctrl+C to cancel, or Enter to continue...');
    
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    // Update stuck operations to failed status
    for (const op of stuckOps) {
      console.log(`\nUpdating operation ${op.id} to failed status...`);
      await database.updateActiveOperation(op.id, {
        status: 'failed',
        progress: 100,
        error: 'Operation cancelled due to stuck state',
        completedAt: new Date()
      });
      console.log(`✓ Updated ${op.id}`);
    }

    console.log('\n✅ All stuck operations have been cleared.');
    
    // Optionally cleanup old completed operations
    console.log('\nCleaning up operations older than 24 hours...');
    await database.cleanupOldActiveOperations(24);
    console.log('✓ Cleanup complete');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    database.close();
    process.exit(0);
  }
}

// Enable stdin for user input
process.stdin.resume();
process.stdin.setEncoding('utf8');

// Run the script
clearStuckOperations();