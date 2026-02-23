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
Create a `.env` file in the same directory as the docker-compose.yml:
```bash
# Create .env file with your configuration
cat > .env << EOF
# Basic Configuration
VITE_BRANDING_URL=https://your-domain.com
VITE_BRANDING_NAME=Your Company Name
PORT=5000
NODE_ENV=production

# Let's Encrypt Configuration
LETSENCRYPT_STAGING=false
LETSENCRYPT_EMAIL=your-email@domain.com

# DNS Provider Credentials (add as needed)
# CLOUDFLARE_TOKEN=your-cloudflare-token
# AWS_ACCESS_KEY=your-aws-access-key
# AWS_SECRET_KEY=your-aws-secret-key
# DO_KEY=your-digitalocean-token
EOF
```

The docker-compose.yml will automatically load all variables from the `.env` file.

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

Data is persisted in Docker named volumes:
- `app_db`: Database files (SQLite)
- `app_accounts`: SSL certificates and Let's Encrypt accounts

**Important**: The backend creates files at `/app/backend/db` and `/app/backend/accounts` inside the container.

### Volume Management

Docker automatically manages permissions for named volumes. No manual permission setup is required.

```bash
# List volumes
docker volume ls

# Inspect a volume
docker volume inspect netssl_app_db

# Backup volumes
docker run --rm -v netssl_app_db:/data -v $(pwd):/backup alpine tar czf /backup/db-backup.tar.gz -C /data .
docker run --rm -v netssl_app_accounts:/data -v $(pwd):/backup alpine tar czf /backup/accounts-backup.tar.gz -C /data .

# Restore volumes
docker run --rm -v netssl_app_db:/data -v $(pwd):/backup alpine tar xzf /backup/db-backup.tar.gz -C /data
docker run --rm -v netssl_app_accounts:/data -v $(pwd):/backup alpine tar xzf /backup/accounts-backup.tar.gz -C /data
```

To reset all data:
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
# Check application health
curl http://localhost:3000/api/data

# Check logs
docker compose logs app
```

### Container Communication Issues
```bash
# Check if backend is running
docker compose exec app ps aux | grep node

# Check database location
docker compose exec app ls -la /app/backend/db/

# Check accounts/certificates location
docker compose exec app ls -la /app/backend/accounts/
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

# Application logs
docker-compose logs -f app
```