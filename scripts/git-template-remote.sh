#!/bin/bash

# See https://www.mslinn.com/blog/2020/11/30/propagating-git-template-changes.html

function help {
  if [ "$1" ]; then printf "\nError: $1\n\n"; fi
  echo "Usage:

$0 [--fresh] [--no-backend] [--no-history] templateUrl newProjectName

Options:
  --fresh        Start with a fresh git history (removes template commit history)
  --no-backend   Remove backend folder and configure for frontend-only
  --no-history   Create repository with no commit history (same as --fresh)"
  exit 1
}

if [ -z "$(which git)" ]; then
  echo "Please install git and rerun this script"
  exit 2
fi

if [ -z "$(which hub)" ]; then
  echo "Please install hub and rerun this script"
  exit 3
fi

# Parse arguments
FRESH_HISTORY=false
NO_BACKEND=false
TEMPLATE_URL=""
PROJECT_NAME=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --fresh|--no-history)
      FRESH_HISTORY=true
      shift
      ;;
    --no-backend)
      NO_BACKEND=true
      shift
      ;;
    -*)
      help "Unknown option: $1"
      ;;
    *)
      if [ -z "$TEMPLATE_URL" ]; then
        TEMPLATE_URL="$1"
      elif [ -z "$PROJECT_NAME" ]; then
        PROJECT_NAME="$1"
      else
        help "Too many arguments"
      fi
      shift
      ;;
  esac
done

if [ -z "$TEMPLATE_URL" ]; then help "No git project was specified as a template."; fi
if [ -z "$PROJECT_NAME" ]; then help "Please provide the name of the new project based on the template"; fi

git clone "$TEMPLATE_URL" "$PROJECT_NAME"
cd "$PROJECT_NAME"

# Configure template for frontend-only if requested
if [ "$NO_BACKEND" = true ]; then
  echo "Configuring for frontend-only project..."
  rm -rf backend
  
  # Update template config for frontend-only
  if [ -f "template.config.json" ]; then
    # Use sed to set useBackend to false
    sed -i '' 's/"useBackend": true/"useBackend": false/' template.config.json
    echo "✓ Set useBackend: false in template.config.json"
  fi
  
  # Remove backend-related scripts from package.json
  if [ -f "package.json" ]; then
    # Remove backend-related scripts but keep the structure
    sed -i '' '/"start":/c\
    "start": "npm run start --prefix frontend",
' package.json
    sed -i '' '/"dev":/c\
    "dev": "npm run dev --prefix frontend",
' package.json
    sed -i '' '/"install-all":/c\
    "install-all": "npm install && cd frontend && npm install",
' package.json
    echo "✓ Updated package.json for frontend-only"
  fi
  
  # Update docker-compose.yml to only include frontend
  if [ -f "docker-compose.yml" ]; then
    # Create a frontend-only docker-compose.yml
    cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    user: "${UID:-1000}:${GID:-1000}"
EOF
    echo "✓ Updated docker-compose.yml for frontend-only"
  fi
  
  # Update docker/ folder for frontend-only
  if [ -d "docker" ]; then
    # Update docker/docker-compose.yml for frontend-only
    cat > docker/docker-compose.yml << 'EOF'
# Docker Compose for Testing with Pre-built Images (Frontend-only)
# This pulls frontend image from GitHub Container Registry for testing purposes

name: react-express-tailwind-app

services:
  frontend:
    image: ghcr.io/sieteunoseis/react-express-tailwind-app/frontend:${FRONTEND_TAG:-latest}
    container_name: react-frontend
    ports:
      - "3000:80"
    networks:
      - app-network
    environment:
      - VITE_BRANDING_NAME=${VITE_BRANDING_NAME:-Automate Builders}
      - VITE_BRANDING_URL=${VITE_BRANDING_URL:-https://automate.builders}
      - VITE_BACKGROUND_LOGO_TEXT=${VITE_BACKGROUND_LOGO_TEXT:-AB}
    restart: unless-stopped

networks:
  app-network:
    driver: bridge
EOF

    # Update docker/docker-compose.dev.yml for frontend-only
    cat > docker/docker-compose.dev.yml << 'EOF'
# Docker Compose for Testing with Local Build (Frontend-only)
# This builds the frontend locally for testing

name: react-express-tailwind-app-dev

services:
  frontend:
    build: 
      context: ../frontend
      dockerfile: Dockerfile
    container_name: react-frontend-dev
    ports:
      - "3000:80"
    networks:
      - app-network
    environment:
      - VITE_BRANDING_NAME=${VITE_BRANDING_NAME:-Automate Builders}
      - VITE_BRANDING_URL=${VITE_BRANDING_URL:-https://automate.builders}
      - VITE_BACKGROUND_LOGO_TEXT=${VITE_BACKGROUND_LOGO_TEXT:-AB}
    restart: unless-stopped

networks:
  app-network:
    driver: bridge
EOF
    echo "✓ Updated docker/ folder for frontend-only"
  fi
  
  # Update GitHub workflow for frontend-only
  if [ -f ".github/workflows/docker-build.yml" ]; then
    cat > .github/workflows/docker-build.yml << 'EOF'
name: Build and Push Docker Images (Frontend-only)

on:
  push:
    branches: [ main, security-stability-improvements ]
    tags: [ 'v*' ]
  pull_request:
    branches: [ main ]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
    - name: Checkout repository
      uses: actions/checkout@v4

    - name: Log in to Container Registry
      if: github.event_name != 'pull_request'
      uses: docker/login-action@v3
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v5
      with:
        images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/frontend
        tags: |
          type=ref,event=branch
          type=ref,event=pr
          type=semver,pattern={{version}}
          type=semver,pattern={{major}}.{{minor}}
          type=semver,pattern={{major}}
          type=raw,value=latest,enable={{is_default_branch}}
          type=sha

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Build and push Docker image
      uses: docker/build-push-action@v5
      with:
        context: ./frontend
        platforms: linux/amd64,linux/arm64
        push: ${{ github.event_name != 'pull_request' }}
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max

  test-docker:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.event_name != 'pull_request'
    
    steps:
    - name: Checkout repository
      uses: actions/checkout@v4

    - name: Test Docker deployment
      run: |
        cd docker
        # Create minimal .env file for frontend-only
        echo "VITE_BRANDING_URL=https://automate.builders" > .env
        echo "VITE_BRANDING_NAME=Automate Builders" >> .env
        echo "VITE_BACKGROUND_LOGO_TEXT=AB" >> .env
        echo "UID=1000" >> .env
        echo "GID=1000" >> .env
        
        # Use the latest frontend image
        export FRONTEND_TAG=latest
        
        # Start frontend service
        docker compose up -d
        
        # Wait for service
        sleep 15
        
        # Test frontend
        curl -f "http://localhost:3000" || exit 1
        
        # Cleanup
        docker compose down
EOF
    echo "✓ Updated GitHub workflow for frontend-only"
  fi
  
  echo "✓ Backend folder removed and configuration updated"
fi

if [ "$FRESH_HISTORY" = true ]; then
  echo "Creating fresh git history..."
  rm -rf .git
  git init
  git add .
  git commit -m "Initial commit from template"
else
  git remote rename origin upstream
  git remote set-url --push upstream no_push
fi

# Add the -p option to create a private repository
hub create "$PROJECT_NAME"
git branch -M master
git push -u origin master