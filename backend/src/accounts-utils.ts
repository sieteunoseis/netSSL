import fs from 'fs';
import path from 'path';
import { Logger } from './logger';

export function getAccountsDirectoryStructure(accountsDir: string): any {
  const structure: any = {};
  
  try {
    if (!fs.existsSync(accountsDir)) {
      return { error: 'Accounts directory does not exist' };
    }

    const files = fs.readdirSync(accountsDir);
    
    structure.root_files = files.filter(file => fs.statSync(path.join(accountsDir, file)).isFile());
    structure.domains = {};
    
    // Get domain directories
    const directories = files.filter(file => {
      const fullPath = path.join(accountsDir, file);
      return fs.statSync(fullPath).isDirectory();
    });
    
    directories.forEach(dir => {
      const domainPath = path.join(accountsDir, dir);
      const domainFiles = fs.readdirSync(domainPath);
      structure.domains[dir] = domainFiles;
    });
    
    return structure;
  } catch (error) {
    Logger.error('Error reading accounts directory:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function getAccountsSize(accountsDir: string): { totalFiles: number; totalSize: number } {
  let totalFiles = 0;
  let totalSize = 0;
  
  try {
    if (!fs.existsSync(accountsDir)) {
      return { totalFiles: 0, totalSize: 0 };
    }

    const calculateSize = (dir: string) => {
      const files = fs.readdirSync(dir);
      
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          calculateSize(fullPath);
        } else {
          totalFiles++;
          totalSize += stat.size;
        }
      });
    };
    
    calculateSize(accountsDir);
    return { totalFiles, totalSize };
  } catch (error) {
    Logger.error('Error calculating accounts size:', error);
    return { totalFiles: 0, totalSize: 0 };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}