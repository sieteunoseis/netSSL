import { Link, useLocation } from "react-router-dom";
import { useConfig } from '@/config/ConfigContext';
import templateConfig from "../../template.config.json";
import { ChevronLeft, ChevronRight, Home, Database, FileText, HelpCircle } from 'lucide-react';
import { cn } from "@/lib/utils";

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
      name: 'Connections',
      path: '/connections',
      icon: Database,
      alwaysShow: false
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
    }
  ];

  const filteredItems = navigationItems.filter(item => 
    item.alwaysShow || templateConfig.useBackend
  );

  return (
    <>
      {/* Backdrop - only on mobile when expanded */}
      {isExpanded && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => onCollapse()}
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "fixed top-14 left-0 h-[calc(100vh-3.5rem)] bg-white dark:bg-gray-900 shadow-xl transition-all duration-300 ease-in-out z-50",
        isExpanded ? "w-80" : "w-20 md:w-20",
        // Hide completely on mobile when collapsed
        !isExpanded && "md:translate-x-0 -translate-x-full"
      )}>
        {/* Header */}
        <div className={cn(
          "flex items-center border-b dark:border-gray-700 p-4",
          isExpanded ? "justify-between" : "justify-center"
        )}>
          {isExpanded && <h2 className="text-lg font-semibold">Navigation</h2>}
          <button
            onClick={isExpanded ? () => onCollapse(true) : onToggle}
            className={cn(
              "rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
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
          <nav className="space-y-2">
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
                    "flex items-center rounded-lg transition-colors",
                    isExpanded 
                      ? "space-x-3 px-4 py-3" 
                      : "justify-center p-2",
                    isActive 
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" 
                      : "hover:bg-gray-100 dark:hover:bg-gray-800"
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

        {/* Footer - only show when expanded */}
        {isExpanded && (
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t dark:border-gray-700">
            <div className="flex flex-col items-center space-y-2">
              <div className="flex items-center space-x-2">
                <img src="/logo.png" alt={config.brandingName || 'netSSL'} className="h-5 w-5 rounded-full object-cover shadow-sm" />
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                  {config.brandingName || 'netSSL'}
                </p>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Certificate Management Dashboard
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default RightSidebar;