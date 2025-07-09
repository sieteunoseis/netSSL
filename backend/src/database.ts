import sqlite3 from 'sqlite3';
import fs from 'fs';
import { ConnectionRecord, DatabaseError } from './types';
import { Logger } from './logger';
import bcrypt from 'bcrypt';

export class Database {
  private db: sqlite3.Database;
  private tableColumns: string[];

  constructor(dbPath: string, tableColumns: string[]) {
    this.tableColumns = tableColumns;
    
    // Ensure database directory exists
    const dbDir = './db';
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize database connection
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        Logger.error('Failed to connect to database:', err);
        throw err;
      }
      Logger.info('Connected to SQLite database');
    });

    this.initializeSchema();
  }

  private initializeSchema(): void {
    // First, check if table exists and get its schema
    this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='connections'", (err, row) => {
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

  private createTable(): void {
    const createTableQuery = `
      CREATE TABLE connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${this.tableColumns.map(col => `${col} TEXT`).join(', ')},
        password_hash TEXT,
        selected TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.run(createTableQuery, (err) => {
      if (err) {
        Logger.error('Failed to create table:', err);
        throw err;
      }
      Logger.info('Database table created with schema:', this.tableColumns);
    });
  }

  private migrateSchema(): void {
    // Get current table schema
    this.db.all("PRAGMA table_info(connections)", (err, columns: any[]) => {
      if (err) {
        Logger.error('Failed to get table info:', err);
        throw err;
      }

      const existingColumns = columns.map(col => col.name);
      const requiredColumns = ['id', ...this.tableColumns, 'password_hash', 'selected', 'created_at', 'updated_at'];
      
      // Check for missing columns
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
      
      if (missingColumns.length > 0) {
        Logger.info('Missing columns detected, adding:', missingColumns);
        this.addMissingColumns(missingColumns);
      } else {
        Logger.info('Database schema is up to date');
      }
    });
  }

  private addMissingColumns(missingColumns: string[]): void {
    let completed = 0;
    const total = missingColumns.length;

    missingColumns.forEach(column => {
      let columnDef = 'TEXT';
      if (column === 'created_at' || column === 'updated_at') {
        columnDef = 'DATETIME';
      }

      const alterQuery = `ALTER TABLE connections ADD COLUMN ${column} ${columnDef}`;
      
      this.db.run(alterQuery, (err) => {
        if (err) {
          Logger.error(`Failed to add column ${column}:`, err);
        } else {
          Logger.info(`Added column: ${column}`);
        }
        
        completed++;
        if (completed === total) {
          Logger.info('Schema migration completed');
        }
      });
    });
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
      // Get all columns except password_hash for security
      const baseColumns = ['id', ...this.tableColumns.filter(col => col !== 'password'), 'selected'];
      const query = `SELECT ${baseColumns.join(', ')} FROM connections`;
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          Logger.error('Failed to fetch connections:', err);
          reject(err);
        } else {
          Logger.debug(`Retrieved ${rows.length} connections`);
          
          // Add password placeholder for frontend display if password column exists in config
          const processedRows = rows.map((row: any) => {
            if (this.tableColumns.includes('password')) {
              return { ...row, password: '********' };
            }
            return row;
          });
          
          resolve(processedRows as ConnectionRecord[]);
        }
      });
    });
  }

  getConnectionById(id: number): Promise<ConnectionRecord | null> {
    return new Promise((resolve, reject) => {
      // Get all columns except password_hash for security
      const baseColumns = ['id', ...this.tableColumns.filter(col => col !== 'password'), 'selected'];
      const query = `SELECT ${baseColumns.join(', ')} FROM connections WHERE id = ?`;
      
      this.db.get(query, [id], (err, row) => {
        if (err) {
          Logger.error('Failed to fetch connection by ID:', err);
          reject(err);
        } else {
          Logger.debug(`Retrieved connection with ID: ${id}`);
          
          // Add password placeholder for frontend display if password column exists in config
          if (row && this.tableColumns.includes('password')) {
            (row as any).password = '********';
          }
          
          resolve(row as ConnectionRecord || null);
        }
      });
    });
  }

  getSelectedConnection(): Promise<ConnectionRecord | null> {
    return new Promise((resolve, reject) => {
      // Get all columns except password_hash for security
      const baseColumns = ['id', ...this.tableColumns.filter(col => col !== 'password'), 'selected'];
      const query = `SELECT ${baseColumns.join(', ')} FROM connections WHERE selected = "YES"`;
      
      this.db.get(query, [], (err, row) => {
        if (err) {
          Logger.error('Failed to fetch selected connection:', err);
          reject(err);
        } else {
          Logger.debug('Retrieved selected connection');
          
          // Add password placeholder for frontend display if password column exists in config
          if (row && this.tableColumns.includes('password')) {
            (row as any).password = '********';
          }
          
          resolve(row as ConnectionRecord || null);
        }
      });
    });
  }

  async createConnection(data: Omit<ConnectionRecord, 'id'>): Promise<number> {
    const hashedPassword = await this.hashPassword(data.password);
    
    return new Promise((resolve, reject) => {
      // Check if this is the first entry
      this.db.get('SELECT COUNT(*) AS count FROM connections', [], (err, row: any) => {
        if (err) {
          Logger.error('Failed to check connection count:', err);
          reject(err);
          return;
        }

        const isFirstEntry = row.count === 0;
        const selectedValue = isFirstEntry ? 'YES' : null;

        // Get column values excluding password (we store password_hash separately)
        const dataColumns = this.tableColumns.filter(col => col !== 'password');
        const columnValues = dataColumns.map(col => (data as any)[col] || null);

        const insertQuery = `
          INSERT INTO connections (${dataColumns.join(', ')}, password_hash, selected) 
          VALUES (${dataColumns.map(() => '?').join(', ')}, ?, ?)
        `;

        this.db.run(
          insertQuery,
          [...columnValues, hashedPassword, selectedValue],
          function (err) {
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
    });
  }

  deleteConnection(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if this is the selected connection before deleting
      this.db.get('SELECT selected FROM connections WHERE id = ?', [id], (err, row: any) => {
        if (err) {
          Logger.error('Failed to check if connection is selected:', err);
          reject(err);
          return;
        }

        const wasSelected = row?.selected === 'YES';

        this.db.run('DELETE FROM connections WHERE id = ?', [id], (err) => {
          if (err) {
            Logger.error('Failed to delete connection:', err);
            reject(err);
          } else {
            Logger.info(`Deleted connection with ID: ${id}`);
            
            // If the deleted connection was selected, auto-select the first remaining one
            if (wasSelected) {
              this.autoSelectFirstConnection().then(() => {
                resolve();
              }).catch((selectErr: any) => {
                Logger.warn('Failed to auto-select first connection after deletion:', selectErr);
                // Don't fail the delete operation if auto-selection fails
                resolve();
              });
            } else {
              resolve();
            }
          }
        });
      });
    });
  }

  private autoSelectFirstConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT id FROM connections ORDER BY id ASC LIMIT 1', [], (err, row: any) => {
        if (err) {
          reject(err);
          return;
        }

        if (row) {
          this.db.run('UPDATE connections SET selected = ? WHERE id = ?', ['YES', row.id], (err) => {
            if (err) {
              reject(err);
            } else {
              Logger.info(`Auto-selected connection with ID: ${row.id}`);
              resolve();
            }
          });
        } else {
          // No connections left, nothing to select
          resolve();
        }
      });
    });
  }

  selectConnection(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use a transaction to ensure atomicity
      this.db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          Logger.error('Failed to start transaction:', err);
          reject(err);
          return;
        }

        // First, verify the connection exists
        this.db.get('SELECT id FROM connections WHERE id = ?', [id], (err, row) => {
          if (err) {
            this.db.run('ROLLBACK');
            Logger.error('Failed to verify connection exists:', err);
            reject(err);
            return;
          }

          if (!row) {
            this.db.run('ROLLBACK');
            Logger.error(`Connection with ID ${id} not found`);
            reject(new Error(`Connection with ID ${id} not found`));
            return;
          }

          // Clear all selections
          this.db.run('UPDATE connections SET selected = NULL', [], (err) => {
            if (err) {
              this.db.run('ROLLBACK');
              Logger.error('Failed to clear selected connections:', err);
              reject(err);
              return;
            }

            // Set the new selection
            this.db.run('UPDATE connections SET selected = ? WHERE id = ?', ['YES', id], (err) => {
              if (err) {
                this.db.run('ROLLBACK');
                Logger.error('Failed to select connection:', err);
                reject(err);
              } else {
                // Commit the transaction
                this.db.run('COMMIT', (err) => {
                  if (err) {
                    Logger.error('Failed to commit transaction:', err);
                    reject(err);
                  } else {
                    Logger.info(`Selected connection with ID: ${id}`);
                    resolve();
                  }
                });
              }
            });
          });
        });
      });
    });
  }

  close(): void {
    this.db.close((err) => {
      if (err) {
        Logger.error('Failed to close database:', err);
      } else {
        Logger.info('Database connection closed');
      }
    });
  }
}