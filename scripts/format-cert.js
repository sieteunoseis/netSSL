#!/usr/bin/env node

/**
 * Certificate formatting utility
 * Converts PEM certificates to JSON-ready format (adds \n escape sequences)
 * Equivalent to: awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' cert.pem
 */

const fs = require('fs');
const path = require('path');

function formatCertificate(certContent) {
  return certContent
    .split('\n')
    .filter(line => line.trim()) // Remove empty lines
    .map(line => line.replace(/\r$/, '')) // Remove carriage returns
    .join('\\n');
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node format-cert.js <cert-file>     # Format certificate file');
    console.log('  node format-cert.js -c <cert-file>  # Format and copy to clipboard');
    console.log('  echo "cert" | node format-cert.js   # Format from stdin');
    console.log('  echo "cert" | node format-cert.js -c # Format from stdin and copy');
    console.log('');
    console.log('Examples:');
    console.log('  node format-cert.js certificate.pem');
    console.log('  node format-cert.js -c fullchain.pem');
    console.log('  cat cert.pem | node format-cert.js -c');
    process.exit(1);
  }

  // Parse arguments
  let copyToClipboard = false;
  let filename = args[0];
  
  if (args[0] === '-c') {
    copyToClipboard = true;
    filename = args[1] || '-'; // Default to stdin if no filename after -c
  } else if (args[1] === '-c') {
    copyToClipboard = true;
    filename = args[0];
  }
  
  try {
    let certContent;
    
    if (filename === '-') {
      // Read from stdin
      certContent = fs.readFileSync(0, 'utf8');
    } else if (fs.existsSync(filename)) {
      // Read from file (relative or absolute path)
      certContent = fs.readFileSync(filename, 'utf8');
    } else {
      // Try to resolve relative to current directory
      const fullPath = path.resolve(filename);
      if (fs.existsSync(fullPath)) {
        certContent = fs.readFileSync(fullPath, 'utf8');
      } else {
        throw new Error(`File not found: ${filename}`);
      }
    }
    
    const formatted = formatCertificate(certContent);
    
    if (copyToClipboard) {
      // Copy to clipboard using pbcopy (macOS) or xclip (Linux)
      const { spawn } = require('child_process');
      let clipboardCmd;
      
      if (process.platform === 'darwin') {
        clipboardCmd = spawn('pbcopy');
      } else if (process.platform === 'linux') {
        clipboardCmd = spawn('xclip', ['-selection', 'clipboard']);
      } else {
        throw new Error('Clipboard functionality not supported on this platform');
      }
      
      clipboardCmd.stdin.write(formatted);
      clipboardCmd.stdin.end();
      
      clipboardCmd.on('close', (code) => {
        if (code === 0) {
          console.log('✓ Certificate formatted and copied to clipboard');
        } else {
          console.error('Failed to copy to clipboard');
          console.log(formatted);
        }
      });
      
      clipboardCmd.on('error', (err) => {
        console.error('Clipboard error:', err.message);
        console.log('Output:');
        console.log(formatted);
      });
    } else {
      console.log(formatted);
    }
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// If this script is run directly (not imported)
if (require.main === module) {
  main();
}

module.exports = { formatCertificate };