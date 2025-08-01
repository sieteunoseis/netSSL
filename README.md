# netSSL

A web-based dashboard for managing SSL certificates across Cisco Voice over Secure (VOS) infrastructure, including Cisco Unified Communications Manager (CUCM), Unity Connection (CUC), and other VOS-based applications.

## Features

- **Multi-Server Management**: Manage SSL certificates across multiple Cisco VOS servers from a single interface
- **Certificate Operations**: 
  - Generate Certificate Signing Requests (CSRs)
  - Upload and install SSL certificates
  - View certificate details and expiration dates
  - Support for multi-SAN certificates
- **Let's Encrypt Integration**: Automated certificate generation and renewal using ACME protocol
- **DNS Provider Support**: Built-in support for multiple DNS providers (Cloudflare, Azure, DigitalOcean, Google Cloud, Route53)
- **Security**: Secure credential storage with bcrypt hashing
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Radix UI
- **Backend**: Express.js, TypeScript, SQLite
- **Security**: Input validation, bcrypt password hashing
- **Testing**: Jest (backend), Vitest (frontend)
- **Deployment**: Single Docker container with nginx and Node.js

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose (for containerized deployment)
- Access to Cisco VOS servers with administrative credentials

## Installation

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

The application uses SQLite with dynamic table creation. Configure your VOS server fields in `frontend/public/dbSetup.json`.

### Environment Variables

Key environment variables:
- `TABLE_COLUMNS`: Comma-separated list of database columns
- `VITE_TABLE_COLUMNS`: Frontend column configuration
- `LETSENCRYPT_STAGING`: Use Let's Encrypt staging environment (default: true)
- DNS provider credentials (varies by provider)

### Let's Encrypt Configuration

For production certificates, set `LETSENCRYPT_STAGING=false`. Account information is stored separately for staging and production environments.

## Usage

1. **Add VOS Servers**: Navigate to Connections page and add your Cisco VOS servers
2. **Generate CSR**: Select a server and generate a Certificate Signing Request
3. **Upload Certificate**: Upload signed certificates back to the server
4. **Let's Encrypt**: Use automated certificate generation with supported DNS providers

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

## Docker Deployment

### Single Container Deployment

The application is packaged as a single Docker container containing both frontend (nginx) and backend (Node.js) services:

```bash
# Using Docker Compose (recommended)
docker-compose up --build

# Or run directly with Docker
docker build -t netssl .
docker run -p 3000:80 \
  -v ./backend/db:/app/db \
  -v ./backend/accounts:/app/accounts \
  --env-file .env \
  netssl
```

The application will be available at http://localhost:3000

### Architecture

- **nginx** serves the React frontend and proxies API requests
- **Node.js backend** handles API requests on internal port 5000
- **PM2** manages both processes with automatic restart
- **Persistent volumes** for database and certificate storage

### Environment Variables

Create a `.env` file with your configuration:
```bash
# Required environment variables
VITE_BRANDING_URL=https://your-domain.com
VITE_BRANDING_NAME=Your Company
VITE_TABLE_COLUMNS=name,hostname,username,password,version
PORT=5000
NODE_ENV=production

# Let's Encrypt settings
LETSENCRYPT_STAGING=false

# DNS provider credentials (as needed)
CLOUDFLARE_TOKEN=your-token
```

## Security Considerations

- All passwords are hashed using bcrypt
- Input validation on both client and server
- HTTPS recommended for production deployment
- Regular security updates for dependencies

## License

MIT License - see [LICENSE](LICENSE) file for details

## Contributing

[Your Contributing Guidelines]