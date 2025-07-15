import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Shield, Calendar, AlertCircle, CheckCircle, RefreshCw, FileText, X } from "lucide-react";
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
  onRenewalComplete?: () => void;
}

const CertificateInfoComponent: React.FC<CertificateInfoProps> = ({ connectionId, onRenewCertificate, onRenewalComplete }) => {
  const { toast } = useToast();
  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');
  const [lastRenewalProgress, setLastRenewalProgress] = useState(0);
  
  // Use WebSocket hook for real-time renewal updates
  const { 
    activeOperation,
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

  const killRenewalOperation = async () => {
    if (!activeOperation) return;
    
    // Confirm before cancelling
    if (!confirm('Are you sure you want to cancel this certificate renewal operation? This action cannot be undone.')) {
      return;
    }

    try {
      // Cancel the active operation via API
      const response = await apiCall(`/operations/${activeOperation.id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        toast({
          title: "Operation Cancelled",
          description: "Certificate renewal operation has been cancelled and cleaned up.",
          duration: 3000,
        });
      } else {
        throw new Error('Failed to cancel operation');
      }
    } catch (error) {
      console.error('Error cancelling operation:', error);
      toast({
        title: "Error",
        description: "Failed to cancel the operation. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  useEffect(() => {
    fetchCertificateInfo();
  }, [connectionId]);

  // Track renewal progress to detect completion
  useEffect(() => {
    if (isRenewing && progress > lastRenewalProgress) {
      setLastRenewalProgress(progress);
    }
  }, [isRenewing, progress, lastRenewalProgress]);

  // Handle renewal completion and error states
  useEffect(() => {
    console.log('CertificateInfo renewal state:', {
      renewalStatus,
      isRenewing,
      renewalError,
      activeOperation: !!activeOperation,
      detailedRenewalStatus,
      progress,
      lastRenewalProgress,
      showCompletionMessage
    });
    
    // Detect completion: was renewing with high progress, now not renewing and no active operation
    if (!isRenewing && !activeOperation && lastRenewalProgress >= 70 && !showCompletionMessage) {
      console.log('Renewal completed - showing completion message');
      // Show completion message
      setCompletionMessage('Certificate renewed successfully! Refreshing certificate information...');
      setShowCompletionMessage(true);
      
      toast({
        title: "Certificate Renewed",
        description: "Certificate has been successfully renewed.",
        duration: 5000,
      });
      
      // Refresh certificate info after successful renewal
      setTimeout(() => {
        fetchCertificateInfo();
        // Notify parent component that renewal completed
        if (onRenewalComplete) {
          onRenewalComplete();
        }
      }, 1000);
      
      // Hide completion message after 5 seconds
      setTimeout(() => {
        setShowCompletionMessage(false);
        setLastRenewalProgress(0); // Reset for next renewal
      }, 5000);
    }
    
    if (renewalStatus === 'failed' && renewalError) {
      toast({
        title: "Certificate Renewal Failed",
        description: renewalError,
        variant: "destructive",
        duration: 7000,
      });
    }
  }, [renewalStatus, isRenewing, renewalError, activeOperation, lastRenewalProgress, showCompletionMessage, toast]);

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
      {(isRenewing || showCompletionMessage) && (
        <div className={`mt-4 p-3 rounded-lg border ${
          showCompletionMessage 
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
            : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              {showCompletionMessage ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
              )}
              <span className={`text-sm font-medium ${
                showCompletionMessage 
                  ? 'text-green-800 dark:text-green-200' 
                  : 'text-blue-800 dark:text-blue-200'
              }`}>
                {showCompletionMessage ? 'Certificate Renewal Complete' : 'Certificate Renewal in Progress'}
              </span>
            </div>
            {!showCompletionMessage && (
              <Button
                onClick={killRenewalOperation}
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-red-500 h-6 w-6 p-0"
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {showCompletionMessage ? (
              <div className="text-sm text-green-700 dark:text-green-300">
                {completionMessage}
              </div>
            ) : (
              <>
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
              </>
            )}
            
            {/* Manual DNS Entry Instructions */}
            {detailedRenewalStatus === 'waiting_manual_dns' && activeOperation?.metadata?.manualDNSEntry && (
              <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md">
                <h4 className="font-medium text-orange-800 dark:text-orange-200 mb-2 flex items-center text-sm">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Manual DNS Configuration Required
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[auto,1fr,auto] gap-2 items-center">
                    <span className="font-medium text-orange-700 dark:text-orange-300">Type:</span>
                    <input
                      type="text"
                      value="TXT"
                      readOnly
                      className="px-2 py-1 bg-white dark:bg-gray-800 border border-orange-300 dark:border-orange-700 rounded text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText("TXT");
                        toast({
                          title: "Copied",
                          description: "Record type copied",
                          duration: 2000,
                        });
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-[auto,1fr,auto] gap-2 items-center">
                    <span className="font-medium text-orange-700 dark:text-orange-300">Name:</span>
                    <input
                      type="text"
                      value={activeOperation.metadata.manualDNSEntry.recordName || ''}
                      readOnly
                      className="px-2 py-1 bg-white dark:bg-gray-800 border border-orange-300 dark:border-orange-700 rounded text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(activeOperation.metadata.manualDNSEntry.recordName || '');
                        toast({
                          title: "Copied",
                          description: "DNS name copied",
                          duration: 2000,
                        });
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-[auto,1fr,auto] gap-2 items-center">
                    <span className="font-medium text-orange-700 dark:text-orange-300">Value:</span>
                    <input
                      type="text"
                      value={activeOperation.metadata.manualDNSEntry.recordValue || ''}
                      readOnly
                      className="px-2 py-1 bg-white dark:bg-gray-800 border border-orange-300 dark:border-orange-700 rounded text-xs font-mono break-all"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(activeOperation.metadata.manualDNSEntry.recordValue || '');
                        toast({
                          title: "Copied",
                          description: "DNS value copied",
                          duration: 2000,
                        });
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  
                  <div className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                    Add this TXT record to your DNS and the system will verify it automatically.
                  </div>
                </div>
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