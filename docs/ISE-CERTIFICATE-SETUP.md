# ISE Guest Portal Certificate Setup with Let's Encrypt

This guide walks through setting up Let's Encrypt certificates for Cisco ISE Guest and Sponsor Portals using custom domain names.

## Overview

ISE Guest and Sponsor Portals typically use IP addresses by default, but Let's Encrypt requires domain names (FQDNs). This process configures DNS records and certificates to enable HTTPS access via domain names.

## Prerequisites

- Cisco ISE deployment with Guest/Sponsor portals configured
- Cloudflare account with domain management access
- Access to ISE administration interface
- VOS SSH Dashboard with Let's Encrypt integration

## Step-by-Step Process

### Step 1: DNS Configuration

Create DNS A records in Cloudflare pointing to your ISE nodes:

#### Example DNS Records
```
guest1.automate.builders    → 10.10.20.77
guest2.automate.builders    → 10.10.20.78
sponsor.automate.builders   → 10.10.20.77
```

#### Cloudflare Setup
1. Log into Cloudflare dashboard
2. Select your domain (e.g., `automate.builders`)
3. Go to **DNS** > **Records**
4. Add A records:
   - **Type**: A
   - **Name**: guest1
   - **IPv4 address**: 10.10.20.77
   - **TTL**: Auto
   - **Proxy status**: DNS only (gray cloud)

Repeat for each portal requiring certificates.

### Step 2: Generate Certificate Signing Request (CSR)

