import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Shield, Calendar, AlertCircle, CheckCircle, RefreshCw, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/api";
import { useCertificateRenewal } from "@/contexts/WebSocketContext";

interface CertificateInfo {
  subject: {
    CN?: string;
    O?: string;
    OU?: string;
  };
  issuer: {
    CN?: string;
    O?: string;
    OU?: string;
  };
  validFrom: string;
  validTo: string;
  fingerprint: string;
  fingerprint256: string;
  serialNumber: string;
  subjectAltNames?: string[];
  isValid: boolean;
  daysUntilExpiry: number;
  error?: string;
}

interface CertificateInfoProps {
  connectionId: number;
  hostname: string;
  onRenewCertificate?: () => void;
}

const CertificateInfoComponent: React.FC<CertificateInfoProps> = ({ connectionId, onRenewCertificate }) => {
  const { toast } = useToast();
  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Use WebSocket hook for real-time renewal updates
  const { 
    isRenewing, 
    progress, 
    message, 
    error: renewalError, 
    status: renewalStatus,
    renewalStatus: detailedRenewalStatus 
  } = useCertificateRenewal(connectionId);

  const fetchCertificateInfo = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiCall(`/data/${connectionId}/certificate`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to fetch certificate information');
      }
      
      const data = await response.json();
      setCertInfo(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch certificate information';
      setError(errorMessage);
      toast({
        title: "Certificate Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCertificateInfo();
  }, [connectionId]);

  // Handle renewal completion and error states
  useEffect(() => {
    if (renewalStatus === 'completed' && !isRenewing) {
      toast({
        title: "Certificate Renewed",
        description: "Certificate has been successfully renewed.",
        duration: 5000,
      });
      // Refresh certificate info after successful renewal
      fetchCertificateInfo();
    }
    
    if (renewalStatus === 'failed' && renewalError) {
      toast({
        title: "Certificate Renewal Failed",
        description: renewalError,
        variant: "destructive",
        duration: 7000,
      });
    }
  }, [renewalStatus, isRenewing, renewalError, toast]);

  const getCertificateStatus = () => {
    if (!certInfo) return { status: "unknown", color: "bg-gray-100 text-gray-800", icon: AlertCircle };
    
    if (!certInfo.isValid) {
      return { status: "invalid", color: "bg-red-100 text-red-800", icon: AlertCircle };
    }
    
    if (certInfo.daysUntilExpiry <= 0) {
      return { status: "expired", color: "bg-red-100 text-red-800", icon: AlertCircle };
    } else if (certInfo.daysUntilExpiry <= 30) {
      return { status: "expiring", color: "bg-yellow-100 text-yellow-800", icon: AlertCircle };
    } else {
      return { status: "valid", color: "bg-green-100 text-green-800", icon: CheckCircle };
    }
  };

  const formatFingerprint = (fingerprint: string) => {
    return fingerprint.replace(/:/g, '').toLowerCase();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">Loading certificate info...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center text-sm text-red-600">
          <AlertCircle className="w-4 h-4 mr-2" />
          {error}
        </div>
        <Button variant="outline" size="sm" onClick={fetchCertificateInfo}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!certInfo) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        No certificate information available
      </div>
    );
  }

  const status = getCertificateStatus();
  const StatusIcon = status.icon;

  return (
    <div className="mt-4">
      {/* Top level with certificate info and renew button */}
      <div className="flex items-center justify-between w-full mb-2">
        <div className="flex items-center space-x-2">
          <Shield className="w-4 h-4" />
          <span className="text-sm font-medium">Certificate Information</span>
          <Badge className={status.color}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {status.status === "valid" && "Valid"}
            {status.status === "expiring" && "Expiring"}
            {status.status === "expired" && "Expired"}
            {status.status === "invalid" && "Invalid"}
            {status.status === "unknown" && "Unknown"}
          </Badge>
        </div>
        {onRenewCertificate && (
          <div
            onClick={isRenewing ? undefined : onRenewCertificate}
            className={`flex items-center space-x-1 px-3 py-1 text-sm border border-input bg-background rounded-md transition-colors ${
              isRenewing 
                ? 'cursor-not-allowed opacity-75' 
                : 'hover:bg-accent hover:text-accent-foreground cursor-pointer'
            }`}
          >
            {isRenewing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            <span>
              {isRenewing ? `Renewing... (${progress}%)` : 'Renew Certificate'}
            </span>
          </div>
        )}
      </div>
      
      {/* Real-time renewal progress */}
      {isRenewing && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center space-x-2 mb-2">
            <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
            <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Certificate Renewal in Progress
            </span>
          </div>
          <div className="space-y-2">
            <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              {message} ({progress}%)
            </div>
            {detailedRenewalStatus && detailedRenewalStatus !== 'pending' && (
              <div className="text-xs text-blue-600 dark:text-blue-400">
                Status: {detailedRenewalStatus.replace(/_/g, ' ')}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Accordion for detailed certificate info */}
      <Accordion type="single" collapsible>
        <AccordionItem value="certificate-info">
          <AccordionTrigger className="text-sm">
            <span>View Certificate Details</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4">
              {/* Subject Information */}
              <div>
                <h4 className="font-medium text-sm mb-2">Subject Certificate</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Common Name (CN):</span>
                    <span className="ml-2">{certInfo.subject.CN}</span>
                  </div>
                  <div>
                    <span className="font-medium">Organization (O):</span>
                    <span className="ml-2">{certInfo.subject.O}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium">Organizational Unit (OU):</span>
                    <span className="ml-2">{certInfo.subject.OU}</span>
                  </div>
                </div>
              </div>

              {/* Issuer Information */}
              <div>
                <h4 className="font-medium text-sm mb-2">Issuer Certificate</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Common Name (CN):</span>
                    <span className="ml-2">{certInfo.issuer.CN}</span>
                  </div>
                  <div>
                    <span className="font-medium">Organization (O):</span>
                    <span className="ml-2">{certInfo.issuer.O}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium">Organizational Unit (OU):</span>
                    <span className="ml-2">{certInfo.issuer.OU}</span>
                  </div>
                </div>
              </div>

              {/* Validity Information */}
              <div>
                <h4 className="font-medium text-sm mb-2">Validity Period</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                    <span className="font-medium">Issued On:</span>
                    <span className="ml-2">{certInfo.validFrom}</span>
                  </div>
                  <div className="flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                    <span className="font-medium">Expires On:</span>
                    <span className="ml-2">{certInfo.validTo}</span>
                  </div>
                </div>
              </div>

              {/* Certificate Details */}
              <div>
                <h4 className="font-medium text-sm mb-2">Certificate Details</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Certificate (SHA1):</span>
                    <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs font-mono break-all">
                      {formatFingerprint(certInfo.fingerprint)}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Public Key (SHA256):</span>
                    <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs font-mono break-all">
                      {formatFingerprint(certInfo.fingerprint256)}
                    </div>
                  </div>
                  {certInfo.serialNumber && (
                    <div>
                      <span className="font-medium">Serial Number:</span>
                      <span className="ml-2 font-mono">{certInfo.serialNumber}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Subject Alternative Names */}
              {certInfo.subjectAltNames && certInfo.subjectAltNames.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2">Subject Alternative Names</h4>
                  <div className="flex flex-wrap gap-1">
                    {certInfo.subjectAltNames.map((name, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Refresh Button */}
              <div className="flex justify-end pt-2">
                <Button variant="outline" size="sm" onClick={fetchCertificateInfo}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Certificate Info
                </Button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default CertificateInfoComponent;