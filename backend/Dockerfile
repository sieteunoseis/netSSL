# Use specific version and lighter base image
FROM node:20-alpine

# Install required system packages
RUN apk add --no-cache openssl

# Add non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create app directory and set ownership
WORKDIR /usr/src/app

# Create directories as root and set ownership immediately
RUN mkdir -p /usr/src/app/db /usr/src/app/data && \
    chown -R appuser:appgroup /usr/src/app && \
    chmod 755 /usr/src/app/db /usr/src/app/data

# Copy package files
COPY --chown=appuser:appgroup package*.json ./
COPY --chown=appuser:appgroup tsconfig.json ./

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm ci

# Copy source code with correct ownership
COPY --chown=appuser:appgroup src/ ./src/

# Build TypeScript
RUN npm run build

# Remove devDependencies and source files to keep image lean
RUN npm prune --production && rm -rf src/ tsconfig.json

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5000

# Command to run the application
CMD [ "node", "dist/server.js" ]