import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { apiCall } from '@/lib/api';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { RefreshCw, Loader2 } from "lucide-react";

const BackendStatusContext = createContext({ isBackendReady: false });

export const useBackendStatus = () => useContext(BackendStatusContext);

export const BackendStatusProvider = ({ children }) => {
  const [isBackendReady, setIsBackendReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const pollBackend = async () => {
      while (!cancelledRef.current) {
        try {
          await apiCall('/health', { retries: 0 });
          if (!cancelledRef.current) {
            setIsBackendReady(true);
          }
          return;
        } catch (err) {
          if (!cancelledRef.current) {
            setRetryCount(prev => prev + 1);
          }
          // Wait 3 seconds before retrying
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    };

    pollBackend();

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  if (!isBackendReady) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="flex items-center justify-center w-12 h-12 mx-auto">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">Connecting to backend...</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {retryCount === 0
                ? 'This may take a few moments, especially on the first start.'
                : `Still trying to connect... (attempt ${retryCount + 1})`}
            </p>
          </CardContent>
          <CardFooter className="flex justify-center pb-6">
            <Button onClick={() => window.location.reload()} variant="outline" className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Reload Page
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <BackendStatusContext.Provider value={{ isBackendReady }}>
      {children}
    </BackendStatusContext.Provider>
  );
};
