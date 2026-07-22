import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Loader2, Check, X, AlertTriangle } from "lucide-react";
import { apiCall } from "@/lib/api";

interface TrustCheckCert {
  commonName: string;
  issuerCommonName: string;
  selfSigned?: boolean;
  trustedOnIse: boolean;
  serialNumber?: string;
  source?: string;
}

interface TrustCheckResult {
  connectionId: number;
  checkedNode: string;
  iseTrustedCount: number;
  localChain: TrustCheckCert[];
  chainComplete: boolean;
  missingLink: string | null;
  knownIntermediates: TrustCheckCert[];
  knownListUpdated: string;
}

interface Connection {
  id: number;
  application_type?: string;
  ssl_provider?: string;
}

const TrustBadge = ({ trusted }: { trusted: boolean }) =>
  trusted ? (
    <Badge variant="success" className="text-xs">
      <Check className="w-3 h-3 mr-1" /> Trusted
    </Badge>
  ) : (
    <Badge variant="secondary" className="text-xs">
      <X className="w-3 h-3 mr-1" /> Not Trusted
    </Badge>
  );

const CertRow = ({ cert }: { cert: TrustCheckCert }) => (
  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b last:border-b-0 text-sm">
    <div className="min-w-0">
      <div className="font-mono truncate">{cert.commonName}</div>
      <div className="text-xs text-muted-foreground truncate">
        issued by {cert.issuerCommonName}
      </div>
    </div>
    <TrustBadge trusted={cert.trustedOnIse} />
  </div>
);

const ISETrustCheckButton = ({ connection }: { connection: Connection }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TrustCheckResult | null>(null);

  const isEligible =
    connection.application_type === "ise" &&
    (connection.ssl_provider === "letsencrypt" ||
      connection.ssl_provider === "lets_encrypt");

  if (!isEligible) return null;

  const runCheck = async () => {
    setIsOpen(true);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await apiCall(`/data/${connection.id}/ise-trust-check`);
      const data = await response.json();
      setResult(data);
    } catch (err) {
      const e = err as Error & { details?: string };
      setError(e.details || e.message || "Failed to check ISE trust chain.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={runCheck}
        size="sm"
        variant="outline"
        className="justify-center border-border hover:border-muted-foreground/30 hover:bg-muted/50"
      >
        <ShieldCheck className="h-4 w-4 mr-2 text-muted-foreground" />
        Check ISE Trust
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>ISE Trust Chain Check</DialogTitle>
            <DialogDescription>
              Checks which Let&apos;s Encrypt CA certificates are currently
              trusted on this connection&apos;s ISE node.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
            {loading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Checking {connection && "ISE node"}...
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {result && (
              <>
                <div
                  className={`rounded-md border p-3 text-sm ${
                    result.chainComplete
                      ? "border-status-valid/30 bg-status-valid/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                >
                  {result.chainComplete ? (
                    <span className="flex items-center gap-1.5 font-medium">
                      <Check className="h-4 w-4 text-status-valid" />
                      This connection's certificate chain is fully trusted on{" "}
                      {result.checkedNode}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      Chain incomplete —{" "}
                      {result.missingLink ? (
                        <>
                          <span className="font-mono">
                            {result.missingLink}
                          </span>{" "}
                          isn't trusted on {result.checkedNode}
                        </>
                      ) : (
                        <>couldn't verify the chain on {result.checkedNode}</>
                      )}
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-2">
                    This Connection's Chain
                  </h4>
                  <div className="rounded-md border overflow-hidden">
                    {result.localChain.length > 0 ? (
                      result.localChain
                        .slice()
                        .reverse()
                        .map((cert) => (
                          <CertRow key={cert.commonName} cert={cert} />
                        ))
                    ) : (
                      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                        No downloaded chain files found for this connection
                        yet — renew once to populate this.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-2">
                    All Known Let&apos;s Encrypt CAs
                  </h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    Every root/intermediate netSSL knows about, not just the
                    ones this connection currently uses — trust the ones
                    likely to matter before Let&apos;s Encrypt rotates onto
                    them. List updated {result.knownListUpdated}.
                  </p>
                  <div className="rounded-md border overflow-hidden max-h-64 overflow-y-auto">
                    {result.knownIntermediates.map((cert) => (
                      <CertRow
                        key={`${cert.issuerCommonName}-${cert.commonName}`}
                        cert={cert}
                      />
                    ))}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {result.iseTrustedCount} total trusted certificates on{" "}
                  {result.checkedNode}.
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ISETrustCheckButton;
