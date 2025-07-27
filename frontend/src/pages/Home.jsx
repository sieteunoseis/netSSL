import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import BackgroundLogo from "@/components/BackgroundLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import AddConnectionModal from "@/components/AddConnectionModalTabbed";
import SettingsModal from "@/components/SettingsModal";
import CertificateInfo from "@/components/CertificateInfo";
import ServiceRestartButton from "@/components/ServiceRestartButton";
import CertificateRenewalButton from "@/components/CertificateRenewalButton";
import CertificateDownloadButton from "@/components/CertificateDownloadButton";
import { apiCall } from "@/lib/api";
import { filterEnabledConnections, getConnectionDisplayHostname, isWildcardCertificate, getCertificateValidationDomain } from "@/lib/connection-utils";
import { useWebSocket } from "@/contexts/WebSocketContext";
import { useCertificateSettings } from "@/hooks/useCertificateSettings";
import templateConfig from "../../template.config.json";
import { 
  FileText, 
  Server, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  RefreshCw, 
  Shield,
  Zap,
  Globe,
  Terminal,
  RotateCcw,
  Settings,
  Wrench
} from "lucide-react";

const Home = ({ onStatusUpdate }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { getConnectionOperations } = useWebSocket();
  const certificateSettings = useCertificateSettings();

  // Connection state
  const [connectionState, setConnectionState] = useState({
    connections: [],
    isLoading: true,
    isRetrying: false,
    retryAttempt: 0,
  });

  const [certificateStatuses, setCertificateStatuses] = useState({});
  const [downloadRefreshTrigger, setDownloadRefreshTrigger] = useState(0);

  const [restartingService, setRestartingService] = useState(new Set());
  const [confirmRestart, setConfirmRestart] = useState(null); // {id, name} for confirmation dialog
  const [confirmCertRenewal, setConfirmCertRenewal] = useState(null); // {id, name} for confirmation dialog

  // Fetch connections data
  const fetchConnectionsData = async () => {
    if (!templateConfig.useBackend) {
      // Skip API call if backend is disabled
      setConnectionState((prev) => ({
        ...prev,
        isLoading: false,
      }));
      return;
    }

    try {
      // Add custom retry options for initial load
      const response = await apiCall('/data', {
        retries: 5, // More retries on initial load
        retryDelay: 2000, // Start with 2 second delay
      });
      const data = await response.json();
      
      setConnectionState((prev) => ({
        ...prev,
        connections: data,
        isLoading: false,
        isRetrying: false,
        retryAttempt: 0,
      }));

      // Fetch certificate information only for enabled connections
      const enabledConnections = filterEnabledConnections(data);
      await fetchCertificateStatuses(enabledConnections);

      if (data.length === 0) {
        toast({
          title: "No connections found",
          description: "Use the 'Add Connection' button to create your first server connection.",
          variant: "destructive",
          duration: 3000,
        });
      }
    } catch (error) {
      console.error(error);
      
      // Check if it's a connection error (backend starting up)
      const isConnectionError = 
        error instanceof TypeError && error.message.includes('fetch') ||
        error.message?.includes('ECONNREFUSED');
      
      if (isConnectionError) {
        // Show a more user-friendly message for backend startup
        toast({
          title: "Waiting for backend",
          description: "The backend server is starting up. This page will refresh automatically.",
          duration: 5000,
        });
        
        // Wait a bit longer then try to navigate to error page
        setTimeout(() => {
          navigate("/error");
        }, 8000);
      } else {
        navigate("/error");
      }
    }
  };

  // Fetch initial connections
  useEffect(() => {
    fetchConnectionsData();
  }, [navigate, toast]);

  // Refresh data when the page becomes visible (e.g., returning from Connections page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchConnectionsData();
      }
    };

    const handleFocus = () => {
      fetchConnectionsData();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);



  const fetchCertificateStatuses = async (connections) => {
    const statuses = {};
    
    for (const connection of connections) {
      try {
        const response = await apiCall(`/data/${connection.id}/certificate`);
        if (response.ok) {
          const certInfo = await response.json();
          statuses[connection.id] = certInfo;
        } else if (response.status === 404) {
          // Certificate not found - this is normal for test servers or unreachable hosts
          statuses[connection.id] = null;
        }
      } catch (error) {
        // Silently handle certificate fetch errors for unreachable servers
        statuses[connection.id] = null;
      }
    }
    
    setCertificateStatuses(statuses);
  };

  const handleConnectionAdded = async () => {
    await fetchConnectionsData();
    
    toast({
      title: "Connection Added",
      description: "New server connection has been added successfully.",
      duration: 3000,
    });
  };

  const getCertificateStatus = (connection) => {
    const certInfo = certificateStatuses[connection.id];
    
    if (!certInfo) {
      return {
        status: "unknown",
        text: "Certificate info unavailable",
        color: "bg-gray-100 text-gray-800",
        icon: AlertCircle,
        days: null
      };
    }

    // Check expiry first (this handles both expired and invalid due to expiry)
    if (certInfo.daysUntilExpiry <= 0) {
      return {
        status: "expired",
        text: "Certificate expired",
        color: "bg-red-100 text-red-800",
        icon: AlertCircle,
        days: certInfo.daysUntilExpiry
      };
    }

    // Check other invalid conditions (self-signed, etc.)
    if (!certInfo.isValid) {
      return {
        status: "invalid",
        text: "Certificate invalid",
        color: "bg-red-100 text-red-800",
        icon: AlertCircle,
        days: certInfo.daysUntilExpiry
      };
    }

    if (certInfo.daysUntilExpiry <= certificateSettings.warningDays) {
      return {
        status: "expiring",
        text: `Expires in ${certInfo.daysUntilExpiry} days`,
        color: "bg-yellow-100 text-yellow-800",
        icon: Clock,
        days: certInfo.daysUntilExpiry
      };
    } else {
      return {
        status: "valid",
        text: `Valid for ${certInfo.daysUntilExpiry} days`,
        color: "bg-green-100 text-green-800",
        icon: CheckCircle,
        days: certInfo.daysUntilExpiry
      };
    }
  };

  const formatProvider = (provider) => {
    const providers = {
      "letsencrypt": "Let's Encrypt",
      "zerossl": "ZeroSSL",
      "cloudflare": "Cloudflare",
      "digitalocean": "DigitalOcean",
      "route53": "AWS Route53",
      "azure": "Azure DNS",
      "google": "Google Cloud DNS",
      "custom": "Custom DNS (Manual)"
    };
    return providers[provider] || provider;
  };


  const overallStatus = useMemo(() => {
    // Filter to only enabled connections
    const enabledConnections = filterEnabledConnections(connectionState.connections);
    
    if (enabledConnections.length === 0) return { total: 0, valid: 0, expiring: 0, expired: 0, autoRenew: 0 };
    
    const summary = enabledConnections.reduce((acc, conn) => {
      const status = getCertificateStatus(conn);
      acc.total++;
      if (status.status === "valid") acc.valid++;
      else if (status.status === "expiring") acc.expiring++;
      else if (status.status === "expired") acc.expired++;
      if (conn.dns_provider !== 'custom' && conn.auto_renew) acc.autoRenew++;
      return acc;
    }, { total: 0, valid: 0, expiring: 0, expired: 0, autoRenew: 0 });

    return summary;
  }, [connectionState.connections, certificateStatuses, certificateSettings.warningDays]);
  
  // Update parent component when status changes
  useEffect(() => {
    if (onStatusUpdate) {
      onStatusUpdate(overallStatus);
    }
  }, [overallStatus, onStatusUpdate]);

  if (connectionState.isLoading) {
    return (
      <div className="min-h-full w-full py-20 relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
        <BackgroundLogo />
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col items-center justify-center h-64 space-y-4">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            <div className="text-center">
              <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
                Connecting to backend server...
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                This may take a moment if the server is starting up
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full py-20 relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex flex-col items-center mb-10">
          <div className="inline-block animate-fade-in text-center">
            <img src="/logo.png" alt="netSSL" className="h-36 w-36 mx-auto mb-4 rounded-full object-cover shadow-lg mix-blend-multiply dark:mix-blend-normal" />
            <h1 className="text-4xl font-bold mb-2 animate-slide-up">Certificate Dashboard</h1>
            <p className="text-lg text-muted-foreground animate-slide-up-delayed">
              Monitor and manage SSL certificates for your network applications
            </p>
          </div>
          <div className="mt-6 flex space-x-4">
            <AddConnectionModal onConnectionAdded={handleConnectionAdded} />
            <SettingsModal />
          </div>
        </div>

        {/* Overall Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Servers</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overallStatus.total}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Valid Certificates</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{overallStatus.valid}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{overallStatus.expiring}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expired</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{overallStatus.expired}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/85 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Auto Renew</CardTitle>
              <RotateCcw className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{overallStatus.autoRenew}</div>
            </CardContent>
          </Card>
        </div>

        {/* Server Details */}
        <div className="space-y-4">
          {filterEnabledConnections(connectionState.connections).map((connection) => {
            const certStatus = getCertificateStatus(connection);
            const StatusIcon = certStatus.icon;

            return (
              <Card key={connection.id} className="w-full bg-card/85 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Server className="h-5 w-5 text-blue-500" />
                      <div>
                        <CardTitle className="text-lg">{connection.name}</CardTitle>
                        <CardDescription className="flex items-center space-x-2">
                          <a 
                            href={`https://${getConnectionDisplayHostname(connection)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
                          >
                            {getConnectionDisplayHostname(connection)}
                          </a>
                          {isWildcardCertificate(connection) && (
                            <Badge variant="outline" className="text-xs">
                              Wildcard
                            </Badge>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge className={certStatus.color}>
                      <StatusIcon className="w-3 h-3 mr-1" />
                      {certStatus.text}
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="space-y-4">
                    {/* Provider Information */}
                    <div className="flex space-x-6">
                      <div className="flex items-center space-x-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          SSL: {formatProvider(connection.ssl_provider)}
                        </span>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          DNS: {formatProvider(connection.dns_provider)}
                        </span>
                      </div>
                      
                      {connection.cert_count_this_week > 0 && (
                        <div className="flex items-center space-x-2">
                          <Zap className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {connection.cert_count_this_week} certs this week
                          </span>
                        </div>
                      )}
                    </div>

                    {/* VOS Features Status */}
                    {connection.application_type === 'vos' && (
                      <div className="flex space-x-6 text-sm">
                        <div className="flex items-center space-x-2">
                          <Terminal className="h-4 w-4 text-muted-foreground" />
                          <span>SSH: {connection.enable_ssh ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          <span>Auto Restart: {connection.auto_restart_service ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <RotateCcw className="h-4 w-4 text-muted-foreground" />
                          <span>Auto Renew: {connection.auto_renew ? 'Enabled' : 'Disabled'}</span>
                          {connection.auto_renew && connection.auto_renew_status && (
                            <Badge 
                              className={
                                connection.auto_renew_status === 'success' ? 'bg-green-100 text-green-800' :
                                connection.auto_renew_status === 'failed' ? 'bg-red-100 text-red-800' :
                                connection.auto_renew_status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                                'bg-gray-100 text-gray-800'
                              }
                            >
                              {connection.auto_renew_status}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Tools Section */}
                  <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-2">
                        <Wrench className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Tools</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {/* Service Restart Button - only show for VOS apps with SSH enabled */}
                      {connection.application_type === 'vos' && connection.enable_ssh && (
                        <ServiceRestartButton 
                          connection={connection}
                          onConfirmRestart={(conn) => setConfirmRestart({ id: conn.id, name: conn.name })}
                        />
                      )}
                      
                      {/* Certificate Renewal Button */}
                      <CertificateRenewalButton 
                        connection={connection}
                        onConfirmRenew={() => setConfirmCertRenewal({ id: connection.id, name: connection.name })}
                      />
                      
                      {/* Certificate Download Button */}
                      <CertificateDownloadButton 
                        connection={connection}
                        refreshTrigger={downloadRefreshTrigger}
                        isRenewing={getConnectionOperations(connection.id, 'certificate_renewal').some(op => ['pending', 'in_progress'].includes(op.status))}
                      />
                    </div>
                  </div>
                  
                  {isWildcardCertificate(connection) ? (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <div className="flex items-center space-x-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Wildcard certificate - Individual certificate validation not available
                        </span>
                      </div>
                    </div>
                  ) : (
                    <CertificateInfo 
                      connectionId={connection.id} 
                      hostname={getCertificateValidationDomain(connection) || ''}
                      connectionName={connection.name}
                      onRenewalComplete={() => setDownloadRefreshTrigger(prev => prev + 1)}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filterEnabledConnections(connectionState.connections).length === 0 && (
          <div className="text-center py-12">
            <Server className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No servers configured</h3>
            <p className="text-gray-500 mb-4">
              Get started by adding your first Cisco UC server connection.
            </p>
            <AddConnectionModal onConnectionAdded={handleConnectionAdded} />
          </div>
        )}

        {/* Service Restart Confirmation Dialog */}
        {confirmRestart && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-center mb-4">
                <Server className="w-6 h-6 text-orange-600 mr-3" />
                <h3 className="text-lg font-semibold">Confirm Service Restart</h3>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                Are you sure you want to restart the Cisco Tomcat service on <strong>{confirmRestart.name}</strong>?
                <br /><br />
                This will temporarily interrupt access to the VOS application while the service restarts.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setConfirmRestart(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    ServiceRestartButton.startRestart(confirmRestart.id, toast);
                    setConfirmRestart(null);
                  }}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  <Server className="w-4 h-4 mr-2" />
                  Restart Service
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Certificate Renewal Confirmation Dialog */}
        {confirmCertRenewal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Confirm Certificate Renewal
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                Are you sure you want to renew the certificate for <strong>{confirmCertRenewal.name}</strong>? 
                This process may take several minutes and will automatically upload the new certificate to the server.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setConfirmCertRenewal(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    CertificateRenewalButton.startRenewal(confirmCertRenewal.id, toast);
                    setConfirmCertRenewal(null);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Renew Certificate
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Home;