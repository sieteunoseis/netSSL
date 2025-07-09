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

### Security Features
- **Input Validation**: Server-side validation using validator.js with type-safe schemas
- **Data Sanitization**: HTML escaping and input sanitization to prevent XSS attacks
- **Password Security**: Bcrypt hashing with 12 salt rounds for secure password storage
- **Error Handling**: Comprehensive error handling with logging and secure error responses
- **Type Safety**: Full TypeScript implementation for both frontend and backend

### Theme System
Uses Radix UI with dark/light mode toggle implemented via context in `frontend/src/components/theme-provider.tsx` and `theme-context.tsx`.

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

## Project Structure

- `frontend/src/pages/` - Main application pages (Home, Connections, Error)
- `frontend/src/components/` - Reusable React components and UI primitives
- `frontend/public/dbSetup.json` - Dynamic form configuration
- `backend/server.js` - Express API server with SQLite integration
- `backend/db/` - SQLite database files (auto-created)

## Environment Configuration

Backend requires environment variables matching `dbSetup.json` field names. Set these in:
- `.env` file for local development
- `docker-compose.yaml` for containerized deployment

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