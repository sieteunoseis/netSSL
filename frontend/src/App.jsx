import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useState, useEffect } from "react";
import NavBar from "./components/NavBar";
import RightSidebar from "./components/RightSidebar";
import Home from "./pages/Home";
import Logs from "./pages/Logs";
import ErrorPage from "./pages/Error";
import Help from "./pages/Help";
import { ThemeProvider } from "@/components/theme-provider";
import { ModeToggle } from "./components/mode-toggle";
import { Toaster } from "@/components/ui/toaster";
import { WebSocketProvider } from "./contexts/WebSocketContext";
import { useBackendStatus } from "./components/BackendStatusProvider.jsx";
import { Menu } from 'lucide-react';
import templateConfig from "../template.config.json";

function App() {
  const { isBackendReady } = useBackendStatus();
  // Start with sidebar closed on screens 1280px or smaller
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth > 1280;
    }
    return true;
  });
  const [overallStatus, setOverallStatus] = useState({ total: 0, valid: 0, expiring: 0, expired: 0, autoRenew: 0 });

  // Handle window resize to auto-collapse sidebar on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1280 && isSidebarExpanded) {
        setIsSidebarExpanded(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarExpanded]);

  const toggleSidebar = () => setIsSidebarExpanded(!isSidebarExpanded);
  const collapseSidebar = (forceCollapse = false) => {
    if (forceCollapse) {
      setIsSidebarExpanded(false);
    } else {
      // Only collapse on mobile, keep expanded on desktop
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setIsSidebarExpanded(false);
      }
    }
  };

  if (!isBackendReady) {
    return null; // Or a loading spinner, but BackendStatusProvider already shows a message
  }

  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <WebSocketProvider>
        <div className="flex flex-col h-screen relative">
          <Router>
            <Toaster />
            <NavBar 
              overallStatus={overallStatus}
            />
            <RightSidebar 
              isExpanded={isSidebarExpanded} 
              onCollapse={collapseSidebar}
              onToggle={toggleSidebar}
            />
            
            {/* Floating menu button for mobile - only when sidebar is closed */}
            {!isSidebarExpanded && (
              <button
                onClick={toggleSidebar}
                className="fixed bottom-6 left-6 z-50 md:hidden p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-colors"
                aria-label="Open navigation menu"
              >
                <Menu size={24} />
              </button>
            )}
            
            <main className={`flex-1 relative overflow-auto transition-all duration-300 z-10 ${isSidebarExpanded ? 'md:ml-80 ml-0' : 'md:ml-20 ml-0'}`}>
              <Routes>
                <Route path="/" element={<Home onStatusUpdate={setOverallStatus} />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/help" element={<Help />} />
                <Route path="/error" element={<ErrorPage />} />
              </Routes>
            </main>
            <ModeToggle />
          </Router>
        </div>
      </WebSocketProvider>
    </ThemeProvider>
  );
}

export default App;