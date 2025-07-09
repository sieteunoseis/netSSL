import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import BackgroundLogo from "@/components/BackgroundLogo";
import { apiCall } from "@/lib/api";
import templateConfig from "../../template.config.json";
// import { useConfig } from '@/config/ConfigContext';

const Home = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Connection state
  const [connectionState, setConnectionState] = useState({
    connections: [],
    callHandlerData: [],
    isLoading: true,
  });

  // Fetch initial connections
  useEffect(() => {
    if (!templateConfig.useBackend) {
      // Skip API call if backend is disabled
      setConnectionState((prev) => ({
        ...prev,
        isLoading: false,
      }));
      return;
    }

    const fetchResults = async () => {
      try {
        const response = await apiCall('/data');
        const data = await response.json();
        setConnectionState((prev) => ({
          ...prev,
          connections: data,
          isLoading: false,
        }));

        if (data.length === 0) {
          toast({
            title: "No connections found",
            description: "Redirected to the connections page, please add a new connection.",
            variant: "destructive",
            duration: 3000,
          });
          navigate("/connections");
        }
      } catch (error) {
        console.error(error);
        navigate("/error");
      }
    };

    fetchResults();
  }, [navigate, toast]);

  return (
    <div className="min-h-full w-full py-20 relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col items-center mb-10">
          <div className="inline-block animate-fade-in">
            <h1 className="text-4xl font-bold mb-1 text-left animate-slide-up">React Boilerplate</h1>
            <h2 className="text-3xl font-bold mb-1 text-left animate-slide-up">Text to Speech Uploader</h2>
            <p className="text-sm text-muted-foreground text-left animate-slide-up-delayed">Powered by Automate Builders</p>
            <p className="mt-4 text-left">Boilerplate code for a full-stack application using React, Express and Tailwind CSS. This project is built with Vite, a modern build tool that is blazing fast and supports React, Vue, Svelte and vanilla JavaScript. The backend is a simple Express server that serves data to the frontend. The frontend is a React app that uses Tailwind CSS for styling. The project is set up with ESLint,
            Prettier and Stylelint for code quality. The project also includes a dark mode toggle and a toast notification system.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
