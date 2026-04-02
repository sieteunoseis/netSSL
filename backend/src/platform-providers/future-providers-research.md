# Future Platform Providers — Research & Sandbox Notes

Potential new platform providers for netSSL certificate management, with DevNet sandbox availability and deep API research.

## Currently Supported

| Platform | Provider File | Status |
|----------|--------------|--------|
| Cisco VOS (CUCM, CUC, IM&P, Expressway) | `vos-provider.ts` | Production |
| Cisco ISE | `ise-provider.ts` | Production |
| Cisco Catalyst Center (DNAC) | `catalyst-center-provider.ts` | Production |
| General (any HTTPS host) | `general-provider.ts` | Production |

---

## Tier 1 — Strong Candidates

### 1. Cisco SD-WAN Manager (vManage)

**Sandbox:** Cisco SD-WAN 20.12 (reservable), SD-WAN 20.10 (reservable)
**Feasibility:** HIGH
**Certificate scope:** vManage web server HTTPS certificate
**Detailed research:** [sdwan-research.md](sdwan-research.md)

**Authentication:**
- Session-based: `POST /j_security_check` with form data `j_username` + `j_password`
- Returns `JSESSIONID` cookie
- XSRF token: `GET /dataservice/client/token` → pass as `X-XSRF-TOKEN` header
- All API calls prefixed with `/dataservice`

**Certificate endpoints (confirmed):**
- `GET /dataservice/setting/configuration/webserver/certificate/getcertificate` — get current web cert

**Certificate endpoints (needs sandbox discovery):**
- CSR generation: likely `POST /dataservice/setting/configuration/webserver/certificate/getcsr`
- Cert install: likely `PUT /dataservice/setting/configuration/webserver/certificate/certificate`

