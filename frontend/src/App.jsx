import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useState } from "react";
import NavBar from "./components/NavBar";
import RightSidebar from "./components/RightSidebar";
import Home from "./pages/Home";
import Connections from "./pages/Connections";
import Logs from "./pages/Logs";
import ErrorPage from "./pages/Error";
import Help from "./pages/Help";
import { ThemeProvider } from "@/components/theme-provider";
import { ModeToggle } from "./components/mode-toggle";
import { Toaster } from "@/components/ui/toaster";
import { WebSocketProvider } from "./contexts/WebSocketContext";
import { Menu } from 'lucide-react';
import templateConfig from "../template.config.json";

function App() {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [overallStatus, setOverallStatus] = useState({ total: 0, valid: 0, expiring: 0, expired: 0, autoRenew: 0 });

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
                <Route path="/connections" element={<Connections />} />
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