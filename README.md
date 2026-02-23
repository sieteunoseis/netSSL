# netSSL

A comprehensive web-based dashboard for SSL certificate management across enterprise infrastructures. Built to work with both general applications and enterprise systems with API support, including Cisco Voice over Secure (VOS) platforms (CUCM, CUC, CER) and Cisco Identity Services Engine (ISE) through their OpenAPI interfaces. Features automated certificate installation, renewal, and service restart capabilities.

![Dashboard Overview](screenshots/dashboard-overview.png)

## Features

- **Multi-Platform Support**: Manage SSL certificates across multiple platforms from a single interface
  - **VOS Platforms**: Cisco CUCM, CUC, CER with SSH-based service restart
  - **ISE Platforms**: Cisco ISE with OpenAPI integration for automated operations
  - **General Applications**: Support for any system requiring certificate management
- **Certificate Operations**: 
  - Generate Certificate Signing Requests (CSRs)
  - Automated certificate upload and installation via API
  - Real-time certificate monitoring and expiration tracking
  - Support for multi-SAN and wildcard certificates
- **Automated Operations**: 
  - Let's Encrypt integration with ACME protocol
  - Automatic certificate renewal and installation
  - Service restart automation (SSH for VOS, API for ISE)
  - DNS challenge automation with multiple provider support
- **DNS Provider Support**: Built-in support for Cloudflare, Azure DNS, DigitalOcean, Google Cloud DNS, Route53, and more
- **Enterprise Features**: 
  - Real-time operation logging and monitoring
  - WebSocket-based live updates during operations
  - Secure credential storage with bcrypt hashing
  - Role-based connection management with enable/disable controls
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Radix UI
- **Backend**: Express.js, TypeScript, SQLite
- **Security**: Input validation, bcrypt password hashing
- **Testing**: Jest (backend), Vitest (frontend)
- **Deployment**: Single Docker container with nginx and Node.js

## Prerequisites

- Docker and Docker Compose (recommended)
- Or Node.js 18+ and npm (for development)
- Access to target systems with administrative credentials

## Installation

### Option 1: Quick Docker Deployment (Easiest - Recommended)

Download and run with a single command using curl or wget:

**With curl:**
```bash
curl -O https://raw.githubusercontent.com/sieteunoseis/netSSL/master/docker-compose.yml
docker-compose up -d
```

**With wget:**
```bash
wget https://raw.githubusercontent.com/sieteunoseis/netSSL/master/docker-compose.yml
docker-compose up -d
```

The application will be available at http://localhost:3000

**To customize configuration:**
1. Edit the `docker-compose.yml` file to update branding and DNS provider credentials
2. For production, set `LETSENCRYPT_STAGING=false`
3. Restart: `docker-compose restart`

### Option 2: Docker Build from Source

1. Clone the repository:
```bash
git clone https://github.com/sieteunoseis/netSSL.git
cd netSSL
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Build and start with Docker Compose:
```bash
docker-compose up --build
```

The application will be available at http://localhost:3000

### Option 3: Development Installation

1. Clone the repository:
```bash
git clone https://github.com/sieteunoseis/netSSL.git
cd netSSL
```

2. Install dependencies:
```bash
npm run install-all
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the development server:
```bash
npm run dev
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Configuration

### Database Setup

The application uses SQLite with dynamic table creation. Connection form fields are defined in `frontend/src/lib/connection-fields.ts` with per-type layouts in `frontend/src/lib/type-profiles.ts`.

### Environment Variables

#### Branding

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_BRANDING_URL` | `https://automate.builders` | Company/project URL |
| `VITE_BRANDING_NAME` | `Automate Builders` | Display name in sidebar |
| `VITE_BACKGROUND_LOGO_TEXT` | `NETSSL` | Background watermark text |

#### Backend

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Backend API port |
| `NODE_ENV` | `development` | Environment mode |

#### Certificate Auto-Renewal

| Variable | Default | Description |
| --- | --- | --- |
| `CERT_RENEWAL_DAYS` | `7` | Days before expiry to auto-renew |
| `CERT_WARNING_DAYS` | `30` | Days before expiry to show warning |
| `CERT_CHECK_SCHEDULE` | `0 0 * * *` | Cron schedule for renewal checks |

