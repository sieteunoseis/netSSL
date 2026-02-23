# Apprise Integration Plan

## Overview

Integrate [Apprise](https://github.com/caronc/apprise) (`caronc/apprise`) as the notification gateway for netSSL certificate renewal events. Apprise handles delivery to 100+ services — netSSL just POSTs to it.

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `APPRISE_URL` | Apprise container endpoint | `http://apprise:8000` |
| `APPRISE_NOTIFICATION_URLS` | Comma-separated notification targets | `msteams://TokenA/TokenB,slack://Token` |

### Notification URL Examples

| Service | URL Format |
|---------|------------|
| MS Teams | `msteams://TokenA/TokenB/TokenC` |
| Slack | `slack://TokenA/TokenB/TokenC` |
| Email | `mailto://user:pass@gmail.com` |
| Discord | `discord://WebhookID/WebhookToken` |
| Telegram | `tgram://BotToken/ChatID` |
| Pushover | `pover://UserKey@AppToken` |
| Gotify | `gotify://hostname/token` |

Full list: https://github.com/caronc/apprise/wiki

## Events to Notify On

| Event | Type | Example Message |
|-------|------|-----------------|
| Renewal success | `success` | Certificate renewed for cucm01.example.com, expires 2026-05-21 |
| Renewal failure | `failure` | Renewal failed for cucm01.example.com: DNS challenge timeout |
| Certificate expiring soon | `warning` | Certificate for cucm01.example.com expires in 7 days |
| Certificate expired | `failure` | Certificate for cucm01.example.com has expired |
| Service restart success | `success` | Cisco Tomcat restarted successfully on cucm01.example.com |
| Service restart failure | `warning` | Service restart timed out on cucm01.example.com — manual verification recommended |

## Backend Implementation

### New file: `backend/src/notifications.ts`

```typescript
import { Logger } from './logger';

interface NotificationOptions {
  title: string;
  body: string;
  type?: 'info' | 'success' | 'warning' | 'failure';
}

export async function notify({ title, body, type = 'info' }: NotificationOptions): Promise<void> {
  const appriseUrl = process.env.APPRISE_URL;
  const notificationUrls = process.env.APPRISE_NOTIFICATION_URLS;

  if (!appriseUrl || !notificationUrls) return;

  try {
    const response = await fetch(`${appriseUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: notificationUrls.split(',').map(u => u.trim()),
        title,
        body,
        type,
      }),
    });

    if (!response.ok) {
      Logger.warn(`Apprise notification failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    // Don't let notification failures break renewals
    Logger.warn(`Apprise notification error: ${error instanceof Error ? error.message : error}`);
  }
}
```

### Integration points

1. **`certificate-renewal.ts`** — after renewal success/failure:
   ```typescript
   import { notify } from './notifications';

   // On success
   await notify({
     title: 'Certificate Renewed',
     body: `Certificate renewed for ${domain}, expires ${expiryDate}`,
     type: 'success',
   });

   // On failure
   await notify({
     title: 'Certificate Renewal Failed',
     body: `Renewal failed for ${domain}: ${error.message}`,
     type: 'failure',
   });
   ```

2. **`auto-renewal-cron.ts`** — after scheduled renewal events and service restarts:
   ```typescript
   // On expiry warning (during cert check)
   await notify({
     title: 'Certificate Expiring Soon',
     body: `Certificate for ${domain} expires in ${daysLeft} days`,
     type: 'warning',
   });

   // On service restart timeout
   await notify({
     title: 'Service Restart Timeout',
     body: `Tomcat restart timed out on ${fqdn} — manual verification recommended`,
     type: 'warning',
   });
   ```

### Docker Compose

Already included in `docker/docker-compose.full-stack.yml`. Add env vars:

```yaml
app:
  environment:
    - APPRISE_URL=http://apprise:8000
    - APPRISE_NOTIFICATION_URLS=${APPRISE_NOTIFICATION_URLS:-}
```

## UI (Optional — Phase 2)

- Settings modal section to configure notification URLs
- "Send Test Notification" button
- Per-connection notification toggle (store in database)
- Notification history/log viewer

## Scope Estimate

- **Phase 1** (core): `notifications.ts` + hook into renewal/cron — ~50 lines of new code
- **Phase 2** (UI): Settings configuration + test button — moderate
- **Phase 3** (per-connection): Database column + granular routing — moderate

## Related

- GitHub Issue: https://github.com/sieteunoseis/netSSL/issues/7
- Docker config: `docker/docker-compose.full-stack.yml`
- Apprise API docs: https://github.com/caronc/apprise-api
