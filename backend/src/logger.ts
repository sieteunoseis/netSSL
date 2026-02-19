import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true';
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '14d';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: () => new Date().toISOString() }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const args = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${args}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: () => new Date().toISOString() }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const args = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${args}`;
  })
);

const consoleTransport = new winston.transports.Console({ format: consoleFormat, handleExceptions: false });

// Silently ignore EPIPE errors (broken pipe when nodemon restarts or terminal disconnects)
consoleTransport.on('error', (err: any) => {
  if (err?.code !== 'EPIPE') {
    process.stderr.write(`[Logger] Console transport error: ${err?.message}\n`);
  }
});

const transports: winston.transport[] = [consoleTransport];

if (LOG_TO_FILE) {
  // Combined log — all levels
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      format: fileFormat,
    })
  );

  // Error-only log — easy to find errors
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      level: 'error',
      format: fileFormat,
    })
  );
}

const winstonLogger = winston.createLogger({
  level: LOG_LEVEL,
  transports,
  exitOnError: false,
});

export class Logger {
  static info(message: string, ...args: any[]): void {
    winstonLogger.info(args.length ? `${message} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}` : message);
  }

  static error(message: string, error?: Error | any, ...args: any[]): void {
    const parts = [message];
    if (error) {
      parts.push(error instanceof Error ? `${error.message}\n${error.stack}` : JSON.stringify(error));
    }
    if (args.length) {
      parts.push(...args.map(a => typeof a === 'string' ? a : JSON.stringify(a)));
    }
    winstonLogger.error(parts.join(' '));
  }

  static warn(message: string, ...args: any[]): void {
    winstonLogger.warn(args.length ? `${message} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}` : message);
  }

  static debug(message: string, ...args: any[]): void {
    winstonLogger.debug(args.length ? `${message} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}` : message);
  }
}