#### Let's Encrypt

| Variable | Default | Description |
| --- | --- | --- |
| `LETSENCRYPT_STAGING` | `true` | Use staging environment for testing |
| `LETSENCRYPT_CLEANUP_DNS` | `false` | Force DNS cleanup in staging mode |
| `ACCOUNTS_DIR` | `./accounts` | Directory for account/cert storage |

#### DNS Provider Credentials

Configure credentials in Settings > API Keys for your DNS provider:

| Provider | Required Keys |
| --- | --- |
| Cloudflare | `CF_KEY`, `CF_ZONE` |
| AWS Route53 | `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_ZONE_ID` (optional: `AWS_ENDPOINT`) |
| DigitalOcean | `DO_KEY` |
| Azure DNS | `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_ZONE_NAME` |
| Google Cloud DNS | `GOOGLE_PROJECT_ID`, `GOOGLE_ZONE_NAME` |

#### Logging

| Variable | Default | Description |
| --- | --- | --- |
| `LOG_TO_FILE` | `false` | Enable rotating log files |
| `LOG_DIR` | `./logs` | Log file directory |
| `LOG_MAX_SIZE` | `20m` | Max size per file before rotation |
| `LOG_MAX_FILES` | `14d` | Retention period (e.g., `14d` or `30`) |
| `LOG_LEVEL` | `info` | Log level: `error`, `warn`, `info`, `debug` |

When `LOG_TO_FILE=true`, two rotating log files are created:

- `app-YYYY-MM-DD.log` — all log levels
- `error-YYYY-MM-DD.log` — errors only (for quick troubleshooting)

#### Debug

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_DEBUG` | `false` | General debug messages in browser console |
| `VITE_DEBUG_WEBSOCKET` | `false` | WebSocket debug messages in browser console |

Note: Database table columns are hardcoded in the application for consistency and reliability.

### Let's Encrypt Configuration

For production certificates, set `LETSENCRYPT_STAGING=false`. Account information is stored separately for staging and production environments.

## Usage

1. **Add Systems**: Navigate to the dashboard and add your target systems:
   - **VOS Platforms**: CUCM, CUC, CER with SSH credentials
   - **ISE Platforms**: ISE nodes with OpenAPI credentials  
   - **General Applications**: Any system requiring certificate management
2. **Generate CSR**: Select a system and generate Certificate Signing Requests
3. **Automated Operations**: 
   - Use Let's Encrypt for automated certificate generation and installation
   - Configure DNS providers for automatic challenge validation
   - Enable auto-renewal for hands-off certificate management
4. **Manual Operations**: Upload and install certificates manually when needed
5. **Monitor & Manage**: 
   - View real-time certificate status and expiration dates
   - Monitor operations through live logging
   - Enable/disable systems for maintenance

## Development

### Testing
```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test
```

### Building
```bash
# Docker build
npm run build

# Frontend production build
cd frontend && npm run build

# Backend TypeScript compilation
cd backend && npm run build
```

## Docker Deployment Details

### Architecture

The application is packaged as a single Docker container containing both frontend (nginx) and backend (Node.js) services:

- **nginx** serves the React frontend and proxies API requests
- **Node.js backend** handles API requests on an internal port
- **PM2** manages both processes with automatic restart
- **Persistent volumes** for database, certificates, and logs

### Volumes

| Volume | Container Path | Purpose |
| --- | --- | --- |
| `app_db` | `/app/backend/db` | SQLite database |
| `app_accounts` | `/app/backend/accounts` | Let's Encrypt accounts and certificates |
| `app_logs` | `/app/backend/logs` | Rotating log files (when `LOG_TO_FILE=true`) |

### Advanced Docker Usage

```bash
# Build and run directly with Docker
docker build -t netssl .
docker run -p 3000:80 \
  -v netssl_db:/app/backend/db \
  -v netssl_accounts:/app/backend/accounts \
  -v netssl_logs:/app/backend/logs \
  --env-file .env \
  netssl
```

## Security Considerations

- All passwords are hashed using bcrypt
- Input validation on both client and server
- HTTPS recommended for production deployment
- Regular security updates for dependencies

## License

MIT License - see [LICENSE](LICENSE) file for details

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/sieteunoseis/netSSL).
