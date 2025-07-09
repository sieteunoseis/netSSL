# React App with Tailwind CSS Boilerplate for Automate Builders

A configurable, full-stack React application template with TypeScript, Express.js backend, and SQLite database. Features comprehensive security, testing, and dynamic form generation.

## ✨ Features

- **🔧 Template Configuration**: Easily configure for frontend-only or full-stack projects
- **🔒 Security First**: Input validation, sanitization, password hashing (bcrypt), and XSS protection
- **📘 TypeScript**: Full TypeScript implementation for both frontend and backend
- **🧪 Testing**: Comprehensive test coverage with Jest (backend) and Vitest (frontend)
- **🎨 Modern UI**: React 19, Tailwind CSS, Radix UI components with dark/light themes
- **📱 Responsive Design**: Mobile-first design with hamburger menu (< 1024px)
- **🗄️ Smart Database**: SQLite with automatic schema migration and dynamic table creation
- **📝 Dynamic Forms**: Auto-generated forms with validation based on configuration
- **🐳 Docker Ready**: Containerized deployment with Docker Compose
- **🔄 Version Control**: Template synchronization with upstream changes

## 🔧 Template Configuration

This template can be configured for different project types:

### Quick Setup

1. **Clone and install**:
```bash
# Using the download script
wget -O git-template-remote.sh https://raw.githubusercontent.com/sieteunoseis/react-express-tailwind-app/refs/heads/main/scripts/git-template-remote.sh
chmod +x git-template-remote.sh

# Full-stack with template sync capability
./git-template-remote.sh https://github.com/sieteunoseis/react-express-tailwind-app.git <your-project-name>

# Frontend-only with template sync
./git-template-remote.sh --no-backend https://github.com/sieteunoseis/react-express-tailwind-app.git <your-project-name>

# Frontend-only with clean git history (no template history)
./git-template-remote.sh --no-backend --no-history https://github.com/sieteunoseis/react-express-tailwind-app.git <your-project-name>

cd <your-project-name>
npm run install-all
```

2. **Configure your project**:
Edit `template.config.json`:
```json
{
  "useBackend": true,           // Set to false for frontend-only projects
  "databaseType": "cucm",       // "cucm" (with version) or "cuc" (without version)
  "availableDatabaseTypes": {
    "cucm": {
      "name": "Cisco CUCM",
      "description": "Cisco Call Manager with version field",
      "configFile": "cucm.dbSetup.json",
      "tableColumns": "name,hostname,username,password,version"
    },
    "cuc": {
      "name": "Cisco CUC",
      "description": "Cisco Unity Connection without version field", 
      "configFile": "cuc.dbSetup.json",
      "tableColumns": "name,hostname,username,password"
    }
  }
}
```

3. **Apply configuration**:
```bash
npm run setup-template
```

### Configuration Options

- **Frontend-only**: Set `useBackend: false` to remove connections page and backend dependencies
- **CUCM**: Set `databaseType: "cucm"` for Cisco Call Manager (includes version field)
- **CUC**: Set `databaseType: "cuc"` for Cisco Unity Connection (no version field)

## 🚀 Quick Start

### Development
```bash
# Apply template configuration
npm run setup-template

# Start development servers
npm run dev  # Starts both frontend and backend
```

### Environment Setup
Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

Key variables:
```bash
# Branding
VITE_BRANDING_NAME=Automate Builders
VITE_BRANDING_URL=https://automate.builders
VITE_BACKGROUND_LOGO_TEXT=AB

# Auto-managed by template (don't edit manually)
VITE_TABLE_COLUMNS=name,hostname,username,password,version

# Backend (only if useBackend: true)
PORT=3000
NODE_ENV=development
```

### Docker Deployment
```bash
npm run build  # docker-compose up --build
```

## 📱 UI Features

### Responsive Navigation
- **Desktop**: Full navigation menu visible on screens ≥1024px
- **Mobile**: Hamburger menu with slide-out panel on screens <1024px
- **Conditional Links**: Connections page only shows when backend is enabled

### Background Logo Customization
Supports both text and [Lucide icons](https://lucide.dev/):
```bash
VITE_BACKGROUND_LOGO_TEXT="AB"              # Text logo
VITE_BACKGROUND_LOGO_TEXT="lucide-settings" # Lucide icon
```

## 🗄️ Database Configuration

### Pre-configured Types
- **CUCM**: `name, hostname, username, password, version`
- **CUC**: `name, hostname, username, password`

### Custom Configuration
Edit database setup files:
- `frontend/public/cucm.dbSetup.json`
- `frontend/public/cuc.dbSetup.json`

Example:
```json
[
  {
    "name": "hostname",
    "type": "TEXT",
    "validator": { "name": "isFQDN", "options": { "allow_numeric_tld": true } }
  },
  {
    "name": "version",
    "type": "TEXT",
    "validator": { "name": "isDecimal", "options": { "force_decimal": false, "decimal_digits": "1,2", "locale": "en-US" } },
    "optional": true
  }
]
```

## 🧪 Testing

```bash
# Backend tests (Jest + TypeScript)
cd backend && npm test

# Frontend tests (Vitest + React Testing Library)
cd frontend && npm test
```

## 🔄 Template Sync

Keep your project updated with template improvements:
```bash
npm run sync-remote  # Only works with standard clone (not --fresh)
```

## 🛠️ Development Scripts

```bash
npm run install-all     # Install all dependencies
npm run dev            # Start development servers
npm run setup-template # Apply template configuration
npm run build          # Docker build
npm run sync-remote    # Sync template updates
```

## 🚨 Troubleshooting

### Common Issues

**Template not applying**: Run `npm run setup-template` after config changes

**Port conflicts**: 
```bash
lsof -i :3000  # Check port usage
PORT=8000 npm run dev  # Use different port
```

**Database errors**:
```bash
mkdir backend/db  # Create database directory
```

**TypeScript errors**:
```bash
cd backend && npm run build    # Check backend types
cd frontend && npm run build   # Check frontend types
```

---

**Template Reference**: Based on [Propagating Git Template Changes](https://www.mslinn.com/git/700-propagating-git-template-changes.html)