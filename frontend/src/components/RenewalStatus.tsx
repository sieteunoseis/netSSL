import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, CheckCircle, XCircle, Clock, AlertCircle, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/api";
import { useCertificateRenewal } from "@/contexts/WebSocketContext";

interface RenewalStatus {
  id: string;
  connectionId: number;
  status: 'pending' | 'generating_csr' | 'creating_account' | 'requesting_certificate' | 'creating_dns_challenge' | 'waiting_dns_propagation' | 'waiting_manual_dns' | 'completing_validation' | 'downloading_certificate' | 'uploading_certificate' | 'completed' | 'failed';
  message: string;
  progress: number;
  startTime: string;
  endTime?: string;
  error?: string;
  logs: string[];
  manualDNSEntry?: {
    recordName: string;
    recordValue: string;
    instructions: string;
  };
}

interface RenewalStatusProps {
  connectionId: number;
  renewalId: string;
  onClose: () => void;
}

interface CertificateFile {
  type: string;
  filename: string;
  size: number;
  lastModified: string;
}

const RenewalStatusComponent: React.FC<RenewalStatusProps> = ({ connectionId, renewalId, onClose }) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<RenewalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certificateFiles, setCertificateFiles] = useState<CertificateFile[]>([]);
  
  // Use WebSocket hook for real-time updates
  const { 
    isRenewing, 
    progress: wsProgress, 
    message: wsMessage, 
    error: wsError,
    renewalStatus: wsRenewalStatus,
    activeOperation
  } = useCertificateRenewal(connectionId);

  const fetchStatus = async () => {
    try {
      const response = await apiCall(`/data/${connectionId}/renewal-status/${renewalId}`);
      const data = await response.json();
      setStatus(data);
      setError(null);
      
      // If renewal is completed, fetch available certificate files
      if (data.status === 'completed') {
        await fetchCertificateFiles();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch renewal status';
      setError(errorMessage);
      console.error('Error fetching renewal status:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCertificateFiles = async () => {
    try {
      const response = await apiCall(`/data/${connectionId}/certificates`);
      const data = await response.json();
      setCertificateFiles(data.availableFiles || []);
    } catch (err) {
      console.error('Error fetching certificate files:', err);
    }
  };

  const handleDownloadCertificate = (fileType: string) => {
    const downloadUrl = `/api/data/${connectionId}/certificates/${fileType}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = ``;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Download Started",
      description: `Downloading ${fileType} certificate file`,
      duration: 3000,
    });
  };

  useEffect(() => {
    fetchStatus();
    
    // Only use polling as fallback if WebSocket is not providing updates
    let intervalId: NodeJS.Timeout | null = null;
    
    if (!isRenewing && status && status.status !== 'completed' && status.status !== 'failed') {
      intervalId = setInterval(() => {
        fetchStatus();
      }, 5000); // Reduced frequency since WebSocket provides real-time updates
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [connectionId, renewalId, status?.status, isRenewing]);

  // Update local status with WebSocket data when available
  useEffect(() => {
    if (activeOperation && activeOperation.id === renewalId) {
      setStatus(prevStatus => ({
        ...prevStatus,
        id: renewalId,
        connectionId: connectionId,
        status: wsRenewalStatus as RenewalStatus['status'],
        message: wsMessage,
        progress: wsProgress,
        startTime: prevStatus?.startTime || new Date().toISOString(),
        error: wsError,
        logs: activeOperation.metadata?.logs || prevStatus?.logs || []
      } as RenewalStatus));
      setLoading(false);
    }
  }, [activeOperation, renewalId, connectionId, wsRenewalStatus, wsMessage, wsProgress, wsError]);

  const getStatusIcon = () => {
    if (!status) return <Clock className="w-4 h-4" />;
    
    switch (status.status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'waiting_manual_dns':
        return <Clock className="w-4 h-4 text-orange-500" />;
      case 'pending':
      case 'generating_csr':
      case 'creating_account':
      case 'requesting_certificate':
      case 'creating_dns_challenge':
      case 'waiting_dns_propagation':
      case 'completing_validation':
      case 'downloading_certificate':
      case 'uploading_certificate':
        return <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusColor = () => {
    if (!status) return "bg-gray-100 text-gray-800";
    
    switch (status.status) {
      case 'completed':
        return "bg-green-100 text-green-800";
      case 'failed':
        return "bg-red-100 text-red-800";
      case 'waiting_manual_dns':
        return "bg-orange-100 text-orange-800";
      case 'pending':
      case 'generating_csr':
      case 'creating_account':
      case 'requesting_certificate':
      case 'creating_dns_challenge':
      case 'waiting_dns_propagation':
      case 'completing_validation':
      case 'downloading_certificate':
      case 'uploading_certificate':
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getDuration = () => {
    if (!status) return null;
    
    const start = new Date(status.startTime);
    const end = status.endTime ? new Date(status.endTime) : new Date();
    const duration = Math.floor((end.getTime() - start.getTime()) / 1000);
    
    if (duration < 60) return `${duration}s`;
    if (duration < 3600) return `${Math.floor(duration / 60)}m ${duration % 60}s`;
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
  };

  if (loading) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading Renewal Status...</span>
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <XCircle className="w-5 h-5 text-red-500" />
            <span>Error Loading Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-600 mb-4">{error}</p>
          <div className="flex space-x-2">
            <Button onClick={fetchStatus} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
            <Button onClick={onClose} variant="outline" size="sm">
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            {getStatusIcon()}
            <span>Certificate Renewal Status</span>
          </CardTitle>
          <Button onClick={onClose} variant="ghost" size="sm">
            ×
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <>
            {/* Status Overview */}
            <div className="flex items-center justify-between">
              <Badge className={getStatusColor()}>
                {status.status.replace('_', ' ').toUpperCase()}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Duration: {getDuration()}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{status.message}</span>
                <span>{status.progress}%</span>
              </div>
              <Progress value={status.progress} className="w-full" />
            </div>

            {/* Error Message */}
            {status.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-700">
                  <strong>Error:</strong> {status.error}
                </p>
              </div>
            )}

            {/* Manual DNS Instructions */}
            {status.status === 'waiting_manual_dns' && status.manualDNSEntry && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-md">
                <h4 className="font-medium text-orange-800 mb-2 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Manual DNS Configuration Required
                </h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Record Type:</span> TXT
                  </div>
                  <div>
                    <span className="font-medium">Name:</span>
                    <code className="ml-2 px-2 py-1 bg-orange-100 rounded text-xs">
                      {status.manualDNSEntry.recordName}
                    </code>
                  </div>
                  <div>
                    <span className="font-medium">Value:</span>
                    <code className="ml-2 px-2 py-1 bg-orange-100 rounded text-xs break-all">
                      {status.manualDNSEntry.recordValue}
                    </code>
                  </div>
                  <div>
                    <span className="font-medium">TTL:</span> 300 (or minimum allowed)
                  </div>
                </div>
                <div className="mt-3 text-xs text-orange-700">
                  <strong>Instructions:</strong> Add the above TXT record to your DNS management interface. 
                  The system will automatically verify the record every 10 seconds.
                </div>
              </div>
            )}

            {/* Timing Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Started:</span>
                <p className="text-muted-foreground">{formatTime(status.startTime)}</p>
              </div>
              {status.endTime && (
                <div>
                  <span className="font-medium">Completed:</span>
                  <p className="text-muted-foreground">{formatTime(status.endTime)}</p>
                </div>
              )}
            </div>

            {/* Logs */}
            <div className="space-y-2">
              <h4 className="font-medium">Renewal Logs:</h4>
              <ScrollArea className="h-32 w-full border rounded-md p-2">
                <div className="space-y-1">
                  {status.logs.map((log, index) => (
                    <div key={index} className="text-xs font-mono text-muted-foreground">
                      {log}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Certificate Downloads */}
            {status.status === 'completed' && certificateFiles.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium flex items-center">
                  <Download className="w-4 h-4 mr-2" />
                  Download Certificates:
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {certificateFiles.map((file) => (
                    <Button
                      key={file.type}
                      onClick={() => handleDownloadCertificate(file.type)}
                      variant="outline"
                      size="sm"
                      className="justify-start text-left"
                    >
                      <Download className="w-3 h-3 mr-2" />
                      <div className="flex flex-col items-start">
                        <span className="text-xs font-medium">{file.filename}</span>
                        <span className="text-xs text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-2">
              <Button onClick={fetchStatus} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              {(status.status === 'completed' || status.status === 'failed') && (
                <Button onClick={onClose} variant="outline" size="sm">
                  Close
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default RenewalStatusComponent;