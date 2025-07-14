import sqlite3 from 'sqlite3';
import { Logger } from '../logger';

export function createActiveOperationsTable(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS active_operations (
        id TEXT PRIMARY KEY,
        connection_id INTEGER NOT NULL,
        operation_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        progress INTEGER DEFAULT 0,
        message TEXT,
        error TEXT,
        metadata TEXT,
        created_by TEXT DEFAULT 'user',
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
        CHECK (operation_type IN ('ssh_test', 'service_restart', 'certificate_renewal')),
        CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
        CHECK (created_by IN ('user', 'cron', 'auto'))
      )
    `;

    db.run(createTableQuery, [], (err) => {
      if (err) {
        Logger.error('Failed to create active_operations table:', err);
        reject(err);
      } else {
        Logger.info('Created active_operations table successfully');
        
        // Create indexes for better query performance
        const createIndexes = [
          `CREATE INDEX IF NOT EXISTS idx_active_operations_connection 
           ON active_operations(connection_id)`,
          `CREATE INDEX IF NOT EXISTS idx_active_operations_status 
           ON active_operations(status)`,
          `CREATE INDEX IF NOT EXISTS idx_active_operations_type_status 
           ON active_operations(operation_type, status)`
        ];

        let completed = 0;
        createIndexes.forEach(indexQuery => {
          db.run(indexQuery, [], (indexErr) => {
            if (indexErr) {
              Logger.error('Failed to create index:', indexErr);
            }
            completed++;
            if (completed === createIndexes.length) {
              resolve();
            }
          });
        });
      }
    });
  });
}