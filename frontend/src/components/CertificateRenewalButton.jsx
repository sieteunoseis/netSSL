import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCertificateRenewal } from "@/contexts/WebSocketContext";
import { Shield, RotateCw, CheckCircle, X } from "lucide-react";
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
  const [showCancel, setShowCancel] = useState(false);

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
      // First show 100% for 2 seconds, then show "Renewal Completed" for 8 seconds
      const showCompletedTimer = setTimeout(() => {
        setRecentlyCompleted(true);
      }, 2000); // Show 100% for 2 seconds first
      
      const hideCompletedTimer = setTimeout(() => {
        setRecentlyCompleted(false);
      }, 10000); // Total of 10 seconds (2 seconds for 100% + 8 seconds for "Renewal Completed")
      
      return () => {
        clearTimeout(showCompletedTimer);
        clearTimeout(hideCompletedTimer);
      };
    }
  }, [status, activeOperation]);

  // Show cancel option for stuck renewals (after 30 seconds of no progress changes, or if failed/error status)
  React.useEffect(() => {
    if (!isRenewing || !activeOperation) {
      setShowCancel(false);
      return;
    }

    // Show cancel immediately for failed operations
    if (status === 'failed' || error) {
      setShowCancel(true);
      return;
    }

    // Show cancel after 30 seconds for stuck operations
    const timer = setTimeout(() => {
      if (isRenewing) {
        setShowCancel(true);
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [isRenewing, activeOperation, status, error]);

  const handleCancel = async () => {
    if (!activeOperation) return;

    // Confirm before cancelling
    if (!confirm('Are you sure you want to cancel this certificate renewal? This action cannot be undone.')) {
      return;
    }

    try {
      debugLog(`Cancelling certificate renewal operation ${activeOperation.id}`);
      
      const response = await apiCall(`/operations/${activeOperation.id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        toast({
          title: "Certificate Renewal Cancelled",
          description: "The certificate renewal operation has been cancelled.",
          duration: 3000,
        });
        setShowCancel(false);
      } else {
        throw new Error('Failed to cancel operation');
      }
    } catch (error) {
      console.error('Error cancelling certificate renewal:', error);
      toast({
        title: "Cancel Failed",
        description: "Failed to cancel the certificate renewal. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

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
      
      // Show more detailed status messages for key phases
      let displayMessage = message || 'Renewing...';
      if (renewalStatus === 'waiting_manual_dns') {
        displayMessage = 'Waiting for manual DNS entry';
      } else if (renewalStatus === 'waiting_dns_propagation') {
        displayMessage = 'Waiting for DNS propagation';
      } else if (renewalStatus === 'completing_validation') {
        displayMessage = 'Completing DNS validation';
      } else if (renewalStatus === 'restarting_service') {
        displayMessage = message || 'Restarting Tomcat...';
      }
      
      return (
        <>
          <RotateCw className="mr-2 h-4 w-4 animate-spin" />
          {displayMessage}{progressText}
        </>
      );
    }

    // Show completion with 100% when status is completed but before recentlyCompleted is set
    if (status === 'completed' && progress === 100 && !recentlyCompleted) {
      return (
        <>
          <RotateCw className="mr-2 h-4 w-4 animate-spin" />
          {message || 'Renewing...'} (100%)
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

  const isDisabled = (isRenewing && !showCancel) || (status === 'completed' && progress === 100 && !recentlyCompleted);

  // If renewal is in progress and we should show cancel, render two buttons
  if (isRenewing && showCancel) {
    return (
      <div className="flex items-center gap-1 w-full">
        <Button
          onClick={handleClick}
          disabled={true}
          size="sm"
          className="text-blue-600 hover:text-blue-700 border-blue-300 hover:border-blue-400 bg-blue-50 flex-1 min-w-0"
          variant="outline"
        >
          {getButtonContent()}
        </Button>
        <Button
          onClick={handleCancel}
          size="sm"
          className="text-red-600 hover:text-red-700 border-red-300 hover:border-red-400 bg-red-50 flex-shrink-0"
          variant="outline"
          title="Cancel renewal"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      size="sm"
      className={`${
        recentlyCompleted 
          ? 'text-green-600 hover:text-green-700 border-green-300 hover:border-green-400 bg-green-50' 
          : isRenewing || (status === 'completed' && progress === 100 && !recentlyCompleted)
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
    
    // Return the renewal data so caller can show the modal
    return data;

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