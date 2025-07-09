import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/api";

interface RenewalStatus {
  id: string;
  connectionId: number;
  status: 'pending' | 'generating_csr' | 'requesting_cert' | 'updating_dns' | 'uploading_cert' | 'completed' | 'failed';
  message: string;
  progress: number;
  startTime: string;
  endTime?: string;
  error?: string;
  logs: string[];
}

interface RenewalStatusProps {
  connectionId: number;
  renewalId: string;
  onClose: () => void;
}

const RenewalStatusComponent: React.FC<RenewalStatusProps> = ({ connectionId, renewalId, onClose }) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<RenewalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await apiCall(`/data/${connectionId}/renewal-status/${renewalId}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch renewal status');
      }
      
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch renewal status';
      setError(errorMessage);
      console.error('Error fetching renewal status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    // Poll for status updates if the renewal is still in progress
    const intervalId = setInterval(() => {
      if (status && status.status !== 'completed' && status.status !== 'failed') {
        fetchStatus();
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [connectionId, renewalId, status?.status]);

  const getStatusIcon = () => {
    if (!status) return <Clock className="w-4 h-4" />;
    
    switch (status.status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'pending':
      case 'generating_csr':
      case 'requesting_cert':
      case 'updating_dns':
      case 'uploading_cert':
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
      case 'pending':
      case 'generating_csr':
      case 'requesting_cert':
      case 'updating_dns':
      case 'uploading_cert':
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