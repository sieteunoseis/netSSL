import { createContext, useContext, useEffect, useState } from "react";

const ConfigContext = createContext(null);

const getConfigValues = () => {
  // Development environment
  if (import.meta.env.DEV) {
    const config = {
      brandingUrl: import.meta.env.VITE_BRANDING_URL || "https://automate.builders",
      brandingName: import.meta.env.VITE_BRANDING_NAME || "Automate Builders",
      tableColumns: import.meta.env.VITE_TABLE_COLUMNS || "name,hostname,username,password,version",
    };
    return config;
  }

  // Production environment
  const config = {
    brandingUrl: window.APP_CONFIG?.BRANDING_URL || "https://automate.builders",
    brandingName: window.APP_CONFIG?.BRANDING_NAME || "Automate Builders",
    tableColumns: window.APP_CONFIG?.TABLE_COLUMNS || "name,hostname,username,password,version",
  };
  return config;
};

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    // Wait for config to be available
    const checkConfig = () => {
      if (import.meta.env.DEV || window.APP_CONFIG) {
        setConfig(getConfigValues());
      } else {
        setTimeout(checkConfig, 100);
      }
    };

    checkConfig();
  }, []);

  if (!config) {
    return <div>Loading configuration...</div>; // Or your loading component
  }

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }
  return context;
}
