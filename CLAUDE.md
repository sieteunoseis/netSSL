# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a full-stack React application template with an Express.js backend and SQLite database, designed for building automation tools. The application features:

- **Frontend**: React 19 with Vite, TypeScript, Tailwind CSS, and Radix UI components
- **Backend**: Express.js server with TypeScript, SQLite database, and REST API
- **Security**: Input validation, sanitization, password hashing (bcrypt), and error handling
- **Testing**: Jest (backend) and Vitest (frontend) with comprehensive test coverage
- **Database**: SQLite with dynamic table creation based on environment variables
- **Configuration**: Dynamic form generation using `dbSetup.json` with validator.js validation
- **Deployment**: Docker containers with nginx (frontend) and Node.js (backend)

## Key Architecture Patterns

### Dynamic Form System
The application uses `frontend/public/dbSetup.json` to dynamically generate forms with validation. This file defines:
- Field names, types, and validation rules using validator.js
- Database table structure (synced with `VITE_TABLE_COLUMNS` env var)
- Sample configurations for Cisco CUCM and CUC are provided

### Database Schema
SQLite table structure is dynamically created based on `TABLE_COLUMNS` environment variable in `backend/server.js:31-42`. The backend automatically creates the `connections` table with columns matching the configuration.

Key database fields for connection management:
- `is_enabled` (BOOLEAN): Controls whether connection participates in certificate monitoring and auto-renewal
- `auto_renew` (BOOLEAN): Enables automatic certificate renewal (requires `is_enabled=true` and API-based DNS)
- `dns_provider` (STRING): DNS provider type - auto-renewal only works with API-based providers (not 'custom')

### Security Features
- **Input Validation**: Server-side validation using validator.js with type-safe schemas
- **Data Sanitization**: HTML escaping and input sanitization to prevent XSS attacks
- **Password Security**: Bcrypt hashing with 12 salt rounds for secure password storage
- **Error Handling**: Comprehensive error handling with logging and secure error responses
- **Type Safety**: Full TypeScript implementation for both frontend and backend

### Theme System
Uses Radix UI with dark/light mode toggle implemented via context in `frontend/src/components/theme-provider.tsx` and `theme-context.tsx`.

### UI/UX Features
- **Unified Dashboard**: Single page combining Home and Connections functionality with card and table view modes
- **Connection Management**: Enable/disable connections with visual feedback (greyed out when disabled)
- **Performance Metrics**: Real-time certificate performance tracking with DNS, TCP, and TLS timing data
- **Certificate Status Badges**: Square-styled badges throughout the application showing certificate status, auto-renewal state, and connection types
- **Auto-Renewal Logic**: Intelligent auto-renewal system that skips disabled connections and manual DNS configurations
- **Responsive Design**: Mobile-friendly interface with collapsible cards and expandable table rows

## Development Commands

### Install Dependencies
```bash
npm run install-all  # Installs deps for root, backend, and frontend
```

### Development Mode
```bash
npm run dev  # Runs both frontend (Vite) and backend (nodemon) concurrently
```

### Individual Services
```bash
# Frontend only
cd frontend && npm run dev

# Backend only  
cd backend && npm run dev  # Uses ts-node for TypeScript development
```

### TypeScript Building and Type Checking
```bash
# Backend TypeScript
cd backend && npm run build      # Compile TypeScript to JavaScript
cd backend && npm run type-check # Type checking only

# Frontend TypeScript  
cd frontend && npm run build     # Build for production
```

### Testing
```bash
# Backend tests (Jest + TypeScript)
cd backend && npm test                    # Run all tests
cd backend && npm run test:watch         # Watch mode
cd backend && npm run test:coverage      # Coverage report

# Frontend tests (Vitest + React Testing Library)
cd frontend && npm test                  # Run tests in watch mode
cd frontend && npm run test:run          # Run tests once
cd frontend && npm run test:coverage     # Coverage report
```

### Linting
```bash
cd frontend && npm run lint  # ESLint for frontend
```

### Building
```bash
npm run build  # Docker compose build
cd frontend && npm run build  # Frontend build only
cd backend && npm run build   # Backend TypeScript build
```

### Docker Development
```bash
docker-compose up --build  # Full containerized build
```

### DNS Provider System
The application supports multiple DNS providers for ACME/Let's Encrypt certificate challenges. Provider implementations live in `backend/src/dns-providers/`:

