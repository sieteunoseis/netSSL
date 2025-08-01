# Docker Deployment

This folder contains Docker Compose configuration for deploying netSSL using pre-built images from GitHub Container Registry.

## Quick Start

### Download Docker Compose File
```bash
# Download docker-compose.yml directly from GitHub
wget https://raw.githubusercontent.com/sieteunoseis/netSSL/master/docker/docker-compose.yml

# Or download entire docker folder
wget -r --no-parent --reject="index.html*" https://raw.githubusercontent.com/sieteunoseis/netSSL/master/docker/
```

### Run Application
```bash
# Start the application
docker compose up -d

# Check logs
docker compose logs -f

# Stop the application
docker compose down
```

## Configuration

### Environment Variables
Create and customize the environment file:
```bash
# Create .env file with your configuration
cat > .env << EOF
VITE_BRANDING_URL=https://your-domain.com
VITE_BRANDING_NAME=Your Company Name
VITE_TABLE_COLUMNS=name,hostname,username,password,version
PORT=5000
NODE_ENV=production
LETSENCRYPT_STAGING=false
# Add DNS provider credentials as needed
EOF
```

### Single Container Image
The compose file pulls the unified image from GitHub Container Registry:
- `ghcr.io/sieteunoseis/netssl:latest`

### Port Configuration
- **Application**: http://localhost:3000 (nginx serves frontend + API proxy)
- **Internal Backend**: Port 5000 (not exposed externally)

## Testing Different Versions

To test specific versions, update the docker-compose.yml image tags:

```yaml
services:
  app:
    image: ghcr.io/sieteunoseis/netssl:v1.1.0
```

## Data Persistence

Database data is persisted in a Docker volume `backend_data`. To reset:

```bash
docker compose down -v  # Remove volumes
docker compose up -d    # Start fresh
```

## Troubleshooting

### Apple Silicon (ARM64) Support
Pre-built images support both AMD64 and ARM64 architectures. If you encounter issues with the pre-built images, build locally:

```bash
# Clone the repository
git clone https://github.com/sieteunoseis/netSSL.git
cd netSSL

# Create .env file (optional, has sensible defaults)
cp .env.example .env

# Build and run locally using root docker-compose.yaml
docker compose -f docker-compose.yaml up -d --build
```

Or download just the build compose file:
```bash
# Download the local build version
wget https://raw.githubusercontent.com/sieteunoseis/netSSL/master/docker-compose.yaml

# Build and run
docker compose -f docker-compose.yaml up -d --build
```

### Image Pull Issues
If images aren't available in GitHub Container Registry yet:
```bash
# Build images locally first
cd ..
docker compose build
docker tag netssl ghcr.io/sieteunoseis/netssl:latest
```

### Health Check Failures
```bash
# Check backend health
curl http://localhost:3000/health

# Check backend logs
docker compose logs backend
```

### Container Communication Issues
```bash
# Test internal network connectivity
docker compose exec react-frontend ping react-backend
docker compose exec react-frontend curl http://backend:3000/health

# If using different container names, override the backend host
BACKEND_HOST=react-backend docker compose up -d
```

## Development vs Testing

| Environment | Frontend | Backend | Use Case |
|-------------|----------|---------|-----------|
| **Development** | `npm run dev` | `npm run dev` | Local development with hot reload |
| **Local Docker** | `docker compose up` | `docker compose up` | Test production build locally |
| **Testing** | Pre-built images | Pre-built images | Test deployed versions |

## Monitoring

### Container Status
```bash
docker-compose ps
docker-compose top
```

### Resource Usage
```bash
docker stats
```

### Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
```