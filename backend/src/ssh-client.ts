import { Client } from 'ssh2';
import { Logger } from './logger';

export interface SSHTestParams {
  hostname: string;
  username: string;
  password: string;
  port?: number;
}

export interface SSHTestResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface SSHCommandParams extends SSHTestParams {
  command: string;
  timeout?: number; // Optional timeout in milliseconds, defaults to 60 seconds
}

export interface SSHCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface SSHStreamCommandParams extends SSHCommandParams {
  onData?: (chunk: string, totalOutput: string) => void;
}

export interface SSHStreamCommandResult extends SSHCommandResult {
  output: string;
}

export class SSHClient {
  private client: Client | null = null;
  private isConnected = false;

  /**
   * Connect to an SSH server (instance method)
   * @param config Connection configuration
   */
  async connect(config: { host: string; username: string; password: string; port?: number; algorithms?: any }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new Client();
      
      this.client.on('ready', () => {
        this.isConnected = true;
        resolve();
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        reject(err);
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      const connectConfig: any = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 30000,
        keepaliveInterval: 5000
      };

      // Only add algorithms if they are provided
      if (config.algorithms) {
        connectConfig.algorithms = config.algorithms;
      }

      this.client.connect(connectConfig);
    });
  }

  /**
   * Execute a command on the connected SSH server (instance method)
   * @param command Command to execute
   * @returns Command output
   */
  async executeCommand(command: string): Promise<string> {
    if (!this.client || !this.isConnected) {
      throw new Error('SSH client is not connected');
    }

    return new Promise((resolve, reject) => {
      this.client!.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
          } else {
            resolve(stdout);
          }
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Disconnect from the SSH server (instance method)
   */
  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      this.client.end();
      this.isConnected = false;
      this.client = null;
    }
  }

  /**
   * Check if client is connected (instance method)
   */
  isClientConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Test SSH connection to a Cisco VOS server
   * @param params Connection parameters
   * @returns Test result with success status and message
   */
  static async testConnection(params: SSHTestParams): Promise<SSHTestResult> {
    const { hostname, username, password, port = 22 } = params;
    const conn = new Client();

    return new Promise((resolve) => {
      let dataReceived = '';
      let resolved = false;
      let welcomeSent = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          conn.end();
        }
      };

      const resolveResult = (result: SSHTestResult) => {
        cleanup();
        resolve(result);
      };

      // Set a timeout for the entire operation
      // Cisco VOS CLI can take 60+ seconds to fully initialize on slower nodes
      const timeout = setTimeout(() => {
        resolveResult({
          success: false,
          error: 'Connection timeout after 90 seconds'
        });
      }, 90000);

      conn.on('ready', () => {
        Logger.info(`SSH connection established to ${hostname}`);
        
        conn.shell((err, stream) => {
          if (err) {
            clearTimeout(timeout);
            resolveResult({
              success: false,
              error: `Failed to start shell: ${err.message}`
            });
            return;
          }

          Logger.info(`Shell started for ${hostname}, waiting for CLI prompt...`);

          stream.on('close', () => {
            clearTimeout(timeout);
            cleanup();
          });

          stream.on('data', (data: Buffer) => {
            const chunk = data.toString();
            dataReceived += chunk;
            
            // Log each chunk of data received
            Logger.info(`SSH data received from ${hostname}:`, {
              chunk: chunk,
              totalLength: dataReceived.length
            });
            
            // Check for the Cisco VOS CLI prompt pattern
            // Looking for "admin:" prompt which appears after the welcome message
            if (dataReceived.includes('admin:')) {
              clearTimeout(timeout);
              clearTimeout(shellTimeout);
              Logger.info(`SSH test successful for ${hostname} - Found admin: prompt`);
              resolveResult({
                success: true,
                message: 'Successfully connected to Cisco VOS CLI'
              });
            }

            // After the Welcome message appears, send a newline to trigger the admin: prompt
            // The CLI may need a nudge after initialization completes
            if (!resolved && !welcomeSent && dataReceived.includes('Welcome to the Platform Command Line Interface')) {
              welcomeSent = true;
              Logger.info(`Detected Welcome message on ${hostname}, sending newline to trigger prompt`);
              stream.write('\r\n');
            }
          });

          stream.stderr.on('data', (data: Buffer) => {
            Logger.error(`SSH stderr: ${data.toString()}`);
          });

          // Send a newline early to potentially trigger the prompt
          setTimeout(() => {
            if (!resolved) {
              Logger.info(`Sending newline to ${hostname} to trigger prompt`);
              stream.write('\r\n');
            }
          }, 5000);

          // Give it more time to receive the full prompt
          // Cisco VOS can take 10-15 seconds to fully initialize
          const shellTimeout = setTimeout(() => {
            if (!resolved) {
              Logger.warn(`Shell timeout reached for ${hostname} after 60 seconds`);
              clearTimeout(timeout);
              if (dataReceived.length > 0) {
                Logger.warn(`SSH timeout for ${hostname} - Did not find admin: prompt. Data received:`, {
                  dataReceived: dataReceived,
                  dataLength: dataReceived.length
                });
                resolveResult({
                  success: false,
                  error: 'Connected but did not receive expected VOS CLI prompt (admin:)',
                  message: dataReceived.substring(0, 500) // Include partial response for debugging
                });
              } else {
                Logger.warn(`SSH timeout for ${hostname} - No data received`);
                resolveResult({
                  success: false,
                  error: 'Connected but received no data from server'
                });
              }
            } else {
              Logger.info(`Shell timeout cleared for ${hostname} - already resolved`);
            }
          }, 120000); // Wait up to 120 seconds for prompt
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        Logger.error(`SSH connection error to ${hostname}: ${err.message}`);
        resolveResult({
          success: false,
          error: `Connection error: ${err.message}`
        });
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        if (!resolved) {
          resolveResult({
            success: false,
            error: 'Connection closed unexpectedly'
          });
        }
      });

      // Attempt connection
      try {
        conn.connect({
          host: hostname,
          port,
          username,
          password,
          readyTimeout: 20000,
          // Temporarily remove algorithms to test with SSH2 defaults
          // algorithms: {
          //   kex: ['diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group14-sha1'],
          //   cipher: ['aes256-ctr', 'aes192-ctr', 'aes128-ctr', 'aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc'],
          //   serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
          //   hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
          // }
        });
      } catch (err: any) {
        clearTimeout(timeout);
        resolveResult({
          success: false,
          error: `Failed to initiate connection: ${err.message}`
        });
      }
    });
  }

  /**
   * Execute a command on a Cisco VOS server via SSH
   * @param params Connection parameters and command to execute
   * @returns Command result with output or error
   */
  static async executeCommand(params: SSHCommandParams): Promise<SSHCommandResult> {
    const { hostname, username, password, command, port = 22, timeout: commandTimeout = 60000 } = params;
    const conn = new Client();

    return new Promise((resolve) => {
      let commandOutput = '';
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          conn.end();
        }
      };

      const resolveResult = (result: SSHCommandResult) => {
        cleanup();
        resolve(result);
      };

      // Set a timeout for the entire operation
      const timeout = setTimeout(() => {
        resolveResult({
          success: false,
          error: `Command execution timeout after ${commandTimeout / 1000} seconds`
        });
      }, commandTimeout);

      conn.on('ready', () => {
        Logger.info(`SSH connection established to ${hostname} for command execution`);

        conn.shell((err, stream) => {
          if (err) {
            clearTimeout(timeout);
            resolveResult({
              success: false,
              error: `Failed to start shell: ${err.message}`
            });
            return;
          }

          Logger.info(`Executing command on ${hostname}: ${command}`);
          let commandSent = false;
          let welcomeSent = false;

          stream.on('close', () => {
            clearTimeout(timeout);
            cleanup();
          });

          stream.on('data', (data: Buffer) => {
            const chunk = data.toString();
            commandOutput += chunk;

            Logger.info(`Command output from ${hostname}:`, {
              chunk: chunk.trim(),
              totalLength: commandOutput.length
            });

            // Before command is sent, detect the admin: prompt
            if (!commandSent) {
              // Send newline after Welcome message to trigger prompt on slow VOS nodes
              if (!welcomeSent && commandOutput.includes('Welcome to the Platform Command Line Interface')) {
                welcomeSent = true;
                Logger.info(`Detected Welcome message on ${hostname}, sending newline to trigger prompt`);
                stream.write('\r\n');
              }
              // When we see admin: prompt, send the command
              if (chunk.includes('admin:')) {
                commandSent = true;
                Logger.info(`Detected admin prompt on ${hostname}, sending command: ${command}`);
                stream.write(`${command}\r\n`);
              }
              return;
            }

            // Check if command execution is complete
            // For service restart commands, look for specific completion patterns
            if (command.includes('service restart') && command.includes('Cisco Tomcat')) {
              // Look for service restart completion patterns
              // VOS may show [STARTED] or just return to admin: after [STARTING] phases
              if ((commandOutput.includes('[STARTED]') || commandOutput.includes('[STARTING]')) && chunk.includes('admin:')) {
                clearTimeout(timeout);
                Logger.info(`Cisco Tomcat service restart completed for ${hostname}`);
                resolveResult({
                  success: true,
                  output: commandOutput
                });
              } else if (commandOutput.includes('[FAILED]') || commandOutput.includes('ERROR')) {
                clearTimeout(timeout);
                Logger.error(`Cisco Tomcat service restart failed for ${hostname}`);
                resolveResult({
                  success: false,
                  error: 'Service restart failed',
                  output: commandOutput
                });
              }
            } else {
              // For other commands, look for the admin prompt again after command execution
              if (chunk.includes('admin:') && commandOutput.includes(command)) {
                clearTimeout(timeout);
                Logger.info(`Command execution completed for ${hostname}`);
                resolveResult({
                  success: true,
                  output: commandOutput
                });
              }
            }
          });

          stream.stderr.on('data', (data: Buffer) => {
            Logger.error(`SSH command stderr from ${hostname}: ${data.toString()}`);
            commandOutput += data.toString();
          });

          // Fallback: if admin: prompt not detected within 30s, send command anyway
          setTimeout(() => {
            if (!commandSent && !resolved) {
              commandSent = true;
              Logger.warn(`Admin prompt not detected on ${hostname} after 30s, sending command anyway: ${command}`);
              stream.write(`${command}\r\n`);
            }
          }, 30000);
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        Logger.error(`SSH command execution error for ${hostname}: ${err.message}`);
        resolveResult({
          success: false,
          error: `Connection error: ${err.message}`
        });
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        if (!resolved) {
          resolveResult({
            success: false,
            error: 'Connection closed unexpectedly',
            output: commandOutput
          });
        }
      });

      // Attempt connection
      try {
        conn.connect({
          host: hostname,
          port,
          username,
          password,
          readyTimeout: 20000,
          // Temporarily remove algorithms to test with SSH2 defaults
          // algorithms: {
          //   kex: ['diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group14-sha1'],
          //   cipher: ['aes256-ctr', 'aes192-ctr', 'aes128-ctr', 'aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc'],
          //   serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
          //   hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
          // }
        });
      } catch (err: any) {
        clearTimeout(timeout);
        resolveResult({
          success: false,
          error: `Failed to initiate connection: ${err.message}`
        });
      }
    });
  }

  /**
   * Execute a command on a Cisco VOS server via SSH with streaming output
   * @param params Connection parameters, command to execute, and optional callback
   * @returns Command result with output or error
   */
  static async executeCommandWithStream(params: SSHStreamCommandParams): Promise<SSHStreamCommandResult> {
    const { hostname, username, password, command, port = 22, timeout: commandTimeout = 60000, onData } = params;
    const conn = new Client();

    return new Promise((resolve) => {
      let commandOutput = '';
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          conn.end();
        }
      };

      const resolveResult = (result: SSHStreamCommandResult) => {
        cleanup();
        resolve(result);
      };

      // Set a timeout for the entire operation
      const timeout = setTimeout(() => {
        resolveResult({
          success: false,
          error: `Command execution timeout after ${commandTimeout / 1000} seconds`,
          output: commandOutput
        });
      }, commandTimeout);

      conn.on('ready', () => {
        Logger.info(`SSH connection established to ${hostname} for streaming command execution`);

        conn.shell((err, stream) => {
          if (err) {
            clearTimeout(timeout);
            resolveResult({
              success: false,
              error: `Failed to start shell: ${err.message}`,
              output: ''
            });
            return;
          }

          Logger.info(`Executing command on ${hostname}: ${command}`);
          let commandSent = false;
          let welcomeSent = false;

          stream.on('close', () => {
            clearTimeout(timeout);
            cleanup();
          });

          stream.on('data', (data: Buffer) => {
            const chunk = data.toString();
            commandOutput += chunk;

            Logger.info(`Command output from ${hostname}:`, {
              chunk: chunk.trim(),
              totalLength: commandOutput.length
            });

            // Call the onData callback if provided (even before command is sent, for visibility)
            if (onData) {
              onData(chunk, commandOutput);
            }

            // Before command is sent, detect the admin: prompt
            if (!commandSent) {
              // Send newline after Welcome message to trigger prompt on slow VOS nodes
              if (!welcomeSent && commandOutput.includes('Welcome to the Platform Command Line Interface')) {
                welcomeSent = true;
                Logger.info(`Detected Welcome message on ${hostname}, sending newline to trigger prompt`);
                stream.write('\r\n');
              }
              // When we see admin: prompt, send the command
              if (chunk.includes('admin:')) {
                commandSent = true;
                Logger.info(`Detected admin prompt on ${hostname}, sending command: ${command}`);
                stream.write(`${command}\r\n`);
              }
              return;
            }

            // Check if command execution is complete
            // For service restart commands, look for specific completion patterns
            if (command.includes('service restart') && command.includes('Cisco Tomcat')) {
              // Look for service restart completion patterns
              // VOS may show [STARTED] or just return to admin: after [STARTING] phases
              if ((commandOutput.includes('[STARTED]') || commandOutput.includes('[STARTING]')) && chunk.includes('admin:')) {
                clearTimeout(timeout);
                Logger.info(`Cisco Tomcat service restart completed for ${hostname}`);
                resolveResult({
                  success: true,
                  output: commandOutput
                });
              } else if (commandOutput.includes('[FAILED]') || commandOutput.includes('ERROR')) {
                clearTimeout(timeout);
                Logger.error(`Cisco Tomcat service restart failed for ${hostname}`);
                resolveResult({
                  success: false,
                  error: 'Service restart failed',
                  output: commandOutput
                });
              }
            } else {
              // For other commands, look for the admin prompt again after command execution
              if (chunk.includes('admin:') && commandOutput.includes(command)) {
                clearTimeout(timeout);
                Logger.info(`Command execution completed for ${hostname}`);
                resolveResult({
                  success: true,
                  output: commandOutput
                });
              }
            }
          });

          stream.stderr.on('data', (data: Buffer) => {
            Logger.error(`SSH command stderr from ${hostname}: ${data.toString()}`);
            commandOutput += data.toString();
          });

          // Fallback: if admin: prompt not detected within 30s, send command anyway
          setTimeout(() => {
            if (!commandSent && !resolved) {
              commandSent = true;
              Logger.warn(`Admin prompt not detected on ${hostname} after 30s, sending command anyway: ${command}`);
              stream.write(`${command}\r\n`);
            }
          }, 30000);
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        Logger.error(`SSH command execution error for ${hostname}: ${err.message}`);
        resolveResult({
          success: false,
          error: `Connection error: ${err.message}`,
          output: ''
        });
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        if (!resolved) {
          resolveResult({
            success: false,
            error: 'Connection closed unexpectedly',
            output: commandOutput
          });
        }
      });

      // Attempt connection
      try {
        conn.connect({
          host: hostname,
          port,
          username,
          password,
          readyTimeout: 20000,
          // Temporarily remove algorithms to test with SSH2 defaults
          // algorithms: {
          //   kex: ['diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group14-sha1'],
          //   cipher: ['aes256-ctr', 'aes192-ctr', 'aes128-ctr', 'aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc'],
          //   serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
          //   hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
          // }
        });
      } catch (err: any) {
        clearTimeout(timeout);
        resolveResult({
          success: false,
          error: `Failed to initiate connection: ${err.message}`,
          output: ''
        });
      }
    });
  }
}