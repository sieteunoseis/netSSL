# Accounts Directory

This directory stores certificate-related files and account information for SSL certificate management.

## Directory Structure

```
accounts/
├── README.md                           # This file
├── domain.com_letsencrypt.json         # Let's Encrypt account info for domain.com
├── domain.com_zerossl.json             # ZeroSSL account info for domain.com
└── domain.com/                         # Domain-specific certificate files
    ├── certificate.csr                 # Certificate Signing Request
    ├── certificate.pem                 # SSL Certificate (PEM format)
    ├── private_key.pem                 # Private key (PEM format)
    └── renewal.log                     # Renewal activity log
```

## File Types

### Account Files (JSON)
- **Format**: `{domain}_{provider}.json`
- **Content**: Account information, keys, and provider-specific data
- **Example**: `example.com_letsencrypt.json`

### Domain Directories
- **Format**: `{domain}/`
- **Content**: Certificate files and logs for specific domains
- **Example**: `example.com/`

### Certificate Files
- **CSR**: Certificate Signing Request generated from CUCM
- **PEM**: SSL certificate in PEM format
- **Private Key**: Private key for the certificate
- **Logs**: Renewal activity and debugging information

## Docker Persistent Storage

In Docker environments, this directory is mounted as a volume to ensure certificate data persists across container restarts:

```yaml
volumes:
  - ./backend/accounts:/app/accounts  # Persistent storage for certificates and accounts
```

## Environment Variables

- `ACCOUNTS_DIR`: Override the default accounts directory path
- Default: `./accounts`

## Security Notes

- This directory contains sensitive information (private keys, account keys)
- Ensure proper file permissions and backup procedures
- Do not commit actual certificate files to version control
- Use `.gitignore` to exclude sensitive files while keeping the directory structure

## API Endpoints

- `GET /api/accounts/debug` - View accounts directory structure (development only)