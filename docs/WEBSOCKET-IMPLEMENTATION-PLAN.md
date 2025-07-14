# WebSocket Implementation Plan

## Overview
Implement WebSocket support for real-time status updates across SSH Testing, SSH Restart Service, and Certificate Renewal operations. This will provide immediate feedback to users and prevent duplicate operations.

## Architecture Design

### Backend Architecture
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Express API   │────▶│ Operation Status │────▶│  WebSocket.io   │
│   Endpoints     │     │    Manager       │     │     Server      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                         │
         ▼                       ▼                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  SSH Operations │     │  SQLite Database │     │  Frontend Clients│
│  Background Jobs│     │  Status Tracking │     │   (React Apps)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Key Components

1. **Operation Status Manager**
   - Centralized service for tracking all active operations
   - Prevents duplicate operations
   - Emits WebSocket events for status changes
   - Maintains operation history

2. **WebSocket Events**
   ```typescript
   // Event types
   'operation:start'    // When any operation begins
   'operation:update'   // Progress updates
   'operation:complete' // Operation finished successfully
   'operation:error'    // Operation failed
   ```

3. **Operation Types**
   - `ssh_test` - SSH connection testing
   - `service_restart` - Cisco Tomcat service restart
   - `certificate_renewal` - Let's Encrypt certificate renewal

## Database Schema

### New Table: `active_operations`
```sql
CREATE TABLE active_operations (
  id TEXT PRIMARY KEY,
  connection_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL, -- 'ssh_test', 'service_restart', 'certificate_renewal'
  status TEXT NOT NULL, -- 'pending', 'in_progress', 'completed', 'failed'
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  progress INTEGER DEFAULT 0,
  message TEXT,
  error TEXT,
  metadata TEXT, -- JSON string for operation-specific data
  created_by TEXT, -- 'user', 'cron', 'auto'
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

CREATE INDEX idx_active_operations_connection ON active_operations(connection_id);
CREATE INDEX idx_active_operations_status ON active_operations(status);
```

## Implementation Steps

### Phase 1: Core Infrastructure

1. **Install Dependencies**
   ```bash
   # Backend
   cd backend && npm install socket.io @types/socket.io
   
   # Frontend  
   cd frontend && npm install socket.io-client
   ```

2. **Create Operation Status Manager** (`backend/src/operation-status-manager.ts`)
   - Track active operations in memory and database
   - Prevent duplicate operations
   - Emit WebSocket events
   - Clean up completed operations

3. **Initialize WebSocket Server** (`backend/src/websocket-server.ts`)
   - Set up socket.io with Express
   - Handle client connections/disconnections
   - Implement room-based subscriptions per connection

### Phase 2: Backend Integration

4. **Update SSH Test Endpoint**
   - Check for active SSH tests before starting
   - Emit real-time status updates
   - Store operation status in database

5. **Update Restart Service Endpoint**
   - Check for active restarts
   - Emit progress events during 5-minute operation
   - Handle long-running operation tracking

6. **Update Certificate Renewal**
   - Check for active renewals (including cron-initiated)
   - Prevent duplicate renewals
   - Emit detailed progress for each renewal step

### Phase 3: Frontend Integration

7. **Create WebSocket Context** (`frontend/src/contexts/WebSocketContext.tsx`)
   - Manage socket connection lifecycle
   - Handle reconnection logic
   - Provide hooks for components

8. **Create Operation Status Hook** (`frontend/src/hooks/useOperationStatus.ts`)
   - Subscribe to operation updates
   - Manage local state sync
   - Handle connection loss gracefully

9. **Update UI Components**
   - Show "Processing..." states for active operations
   - Display real-time progress
   - Disable buttons during operations
   - Show operation history

### Phase 4: Docker & Production

10. **Update Docker Configuration**
    - Map WebSocket port (3000)
    - Configure nginx for WebSocket proxy
    - Handle container networking

11. **Update nginx.conf**
    ```nginx
    location /socket.io/ {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    ```

## API Changes

### SSH Test
```typescript
POST /api/data/:id/test-connection
Response: {
  operationId: string,
  status: 'started',
  message: 'SSH test initiated'
}
```

### Restart Service  
```typescript
POST /api/data/:id/restart-service
Response: {
  operationId: string,
  status: 'started',
  message: 'Service restart initiated',
  estimatedDuration: 300000 // 5 minutes
}
```

### Certificate Renewal
```typescript
POST /api/data/:id/issue-cert
Response: {
  operationId: string,
  renewalId: string,
  status: 'started' | 'already_running',
  existingOperation?: {
    operationId: string,
    progress: number,
    message: string
  }
}
```

## UI/UX Improvements

1. **Button States**
   - Normal: "Test SSH", "Restart Service", "Renew Certificate"
   - Active: "Testing...", "Restarting... (4:32 remaining)", "Processing Renewal (60%)"
   - Completed: Show success briefly, then return to normal
   - Failed: Show error state with retry option

2. **Progress Indicators**
   - SSH Test: Simple spinner
   - Restart Service: Progress bar with time remaining
   - Certificate Renewal: Multi-step progress with current action

3. **Cross-Session Sync**
   - If user opens multiple tabs, all show same status
   - If user logs out/in during operation, status persists
   - Mobile and desktop sync in real-time

## Error Handling

1. **Connection Loss**
   - Automatic reconnection with exponential backoff
   - Queue updates during disconnection
   - Sync state on reconnection

2. **Operation Failures**
   - Clear error messages
   - Retry capabilities
   - Cleanup incomplete operations

3. **Concurrent Operations**
   - Prevent same operation running twice
   - Allow different operations on same connection
   - Handle race conditions

## Testing Strategy

1. **Unit Tests**
   - Operation Status Manager logic
   - WebSocket event handling
   - Database operation tracking

2. **Integration Tests**
   - Full operation lifecycle
   - Multi-client scenarios
   - Failure recovery

3. **E2E Tests**
   - User workflows with WebSocket
   - Page refresh during operations
   - Multiple browser testing

## Security Considerations

1. **Authentication**
   - Validate WebSocket connections
   - Use existing auth tokens
   - Prevent unauthorized subscriptions

2. **Rate Limiting**
   - Limit operation requests per connection
   - Prevent WebSocket spam
   - Monitor for abuse

3. **Data Isolation**
   - Users only see their own operations
   - Proper room-based isolation
   - No data leakage between connections

## Rollback Plan

1. Feature flag for WebSocket functionality
2. Fallback to polling if WebSocket fails
3. Gradual rollout to subset of users
4. Easy disable via environment variable

## Success Metrics

1. Reduced duplicate operations (target: 0%)
2. Improved user satisfaction with real-time feedback
3. Reduced server load from polling
4. Better visibility into long-running operations
5. Fewer support tickets about "stuck" operations