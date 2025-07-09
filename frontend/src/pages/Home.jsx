import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import BackgroundLogo from "@/components/BackgroundLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import AddConnectionModal from "@/components/AddConnectionModal";
import SettingsModal from "@/components/SettingsModal";
import CertificateInfo from "@/components/CertificateInfo";
import RenewalStatus from "@/components/RenewalStatus";
import { apiCall } from "@/lib/api";
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
  Globe
} from "lucide-react";

const Home = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Connection state
  const [connectionState, setConnectionState] = useState({
    connections: [],
    isLoading: true,
  });

  const [certificateStatuses, setCertificateStatuses] = useState({});

  const [renewalState, setRenewalState] = useState({
    activeRenewal: null,
    renewalId: null,
    connectionId: null
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

        // Fetch certificate information for all connections
        await fetchCertificateStatuses(data);

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
        navigate("/error");
      }
    };

    fetchResults();
  }, [navigate, toast]);

  const handleRenewCertificate = async (connectionId) => {
    try {
      const response = await apiCall(`/data/${connectionId}/issue-cert`, { method: "POST" });
      const data = await response.json();
      
      // Show renewal status modal
      setRenewalState({
        activeRenewal: true,
        renewalId: data.renewalId,
        connectionId: connectionId
      });
      
      toast({
        title: "Certificate Renewal Initiated",
        description: "Certificate renewal process has been started.",
        duration: 3000,
      });
      
    } catch (error) {
      console.error("Error renewing certificate:", error);
      toast({
        title: "Renewal Failed",
        description: "Failed to initiate certificate renewal.",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  const handleRenewalClose = () => {
    setRenewalState({
      activeRenewal: null,
      renewalId: null,
      connectionId: null
    });
    
    // Refresh connections data after renewal
    const fetchConnections = async () => {
      try {
        const response = await apiCall('/data');
        const data = await response.json();
        setConnectionState((prev) => ({
          ...prev,
          connections: data,
        }));
        
        // Fetch certificate information for each connection
        await fetchCertificateStatuses(data);
      } catch (error) {
        console.error("Error refreshing connections:", error);
      }
    };
    
    fetchConnections();
  };

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
    try {
      const response = await apiCall('/data');
      const data = await response.json();
      setConnectionState((prev) => ({
        ...prev,
        connections: data,
      }));
      
      // Fetch certificate information for new connections
      await fetchCertificateStatuses(data);
      
      toast({
        title: "Connection Added",
        description: "New server connection has been added successfully.",
        duration: 3000,
      });
    } catch (error) {
      console.error("Error refreshing connections:", error);
    }
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

    if (!certInfo.isValid) {
      return {
        status: "invalid",
        text: "Certificate invalid",
        color: "bg-red-100 text-red-800",
        icon: AlertCircle,
        days: certInfo.daysUntilExpiry
      };
    }

    if (certInfo.daysUntilExpiry <= 0) {
      return {
        status: "expired",
        text: "Certificate expired",
        color: "bg-red-100 text-red-800",
        icon: AlertCircle,
        days: certInfo.daysUntilExpiry
      };
    } else if (certInfo.daysUntilExpiry <= 30) {
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
      "google": "Google Cloud DNS"
    };
    return providers[provider] || provider;
  };

  const getOverallStatus = () => {
    if (connectionState.connections.length === 0) return { total: 0, valid: 0, expiring: 0, expired: 0 };
    
    const summary = connectionState.connections.reduce((acc, conn) => {
      const status = getCertificateStatus(conn);
      acc.total++;
      if (status.status === "valid") acc.valid++;
      else if (status.status === "expiring") acc.expiring++;
      else if (status.status === "expired") acc.expired++;
      return acc;
    }, { total: 0, valid: 0, expiring: 0, expired: 0 });

    return summary;
  };

  const overallStatus = getOverallStatus();

  if (connectionState.isLoading) {
    return (
      <div className="min-h-full w-full py-20 relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
        <BackgroundLogo />
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
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
            <h1 className="text-4xl font-bold mb-2 animate-slide-up">Certificate Dashboard</h1>
            <p className="text-lg text-muted-foreground animate-slide-up-delayed">
              Monitor and manage SSL certificates for your Cisco UC servers
            </p>
          </div>
          <div className="mt-6 flex space-x-4">
            <AddConnectionModal onConnectionAdded={handleConnectionAdded} />
            <SettingsModal />
          </div>
        </div>

        {/* Overall Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Servers</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overallStatus.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Valid Certificates</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{overallStatus.valid}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{overallStatus.expiring}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expired</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{overallStatus.expired}</div>
            </CardContent>
          </Card>
        </div>

        {/* Server Details */}
        <div className="space-y-4">
          {connectionState.connections.map((connection) => {
            const certStatus = getCertificateStatus(connection);
            const StatusIcon = certStatus.icon;

            return (
              <Card key={connection.id} className="w-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Server className="h-5 w-5 text-blue-500" />
                      <div>
                        <CardTitle className="text-lg">{connection.name}</CardTitle>
                        <CardDescription className="flex items-center space-x-2">
                          <span>{connection.hostname}.{connection.domain}</span>
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
                  <div className="flex items-center justify-between">
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

                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRenewCertificate(connection.id)}
                        className="flex items-center space-x-1"
                      >
                        <FileText className="w-4 h-4" />
                        <span>Renew Certificate</span>
                      </Button>
                    </div>
                  </div>
                  
                  <CertificateInfo 
                    connectionId={connection.id} 
                    hostname={`${connection.hostname}.${connection.domain}`}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>

        {connectionState.connections.length === 0 && (
          <div className="text-center py-12">
            <Server className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No servers configured</h3>
            <p className="text-gray-500 mb-4">
              Get started by adding your first Cisco UC server connection.
            </p>
            <AddConnectionModal onConnectionAdded={handleConnectionAdded} />
          </div>
        )}

        {/* Renewal Status Modal */}
        {renewalState.activeRenewal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <RenewalStatus
              connectionId={renewalState.connectionId}
              renewalId={renewalState.renewalId}
              onClose={handleRenewalClose}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;