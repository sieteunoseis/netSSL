import { Link, useLocation } from "react-router-dom";
import { useConfig } from '@/config/ConfigContext';

import versionInfo from "../version.json";
import { ChevronLeft, ChevronRight, Home, FileText, HelpCircle, Monitor } from 'lucide-react';
import { cn } from "@/lib/utils";
import { ModeToggle } from "./mode-toggle";

const RightSidebar = ({ isExpanded, onCollapse, onToggle }) => {
  const config = useConfig();
  const location = useLocation();

  const navigationItems = [
    {
      name: 'Home',
      path: '/',
      icon: Home,
      alwaysShow: true
    },
    {
      name: 'Logs',
      path: '/logs',
      icon: FileText,
      alwaysShow: false
    },
    {
      name: 'Help',
      path: '/help',
      icon: HelpCircle,
      alwaysShow: false
    },
    {
      name: 'System Info',
      path: '/system',
      icon: Monitor,
      alwaysShow: false
    }
  ];

  const filteredItems = navigationItems;

  return (
    <>
      {/* Backdrop - only on mobile when expanded */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => onCollapse()}
        />
      )}

      {/* Sidebar */}
      <div className={cn(
        "fixed top-14 left-0 h-[calc(100vh-3.5rem)] bg-card border-r border-border transition-all duration-300 ease-in-out z-50 flex flex-col",
        isExpanded ? "w-80" : "w-20 md:w-20",
        // Hide completely on mobile when collapsed
        !isExpanded && "md:translate-x-0 -translate-x-full"
      )}>
        {/* Header */}
        <div className={cn(
          "flex items-center border-b border-border p-4",
          isExpanded ? "justify-between" : "justify-center"
        )}>
          {isExpanded && <h2 className="text-lg font-semibold">Navigation</h2>}
          <button
            onClick={isExpanded ? () => onCollapse(true) : onToggle}
            className={cn(
              "rounded-md hover:bg-muted transition-colors duration-150",
              isExpanded ? "p-2" : "p-3"
            )}
            aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            title={!isExpanded ? "Expand menu" : undefined}
          >
            {isExpanded ? <ChevronLeft size={20} /> : <ChevronRight size={24} />}
          </button>
        </div>

        {/* Navigation Items */}
        <div className={cn("p-4", !isExpanded && "p-2")}>
          <nav className="space-y-1">
            {filteredItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <Link
                  key={item.name}
                  to={item.path}
                  onClick={() => {
                    // Only collapse on mobile
                    const isMobile = window.innerWidth < 768;
                    if (isMobile) {
                      onCollapse();
                    }
                  }}
                  className={cn(
                    "flex items-center rounded-md transition-colors duration-150",
                    isExpanded
                      ? "space-x-3 px-4 py-3"
                      : "justify-center p-2",
                    isActive
                      ? "bg-primary/10 text-primary border-l-2 border-primary"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                  title={!isExpanded ? item.name : undefined}
                >
                  <Icon size={isExpanded ? 20 : 24} />
                  {isExpanded && <span className="font-medium">{item.name}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Spacer to push mode toggle to bottom */}
        <div className="flex-1" />

        {/* Mode Toggle - above footer */}
        <div className={cn(
          "p-4",
          isExpanded ? "pb-32" : "pb-20"
        )}>
          <div className={cn(
            "flex items-center rounded-lg",
            isExpanded ? "justify-center px-4 py-3" : "justify-center py-3"
          )}>
            <ModeToggle variant={isExpanded ? "inline" : "icon"} />
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
          {isExpanded ? (
            <div className="flex flex-col items-center space-y-2">
              <div className="flex items-center space-x-2">
                <img src="/logo.png" alt={config.brandingName || 'netSSL'} className="h-5 w-5 rounded-full object-cover" />
                <p className="text-sm text-muted-foreground font-medium">
                  {config.brandingName || 'netSSL'}
                </p>
              </div>
              <p className="text-xs text-muted-foreground/70 whitespace-nowrap">
                Certificate Management Dashboard
              </p>
              <p className="text-xs text-muted-foreground/50 font-mono">
                v{versionInfo.version}
              </p>
            </div>
          ) : (
            <div className="flex justify-center">
              <img src="/logo.png" alt={config.brandingName || 'netSSL'} className="h-5 w-5 rounded-full object-cover" />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default RightSidebar;
