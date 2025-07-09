# Certificate Renewal Implementation Plan

## 📋 **Current Status**

### **✅ COMPLETED (as of 2025-07-09):**
- ✅ CSR generation from CUCM API (working with authentication)
- ✅ Database schema with password storage and retrieval
- ✅ Authentication to CUCM API resolved (401 errors fixed)
- ✅ Account folder structure for Docker persistence (`accounts/cucm01-pub.automate.builders/`)
- ✅ Password visibility in UI with eye icon toggle
- ✅ Separate hostname/domain configuration (`cucm01-pub` + `automate.builders`)
- ✅ Certificate renewal service module with status tracking
- ✅ Settings management for API keys (Let's Encrypt, Cloudflare, etc.)

### **🔍 CURRENT STATE:**
- **Working CSR Generation**: Successfully creates CSR files in `accounts/` folder
- **Database**: Fresh schema with password column working correctly
- **Authentication**: CUCM API calls working with credentials
- **UI**: Password visibility, connection management, renewal status modal
- **Backend**: Express API with certificate renewal endpoints

---

## 🔄 **NEXT STEPS - PRIORITY ORDER**

### **Phase 1: Let's Encrypt Integration (HIGH PRIORITY)**

#### **1.1 Install ACME Client Library**
```bash
cd backend && npm install acme-client
```

#### **1.2 Implement ACME Account Registration**
- **File**: `backend/src/acme-client.ts`
- **Function**: `createLetsEncryptAccount(email: string)`
- **Store**: Account key in `accounts/[domain]/account.key`

#### **1.3 Certificate Request Implementation**
- **File**: `backend/src/certificate-renewal.ts` (update existing)
- **Function**: `requestLetsEncryptCertificate()`
- **Input**: CSR from CUCM
- **Output**: Certificate order for DNS validation

#### **1.4 Order Status Tracking**
- **Function**: `checkOrderStatus(orderUrl: string)`
- **Handle**: pending, ready, processing, valid, invalid states

---

### **Phase 2: DNS Challenge Management (HIGH PRIORITY)**

#### **2.1 Cloudflare DNS API Integration**
- **File**: `backend/src/dns-providers/cloudflare.ts`
- **Functions**:
  - `createTxtRecord(domain: string, value: string)`
  - `deleteTxtRecord(domain: string, recordId: string)`
  - `verifyTxtRecord(domain: string, expectedValue: string)`
- **Settings**: Use existing `CF_KEY` and `CF_ZONE` from settings table

#### **2.2 DigitalOcean DNS API**
- **File**: `backend/src/dns-providers/digitalocean.ts`
- **Similar functions as Cloudflare**
- **Settings**: `DO_KEY` from settings table

#### **2.3 AWS Route53 Integration**
- **File**: `backend/src/dns-providers/route53.ts`
- **Settings**: `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_ZONE_ID`

#### **2.4 DNS Propagation Checking**
- **Function**: `waitForDnsPropagation(domain: string, txtValue: string)`
- **Method**: Query multiple DNS servers until TXT record propagates
- **Timeout**: 5-10 minutes max wait

---

### **Phase 3: Certificate Upload to CUCM (HIGH PRIORITY)**

#### **3.1 Certificate Chain Parsing**
- **Function**: `parseCertificateChain(pemData: string)`
- **Extract**: Certificate, intermediate, root certificates
- **Format**: Prepare for CUCM API requirements

#### **3.2 CUCM Certificate Upload**
- **File**: `backend/src/certificate-renewal.ts` (update existing `uploadCertificateToCUCM`)
- **Endpoint**: `POST /platformcom/api/v1/certmgr/config/certificate`
- **Payload**: Certificate content, service restart flag
- **Verification**: Confirm upload success

#### **3.3 Service Restart Handling**
- **Monitor**: CUCM service restart process
- **Timeout**: Handle long restart times
- **Verification**: Check certificate is active

---

### **Phase 4: Complete Workflow Orchestration (MEDIUM PRIORITY)**

#### **4.1 End-to-End Renewal Flow**
Update `backend/src/certificate-renewal.ts`:
```typescript
async performRenewal() {
  1. Generate CSR from CUCM ✅ (already working)
  2. Create Let's Encrypt account (if needed)
  3. Request certificate from Let's Encrypt
  4. Handle DNS challenge (create TXT record)
  5. Wait for DNS propagation
  6. Complete Let's Encrypt validation
  7. Download certificate
  8. Upload certificate to CUCM
  9. Restart CUCM services
  10. Verify new certificate is active
  11. Clean up DNS records
  12. Update database with renewal info
}
```

#### **4.2 Enhanced Error Handling**
- **Retry Logic**: Exponential backoff for temporary failures
- **Rollback**: Restore previous certificate if upload fails
- **Logging**: Detailed logs for troubleshooting

#### **4.3 Status Tracking Updates**
Update renewal status with more granular steps:
- `generating_csr` ✅
- `creating_account`
- `requesting_certificate`
- `creating_dns_challenge`
- `waiting_dns_propagation`
- `completing_validation`
- `downloading_certificate`
- `uploading_certificate`
- `restarting_services`
- `verifying_certificate`
- `cleaning_up`
- `completed`

---

### **Phase 5: Production Features (LOW PRIORITY)**

#### **5.1 Automated Scheduling**
- **Cron Jobs**: Schedule renewals 30 days before expiry
- **Queue System**: Handle multiple simultaneous renewals
- **Rate Limiting**: Respect Let's Encrypt rate limits

#### **5.2 Certificate Monitoring**
- **Expiry Alerts**: Email/webhook notifications
- **Health Checks**: Verify certificate validity
- **Dashboard**: Real-time certificate status

#### **5.3 Advanced Features**
- **Multi-server clusters**: Handle certificate distribution
- **Backup/rollback**: Emergency certificate restoration
- **Certificate templates**: Support different certificate types

---

## 📁 **FILE STRUCTURE REFERENCE**

```
backend/
├── src/
│   ├── certificate-renewal.ts     ✅ Main renewal orchestration
│   ├── acme-client.ts             ← NEW: Let's Encrypt integration
│   ├── dns-providers/             ← NEW: DNS challenge handlers
│   │   ├── cloudflare.ts
│   │   ├── digitalocean.ts
│   │   └── route53.ts
│   ├── account-manager.ts         ✅ File management
│   ├── database.ts                ✅ Data persistence
│   └── validation.ts              ✅ Input validation
├── accounts/                      ✅ Certificate storage
│   └── cucm01-pub.automate.builders/
│       ├── csr.pem               ✅ Generated CSR
│       ├── account.key           ← NEW: Let's Encrypt account
│       ├── certificate.pem       ← NEW: Final certificate
│       ├── chain.pem             ← NEW: Certificate chain
│       ├── private.key           ← NEW: Private key
│       └── renewal.log           ✅ Renewal history
└── package.json                   ← ADD: acme-client dependency
```

---

## 🔧 **TECHNICAL CONSIDERATIONS**

### **Security**
- Store private keys with restricted permissions
- Use environment variables for API keys
- Implement proper key rotation

### **Rate Limits**
- Let's Encrypt: 50 certificates per domain per week
- DNS APIs: Vary by provider
- Implement queuing for high-volume scenarios

### **Error Recovery**
- Handle partial failures gracefully
- Store intermediate state for resume capability
- Implement certificate rollback procedures

### **Docker Considerations**
- Ensure `accounts/` folder persists across container restarts
- Use volume mounts for certificate storage
- Handle file permissions correctly

---

## 📋 **IMMEDIATE NEXT SESSION TASKS**

1. **Install ACME client**: `npm install acme-client`
2. **Create acme-client.ts**: Implement Let's Encrypt account creation
3. **Test certificate request**: Basic ACME flow without DNS challenges
4. **Implement Cloudflare DNS**: Create/delete TXT records
5. **Test DNS challenge**: Complete DNS-01 validation
6. **Update renewal flow**: Chain CSR → Let's Encrypt → DNS → Upload

---

## 🚀 **SUCCESS CRITERIA**

### **Phase 1 Complete When:**
- Can request certificates from Let's Encrypt
- Account registration working
- Basic ACME client integration functional

### **Phase 2 Complete When:**
- DNS TXT records created/deleted successfully
- DNS propagation checking working
- At least Cloudflare provider fully functional

### **Phase 3 Complete When:**
- Certificates upload to CUCM successfully
- CUCM services restart properly
- New certificate verified as active

### **Final Success:**
- Complete end-to-end renewal: CSR → Let's Encrypt → DNS → Upload → Verify
- All steps logged and tracked
- Error handling robust
- Ready for production use

---

## 📞 **REFERENCE INFORMATION**

### **CUCM API Endpoints**
- **CSR Generation**: `POST /platformcom/api/v1/certmgr/config/csr` ✅
- **Certificate Upload**: `POST /platformcom/api/v1/certmgr/config/certificate`

### **Let's Encrypt ACME API**
- **Directory**: `https://acme-v02.api.letsencrypt.org/directory`
- **Staging**: `https://acme-staging-v02.api.letsencrypt.org/directory`

### **DNS Provider APIs**
- **Cloudflare**: `https://api.cloudflare.com/client/v4/`
- **DigitalOcean**: `https://api.digitalocean.com/v2/`
- **AWS Route53**: AWS SDK

### **Current Settings Schema**
```sql
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  key_name TEXT UNIQUE,     -- e.g., "LETSENCRYPT_EMAIL"
  key_value TEXT,           -- e.g., "admin@automate.builders"
  provider TEXT,            -- e.g., "letsencrypt"
  description TEXT,         -- Human-readable description
  created_at DATETIME,
  updated_at DATETIME
);
```

---

*Plan created: 2025-07-09*  
*Next session: Continue with Phase 1 - Let's Encrypt Integration*