#### Option A: Online CSR Generator
1. Visit [CSR Generator](https://csrgenerator.com/)
2. Fill in certificate details:
   - **Common Name**: `guest1.automate.builders`
   - **Organization**: Your organization name
   - **Country**: Your country code
   - **State/Province**: Your state
   - **City**: Your city
   - **Key Size**: 2048 bits (recommended)

3. Generate and download:
   - Certificate Signing Request (CSR)
   - Private Key

#### Option B: OpenSSL Command Line
```bash
openssl req -new -newkey rsa:2048 -nodes -keyout guest1.automate.builders.key -out guest1.automate.builders.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=guest1.automate.builders"
```

### Step 3: Let's Encrypt Certificate Generation

#### Using VOS SSH Dashboard
1. Create new connection in dashboard:
   - **Application Type**: ISE
   - **Portal URL**: `https://guest1.automate.builders:8443/portal/PortalSetup.action?portal=f09aaac2-f101-45ed-832f-fda201ab7639`
   - **SSL Provider**: Let's Encrypt
   - **DNS Provider**: Cloudflare
   - **Custom CSR**: Paste generated CSR
   - **Private Key**: Paste generated private key

2. Run certificate renewal
3. Download generated certificates from: `./accounts/guest1.automate.builders/prod/`

#### Required Certificate Files
- `certificate.pem` - Domain certificate (leaf)
- `intermediate.crt` - R10 intermediate certificate
- `root.crt` - ISRG Root X1 root certificate
- `private_key.pem` - Private key

### Step 4: Upload CA Certificates to ISE

ISE requires the certificate chain to be installed before the domain certificate.

#### Install Intermediate Certificate (R10)
1. ISE Admin → **Administration** → **System** → **Certificates** → **Certificate Authority** → **Certificate Authority Certificates**
2. Click **Import**
3. Upload `intermediate.crt` (R10 Let's Encrypt intermediate)
4. **Friendly Name**: `R10 Let's Encrypt Intermediate`
5. **Usage**: Trust for authentication within ISE
6. Click **Submit**

#### Install Root Certificate (ISRG Root X1)
1. Same location as above
2. Upload `root.crt` (ISRG Root X1)
3. **Friendly Name**: `ISRG Root X1`
4. **Usage**: Trust for authentication within ISE
5. Click **Submit**

### Step 5: Import Guest Portal Certificate

#### Via ISE Web Interface
1. ISE Admin → **Administration** → **System** → **Certificates** → **System Certificates**
2. Click **Import**
3. **Certificate File**: Upload `certificate.pem`
4. **Private Key File**: Upload `private_key.pem`
5. **Friendly Name**: `guest1.automate.builders`
6. **Usage**: 
   - ✅ EAP Authentication
   - ✅ RADIUS DTLS
   - ✅ Admin Portal
   - ✅ Portal
7. Click **Submit**

#### Via ISE API (Optional)
```bash
curl -X POST "https://ise-admin.automate.builders:9060/ers/config/systemcertificate/import" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -u "admin:password" \
  -d '{
    "SystemCertificate": {
      "friendlyName": "guest1.automate.builders",
      "data": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      "privateKeyData": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
      "usedFor": "PORTAL"
    }
  }'
```

### Step 6: Configure Guest Portal FQDN

#### Update Portal Settings
1. ISE Admin → **Work Centers** → **Guest Access** → **Portals & Components** → **Guest Portals**
2. Select your Guest Portal
3. Go to **Portal Settings** tab
4. **FQDN**: Change from IP address to `guest1.automate.builders`
5. **Certificate Template**: Select the imported certificate `guest1.automate.builders`
6. Click **Save**

### Step 7: Test Guest Portal Access

#### Test HTTPS Access
Visit: `https://guest1.automate.builders:8443/portal/PortalSetup.action?portal=f09aaac2-f101-45ed-832f-fda201ab7639`

#### Verify Certificate
1. Check browser shows valid certificate
2. Certificate should show:
   - **Issued to**: guest1.automate.builders
   - **Issued by**: R10
   - **Valid**: ✅ Trusted

## Sponsor Portal Setup

Follow the same process for Sponsor Portal with these modifications:

### DNS Record
```
sponsor.automate.builders   → 10.10.20.77
```

### Portal Configuration
1. **Work Centers** → **Guest Access** → **Portals & Components** → **Sponsor Portals**
2. **FQDN**: `sponsor.automate.builders`
3. **Port**: 8445 (default sponsor portal port)

### Test URL
`https://sponsor.automate.builders:8445/sponsorportal/PortalSetup.action?portal=ac6b8399-ef91-4ef3-97d2-46adaab82d42`

## Certificate Chain Structure

### Production Environment
```
guest1.automate.builders Certificate (Leaf)
├── Issued by: R10 (Let's Encrypt Intermediate)
    ├── Issued by: ISRG Root X1 (Let's Encrypt Root)
```

### Staging Environment
```
guest1.automate.builders Certificate (Leaf)
├── Issued by: (STAGING) Fake LE Intermediate X1
    ├── Issued by: (STAGING) Fake LE Root X1
```

## Troubleshooting

### Common Issues

#### Certificate Not Trusted
- **Cause**: CA certificates not installed
- **Solution**: Ensure R10 and ISRG Root X1 are installed in ISE

#### Portal Redirects to IP
- **Cause**: FQDN not configured in portal settings
- **Solution**: Update portal FQDN in ISE admin

#### DNS Not Resolving
- **Cause**: DNS propagation delay or incorrect A record
- **Solution**: Test DNS with `nslookup guest1.automate.builders`

#### Certificate Expired
- **Cause**: Let's Encrypt certificates expire every 90 days
- **Solution**: Set up auto-renewal or renew manually

### Verification Commands

#### Test DNS Resolution
```bash
nslookup guest1.automate.builders
```

#### Test Certificate
```bash
openssl s_client -connect guest1.automate.builders:8443 -servername guest1.automate.builders
```

#### Check Certificate Expiration
```bash
echo | openssl s_client -connect guest1.automate.builders:8443 2>/dev/null | openssl x509 -noout -dates
```

## Security Considerations

### Best Practices
- Use strong private keys (2048-bit RSA minimum)
- Keep private keys secure and never share
- Monitor certificate expiration dates
- Use different certificates for each portal if possible
- Enable HSTS headers if supported

### Network Security
- Ensure firewall allows HTTPS traffic on portal ports
- Consider using different FQDNs for internal vs external access
- Implement proper network segmentation

## Reference Links

- [Cisco ISE Guest Access Deployment Guide](https://community.cisco.com/t5/security-knowledge-base/ise-guest-access-prescriptive-deployment-guide/ta-p/3640475)
- [Let's Encrypt Certificate Chain](https://letsencrypt.org/certificates/)
- [Cisco ISE Certificate Management](https://www.cisco.com/c/en/us/support/docs/security/identity-services-engine/215884-ise-certificate-management.html)

---

*Last Updated: July 12, 2025*
*For use with VOS SSH Dashboard Let's Encrypt integration*