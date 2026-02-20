import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info, Download, Shield, BookOpen, Key, Server, ExternalLink, Github, MessageCircle } from "lucide-react";
import BackgroundLogo from "@/components/BackgroundLogo";

export default function Help() {
  return (
    <div className="min-h-screen relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <div className="container mx-auto py-6 space-y-6 relative z-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Help & Documentation</h1>
          <p className="text-muted-foreground">
            Learn how to use netSSL for certificate lifecycle management and automation
          </p>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com/sieteunoseis/netSSL/wiki"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                <BookOpen className="h-4 w-4" />
                Wiki Documentation
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com/sieteunoseis/netSSL/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                <Github className="h-4 w-4" />
                Report an Issue
              </a>
            </Button>
          </div>
        </div>

      <Tabs defaultValue="certificates" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="certificates">Certificates</TabsTrigger>
          <TabsTrigger value="platforms">Platforms</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="troubleshooting">Troubleshooting</TabsTrigger>
        </TabsList>

        <TabsContent value="certificates" className="space-y-4">
          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Let's Encrypt Certificates
              </CardTitle>
              <CardDescription>
                Understanding certificate chains and root certificates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Certificate Chain Structure</h3>
                <p className="text-sm text-muted-foreground">
                  Let's Encrypt certificates require a complete chain for proper validation:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Your domain certificate (issued for your specific domain)</li>
                  <li>Intermediate certificate (R11/R12/R13 - Let's Encrypt Authority)</li>
                  <li>Root certificate (ISRG Root X1 - trusted by browsers and systems)</li>
                </ul>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Important for ISE</AlertTitle>
                <AlertDescription>
                  Cisco ISE requires both the intermediate and root certificates to be uploaded
                  to the trust store before importing your domain certificate. netSSL handles this
                  automatically during renewal.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Download Root Certificates</h3>
                <p className="text-sm text-muted-foreground">
                  netSSL automatically downloads and includes these in certificate bundles.
                  You can also download them manually:
                </p>
                <h4 className="text-sm font-semibold text-muted-foreground pt-1">Root Certificates</h4>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="bg-card/85 backdrop-blur-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">ISRG Root X1</CardTitle>
                      <CardDescription className="text-sm">
                        Primary root certificate for RSA certificates
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href="https://letsencrypt.org/certs/isrgrootx1.pem"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download PEM
                        </a>
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/85 backdrop-blur-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">ISRG Root X2</CardTitle>
                      <CardDescription className="text-sm">
                        Root certificate for ECDSA certificates
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href="https://letsencrypt.org/certs/isrg-root-x2-cross-signed.pem"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download PEM
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <h4 className="text-sm font-semibold text-muted-foreground pt-2">Intermediate Certificates</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <Card className="bg-card/85 backdrop-blur-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">R11</CardTitle>
                      <CardDescription className="text-sm">
                        RSA intermediate (retired)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href="https://letsencrypt.org/certs/2024/r11.pem"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download PEM
                        </a>
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/85 backdrop-blur-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">R12</CardTitle>
                      <CardDescription className="text-sm">
                        RSA intermediate (active)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href="https://letsencrypt.org/certs/2024/r12.pem"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download PEM
                        </a>
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/85 backdrop-blur-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">R13</CardTitle>
                      <CardDescription className="text-sm">
                        RSA intermediate (active)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href="https://letsencrypt.org/certs/2024/r13.pem"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download PEM
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Certificate Storage</h3>
                <p className="text-sm text-muted-foreground">
                  Certificates are stored per-connection in isolated directories:
                </p>
                <pre className="bg-muted p-3 rounded-md text-sm">
{`accounts/
├── connection-1/
│   ├── prod/
│   │   ├── certificate.pem       # Domain certificate (leaf)
│   │   ├── private_key.pem       # Private key
│   │   ├── fullchain.pem         # Full chain (leaf + intermediate + root)
│   │   ├── chain.pem             # CA certs only
│   │   ├── intermediate.crt      # Intermediate (R11/R12/R13)
│   │   └── root.crt              # Root (ISRG Root X1)
│   ├── staging/
│   │   └── (same structure)
│   └── renewal.log
├── connection-2/
│   └── ...`}</pre>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://github.com/sieteunoseis/netSSL/wiki"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Full documentation on the Wiki
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="platforms" className="space-y-4">
          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Supported Platforms
              </CardTitle>
              <CardDescription>
                Certificate deployment across Cisco UC and general systems
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Cisco VOS (CUCM, CUC, CER, IM&P)</h3>
                  <p className="text-sm text-muted-foreground">
                    Voice Operating System — fully automated via API and SSH
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>CSR generation via VOS API</li>
                    <li>CA certificate and identity certificate upload via API</li>
                    <li>Automatic Tomcat service restart via SSH</li>
                    <li>Support for tomcat, tomcat-ECDSA, and web services</li>
                  </ul>
                  <Button variant="outline" size="sm" asChild className="mt-2">
                    <a
                      href="https://github.com/sieteunoseis/netSSL/wiki/VOS-Setup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      VOS Setup Guide
                    </a>
                  </Button>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Cisco ISE</h3>
                  <p className="text-sm text-muted-foreground">
                    Identity Services Engine — Admin and Guest Portal certificates via REST API
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Certificate import via ISE Open API</li>
                    <li>Trust store management (intermediate + root auto-upload)</li>
                    <li>Support for Admin and Guest Portal certificate roles</li>
                    <li>Multi-node cluster support</li>
                    <li>Built-in CSR generation wizard</li>
                  </ul>
                  <Alert className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      Known issue: Let's Encrypt certificates contain an apostrophe in the issuer
                      field that can break ISE's XML API parser. Consider using ZeroSSL as an alternative.
                    </AlertDescription>
                  </Alert>
                  <Button variant="outline" size="sm" asChild className="mt-2">
                    <a
                      href="https://github.com/sieteunoseis/netSSL/wiki/ISE-Setup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      ISE Setup Guide
                    </a>
                  </Button>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">General (ESXi, PiKVM, Linux)</h3>
                  <p className="text-sm text-muted-foreground">
                    Any SSH-accessible system — certificate deployment via SFTP
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Built-in CSR generation wizard</li>
                    <li>SFTP upload to configurable remote paths</li>
                    <li>Custom restart commands (e.g., systemctl, /etc/init.d)</li>
                    <li>Support for ESXi keyboard-interactive authentication</li>
                    <li>Manual download fallback when SSH is not configured</li>
                  </ul>
                  <Button variant="outline" size="sm" asChild className="mt-2">
                    <a
                      href="https://github.com/sieteunoseis/netSSL/wiki/General-Setup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      General Setup Guide
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation" className="space-y-4">
          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Certificate Automation
              </CardTitle>
              <CardDescription>
                DNS challenge validation and automatic renewal
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">DNS-01 Challenge</h3>
                <p className="text-sm text-muted-foreground">
                  netSSL uses DNS-01 challenge for certificate validation:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Creates a TXT record at _acme-challenge.yourdomain.com</li>
                  <li>Let's Encrypt verifies the record to prove domain ownership</li>
                  <li>TXT record is automatically cleaned up after validation</li>
                  <li>No need to expose ports or modify firewall rules</li>
                  <li>Supports wildcard certificates</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Supported DNS Providers</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm">Cloudflare</p>
                    <p className="text-xs text-muted-foreground">API Key + Zone ID</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm">AWS Route 53</p>
                    <p className="text-xs text-muted-foreground">Access Key + Secret + Zone ID</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm">DigitalOcean</p>
                    <p className="text-xs text-muted-foreground">API Token</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm">Manual / Custom</p>
                    <p className="text-xs text-muted-foreground">Create TXT records manually (no auto-renewal)</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild className="mt-2">
                  <a
                    href="https://github.com/sieteunoseis/netSSL/wiki/DNS-Providers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    DNS Provider Setup Guide
                  </a>
                </Button>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Auto-Renewal</h3>
                <p className="text-sm text-muted-foreground">
                  Connections with auto-renewal enabled are checked daily:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Renewal threshold: configurable (default: 7 days before expiry)</li>
                  <li>Schedule: configurable cron (default: daily at midnight)</li>
                  <li>Requires: connection enabled + auto-renew on + API-based DNS provider</li>
                  <li>Existing certificates valid for 30+ days are reused (not re-requested)</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Rate Limits</h3>
                <Alert variant="warning">
                  <AlertTitle>Let's Encrypt Rate Limits</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>Be aware of these limits to avoid being blocked:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>50 certificates per registered domain per week</li>
                      <li>5 duplicate certificates per week (same domain set)</li>
                      <li>5 failed validations per hour per domain</li>
                    </ul>
                    <p className="text-sm font-medium">
                      Use staging environment (LETSENCRYPT_STAGING=true) for testing!
                    </p>
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="troubleshooting" className="space-y-4">
          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Troubleshooting
              </CardTitle>
              <CardDescription>
                Common issues and solutions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Docker Permissions</h3>
                <div className="border-l-4 border-yellow-500 pl-4 space-y-1">
                  <p className="font-medium text-sm">EACCES: Permission denied on accounts/db/logs</p>
                  <p className="text-sm text-muted-foreground">
                    The container runs as appuser with a specific UID/GID. Host-mounted volumes
                    must be writable by this user. Check the actual UID/GID on the Admin &gt; Diagnostics page,
                    then fix ownership:
                  </p>
                  <pre className="bg-muted p-2 rounded-md text-xs mt-1">
{`# Check container's UID/GID
docker exec netssl-dashboard id appuser

# Fix ownership (use actual UID:GID from above)
sudo chown -R <UID>:<GID> accounts/ db/ logs/`}</pre>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Certificate Issues</h3>
                <div className="space-y-2">
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">Certificate not trusted by browser</p>
                    <p className="text-sm text-muted-foreground">
                      Check if LETSENCRYPT_STAGING is set to true. Staging certificates
                      are not trusted. Set to false for production certificates.
                    </p>
                  </div>
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">ISE: "Security Check Failed" (HTTP 400)</p>
                    <p className="text-sm text-muted-foreground">
                      Let's Encrypt certificates contain an apostrophe in the issuer field
                      that breaks ISE's XML API. Use ZeroSSL as an alternative, or manually
                      upload trust certs via ISE GUI.
                    </p>
                  </div>
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">ISE: "Failed to Verify Certificate Path" (HTTP 422)</p>
                    <p className="text-sm text-muted-foreground">
                      ISE can't build a trust chain. Ensure both intermediate (R11/R12/R13)
                      and root (ISRG Root X1) certificates are in the ISE trust store.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">DNS Challenge Issues</h3>
                <div className="space-y-2">
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">DNS record not found</p>
                    <p className="text-sm text-muted-foreground">
                      Verify API credentials in Settings, check Zone ID matches the domain,
                      and ensure the API user has write access to DNS records.
                    </p>
                  </div>
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">DNS propagation timeout</p>
                    <p className="text-sm text-muted-foreground">
                      TXT records typically propagate in 30-120 seconds. If validation
                      still fails, check that the domain's nameservers point to the
                      configured DNS provider.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">SSH Connection Issues</h3>
                <div className="space-y-2">
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">Permission denied or timeout</p>
                    <p className="text-sm text-muted-foreground">
                      Verify credentials, ensure SSH is enabled on the target system,
                      and check that port 22 is not blocked by a firewall.
                    </p>
                  </div>
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">ESXi: keyboard-interactive auth</p>
                    <p className="text-sm text-muted-foreground">
                      ESXi uses keyboard-interactive instead of standard password auth.
                      netSSL handles this automatically. Ensure SSH is enabled in
                      ESXi Host &gt; Actions &gt; Services.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Verification Commands</h3>
                <pre className="bg-muted p-3 rounded-md text-xs">
{`# Check certificate on remote host
openssl s_client -connect hostname:443 -servername hostname 2>/dev/null \\
  | openssl x509 -noout -subject -issuer -dates

# Verify DNS TXT record
dig TXT _acme-challenge.yourdomain.com +short

# Check certificate files on disk
openssl x509 -in certificate.pem -noout -subject -dates`}</pre>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://github.com/sieteunoseis/netSSL/wiki/Troubleshooting"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Full Troubleshooting Guide
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://github.com/sieteunoseis/netSSL/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Report an Issue
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