| Provider         | File              | Status                                                    |
| ---------------- | ----------------- | --------------------------------------------------------- |
| Cloudflare       | `cloudflare.ts`   | Fully implemented and wired in                            |
| DigitalOcean     | `digitalocean.ts` | Provider class complete                                   |
| AWS Route53      | `route53.ts`      | Provider class complete (uses `@aws-sdk/client-route-53`) |
| Azure DNS        | `azure.ts`        | Skeleton only                                             |
| Google Cloud DNS | `google.ts`       | Skeleton only                                             |
| Custom (Manual)  | `custom.ts`       | Fully implemented                                         |

The Let's Encrypt challenge flow in `backend/src/certificate-renewal.ts` dynamically imports and instantiates the correct DNS provider based on `connection.dns_provider`. All providers use the common `createDNSRecord()` method, with Cloudflare-specific methods (cleanup, verification, deletion) handled via conditional dispatch.

**Required API keys per provider** (validated in `backend/src/server.ts`):
- `cloudflare`: CF_KEY, CF_ZONE
- `digitalocean`: DO_KEY
- `route53`: AWS_ACCESS_KEY, AWS_SECRET_KEY, AWS_ZONE_ID
- `azure`: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, AZURE_ZONE_NAME
- `google`: GOOGLE_PROJECT_ID, GOOGLE_ZONE_NAME

## Project Structure

- `frontend/src/pages/` - Main application pages (Home, Connections, Error)
- `frontend/src/components/` - Reusable React components and UI primitives
- `frontend/src/lib/connection-utils.js` - Connection utility functions including enable/disable logic
- `frontend/public/dbSetup.json` - Dynamic form configuration with conditional field visibility
- `backend/src/server.ts` - Express API server with SQLite integration and connection management
- `backend/src/certificate-renewal.ts` - Let's Encrypt ACME certificate renewal with DNS challenges
- `backend/src/auto-renewal-cron.ts` - Scheduled certificate renewal service (respects connection enabled state)
- `backend/src/dns-providers/` - DNS provider implementations (Cloudflare, Route53, DigitalOcean, etc.)
- `backend/db/` - SQLite database files (auto-created)

## Environment Configuration

Backend requires environment variables matching `dbSetup.json` field names. Set these in:
- `.env` file for local development
- `docker-compose.yaml` for containerized deployment

### Frontend Debug Configuration
- `VITE_DEBUG`: Set to `true` to enable general debug messages in browser console (default: `false`)
- `VITE_DEBUG_WEBSOCKET`: Set to `true` to enable detailed WebSocket debug logging in browser console (default: `false`)

### Let's Encrypt Configuration
- `LETSENCRYPT_STAGING`: Set to `false` for production certificates, `true` or unset for staging (default: `true`)
- Account files are saved with staging/production suffix: `domain_letsencrypt_staging.json` or `domain_letsencrypt_prod.json`

### Let's Encrypt Certificate Behavior

#### Duplicate Certificates
Let's Encrypt will create a new certificate every time you request one, even if you just requested one for the same domain. It doesn't return the previously issued certificate - each request generates a brand new certificate with:
- New serial number
- New expiration date (90 days from issuance)
- New private key (if generated)
- New certificate chain

#### Rate Limits
Let's Encrypt has several rate limits to prevent abuse:

1. **Certificates per Registered Domain**: 50 certificates per week for a registered domain
   - For `automate.builders`, this includes all subdomains
   - `ecp.automate.builders`, `cucm01.automate.builders`, etc. all count toward this limit

2. **Duplicate Certificate Limit**: 5 per week
   - This is for the exact same set of domains
   - If you request `ecp.automate.builders` again, you can only get 5 certificates per week with that exact domain

3. **Failed Validation Limit**: 5 failures per hour per domain
   - Failed DNS challenges count toward this

#### Best Practices
- Use staging environment (`LETSENCRYPT_STAGING=true`) for testing to avoid hitting production rate limits
- Monitor certificate expiration and renew before 30 days remaining
- Keep track of renewal frequency to stay within duplicate certificate limits
- Failed DNS challenges count toward rate limits, so ensure DNS records are correct before attempting renewal

## Template Configuration

This is a configurable template repository. Configure for your project needs:

### Setup Template
```bash
npm run setup-template  # Apply template configuration
```

### Configuration Options
Edit `template.config.json` to customize:
- `useBackend`: Enable/disable backend and connections page
- `databaseType`: Choose "cucm" (with version) or "cuc" (without version)

### Template Synchronization
Sync upstream changes:
```bash
npm run sync-remote  # Pulls from upstream main branch
```