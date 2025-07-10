# Let's Encrypt Certificate Troubleshooting Guide

This document provides guidance for troubleshooting Let's Encrypt certificate validation failures and DNS-related issues in the VOS SSH Dashboard.

## Common Issues and Solutions

### 1. DNS TXT Record Challenge Failures

#### Problem
Let's Encrypt validation fails when DNS TXT records cannot be properly verified.

#### Root Causes
- **DNS Propagation Delays**: TXT records may not have propagated to all DNS servers yet
- **DNS Provider API Issues**: Cloudflare API rate limiting or authentication problems
- **Record Cleanup Issues**: Old TXT records not properly cleaned up from previous attempts
- **Domain Configuration**: Incorrect domain setup or delegation issues

#### Solutions
1. **Increase DNS Propagation Wait Time**
   ```typescript
   // In certificate-renewal.ts, increase wait time from 30s to 60-90s
   await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
   ```

2. **Verify DNS Provider Settings**
   - Ensure Cloudflare API tokens have correct permissions
   - Check zone ID is correct for the domain
   - Verify domain is properly delegated to Cloudflare

3. **Manual DNS Verification**
   ```bash
   # Check if TXT record is visible
   dig _acme-challenge.yourserver.yourdomain.com TXT
   nslookup -type=TXT _acme-challenge.yourserver.yourdomain.com
   ```

### 2. Account Key Mismatch Issues

#### Problem
Let's Encrypt rejects requests due to account key mismatches between staging and production environments.

#### Root Causes
- **Mixed Environment Usage**: Using staging keys in production or vice versa
- **Corrupted Account Files**: Account data files become corrupted
- **Directory URL Mismatch**: Account created with different ACME directory URL

#### Solutions
1. **Clear Account Cache**
   ```bash
   # Remove all account files to force recreation
   rm -rf backend/accounts/*/letsencrypt_*.json
   ```

2. **Environment Consistency**
   - Ensure `LETSENCRYPT_STAGING=true` for testing
   - Use `LETSENCRYPT_STAGING=false` or remove for production
   - Don't mix staging and production accounts for the same domain

3. **Account Recreation**
   - Delete specific domain account: `rm backend/accounts/domain.com/letsencrypt_*.json`
   - Next renewal will create fresh account

### 3. Server Restart Issues

#### Problem
Certificate renewal processes are interrupted when the server restarts (nodemon, file changes).

#### Root Causes
- **In-Memory State Loss**: Renewal statuses stored in memory are lost on restart
- **File Watch Triggers**: New account files trigger nodemon restart
- **Process Interruption**: Long-running DNS validation interrupted

#### Solutions
1. **Disable File Watching During Renewal**
   ```bash
   # Use nodemon ignore patterns
   nodemon --ignore 'accounts/**' --exec "node --env-file ../.env -r ts-node/register src/server.ts"
   ```

2. **Persistent Renewal State** (Future Enhancement)
   - Store renewal status in SQLite database instead of memory
   - Implement renewal state recovery on server restart

3. **Manual Account Management**
   - Create accounts beforehand to avoid file creation during renewal
   - Use production environment to reduce file watching sensitivity

### 4. Certificate Upload Failures

#### Problem
Successfully obtained certificates fail to upload to Cisco CUCM servers.

#### Root Causes
- **SSH Connection Issues**: Network connectivity or authentication problems
- **Certificate Format**: CUCM expects specific PEM format
- **File Permissions**: Insufficient permissions on CUCM server
- **Service Restart Required**: CUCM services need restart after cert upload

#### Solutions
1. **Test SSH Connectivity**
   ```bash
   ssh username@cucm-server.domain.com
   # Verify connectivity and authentication
   ```

2. **Certificate Format Validation**
   ```bash
   # Check certificate validity
   openssl x509 -in certificate.pem -text -noout
   # Verify private key matches
   openssl rsa -in private.key -check
   ```

3. **CUCM Certificate Chain**
   - Ensure full certificate chain is provided
   - Include intermediate certificates if required
   - Verify certificate order (server cert first, then intermediates)

## Best Practices

### Development Environment
1. **Use Staging Environment**
   ```bash
   # In .env file
   LETSENCRYPT_STAGING=true
   ```

2. **Test with Single Domain**
   - Start with one domain before testing multiple SANs
   - Verify DNS delegation is working

3. **Monitor Rate Limits**
   - Let's Encrypt staging: 30,000 certs per week
   - Let's Encrypt production: 50 certs per week per domain

### Production Environment
1. **Use Production CA**
   ```bash
   # In .env file
   LETSENCRYPT_STAGING=false
   # or remove the line entirely
   ```

2. **DNS Verification**
   - Always verify DNS records are reachable before starting renewal
   - Use external DNS checkers to confirm propagation

3. **Backup Strategy**
   - Backup account keys before major changes
   - Keep copies of working certificates

## Debugging Commands

### Check DNS Propagation
```bash
# Check TXT record from multiple DNS servers
dig @8.8.8.8 _acme-challenge.server.domain.com TXT
dig @1.1.1.1 _acme-challenge.server.domain.com TXT
dig @208.67.222.222 _acme-challenge.server.domain.com TXT
```

### Verify Certificate Chain
```bash
# Check certificate details
openssl x509 -in certificate.pem -text -noout | grep -E "(Subject|Issuer|DNS)"

# Verify certificate chain
openssl verify -CAfile chain.pem certificate.pem
```

### Test Cloudflare API
```bash
# List DNS records
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json"
```

## Error Message Reference

### Common Error Messages and Meanings

- **"Account key unauthorized"**: Account key doesn't match ACME directory (staging vs production)
- **"DNS record not found"**: TXT record not visible to Let's Encrypt servers
- **"Connection timeout"**: DNS propagation not complete or DNS server unreachable
- **"Challenge failed"**: DNS challenge validation failed, check TXT record content
- **"Rate limit exceeded"**: Hit Let's Encrypt rate limits, wait before retry

## Support Resources

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [ACME Challenge Types](https://letsencrypt.org/docs/challenge-types/)
- [Cloudflare API Documentation](https://developers.cloudflare.com/api/)
- [DNS Propagation Checker](https://dnschecker.org/)

## Recent Changes and Known Issues

### Current Implementation Status
- ✅ Basic Let's Encrypt integration working
- ✅ Cloudflare DNS provider implemented
- ✅ Account management and persistence
- ✅ Certificate renewal status tracking
- ⚠️  DNS cleanup disabled due to validation timing issues
- ⚠️  Server restart handling needs improvement
- ❌ Certificate upload to CUCM not yet implemented

### Immediate Fixes Needed
1. **Re-enable DNS cleanup** after successful validation
2. **Implement persistent renewal state** to survive server restarts
3. **Add certificate upload integration** with Cisco CUCM
4. **Improve error handling** for DNS propagation failures

### Recommended Next Steps
1. Test with production Let's Encrypt environment
2. Implement certificate upload to CUCM servers
3. Add support for multiple DNS providers
4. Create automated testing for renewal process