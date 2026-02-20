import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// @ts-ignore
import CertificateRenewalButton from "@/components/CertificateRenewalButton";
// @ts-ignore
import CertificateDownloadButton from "@/components/CertificateDownloadButton";
// @ts-ignore
import ServiceRestartButton from "@/components/ServiceRestartButton";
import CertificateInfo from "@/components/CertificateInfo";
import PerformanceMetricsChart from "@/components/PerformanceMetricsChart";
import { formatDate } from "@/lib/date-utils";
// @ts-ignore
import { getConnectionDisplayHostname } from "@/lib/connection-utils";
import {
  Info, Shield, Zap, Wrench, FileText, Terminal, ExternalLink,
  Edit, Loader2,
} from "lucide-react";

interface ConnectionDetailsTabsProps {
  connection: any;
  certInfo: any;
  variant: "card" | "table";
  status: { status: string; text: string; icon: any; days?: number };
  activeOperation: any;
  testingSSH: boolean;
  downloadRefreshTrigger: number;
  onRenewSuccess: () => void;
  onRefreshCert: () => void;
  onSSHTest: (connection: any) => void;
  onNavigate: (path: string) => void;
  onEdit: (connection: any) => void;
  formatApplicationType: (type: string) => string;
}

const ConnectionDetailsTabs = ({
  connection,
  certInfo,
  variant,
  status: _status,
  activeOperation,
  testingSSH,
  downloadRefreshTrigger,
  onRenewSuccess,
  onRefreshCert,
  onSSHTest,
  onNavigate,
  onEdit,
  formatApplicationType: _formatApplicationType,
}: ConnectionDetailsTabsProps) => {
  const hostname = getConnectionDisplayHostname(connection);
  const showSSH = connection.enable_ssh && (connection.application_type === "vos" || connection.application_type === "general");
  const autoRenewEnabled = connection.auto_renew && connection.dns_provider !== "custom";

  // Card variant: compact TabsList; Table variant: full-width inline style
  const tabsListClass =
    variant === "card"
      ? "grid w-full grid-cols-4 h-9"
      : "w-full justify-start rounded-none bg-transparent border-b h-12 px-4";

  const triggerClass = variant === "card" ? "text-xs" : "gap-2";
  const toolsGridClass = variant === "card" ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 md:grid-cols-4 gap-2";
  const iconSize = variant === "card" ? "h-3 w-3" : "h-4 w-4";

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className={tabsListClass}>
        <TabsTrigger value="overview" className={triggerClass}>
          <Info className={`${iconSize} ${variant === "card" ? "mr-1" : ""}`} />
          Overview
        </TabsTrigger>
        <TabsTrigger value="certificate" className={triggerClass}>
          <Shield className={`${iconSize} ${variant === "card" ? "mr-1" : ""}`} />
          Certificate
        </TabsTrigger>
        <TabsTrigger value="performance" className={triggerClass}>
          <Zap className={`${iconSize} ${variant === "card" ? "mr-1" : ""}`} />
          Performance
        </TabsTrigger>
        <TabsTrigger value="tools" className={triggerClass}>
          <Wrench className={`${iconSize} ${variant === "card" ? "mr-1" : ""}`} />
          Tools
        </TabsTrigger>
      </TabsList>

      <div className={variant === "card" ? "mt-4" : "p-4"}>
        {/* Overview Tab (combined Overview + Settings) */}
        <TabsContent value="overview" className="mt-0">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
              <div>
                <p className="font-medium text-sm">Domain</p>
                <p className="text-xs text-muted-foreground font-mono">{hostname}</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
              <div>
                <p className="font-medium text-sm">SSL Provider</p>
                <p className="text-xs text-muted-foreground capitalize">{connection.ssl_provider}</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
              <div>
                <p className="font-medium text-sm">DNS Provider</p>
                <p className="text-xs text-muted-foreground capitalize">{connection.dns_provider}</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
              <div>
                <p className="font-medium text-sm">Last Issued</p>
                <p className="text-xs text-muted-foreground">
                  {connection.last_cert_issued ? new Date(connection.last_cert_issued).toLocaleDateString() : "Never"}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
              <div>
                <p className="font-medium text-sm">Auto-renewal</p>
                <p className="text-xs text-muted-foreground">Automatic certificate renewal</p>
              </div>
              <Badge variant={autoRenewEnabled ? "default" : "secondary"}>
                {autoRenewEnabled ? "On" : "Off"}
              </Badge>
            </div>
            {(connection.application_type === "vos" || connection.application_type === "general") && (
              <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                <div>
                  <p className="font-medium text-sm">SSH Access</p>
                  <p className="text-xs text-muted-foreground">Allow SSH connections</p>
                </div>
                <Badge variant={connection.enable_ssh ? "default" : "secondary"}>
                  {connection.enable_ssh ? "On" : "Off"}
                </Badge>
              </div>
            )}
            {connection.application_type === "vos" && (
              <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                <div>
                  <p className="font-medium text-sm">Auto Restart</p>
                  <p className="text-xs text-muted-foreground">Restart service after cert</p>
                </div>
                <Badge variant={connection.auto_restart_service ? "default" : "secondary"}>
                  {connection.auto_restart_service ? "On" : "Off"}
                </Badge>
              </div>
            )}
          </div>
          <div className="mt-3">
            <Button
              onClick={() => onEdit(connection)}
              size="sm"
              variant="outline"
              className="w-full justify-center border-primary/30 hover:border-primary/50 hover:bg-primary/5"
            >
              <Edit className="h-4 w-4 mr-2 text-primary" />
              Edit Connection
            </Button>
          </div>
        </TabsContent>

        {/* Certificate Tab */}
        <TabsContent value="certificate" className="mt-0">
          {variant === "table" ? (
            <CertificateInfo connectionId={connection.id} hostname={hostname} />
          ) : certInfo ? (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-3">Subject Certificate</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">Common Name (CN):</span>
                    <p className="mt-1">{certInfo.subject?.CN || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Organization (O):</span>
                    <p className="mt-1">{certInfo.subject?.O || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Organizational Unit (OU):</span>
                    <p className="mt-1">{certInfo.subject?.OU || "N/A"}</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-3">Issuer Certificate</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">Common Name (CN):</span>
                    <p className="mt-1">{certInfo.issuer?.CN || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Organization (O):</span>
                    <p className="mt-1">{certInfo.issuer?.O || "N/A"}</p>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-3">Certificate Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">Valid From:</span>
                    <p className="mt-1">{formatDate(certInfo.validFrom)}</p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Valid To:</span>
                    <p className="mt-1">{formatDate(certInfo.validTo)}</p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Serial Number:</span>
                    <p className="mt-1 font-mono text-xs">{certInfo.serialNumber || "N/A"}</p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Algorithm:</span>
                    <p className="mt-1">{certInfo.signatureAlgorithm || "N/A"}</p>
                  </div>
                </div>
              </div>

              {certInfo.subjectAltNames && certInfo.subjectAltNames.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-3">Subject Alternative Names</h4>
                  <div className="flex flex-wrap gap-2">
                    {certInfo.subjectAltNames.map((san: string, index: number) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {san}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Certificate information not available</div>
          )}
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="mt-0">
          <PerformanceMetricsChart
            connectionId={connection.id}
            connectionName={connection.name}
            showIcons={true}
            showGrade={true}
          />
        </TabsContent>

        {/* Tools Tab */}
        <TabsContent value="tools" className="mt-0">
          <div className={toolsGridClass}>
            <CertificateRenewalButton
              connection={connection}
              onSuccess={onRenewSuccess}
              refresh={onRefreshCert}
              isDisabled={activeOperation}
            />

            <CertificateDownloadButton
              connection={connection}
              refreshTrigger={downloadRefreshTrigger}
            />

            {showSSH && (
              <ServiceRestartButton
                connection={connection}
                onSuccess={onRefreshCert}
                isDisabled={activeOperation}
              />
            )}

            {showSSH && (
              <Button
                onClick={() => onSSHTest(connection)}
                size="sm"
                variant="outline"
                disabled={testingSSH}
                className="justify-center border-primary/30 hover:border-primary/50 hover:bg-primary/5"
              >
                {testingSSH ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Terminal className="h-4 w-4 mr-2 text-primary" />
                    Test SSH
                  </>
                )}
              </Button>
            )}

            <Button
              onClick={() => onNavigate(`/logs?connection=${connection.id}`)}
              size="sm"
              variant="outline"
              className="justify-center border-border hover:border-muted-foreground/30 hover:bg-muted/50"
            >
              <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
              {variant === "table" ? "Logs" : "View Logs"}
            </Button>

            <Button
              onClick={() => window.open(`https://${hostname}`, "_blank")}
              size="sm"
              variant="outline"
              className="justify-center border-status-valid/30 hover:border-status-valid/50 hover:bg-status-valid/5"
            >
              <ExternalLink className="h-4 w-4 mr-2 text-status-valid" />
              {variant === "table" ? "View" : "View in Browser"}
            </Button>
          </div>
        </TabsContent>

      </div>
    </Tabs>
  );
};

export default ConnectionDetailsTabs;
