# Cisco SD-WAN (vManage) Certificate API Research

## Goal
Add SD-WAN Manager (vManage) as a platform provider for web server certificate management via Let's Encrypt.

## Sandbox
- **DevNet Sandbox:** Cisco SD-WAN 20.12 (reservable)
- **Alternate:** SD-WAN 20.10 (reservable, older)
- Reserve at: https://devnetsandbox.cisco.com/
- Once reserved, you'll get VPN credentials + vManage IP/creds
- Use browser dev tools (Network tab) on the vManage GUI to discover web server cert endpoints

## Authentication
- Session-based: `POST /j_security_check` with `j_username` and `j_password` form data
- Returns JSESSIONID cookie used for subsequent requests
- XSRF token: `GET /dataservice/client/token` — returns token string, pass as `X-XSRF-TOKEN` header
- All API calls prefixed with `/dataservice`

## Known Certificate Endpoints

### Web Server Certificate (what we need for netSSL)

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `/dataservice/setting/configuration/webserver/certificate/getcertificate` | GET | Get current web server certificate details | Confirmed |
| `/dataservice/setting/configuration/webserver/certificate/getcsr` | POST? | Generate CSR for web server | **Needs discovery** |
| `/dataservice/setting/configuration/webserver/certificate/certificate` | PUT? | Install signed certificate | **Needs discovery** |

### Controller/Device Certificates (not needed for netSSL, but documented)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dataservice/certificate/generate/csr` | POST | Generate CSR for a device (`{"deviceIP": "..."}`) |
| `/dataservice/certificate/install/signedCert` | POST | Install signed cert on a device |
| `/dataservice/certificate/vedge/list?action=push` | POST | Push certificates to all controllers |
| `/dataservice/certificate/rootcertificate` | GET | Get vManage root certificate |
| `/dataservice/certificate/controller/bulkcsr?csrKeyLength=4096` | POST | Generate CSR for all controllers |

### Configuration Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dataservice/settings/configuration/certificate/{type}` | GET | Get cert config by type |
| `/dataservice/settings/configuration/certificate/{type}` | PUT | Update cert config |
| `/dataservice/settings/configuration/certificate/{type}` | POST | Add cert config |
| `/dataservice/sslproxy/certificate` | PUT | Update SSL proxy device certificate |

**Config types:** `csrproperties`, `enterpriserootca`, `enterpriseCertificateSettings`, `controllerEdgeCertificateSettings`, `crlSetting`, `certificate`, `hardwarerootca`, `quarantineExpiredCertificate`

## Sandbox Discovery Plan

Use browser dev tools or curl against the sandbox to discover the exact web server certificate endpoints:

### Step 1: Authenticate
```bash
# Get session cookie
curl -k -c cookies.txt -X POST "https://{vmanage}/j_security_check" \
  -d "j_username=admin&j_password=admin"

# Get XSRF token
XSRF=$(curl -k -b cookies.txt "https://{vmanage}/dataservice/client/token")
```

### Step 2: Get current web server cert
```bash
curl -k -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" \
  "https://{vmanage}/dataservice/setting/configuration/webserver/certificate/getcertificate"
```

### Step 3: Discover CSR generation endpoint
Try these candidates (watch browser Network tab while clicking CSR > Generate in GUI):
```bash
# Candidate 1
curl -k -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" \
  -X POST "https://{vmanage}/dataservice/setting/configuration/webserver/certificate/getcsr"

# Candidate 2
curl -k -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" \
  -X POST "https://{vmanage}/dataservice/setting/configuration/webserver/certificate/generatecsr"

# Candidate 3 — with CSR properties body
curl -k -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" \
  -H "Content-Type: application/json" \
  -X POST "https://{vmanage}/dataservice/setting/configuration/webserver/certificate/getcsr" \
  -d '{"commonName":"vmanage.example.com","organization":"Org","organizationUnit":"IT","locality":"San Jose","state":"CA","country":"US"}'
```

### Step 4: Discover cert install endpoint
Try these candidates (watch browser Network tab while pasting cert and clicking Import):
```bash
# Candidate 1
curl -k -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" \
  -H "Content-Type: application/json" \
  -X PUT "https://{vmanage}/dataservice/setting/configuration/webserver/certificate/certificate" \
  -d '"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"'

# Candidate 2
curl -k -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" \
  -H "Content-Type: application/json" \
  -X POST "https://{vmanage}/dataservice/setting/configuration/webserver/certificate/certificate" \
  -d '"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"'
```

### Step 5: Check for service restart
```bash
# After cert install, check if vManage restarts automatically
# or if there's a restart endpoint
curl -k -b cookies.txt -H "X-XSRF-TOKEN: $XSRF" \
  "https://{vmanage}/dataservice/system/device/controllers"
```

## Key Differences from Other Providers

| Feature | VOS | ISE | Catalyst Center | SD-WAN (vManage) |
|---------|-----|-----|-----------------|------------------|
| Auth | Basic Auth per request | Basic Auth + ERS | Token (X-Auth-Token) | Session cookie + XSRF |
| CSR | API on device | API on device | Local (no API) | API on device (TBD) |
| Cert install | Multipart file upload | JSON/PUT | Multipart file upload | JSON string (TBD) |
| Service restart | SSH command | SSH command | Automatic | Unknown (TBD) |
| Cert format | PEM | PEM + PKCS12 | PEM | PEM (Base64 only) |

## Cloud vs On-Prem vManage

Both deployment models support custom web server certificates via the same flow:

- **Cloud-hosted** (e.g., `vmanage-xxx.sdwan.cisco.com`): Default cert is self-signed for `cisco.com`. Create a CNAME in your DNS (e.g., `vmanage.example.com` → `vmanage-xxx.sdwan.cisco.com`), then generate CSR with custom CN/SAN.
- **On-prem**: Direct access to vManage IP/hostname. Same CSR generation and cert install flow.
- Both use Administration > Settings > Web Certificate in GUI
- Let's Encrypt integration would work for either model as long as the FQDN is publicly resolvable for DNS challenge

Source: [Cisco Community — vManage web certificate cloud version](https://community.cisco.com/t5/sd-wan-and-cloud-networking/vmanage-web-certificate-cloud-version/td-p/4571647)

## Implementation Notes

- vManage only supports Base64 (PEM) encoded certificates — no DER
- Web server cert CSR is generated ON the vManage server (like VOS/ISE), not locally (unlike CC)
- After cert install, vManage may auto-restart web server or require service restart
- Session auth means we need to handle cookies + XSRF token (different from all other providers)
- The `/dataservice` prefix applies to all API calls

## References
- [Cisco SD-WAN Manager API, Release 20.18](https://developer.cisco.com/docs/sdwan/)
- [Generate Self-Signed Web Certificate](https://www.cisco.com/c/en/us/support/docs/routers/sd-wan/215103-how-to-generate-self-signed-web-certific.html)
- [Understand the Web Certificate for vManage](https://www.cisco.com/c/en/us/support/docs/routers/sd-wan/217426-understand-the-web-certificate-for-vmana.html)
- [Python vManage SDK](https://python-viptela.readthedocs.io/en/latest/_modules/api/certificate.html)
- [Get certificate for alias server](https://developer.cisco.com/docs/sdwan/get-certificate-for-alias-server/)
