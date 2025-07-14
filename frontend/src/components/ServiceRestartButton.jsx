import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useServiceRestart } from "@/contexts/WebSocketContext";
import { Server, RotateCcw, CheckCircle } from "lucide-react";
import { apiCall } from "@/lib/api";
import { debugLog } from "@/lib/debug";

const ServiceRestartButton = ({ connection, onConfirmRestart }) => {
  const { toast } = useToast();
  const { 
    activeOperation, 
    isRestarting, 
    progress, 
    message, 
    error,
    status 
  } = useServiceRestart(connection.id);

  const [recentlyCompleted, setRecentlyCompleted] = useState(false);

  // Debug logging
  React.useEffect(() => {
    debugLog(`ServiceRestartButton for connection ${connection.id}:`, {
      activeOperation,
      isRestarting,
      progress,
      message,
      status
    });
  }, [connection.id, activeOperation, isRestarting, progress, message, status]);

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
    if (isRestarting) {
      // If already restarting, show current status with progress
      const progressText = progress > 0 ? ` (${progress}%)` : '';
      toast({
        title: "Service Restart In Progress",
        description: `${message || "Service restart is currently running"}${progressText}`,
        duration: 3000,
      });
      return;
    }

    // Show confirmation dialog
    onConfirmRestart(connection);
  };


  // Handle error states
  React.useEffect(() => {
    if (error && status === 'failed') {
      toast({
        title: "Service Restart Failed",
        description: error,
        variant: "destructive",
        duration: 10000,
      });
    } else if (status === 'completed') {
      toast({
        title: "Service Restart Completed",
        description: "Cisco Tomcat service has been restarted successfully",
        duration: 5000,
      });
    }
  }, [error, status, toast]);

  const getButtonContent = () => {
    if (isRestarting) {
      const progressText = progress > 0 ? ` (${progress}%)` : '';
      return (
        <>
          <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
          {message || 'Restarting...'}{progressText}
        </>
      );
    }

    if (recentlyCompleted) {
      return (
        <>
          <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
          Restart Completed
        </>
      );
    }

    return (
      <>
        <Server className="mr-2 h-4 w-4" />
        Restart Service
      </>
    );
  };

  const isDisabled = isRestarting;

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      size="sm"
      className={`${
        recentlyCompleted 
          ? 'text-green-600 hover:text-green-700 border-green-300 hover:border-green-400 bg-green-50' 
          : isRestarting 
            ? 'text-orange-600 hover:text-orange-700 border-orange-300 hover:border-orange-400 bg-orange-50'
            : 'text-orange-600 hover:text-orange-700 border-orange-300 hover:border-orange-400'
      }`}
      variant="outline"
    >
      {getButtonContent()}
    </Button>
  );
};

// Export the start function so it can be called from confirmation dialogs
ServiceRestartButton.startRestart = async (connectionId, toast) => {
  try {
    const response = await apiCall(`/data/${connectionId}/restart-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    
    if (result.status === 'started') {
      toast({
        title: "Service Restart Initiated",
        description: "Cisco Tomcat service restart has been started. You can monitor the progress in real-time.",
        duration: 5000,
      });
    } else if (result.status === 'already_running') {
      toast({
        title: "Service Restart Already Running",
        description: result.message || "A service restart is already in progress",
        duration: 3000,
      });
    } else {
      toast({
        title: "Service Restart Failed",
        description: result.error || "Unable to start service restart",
        variant: "destructive",
      });
    }
  } catch (error) {
    console.error('Error starting service restart:', error);
    toast({
      title: "Restart Error",
      description: "Failed to start service restart. Please check your connection.",
      variant: "destructive",
    });
  }
};

export default ServiceRestartButton;