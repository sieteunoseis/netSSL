import sqlite3 from 'sqlite3';
import fs from 'fs';
import { ConnectionRecord, DatabaseError } from './types';
import { Logger } from './logger';
import bcrypt from 'bcrypt';

export class DatabaseManager {
  private db: sqlite3.Database;
  private tableColumns: string[];

  constructor(dbPath: string, tableColumns: string[]) {
    this.tableColumns = tableColumns;
    
    // Ensure database directory exists
    const dbDir = './db';
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    Logger.info('Database path:', dbPath);
    Logger.info('Database directory:', dbDir);
    Logger.info('Current working directory:', process.cwd());

    // Initialize database connection
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        Logger.error('Failed to connect to database:', err);
        throw err;
      } else {
        Logger.info('Connected to SQLite database');
        // Create the table synchronously on startup
        this.createTableSync();
        // Run migration to ensure settings table exists
        this.initializeSchema();
      }
    });
  }

  private initializeSchema(): void {
    // First, check if table exists and get its schema
    this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='connections'", [], (err: any, row: any) => {
      if (err) {
        Logger.error('Failed to check table existence:', err);
        throw err;
      }
      
      if (!row) {
        // Table doesn't exist, create it
        this.createTable();
      } else {
        // Table exists, check and migrate schema if needed
        this.migrateSchema();
      }
    });
  }

  private createTableSync(): void {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${this.tableColumns.map(col => `${col} TEXT`).join(', ')},
        password_hash TEXT,
        last_cert_issued DATETIME,
        cert_count_this_week INTEGER DEFAULT 0,
        cert_count_reset_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createSettingsTableQuery = `
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_name TEXT UNIQUE NOT NULL,
        key_value TEXT NOT NULL,
        provider TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createRenewalStatusTableQuery = `
      CREATE TABLE IF NOT EXISTS renewal_status (
        renewal_id TEXT PRIMARY KEY,
        connection_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        current_step TEXT,
        message TEXT,
        error TEXT,
        logs TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
      )
    `;

    this.db.run(createTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create connections table:', err);
        throw err;
      } else {
        Logger.info('Database connections table created with schema:', this.tableColumns);
      }
    });

    this.db.run(createSettingsTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create settings table:', err);
        throw err;
      } else {
        Logger.info('Database settings table created');
      }
    });

    this.db.run(createRenewalStatusTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create renewal_status table:', err);
        throw err;
      } else {
        Logger.info('Database renewal_status table created');
      }
    });

    const createActiveOperationsTableQuery = `
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
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
      )
    `;

    this.db.run(createActiveOperationsTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create active_operations table:', err);
        throw err;
      } else {
        Logger.info('Database active_operations table created');
        
        // Create indexes for better performance
        const indexes = [
          'CREATE INDEX IF NOT EXISTS idx_active_operations_connection ON active_operations(connection_id)',
          'CREATE INDEX IF NOT EXISTS idx_active_operations_status ON active_operations(status)',
          'CREATE INDEX IF NOT EXISTS idx_active_operations_type_status ON active_operations(operation_type, status)'
        ];
        
        indexes.forEach(indexQuery => {
          this.db.run(indexQuery, [], (indexErr: any) => {
            if (indexErr) {
              Logger.error('Failed to create index:', indexErr);
            }
          });
        });
      }
    });

    const createCertificateMetricsTableQuery = `
      CREATE TABLE IF NOT EXISTS certificate_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        port INTEGER DEFAULT 443,
        check_type TEXT NOT NULL, -- 'live_tls' or 'file_based'
        dns_resolve_time INTEGER, -- milliseconds
        tcp_connect_time INTEGER, -- milliseconds
        tls_handshake_time INTEGER, -- milliseconds
        certificate_processing_time INTEGER, -- milliseconds
        total_time INTEGER, -- milliseconds
        key_algorithm TEXT,
        key_size INTEGER,
        signature_algorithm TEXT,
        certificate_valid BOOLEAN,
        days_until_expiry INTEGER,
        error_message TEXT,
        checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
      )
    `;

    this.db.run(createCertificateMetricsTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create certificate_metrics table:', err);
        throw err;
      } else {
        Logger.info('Database certificate_metrics table created');
        
        // Create indexes for better performance
        const metricsIndexes = [
          'CREATE INDEX IF NOT EXISTS idx_certificate_metrics_connection ON certificate_metrics(connection_id)',
          'CREATE INDEX IF NOT EXISTS idx_certificate_metrics_checked_at ON certificate_metrics(checked_at)',
          'CREATE INDEX IF NOT EXISTS idx_certificate_metrics_hostname ON certificate_metrics(hostname)',
          'CREATE INDEX IF NOT EXISTS idx_certificate_metrics_connection_time ON certificate_metrics(connection_id, checked_at)'
        ];
        
        metricsIndexes.forEach(indexQuery => {
          this.db.run(indexQuery, [], (indexErr: any) => {
            if (indexErr) {
              Logger.error('Failed to create certificate_metrics index:', indexErr);
            }
          });
        });
      }
    });
  }

  private createTable(): void {
    const createTableQuery = `
      CREATE TABLE connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${this.tableColumns.map(col => `${col} TEXT`).join(', ')},
        password_hash TEXT,
        last_cert_issued DATETIME,
        cert_count_this_week INTEGER DEFAULT 0,
        cert_count_reset_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createSettingsTableQuery = `
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_name TEXT UNIQUE NOT NULL,
        key_value TEXT NOT NULL,
        provider TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createRenewalStatusTableQuery = `
      CREATE TABLE renewal_status (
        renewal_id TEXT PRIMARY KEY,
        connection_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        current_step TEXT,
        message TEXT,
        error TEXT,
        logs TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
      )
    `;

    this.db.run(createTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create connections table:', err);
        throw err;
      } else {
        Logger.info('Database connections table created with schema:', this.tableColumns);
      }
    });

    this.db.run(createSettingsTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create settings table:', err);
        throw err;
      } else {
        Logger.info('Database settings table created');
      }
    });

    this.db.run(createRenewalStatusTableQuery, [], (err: any) => {
      if (err) {
        Logger.error('Failed to create renewal_status table:', err);
        throw err;
      } else {
        Logger.info('Database renewal_status table created');
      }
    });
  }

  private migrateSchema(): void {
    // Get current table schema for connections
    this.db.all("PRAGMA table_info(connections)", [], (err: any, columns: any[]) => {
      if (err) {
        Logger.error('Failed to get table info:', err);
        throw err;
      }
      
      const existingColumns = columns.map((col: any) => col.name);
      const requiredColumns = ['id', ...this.tableColumns, 'password_hash', 'application_type', 'custom_csr', 'is_enabled', 'last_cert_issued', 'cert_count_this_week', 'cert_count_reset_date', 'created_at', 'updated_at'];
      
      // Check for missing columns
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
      
      if (missingColumns.length > 0) {
        Logger.info('Missing columns detected, adding:', missingColumns);
        this.addMissingColumns(missingColumns);
      } else {
        Logger.info('Database connections schema is up to date');
      }
    });

    // Check if settings table exists
    this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'", [], (err: any, row: any) => {
      if (err) {
        Logger.error('Failed to check settings table existence:', err);
        throw err;
      }
      
      if (!row) {
        // Settings table doesn't exist, create it
        const createSettingsTableQuery = `
          CREATE TABLE settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_name TEXT UNIQUE NOT NULL,
            key_value TEXT NOT NULL,
            provider TEXT NOT NULL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `;

        this.db.run(createSettingsTableQuery, [], (err: any) => {
          if (err) {
            Logger.error('Failed to create settings table during migration:', err);
            throw err;
          } else {
            Logger.info('Settings table created during migration');
          }
        });
      } else {
        Logger.info('Settings table already exists');
      }
    });
  }

  private addMissingColumns(missingColumns: string[]): void {
    missingColumns.forEach(column => {
      let columnDef = 'TEXT';
      if (column === 'created_at' || column === 'updated_at' || column === 'last_cert_issued' || column === 'cert_count_reset_date') {
        columnDef = 'DATETIME';
      } else if (column === 'cert_count_this_week') {
        columnDef = 'INTEGER DEFAULT 0';
      } else if (column === 'application_type') {
        columnDef = 'TEXT DEFAULT "vos"';
      } else if (column === 'custom_csr') {
        columnDef = 'TEXT';
      } else if (column === 'is_enabled') {
        columnDef = 'INTEGER DEFAULT 1';
      } else if (column === 'dns_challenge_mode') {
        columnDef = 'TEXT DEFAULT "auto"';
      }

      const alterQuery = `ALTER TABLE connections ADD COLUMN ${column} ${columnDef}`;
      
      this.db.run(alterQuery, [], (err: any) => {
        if (err) {
          Logger.error(`Failed to add column ${column}:`, err);
        } else {
          Logger.info(`Added column: ${column}`);
        }
      });
    });
    Logger.info('Schema migration completed');
  }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  getAllConnections(): Promise<ConnectionRecord[]> {
    return new Promise((resolve, reject) => {
      // Get all columns including password for API functionality
      const baseColumns = ['id', ...this.tableColumns, 'application_type', 'custom_csr', 'is_enabled', 'last_cert_issued', 'cert_count_this_week', 'cert_count_reset_date', 'created_at', 'updated_at'];
      const query = `SELECT ${baseColumns.join(', ')} FROM connections`;
      
      this.db.all(query, [], (err: any, rows: any[]) => {
        if (err) {
          Logger.error('Failed to fetch connections:', err);
          reject(err);
        } else {
          Logger.debug(`Retrieved ${rows.length} connections`);
          // Convert integer/string boolean values back to booleans for API consistency
          const convertedRows = rows.map((row: any) => {
            if (row.is_enabled !== undefined) {
              row.is_enabled = Boolean(row.is_enabled);
            }
            if (row.auto_renew !== undefined && row.auto_renew !== null) {
              // Convert SQLite boolean values: "0"/"1" or 0/1 to proper boolean
              row.auto_renew = !!(Number(row.auto_renew));
            } else {
              row.auto_renew = false;
            }
            if (row.auto_restart_service !== undefined) {
              row.auto_restart_service = !!(Number(row.auto_restart_service));
            }
            if (row.enable_ssh !== undefined) {
              row.enable_ssh = !!(Number(row.enable_ssh));
            }
            return row;
          });
          resolve(convertedRows as ConnectionRecord[]);
        }
      });
    });
  }

  getConnectionById(id: number): Promise<ConnectionRecord | null> {
    return new Promise((resolve, reject) => {
      // Get all columns including password for API functionality
      const baseColumns = ['id', ...this.tableColumns, 'application_type', 'custom_csr', 'is_enabled', 'last_cert_issued', 'cert_count_this_week', 'cert_count_reset_date', 'created_at', 'updated_at'];
      const query = `SELECT ${baseColumns.join(', ')} FROM connections WHERE id = ?`;
      
      this.db.get(query, [id], (err: any, row: any) => {
        if (err) {
          Logger.error('Failed to fetch connection by ID:', err);
          reject(err);
        } else {
          Logger.debug(`Retrieved connection with ID: ${id}`);
          // Convert integer/string boolean values back to booleans for API consistency
          if (row) {
            if (row.is_enabled !== undefined) {
              row.is_enabled = Boolean(row.is_enabled);
            }
            if (row.auto_renew !== undefined && row.auto_renew !== null) {
              // Convert SQLite boolean values: "0"/"1" or 0/1 to proper boolean
              row.auto_renew = !!(Number(row.auto_renew));
            } else {
              row.auto_renew = false;
            }
            if (row.auto_restart_service !== undefined) {
              row.auto_restart_service = !!(Number(row.auto_restart_service));
            }
            if (row.enable_ssh !== undefined) {
              row.enable_ssh = !!(Number(row.enable_ssh));
            }
          }
          resolve(row as ConnectionRecord || null);
        }
      });
    });
  }

  async createConnection(data: Omit<ConnectionRecord, 'id'>): Promise<number> {
    // For CUCM API automation, store password directly since we need it for API calls
    // This is less secure but necessary for automation tools
    const hashedPassword = data.password ? await this.hashPassword(data.password) : null;
    
    return new Promise((resolve, reject) => {
      // Include all columns including the newer fields
      const allColumns = [...this.tableColumns, 'application_type', 'custom_csr', 'is_enabled'];
      const columnValues = allColumns.map(col => (data as any)[col] || null);

      const insertQuery = `
        INSERT INTO connections (${allColumns.join(', ')}, password_hash) 
        VALUES (${allColumns.map(() => '?').join(', ')}, ?)
      `;

      this.db.run(
        insertQuery,
        [...columnValues, hashedPassword],
        function (this: any, err: any) {
          if (err) {
            Logger.error('Failed to create connection:', err);
            reject(err);
          } else {
            Logger.info(`Created connection with ID: ${this.lastID}`);
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async updateConnection(id: number, data: Partial<ConnectionRecord>): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Only update columns that are provided in data (excluding password and id)
        const dataColumns = this.tableColumns.filter(col => col !== 'password');
        // Add the new fields that were added later
        const allUpdateableColumns = [...dataColumns, 'application_type', 'custom_csr', 'is_enabled'];
        const updateColumns: string[] = [];
        const updateValues: any[] = [];
        
        // Only include columns that are actually provided in the data
        for (const col of allUpdateableColumns) {
          if ((data as any)[col] !== undefined) {
            updateColumns.push(col);
            updateValues.push((data as any)[col]);
          }
        }
        
        Logger.info(`Update columns for connection ${id}:`, { 
          updateColumns, 
          updateValues,
          allUpdateableColumns,
          providedData: Object.keys(data)
        });
        
        // Handle password update if provided
        if (data.password) {
          const hashedPassword = await this.hashPassword(data.password);
          updateColumns.push('password_hash');
          updateValues.push(hashedPassword);
        }

        // Always update the timestamp
        updateColumns.push('updated_at');
        updateValues.push(new Date().toISOString());

        // Skip update if no columns to update (besides timestamp)
        if (updateColumns.length <= 1) {
          Logger.warn(`No columns to update for connection ${id}`);
          resolve();
          return;
        }

        const updateQuery = `
          UPDATE connections 
          SET ${updateColumns.map(col => `${col} = ?`).join(', ')}
          WHERE id = ?
        `;

        this.db.run(
          updateQuery,
          [...updateValues, id],
          function (this: any, err: any) {
            if (err) {
              Logger.error('Failed to update connection:', err);
              reject(err);
            } else {
              Logger.info(`Updated connection with ID: ${id}`);
              resolve();
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  deleteConnection(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM connections WHERE id = ?', [id], (err: any) => {
        if (err) {
          Logger.error('Failed to delete connection:', err);
          reject(err);
        } else {
          Logger.info(`Deleted connection with ID: ${id}`);
          resolve();
        }
      });
    });
  }


  // Settings/API Keys management
  async getSetting(keyName: string): Promise<{ key_value: string; provider: string; description?: string } | null> {
    return new Promise((resolve, reject) => {
      const query = `SELECT key_value, provider, description FROM settings WHERE key_name = ?`;
      
      this.db.get(query, [keyName], (err: any, row: any) => {
        if (err) {
          Logger.error('Failed to fetch setting:', err);
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  async getAllSettings(): Promise<{ key_name: string; provider: string; description?: string; has_value: boolean }[]> {
    return new Promise((resolve, reject) => {
      const query = `SELECT key_name, provider, description, CASE WHEN key_value IS NOT NULL AND key_value != '' THEN 1 ELSE 0 END as has_value FROM settings`;
      
      this.db.all(query, [], (err: any, rows: any[]) => {
        if (err) {
          Logger.error('Failed to fetch settings:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async upsertSetting(keyName: string, keyValue: string, provider: string, description?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO settings (key_name, key_value, provider, description, updated_at) 
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key_name) DO UPDATE SET 
          key_value = excluded.key_value,
          provider = excluded.provider,
          description = excluded.description,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      this.db.run(query, [keyName, keyValue, provider, description], (err: any) => {
        if (err) {
          Logger.error('Failed to upsert setting:', err);
          reject(err);
        } else {
          Logger.info(`Upserted setting: ${keyName} for provider: ${provider}`);
          resolve();
        }
      });
    });
  }

  async deleteSetting(keyName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM settings WHERE key_name = ?', [keyName], (err: any) => {
        if (err) {
          Logger.error('Failed to delete setting:', err);
          reject(err);
        } else {
          Logger.info(`Deleted setting: ${keyName}`);
          resolve();
        }
      });
    });
  }

  async getSettingsByProvider(provider: string): Promise<{ key_name: string; key_value: string; description?: string }[]> {
    return new Promise((resolve, reject) => {
      const query = `SELECT key_name, key_value, description FROM settings WHERE provider = ?`;
      
      this.db.all(query, [provider], (err: any, rows: any[]) => {
        if (err) {
          Logger.error('Failed to fetch settings by provider:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async saveRenewalStatus(renewalId: string, connectionId: number, status: string, currentStep?: string, message?: string, error?: string, logs?: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT OR REPLACE INTO renewal_status (renewal_id, connection_id, status, current_step, message, error, logs, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      
      const logsJson = logs ? JSON.stringify(logs) : null;
      
      this.db.run(query, [renewalId, connectionId, status, currentStep, message, error, logsJson], (err: any) => {
        if (err) {
          Logger.error('Failed to save renewal status:', err);
          reject(err);
        } else {
          Logger.debug(`Saved renewal status: ${renewalId} - ${status}`);
          resolve();
        }
      });
    });
  }

  async getRenewalStatus(renewalId: string): Promise<any | null> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM renewal_status WHERE renewal_id = ?';
      
      this.db.get(query, [renewalId], (err: any, row: any) => {
        if (err) {
          Logger.error('Failed to get renewal status:', err);
          reject(err);
        } else if (row) {
          // Parse logs from JSON
          if (row.logs) {
            try {
              row.logs = JSON.parse(row.logs);
            } catch (e) {
              row.logs = [];
            }
          }
          resolve(row);
        } else {
          resolve(null);
        }
      });
    });
  }

  async deleteRenewalStatus(renewalId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM renewal_status WHERE renewal_id = ?', [renewalId], (err: any) => {
        if (err) {
          Logger.error('Failed to delete renewal status:', err);
          reject(err);
        } else {
          Logger.debug(`Deleted renewal status: ${renewalId}`);
          resolve();
        }
      });
    });
  }

  async cleanupOldRenewalStatuses(hoursOld: number = 24): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `DELETE FROM renewal_status WHERE created_at < datetime('now', '-${hoursOld} hours')`;
      
      this.db.run(query, [], (err: any) => {
        if (err) {
          Logger.error('Failed to cleanup old renewal statuses:', err);
          reject(err);
        } else {
          Logger.debug(`Cleaned up renewal statuses older than ${hoursOld} hours`);
          resolve();
        }
      });
    });
  }

  // Active Operations Management
  async saveActiveOperation(
    id: string,
    connectionId: number,
    operationType: string,
    status: string = 'pending',
    progress: number = 0,
    message?: string,
    error?: string,
    metadata?: any,
    createdBy: string = 'user'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT OR REPLACE INTO active_operations 
        (id, connection_id, operation_type, status, progress, message, error, metadata, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const metadataJson = metadata ? JSON.stringify(metadata) : null;
      
      this.db.run(query, [id, connectionId, operationType, status, progress, message, error, metadataJson, createdBy], (err: any) => {
        if (err) {
          Logger.error('Failed to save active operation:', err);
          reject(err);
        } else {
          Logger.debug(`Saved active operation: ${id}`);
          resolve();
        }
      });
    });
  }

  async updateActiveOperation(
    id: string,
    updates: {
      status?: string;
      progress?: number;
      message?: string;
      error?: string;
      metadata?: any;
      completedAt?: Date;
    }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const fields: string[] = [];
      const values: any[] = [];
      
      if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
      }
      
      if (updates.progress !== undefined) {
        fields.push('progress = ?');
        values.push(updates.progress);
      }
      
      if (updates.message !== undefined) {
        fields.push('message = ?');
        values.push(updates.message);
      }
      
      if (updates.error !== undefined) {
        fields.push('error = ?');
        values.push(updates.error);
      }
      
      if (updates.metadata !== undefined) {
        fields.push('metadata = ?');
        values.push(JSON.stringify(updates.metadata));
      }
      
      if (updates.completedAt) {
        fields.push('completed_at = ?');
        values.push(updates.completedAt.toISOString());
      }
      
      if (updates.status === 'completed' || updates.status === 'failed') {
        fields.push('completed_at = ?');
        values.push(new Date().toISOString());
      }
      
      values.push(id);
      
      const query = `UPDATE active_operations SET ${fields.join(', ')} WHERE id = ?`;
      
      this.db.run(query, values, (err: any) => {
        if (err) {
          Logger.error('Failed to update active operation:', err);
          reject(err);
        } else {
          Logger.debug(`Updated active operation: ${id}`);
          resolve();
        }
      });
    });
  }

  async getActiveOperation(id: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM active_operations WHERE id = ?', [id], (err: any, row: any) => {
        if (err) {
          Logger.error('Failed to get active operation:', err);
          reject(err);
        } else if (row) {
          // Parse metadata from JSON
          if (row.metadata) {
            try {
              row.metadata = JSON.parse(row.metadata);
            } catch (e) {
              row.metadata = null;
            }
          }
          resolve(row);
        } else {
          resolve(null);
        }
      });
    });
  }

  async getActiveOperationsByConnection(connectionId: number, operationType?: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM active_operations WHERE connection_id = ?';
      const params: any[] = [connectionId];
      
      if (operationType) {
        query += ' AND operation_type = ?';
        params.push(operationType);
      }
      
      query += ' ORDER BY started_at DESC';
      
      this.db.all(query, params, (err: any, rows: any[]) => {
        if (err) {
          Logger.error('Failed to get active operations by connection:', err);
          reject(err);
        } else {
          const operations = rows.map(row => {
            if (row.metadata) {
              try {
                row.metadata = JSON.parse(row.metadata);
              } catch (e) {
                row.metadata = null;
              }
            }
            // Transform snake_case to camelCase for frontend compatibility
            return {
              id: row.id,
              connectionId: row.connection_id,
              type: row.operation_type,
              status: row.status,
              progress: row.progress,
              message: row.message,
              error: row.error,
              startedAt: row.started_at,
              completedAt: row.completed_at,
              metadata: row.metadata,
              createdBy: row.created_by
            };
          });
          resolve(operations);
        }
      });
    });
  }

  async getActiveOperationsByType(connectionId: number, operationType: string, activeOnly: boolean = true): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM active_operations WHERE';
      const params: any[] = [];
      
      // If connectionId is 0, get operations for all connections
      if (connectionId === 0) {
        if (operationType) {
          query += ' operation_type = ?';
          params.push(operationType);
        } else {
          query += ' 1=1'; // Get all operations
        }
      } else {
        query += ' connection_id = ?';
        params.push(connectionId);
        if (operationType) {
          query += ' AND operation_type = ?';
          params.push(operationType);
        }
      }
      
      if (activeOnly) {
        query += ' AND status IN (?, ?)';
        params.push('pending', 'in_progress');
      }
      
      query += ' ORDER BY started_at DESC';
      
      this.db.all(query, params, (err: any, rows: any[]) => {
        if (err) {
          Logger.error('Failed to get active operations by type:', err);
          reject(err);
        } else {
          const operations = rows.map(row => {
            if (row.metadata) {
              try {
                row.metadata = JSON.parse(row.metadata);
              } catch (e) {
                row.metadata = null;
              }
            }
            // Transform snake_case to camelCase for frontend compatibility
            return {
              id: row.id,
              connectionId: row.connection_id,
              type: row.operation_type,
              status: row.status,
              progress: row.progress,
              message: row.message,
              error: row.error,
              startedAt: row.started_at,
              completedAt: row.completed_at,
              metadata: row.metadata,
              createdBy: row.created_by
            };
          });
          resolve(operations);
        }
      });
    });
  }

  async deleteActiveOperation(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM active_operations WHERE id = ?', [id], (err: any) => {
        if (err) {
          Logger.error('Failed to delete active operation:', err);
          reject(err);
        } else {
          Logger.debug(`Deleted active operation: ${id}`);
          resolve();
        }
      });
    });
  }

  async cleanupOldActiveOperations(hoursOld: number = 24): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `DELETE FROM active_operations WHERE completed_at < datetime('now', '-${hoursOld} hours')`;
      
      this.db.run(query, [], (err: any) => {
        if (err) {
          Logger.error('Failed to cleanup old active operations:', err);
          reject(err);
        } else {
          Logger.debug(`Cleaned up active operations older than ${hoursOld} hours`);
          resolve();
        }
      });
    });
  }

  close(): void {
    this.db.close((err: any) => {
      if (err) {
        Logger.error('Failed to close database:', err);
      } else {
        Logger.info('Database connection closed');
      }
    });
  }

  // Certificate Metrics Management
  async saveCertificateMetrics(
    connectionId: number,
    hostname: string,
    port: number,
    checkType: 'live_tls' | 'file_based',
    timings?: {
      dnsResolve?: number;
      tcpConnect?: number;
      tlsHandshake?: number;
      certificateProcessing?: number;
      totalTime?: number;
    },
    keyAlgorithm?: string,
    keySize?: number,
    signatureAlgorithm?: string,
    certificateValid?: boolean,
    daysUntilExpiry?: number,
    errorMessage?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO certificate_metrics (
          connection_id, hostname, port, check_type,
          dns_resolve_time, tcp_connect_time, tls_handshake_time, 
          certificate_processing_time, total_time,
          key_algorithm, key_size, signature_algorithm,
          certificate_valid, days_until_expiry, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(query, [
        connectionId, hostname, port, checkType,
        timings?.dnsResolve, timings?.tcpConnect, timings?.tlsHandshake,
        timings?.certificateProcessing, timings?.totalTime,
        keyAlgorithm, keySize, signatureAlgorithm,
        certificateValid, daysUntilExpiry, errorMessage
      ], (err: any) => {
        if (err) {
          Logger.error('Failed to save certificate metrics:', err);
          reject(err);
        } else {
          Logger.debug(`Saved certificate metrics for ${hostname}:${port}`);
          resolve();
        }
      });
    });
  }

  async getCertificateMetrics(
    connectionId: number,
    limit: number = 100,
    hours: number = 24
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM certificate_metrics 
        WHERE connection_id = ? 
        AND checked_at >= datetime('now', '-${hours} hours')
        ORDER BY checked_at DESC 
        LIMIT ?
      `;

      this.db.all(query, [connectionId, limit], (err: any, rows: any[]) => {
        if (err) {
          Logger.error('Failed to get certificate metrics:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getAllCertificateMetrics(
    limit: number = 1000,
    hours: number = 24
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT cm.*, c.name as connection_name 
        FROM certificate_metrics cm
        LEFT JOIN connections c ON cm.connection_id = c.id
        WHERE cm.checked_at >= datetime('now', '-${hours} hours')
        ORDER BY cm.checked_at DESC 
        LIMIT ?
      `;

      this.db.all(query, [limit], (err: any, rows: any[]) => {
        if (err) {
          Logger.error('Failed to get all certificate metrics:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getAverageMetrics(
    connectionId: number,
    hours: number = 24
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          AVG(dns_resolve_time) as avg_dns_resolve_time,
          AVG(tcp_connect_time) as avg_tcp_connect_time,
          AVG(tls_handshake_time) as avg_tls_handshake_time,
          AVG(certificate_processing_time) as avg_certificate_processing_time,
          AVG(total_time) as avg_total_time,
          COUNT(*) as check_count,
          MAX(checked_at) as last_check
        FROM certificate_metrics 
        WHERE connection_id = ? 
        AND checked_at >= datetime('now', '-${hours} hours')
        AND check_type = 'live_tls'
      `;

      this.db.get(query, [connectionId], (err: any, row: any) => {
        if (err) {
          Logger.error('Failed to get average metrics:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async cleanupOldCertificateMetrics(daysOld: number = 30): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `DELETE FROM certificate_metrics WHERE checked_at < datetime('now', '-${daysOld} days')`;
      
      this.db.run(query, [], (err: any) => {
        if (err) {
          Logger.error('Failed to cleanup old certificate metrics:', err);
          reject(err);
        } else {
          Logger.debug(`Cleaned up certificate metrics older than ${daysOld} days`);
          resolve();
        }
      });
    });
  }
}