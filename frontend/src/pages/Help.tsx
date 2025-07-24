import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info, Download, Shield, BookOpen, Key, Server, ExternalLink } from "lucide-react";
import BackgroundLogo from "@/components/BackgroundLogo";

export default function Help() {
  return (
    <div className="min-h-screen relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <div className="container mx-auto py-6 space-y-6 relative z-10">
        <div className="space-y-2">
        <h1 className="text-3xl font-bold">Help & Documentation</h1>
        <p className="text-muted-foreground">
          Learn how to use the VOS SSH Dashboard for certificate management and automation
        </p>
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
                  <li>Intermediate certificate (R11 - Let's Encrypt Authority)</li>
                  <li>Root certificate (ISRG Root X1 - trusted by browsers and systems)</li>
                </ul>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Important for ISE</AlertTitle>
                <AlertDescription>
                  Cisco ISE requires both the intermediate and root certificates to be uploaded 
                  along with your domain certificate. Let's Encrypt now only provides the intermediate 
                  certificate in the chain, so the root certificate must be obtained separately.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Download Root Certificates</h3>
                <p className="text-sm text-muted-foreground">
                  The application automatically downloads these certificates on startup if missing. 
                  You can also download them manually:
                </p>
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
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Certificate Storage</h3>
                <p className="text-sm text-muted-foreground">
                  Certificates are stored in the accounts folder with the following structure:
                </p>
                <pre className="bg-muted p-3 rounded-md text-sm">
{`accounts/
├── isrgrootx1.pem              # ISRG Root X1 certificate
├── isrg-root-x2-cross-signed.pem # ISRG Root X2 certificate
└── conn_[ID]_[HOSTNAME]/
    ├── production/
    │   ├── certificate.pem      # Your domain certificate
    │   ├── private_key.pem      # Private key
    │   ├── chain.pem           # Complete chain
    │   ├── intermediate.crt    # R11 intermediate
    │   └── root.crt           # ISRG Root X1
    └── staging/
        └── ... (same structure)`}</pre>
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
                Certificate deployment for various Cisco platforms
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Cisco ISE</h3>
                  <p className="text-sm text-muted-foreground">
                    Identity Services Engine certificate management
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Automatic certificate upload via REST API</li>
                    <li>Support for admin, portal, and pxGrid certificates</li>
                    <li>Requires both intermediate and root certificates</li>
                    <li>Duplicate certificate detection and management</li>
                    <li>Requires manual CSR generation before certificate request</li>
                  </ul>
                  <div className="mt-3">
                    <Button variant="outline" size="sm" asChild>
                      <a 
                        href="https://csrgenerator.com/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Generate CSR Online
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Cisco CUCM</h3>
                  <p className="text-sm text-muted-foreground">
                    Unified Communications Manager (coming soon)
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>OS Administration certificate upload</li>
                    <li>Tomcat certificate management</li>
                    <li>Certificate chain validation</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Cisco CUC</h3>
                  <p className="text-sm text-muted-foreground">
                    Unity Connection (coming soon)
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Web certificate management</li>
                    <li>SMTP certificate configuration</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">General Applications</h3>
                  <p className="text-sm text-muted-foreground">
                    ESXi, other non-Cisco applications, and custom systems
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Requires manual CSR generation and certificate installation</li>
                    <li>Support for wildcard and SAN certificates</li>
                    <li>Certificate renewal tracking</li>
                    <li>Custom private key storage</li>
                  </ul>
                  <div className="mt-3">
                    <Button variant="outline" size="sm" asChild>
                      <a 
                        href="https://csrgenerator.com/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Generate CSR Online
                      </a>
                    </Button>
                  </div>
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
                Automated certificate renewal and deployment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">DNS Challenge</h3>
                <p className="text-sm text-muted-foreground">
                  The application uses DNS-01 challenge for certificate validation:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Supports multiple DNS providers (Cloudflare, Route53, etc.)</li>
                  <li>Wildcard certificate support</li>
                  <li>No need to expose ports or modify firewall rules</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Auto-Renewal</h3>
                <p className="text-sm text-muted-foreground">
                  Certificates are automatically renewed when:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Less than 30 days until expiration</li>
                  <li>Daily checks at 2:00 AM (configurable)</li>
                  <li>Manual renewal available anytime</li>
                  <li>Automatic deployment to configured platforms</li>
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
                      <li>5 duplicate certificates per week (same domains)</li>
                      <li>5 failed validations per hour per domain</li>
                    </ul>
                    <p className="text-sm font-medium">
                      Use staging environment for testing!
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
                Troubleshooting Guide
              </CardTitle>
              <CardDescription>
                Common issues and solutions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Certificate Upload Failures</h3>
                <div className="space-y-2">
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">ISE: "Certificate chain is not complete"</p>
                    <p className="text-sm text-muted-foreground">
                      Ensure both intermediate and root certificates are present in the accounts folder.
                      The application should download them automatically on startup.
                    </p>
                  </div>
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">ISE: "Certificate already exists"</p>
                    <p className="text-sm text-muted-foreground">
                      ISE creates duplicates when uploading the same certificate. Use the ISE admin UI
                      to remove old certificates before uploading new ones.
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
                      Check DNS provider credentials and ensure the domain's nameservers 
                      point to the configured DNS provider.
                    </p>
                  </div>
                  <div className="border-l-4 border-yellow-500 pl-4">
                    <p className="font-medium text-sm">DNS propagation timeout</p>
                    <p className="text-sm text-muted-foreground">
                      DNS changes can take time to propagate. The application waits up to 
                      10 minutes. If it still fails, try again later.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">General Tips</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Always test with staging certificates first</li>
                  <li>Check logs in the Logs tab for detailed error messages</li>
                  <li>Ensure platform credentials have appropriate permissions</li>
                  <li>Verify network connectivity to target platforms</li>
                  <li>Monitor rate limits to avoid being blocked</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}