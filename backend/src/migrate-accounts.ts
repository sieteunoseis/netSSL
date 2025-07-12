import fs from 'fs';
import path from 'path';
import { Logger } from './logger';

/**
 * Migrate existing account files from flat structure to organized domain/env structure
 * From: domain_provider_env.json
 * To: domain/env/provider.json
 */
export async function migrateAccountFiles(accountsDir: string): Promise<void> {
  const migrationMarkerPath = path.join(accountsDir, '.migration-complete');
  
  try {
    // Check if migration has already been completed
    if (fs.existsSync(migrationMarkerPath)) {
      Logger.debug('Account files migration already completed, skipping');
      return;
    }

    Logger.info('Starting account files migration...');
    
    if (!fs.existsSync(accountsDir)) {
      Logger.info('Accounts directory does not exist, no migration needed');
      return;
    }

    const files = await fs.promises.readdir(accountsDir);
    const oldFormatFiles = files.filter(file => 
      file.endsWith('.json') && file.includes('_') && (file.includes('_staging.json') || file.includes('_prod.json'))
    );

    if (oldFormatFiles.length === 0) {
      Logger.info('No old format account files found, migration not needed');
      return;
    }

    Logger.info(`Found ${oldFormatFiles.length} old format account files to migrate`);

    for (const file of oldFormatFiles) {
      try {
        const filePath = path.join(accountsDir, file);
        
        // Parse old filename: domain_provider_env.json
        const withoutExtension = file.replace('.json', '');
        const parts = withoutExtension.split('_');
        
        if (parts.length < 3) {
          Logger.warn(`Skipping invalid filename format: ${file}`);
          continue;
        }

        const env = parts[parts.length - 1]; // staging or prod
        const provider = parts[parts.length - 2]; // letsencrypt, zerossl, etc
        const domain = parts.slice(0, -2).join('_'); // everything else joined back

        if (!['staging', 'prod'].includes(env)) {
          Logger.warn(`Skipping unknown environment: ${env} in file ${file}`);
          continue;
        }

        // Create new directory structure
        const newDomainDir = path.join(accountsDir, domain);
        const newEnvDir = path.join(newDomainDir, env);
        
        if (!fs.existsSync(newDomainDir)) {
          await fs.promises.mkdir(newDomainDir, { recursive: true });
        }
        
        if (!fs.existsSync(newEnvDir)) {
          await fs.promises.mkdir(newEnvDir, { recursive: true });
        }

        // New file path
        const newFilePath = path.join(newEnvDir, `${provider}.json`);

        // Check if new file already exists
        if (fs.existsSync(newFilePath)) {
          Logger.warn(`Target file already exists, skipping: ${newFilePath}`);
          continue;
        }

        // Move the file
        await fs.promises.rename(filePath, newFilePath);
        Logger.info(`Migrated: ${file} -> ${domain}/${env}/${provider}.json`);

      } catch (error) {
        Logger.error(`Failed to migrate file ${file}:`, error);
      }
    }

    Logger.info('Account files migration completed');

    // Create a marker file to indicate migration is complete
    await fs.promises.writeFile(migrationMarkerPath, new Date().toISOString());

    // Schedule cleanup of migration script after successful migration
    setTimeout(() => {
      cleanupMigrationScript();
    }, 10000); // Clean up after 10 seconds

  } catch (error) {
    Logger.error('Error during account files migration:', error);
    throw error;
  }
}

/**
 * Clean up the migration script file after successful migration
 */
function cleanupMigrationScript(): void {
  try {
    const scriptPath = __filename;
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
      Logger.info('Migration script cleaned up successfully');
    }
  } catch (error) {
    Logger.debug('Could not clean up migration script (this is normal):', error);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  const accountsDir = process.env.ACCOUNTS_DIR || './accounts';
  migrateAccountFiles(path.resolve(accountsDir))
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}