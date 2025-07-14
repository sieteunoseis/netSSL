import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCertificateRenewal } from "@/contexts/WebSocketContext";
import { Shield, RotateCcw, CheckCircle } from "lucide-react";
import { apiCall } from "@/lib/api";
import { debugLog } from "@/lib/debug";

const CertificateRenewalButton = ({ connection, onConfirmRenew }) => {
  const { toast } = useToast();
  const { 
    activeOperation, 
    isRenewing, 
    progress, 
    message, 
    error,
    status,
    renewalStatus 
  } = useCertificateRenewal(connection.id);

  const [recentlyCompleted, setRecentlyCompleted] = useState(false);

  // Debug logging
  React.useEffect(() => {
    debugLog(`CertificateRenewalButton for connection ${connection.id}:`, {
      activeOperation,
      isRenewing,
      progress,
      message,
      status,
      renewalStatus
    });
  }, [connection.id, activeOperation, isRenewing, progress, message, status, renewalStatus]);

  // Track recently completed operations
  React.useEffect(() => {
    if (status === 'completed' && activeOperation) {
      setRecentlyCompleted(true);
      const timer = setTimeout(() => {
        setRecentlyCompleted(false);
      }, 10000); // Show completion state for 10 seconds
      return () => clearTimeout(timer);
    }
  }, [status, activeOperation]);

  const handleClick = async () => {
    if (isRenewing) {
      // If already renewing, show current status with progress
      const progressText = progress > 0 ? ` (${progress}%)` : '';
      toast({
        title: "Certificate Renewal In Progress",
        description: `${message || "Certificate renewal is currently running"}${progressText}`,
        duration: 3000,
      });
      return;
    }

    if (onConfirmRenew) {
      // Let the parent handle confirmation dialog
      onConfirmRenew();
    } else {
      // Direct renewal
      await startRenewal();
    }
  };

  const startRenewal = async () => {
    try {
      debugLog(`Starting certificate renewal for connection ${connection.id}`);
      
      const response = await apiCall(`/data/${connection.id}/issue-cert`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.details || 'Failed to start certificate renewal');
      }

      const data = await response.json();
      debugLog('Certificate renewal started:', data);

      toast({
        title: "Certificate Renewal Started",
        description: "Certificate renewal has been initiated. You can monitor progress in real-time.",
        duration: 5000,
      });

    } catch (error) {
      console.error('Error starting certificate renewal:', error);
      toast({
        title: "Certificate Renewal Failed",
        description: error.message || "Failed to start certificate renewal",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  const getButtonContent = () => {
    if (isRenewing) {
      const progressText = progress > 0 ? ` (${progress}%)` : '';
      return (
        <>
          <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
          {message || 'Renewing...'}{progressText}
        </>
      );
    }

    if (recentlyCompleted) {
      return (
        <>
          <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
          Renewal Completed
        </>
      );
    }

    return (
      <>
        <Shield className="mr-2 h-4 w-4" />
        Renew Certificate
      </>
    );
  };

  const isDisabled = isRenewing;

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      size="sm"
      className={`${
        recentlyCompleted 
          ? 'text-green-600 hover:text-green-700 border-green-300 hover:border-green-400 bg-green-50' 
          : isRenewing 
            ? 'text-blue-600 hover:text-blue-700 border-blue-300 hover:border-blue-400 bg-blue-50'
            : 'text-blue-600 hover:text-blue-700 border-blue-300 hover:border-blue-400'
      }`}
      variant="outline"
    >
      {getButtonContent()}
    </Button>
  );
};

// Export the start function so it can be called from confirmation dialogs
CertificateRenewalButton.startRenewal = async (connectionId, toast) => {
  try {
    debugLog(`Starting certificate renewal for connection ${connectionId}`);
    
    const response = await apiCall(`/data/${connectionId}/issue-cert`, {
      method: 'POST'
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.details || 'Failed to start certificate renewal');
    }

    const data = await response.json();
    debugLog('Certificate renewal started:', data);

    toast({
      title: "Certificate Renewal Started",
      description: "Certificate renewal has been initiated. You can monitor progress in real-time.",
      duration: 5000,
    });

  } catch (error) {
    console.error('Error starting certificate renewal:', error);
    toast({
      title: "Certificate Renewal Failed",
      description: error.message || "Failed to start certificate renewal",
      variant: "destructive",
      duration: 5000,
    });
  }
};

export default CertificateRenewalButton;