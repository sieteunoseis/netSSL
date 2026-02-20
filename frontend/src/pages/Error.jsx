import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Home, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import BackgroundLogo from "@/components/BackgroundLogo";

const ErrorPage = () => {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (countdown === 0) {
      window.location.reload();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

  const handleGoHome = () => {
    navigate("/");
  };

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-full w-full py-20 relative bg-background">
      <BackgroundLogo />
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col items-center mb-10">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-destructive/10">
                <span className="text-2xl">⚠️</span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight">Something went wrong</h2>
              <p className="mt-2 text-sm text-muted-foreground">We encountered an error while processing your request. Please try again later.</p>
              <p className="mt-4 text-sm text-muted-foreground">
                Reloading in <span className="font-mono">{countdown}</span> second{countdown !== 1 ? 's' : ''}...
              </p>
            </CardContent>
            <CardFooter className="flex justify-center pb-6 gap-4">
              <Button onClick={handleGoHome} className="flex items-center gap-2">
                <Home className="w-4 h-4" />
                Go back home
              </Button>
              <Button onClick={handleReload} variant="outline" className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Reload Now
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;
