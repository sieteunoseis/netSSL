import React, { useState, useEffect, createContext, useContext } from 'react';
import { apiCall } from '@/lib/api';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";

const BackendStatusContext = createContext({ isBackendReady: false });

export const useBackendStatus = () => useContext(BackendStatusContext);

export const BackendStatusProvider = ({ children }) => {
  const [isBackendReady, setIsBackendReady] = useState(false);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const checkBackendStatus = async () => {
      try {
        // Corrected the endpoint to /health, as /api is prepended by apiCall
        await apiCall('/health', { retries: 10, retryDelay: 3000 });
        setIsBackendReady(true);
      } catch (err) {
        setError('Failed to connect to the backend. Please try again later.');
        console.error('Backend health check failed:', err);
      }
    };

    checkBackendStatus();
  }, []);

  useEffect(() => {
    if (error) {
      if (countdown === 0) {
        window.location.reload();
        return;
      }

      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [error, countdown]);

  const handleReload = () => {
    window.location.reload();
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-destructive/10">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">Connection Error</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              Reloading in {countdown} second{countdown !== 1 ? 's' : ''}...
            </p>
          </CardContent>
          <CardFooter className="flex justify-center pb-6">
            <Button onClick={handleReload} variant="outline" className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Reload Now
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!isBackendReady) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Connecting to backend...</h1>
          <p>This may take a few moments, especially on the first start.</p>
        </div>
      </div>
    );
  }

  return (
    <BackendStatusContext.Provider value={{ isBackendReady }}>
      {children}
    </BackendStatusContext.Provider>
  );
};