**Key facts:**
- CSR generated on device (like VOS/ISE), not locally
- PEM format only (Base64 encoded, no DER)
- Works for both on-prem and cloud-hosted vManage (CNAME your domain → Cisco's address)
- Service restart behavior: TBD (may auto-restart)

**Next steps:**
1. Reserve SD-WAN 20.12 sandbox
2. Browser dev tools on GUI to capture CSR/install API calls
3. Build provider skeleton

---

### 2. Cisco Nexus Dashboard

**Sandbox:** Nexus Dashboard (reservable), vNexus Dashboard Fabric Controller (reservable)
**Feasibility:** HIGH — full certificate management API exists (Early Access in ND 4.1, GA in 4.2+)
**Certificate scope:** Nexus Dashboard web UI certificate + switch certificates

**Authentication:**

```
POST /login
Body: {"userName": "admin", "userPasswd": "password", "domain": "DefaultAuth"}
Response: {"token": "eyJ..."} (or "jwttoken" on some versions)
```

Two headers required on all subsequent calls:
```
Authorization: Bearer <token>
Cookie: AuthCookie=<token>
```

Token lifetime: 20 minutes. Also supports API key auth via `X-Nd-Username` + `X-Nd-Apikey` headers.

**Certificate endpoints (confirmed from OpenAPI spec + Ansible/Terraform source):**

| Operation | Method | Path |
|-----------|--------|------|
| List certificates | GET | `/apis/security/certificates` |
| Upload certificate | POST | `/apis/security/certificates` |
| Modify certificate | POST | `/apis/security/certificates/actions/modify` |
| Remove certificate | POST | `/apis/security/certificates/actions/remove` |
| Install on switches | POST | `/apis/security/certificates/actions/installCertificates` |
| Get enforcement | GET | `/apis/security/certificates/enforce` |
| List features | GET | `/apis/security/certificates/features` |
| List switches | GET | `/apis/security/certificates/switches` |
| **Get HTTP/TLS config** | GET | `/apis/security/httpConfig` |
| **Update HTTP/TLS config** | POST | `/apis/security/httpConfig` |
| List trusted CAs | GET | `/apis/aaa/trustedSecureKeys` |
| Add trusted CA | POST | `/apis/aaa/trustedSecureKeys` |

**Key `/apis/security/httpConfig`** — this is the web server certificate endpoint. Updates the ND platform's own HTTPS cert/key/TLS settings.

**Key facts:**
- PEM format, Base64 encoded
- RSA 2048+ or ECDSA P-256/P-384
- Full chain should be provided (server cert + intermediates)
- Service restart likely automatic on httpConfig update
- API marked "Early Access" in ND 4.1, GA in 4.2+
- On-box Swagger at `https://<ND>/apidocs` has full schemas

**Next steps:**
1. Reserve Nexus Dashboard sandbox
2. `GET /apis/security/httpConfig` to see current config schema
3. Test cert upload flow
4. Build provider skeleton

---

## Tier 2 — Moderate Candidates

### 3. Cisco Firepower Management Center (FMC)

**Sandbox:** Firepower Management Center (reservable)
**Feasibility:** MEDIUM — REST API does NOT manage FMC's own web cert; SSH/CLI required
**Certificate scope:** FMC web server HTTPS certificate (via SSH), policy cert objects (via API)

**Authentication:**

```
POST /api/fmc_platform/v1/auth/generatetoken
Headers: Authorization: Basic <base64(user:pass)>
Response: HTTP 204 (tokens in response headers)
  X-auth-access-token: <token>
  X-auth-refresh-token: <token>
  DOMAIN_UUID: <uuid>
```

Token lifetime: 30 minutes, refreshable up to 3 times. Rate limit: 120 req/min, 10 auth/min.

**Critical finding: NO REST API for FMC web server certificate.**

The FMC REST API only manages **policy certificate objects** (SSL decryption, VPN), NOT the FMC web UI HTTPS cert:

| Operation | Method | Path |
|-----------|--------|------|
| Internal CAs | CRUD | `/api/fmc_config/v1/domain/{uuid}/object/internalcas` |
| External CAs | CRUD | `/api/fmc_config/v1/domain/{uuid}/object/externalcas` |
| Internal certs | CRUD | `/api/fmc_config/v1/domain/{uuid}/object/internalcertificates` |
| External certs | CRUD | `/api/fmc_config/v1/domain/{uuid}/object/externalcertificates` |

These are for SSL inspection policies, NOT the FMC web server cert.

**Web server cert management is GUI or SSH only:**

GUI: System > Configuration > HTTPS Certificate → Generate CSR / Import cert (auto-restarts httpd)

SSH/CLI approach:
```bash
# Certificate paths on FMC:
/etc/sf/ssl/server.crt      # Server certificate
/etc/sf/ssl/private.key      # Private key
/etc/sf/ssl/ca_chain.pem     # CA chain

# Restart web service after manual cert replacement:
sudo pmtool restartbyid httpd
```

**Verdict:** FMC would need a **hybrid SSH approach** (like VOS) — API for auth/validation, SSH for cert file replacement and httpd restart. Still feasible since netSSL already has SSH infrastructure.

**Next steps:**
1. Reserve FMC sandbox
2. Verify cert file paths and restart command
3. Check FMC API Explorer (`https://<FMC>/api/api-explorer`) for any new cert endpoints in 7.4+
4. Build SSH-based provider (similar to VOS pattern)

---

### 4. Cisco Secure Network Analytics (Stealthwatch)

**Sandbox:** Cisco Secure Network Analytics v7.4.1 (reservable)
**Feasibility:** MEDIUM — NO REST API for certs; SSH/CLI only
**Certificate scope:** SNA Manager Console web certificate

**Authentication:**

```
POST /token/v2/authenticate
Content-Type: application/x-www-form-urlencoded
Body: username={user}&password={pass}
→ Sets JSESSIONID + XSRF-TOKEN cookies
→ Pass X-XSRF-TOKEN header on all subsequent requests

DELETE /token   (logout)
```

**Critical finding: NO certificate management REST API.**

The SNA REST API covers: Reporting (v1/v2), Configuration Management, User Management, Associated Flows. None include certificate operations.

**Certificate management is GUI (Central Management) or SSH:**

SSH approach:
- Web server: `lc-tomcat` (Lancope Tomcat)
- Restart: `systemctl restart lc-tomcat`
- Certificate managed via Java keystore or direct file placement under `/lancope/` directory tree
- PEM format required, full chain needed

Cisco publishes a dedicated guide: "SSL/TLS Certificates for Managed Appliances Guide" (separate PDF per version, 3-4MB each).

**Verdict:** SSH-based only. Similar to FMC — would need SSH for cert file management + service restart. The auth flow (session cookies + XSRF) is similar to vManage.

**Next steps:**
1. Reserve SNA v7.4.1 sandbox
2. Download the SSL/TLS Certificates Guide PDF for exact file paths
3. Test SSH cert replacement workflow
4. Determine if hybrid (API auth + SSH cert ops) or pure SSH approach

---

### 5. Cisco Umbrella (Secure Internet Gateway)

**Sandbox:** Cisco Umbrella SIG (reservable)
**Feasibility:** NONE — cloud-managed, no certificate APIs
**Certificate scope:** N/A

**Research finding:** After examining every API category (Auth, Admin, Deployments, Investigate, Policies, Reports) across both the Secure Access API and legacy Umbrella API — **there are zero certificate management endpoints.**

Umbrella is a cloud-delivered service where Cisco manages all TLS certificates internally. The SSL decryption root CA cert is a static Cisco-issued certificate downloaded from the dashboard. Custom block page certs are not replaceable via API.

**Verdict:** NOT APPLICABLE. Remove from candidates.

---

### 6. Cisco Security Cloud Control (CDO)

**Sandbox:** Cisco Security Cloud Control (reservable)
**Feasibility:** LOW — no dedicated cert API; only indirect CLI execution
**Certificate scope:** Managed ASA/FTD device certificates (indirect)

**Authentication:** Bearer token generated from SCC dashboard (not OAuth).

**Research finding:** Only one cert-related endpoint exists:
- `POST /v1/inventory/devices/asas/acceptCert` — accepts device certs during onboarding (NOT lifecycle management)

The only viable path for cert management is **indirect CLI execution**:
- `POST /v1/inventory/devices/asas/cli/execute` — run CLI on ASA
- `POST /v1/fmc/gateway/command` — proxy commands to cdFMC for FTD

This would mean sending raw `crypto ca enroll` / `crypto ca import` commands through the API and parsing text output — fragile and unreliable for certificate data transfer.

**Verdict:** NOT RECOMMENDED. Too indirect and brittle. Better to manage ASA/FTD certs directly via the device API or through FMC.

---

## Tier 3 — Niche / Lower Priority

### Cisco Firepower Threat Defense (FTD)

**Sandbox:** Firepower Threat Defense REST API (reservable) — FTD 7.0.1 + CentOS devbox
**Feasibility:** Medium — has device API for identity certificates, trustpoints, CA certs
**Notes:** FTD certs typically managed through FMC. Standalone FTD deployments only.

### Cisco ACI (APIC)

**Sandbox:** ACI Simulator 6.0 (reservable)
**Feasibility:** Low-Medium — complex policy model (crypto:Cert, crypto:Key managed objects, keyrings)
**Notes:** Auth via `POST /api/aaaLogin.json`. Cert management requires creating keyring objects.

### Cisco Catalyst / IOS-XE Switches

**Sandbox:** Cat9300, Cat9200CX, Catalyst 8/9k (various), Catalyst 8000 Always-On
**Feasibility:** Low — CLI-based `crypto pki`, would need RESTCONF/NETCONF integration

### Cisco Modeling Labs (CML)

**Sandbox:** Cisco Modeling Labs (reservable)
**Feasibility:** Medium — CML 2.x has REST API, token-based auth
**Notes:** Lab environments only, limited production deployment.

---

## Not Applicable

| Sandbox | Reason |
|---------|--------|
| CI/CD Pipeline | Infrastructure tool, not a cert target |
| Cisco 8000 SONiC | SONiC OS — different cert model |
| IOS XR Always-On | Router OS — CLI-based crypto |
| IOx v1.15 | IoT app hosting — no web cert management |
| Network Services Orchestrator (NSO) | Orchestration tool — not a cert target |
| NSOLAB | NSO lab environment |
| IE3400 Edge Compute | Industrial IoT device |
| Cyber Vision | OT visibility — limited cert API |
| Secure Equipment Access | IoT operations — limited cert API |
| Cloud-Native SD-WAN (CN-WAN) | Kubernetes — use cert-manager instead |
| XRd Sandbox | Containerized IOS-XR — CLI-based crypto |
| Cisco Umbrella | Cloud-managed — no cert APIs |
| Cisco CDO/SCC | No dedicated cert API — CLI passthrough only |

---

## Updated Priority Roadmap

| Priority | Platform | API Method | Effort | Sandbox |
|----------|----------|-----------|--------|---------|
| **1** | **SD-WAN Manager (vManage)** | REST API (session + XSRF) | Medium | SD-WAN 20.12 |
| **2** | **Nexus Dashboard** | REST API (JWT + cookie) | Medium | Nexus Dashboard |
| **3** | **FMC** | SSH/CLI (API for auth only) | Medium | FMC |
| **4** | **Secure Network Analytics** | SSH/CLI | Medium | SNA v7.4.1 |
| 5 | FTD (standalone) | REST API | Medium | FTD REST API |
| 6 | ACI (APIC) | REST API (complex) | High | ACI Simulator 6.0 |

**Key insight:** Nexus Dashboard jumped to #2 (from #3) because it has a **full certificate management REST API** including web server config — much better than FMC and SNA which both require SSH. vManage stays #1 since the web cert endpoint just needs sandbox confirmation.
