# Multi-stage build for unified frontend and backend container
FROM node:20.18-alpine3.20 AS build

# Install PM2 globally for process management
RUN npm install -g pm2

# Build backend first
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/tsconfig.json ./
RUN npm ci

COPY backend/src/ ./src/
RUN npm run build

# Remove devDependencies for backend
RUN npm prune --production

# Build frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
ENV NODE_ENV=production
ENV VITE_API_URL=/api
RUN npm run build

# Production stage
FROM node:20.18-alpine3.20

# Update packages and install nginx and PM2
RUN apk update && apk upgrade && apk add --no-cache nginx curl && \
    npm install -g pm2@5.4.3

# Add non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create app directories
WORKDIR /app
RUN mkdir -p /app/backend /app/frontend/dist /app/db /app/accounts && \
    chown -R appuser:appgroup /app && \
    chmod 755 /app/db /app/accounts

# Copy built backend
COPY --from=build --chown=appuser:appgroup /app/backend/dist /app/backend/dist
COPY --from=build --chown=appuser:appgroup /app/backend/node_modules /app/backend/node_modules
COPY --from=build --chown=appuser:appgroup /app/backend/package.json /app/backend/

# Copy built frontend
COPY --from=build --chown=appuser:appgroup /app/frontend/dist /app/frontend/dist

# Create nginx configuration
RUN mkdir -p /etc/nginx/http.d
COPY <<'EOF' /etc/nginx/nginx.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log notice;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    
    access_log /var/log/nginx/access.log main;
    
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;
    gzip on;
    
    # Frontend server
    server {
        listen 80;
        server_name _;
        root /app/frontend/dist;
        index index.html;
        
        # Serve static files
        location / {
            try_files $uri $uri/ /index.html;
        }
        
        # Proxy API requests to backend
        location /api/ {
            proxy_pass http://127.0.0.1:5000/api/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 86400;
        }
        
        # Proxy WebSocket connections
        location /socket.io/ {
            proxy_pass http://127.0.0.1:5000/socket.io/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
EOF

# Create PM2 ecosystem configuration
COPY <<'EOF' /app/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'backend',
      script: '/app/backend/dist/server.js',
      cwd: '/app/backend',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      user: 'appuser',
      group: 'appgroup'
    },
    {
      name: 'nginx',
      script: 'nginx',
      args: '-g "daemon off;"'
    }
  ]
};
EOF

# Create startup script
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e

# Start PM2 with ecosystem file
exec pm2-runtime start /app/ecosystem.config.js
EOF

RUN chmod +x /app/start.sh

# Switch to non-root user for backend files
RUN chown -R appuser:appgroup /app/backend /app/db /app/accounts

# Expose port 80 for nginx
EXPOSE 80

# Start both services using PM2
CMD ["/app/start.sh"]