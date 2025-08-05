import { createContext, useContext, useEffect, useState } from "react";

const ConfigContext = createContext(null);

// Hardcoded table columns - these define the frontend form fields and should not be modified
const HARDCODED_TABLE_COLUMNS = "name,hostname,username,password,domain,ssl_provider,dns_provider,dns_challenge_mode,portal_url,ise_nodes,ise_certificate,ise_private_key,ise_cert_import_config,ise_application_subtype,general_private_key,alt_names,enable_ssh,auto_restart_service,auto_renew,auto_renew_status,auto_renew_last_attempt";

const getConfigValues = () => {
  // Development environment
  if (import.meta.env.DEV) {
    const config = {
      brandingUrl: import.meta.env.VITE_BRANDING_URL || "https://automate.builders",
      brandingName: import.meta.env.VITE_BRANDING_NAME || "netSSL",
      tableColumns: HARDCODED_TABLE_COLUMNS,
    };
    return config;
  }

  // Production environment
  const config = {
    brandingUrl: window.APP_CONFIG?.BRANDING_URL || "https://automate.builders",
    brandingName: window.APP_CONFIG?.BRANDING_NAME || "netSSL",
    tableColumns: HARDCODED_TABLE_COLUMNS,
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
