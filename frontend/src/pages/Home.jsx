import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import BackgroundLogo from "@/components/BackgroundLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AddConnectionModal from "@/components/AddConnectionModalTabbed";
import SettingsModal from "@/components/SettingsModal";
import CertificateInfo from "@/components/CertificateInfo";
import ServiceRestartButton from "@/components/ServiceRestartButton";
import CertificateRenewalButton from "@/components/CertificateRenewalButton";
import CertificateDownloadButton from "@/components/CertificateDownloadButton";
import EditConnectionModalTabbed from "@/components/EditConnectionModalTabbed";
import { apiCall } from "@/lib/api";
import { filterEnabledConnections, getConnectionDisplayHostname, isWildcardCertificate, getCertificateValidationDomain, isConnectionEnabled } from "@/lib/connection-utils";
import { useWebSocket } from "@/contexts/WebSocketContext";
import { AutoRenewalNotifications } from "@/components/AutoRenewalNotifications";
import { NextAutoRenewalInfo } from "@/components/NextAutoRenewalInfo";
import { AutoRenewalCountdownBadge } from "@/components/AutoRenewalCountdownBadge";
import { useCertificateSettings } from "@/hooks/useCertificateSettings";
import PerformanceMetricsChart from "@/components/PerformanceMetricsChart";
import templateConfig from "../../template.config.json";
import { 
  FileText, Server, AlertCircle, CheckCircle, Clock, RefreshCw, Shield,
  Zap, Globe, Terminal, RotateCcw, Settings, Wrench, Plus, Search,
  SortAsc, SortDesc, LayoutGrid, Table as TableIcon, ChevronDown, 
  ChevronRight, Info, Activity, Wifi, AlertTriangle, Download, Upload,
  ExternalLink, Edit, Loader2
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const Home = ({ onStatusUpdate }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { getConnectionOperations } = useWebSocket();
  const certificateSettings = useCertificateSettings();

  // View state
  const [viewMode, setViewMode] = useState('full'); // 'full', 'compact'
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [expandedCards, setExpandedCards] = useState(new Set());

  // Connection state
  const [connectionState, setConnectionState] = useState({
    connections: [],
    isLoading: true,
    isRetrying: false,
    retryAttempt: 0,
  });

  const [certificateStatuses, setCertificateStatuses] = useState({});
  const [downloadRefreshTrigger, setDownloadRefreshTrigger] = useState(0);
  const [editingConnection, setEditingConnection] = useState(null);
  const [testingSSH, setTestingSSH] = useState(new Set());

  const fetchConnections = async (retryCount = 0) => {
    try {
      setConnectionState(prev => ({ ...prev, isRetrying: retryCount > 0, retryAttempt: retryCount }));
      
      const response = await apiCall('/data');
      const data = await response.json();
      console.log('Fetched connections:', data);
      
      // Debug ISE connections specifically
      const iseConnections = data.filter(conn => conn.name.includes('ISE'));
      console.log('ISE connections found:', iseConnections);
      iseConnections.forEach(conn => {
        console.log(`${conn.name}: app_type=${conn.application_type}, enable_ssh=${conn.enable_ssh}`);
      });
      
      setConnectionState({ connections: data, isLoading: false, isRetrying: false, retryAttempt: 0 });

      // Fetch certificate status for enabled connections
      const enabledConnections = filterEnabledConnections(data);
      for (const connection of enabledConnections) {
        await fetchCertificateStatus(connection);
      }
    } catch (error) {
      console.error("Error fetching connections:", error);
      if (error.code === 'ECONNREFUSED' && retryCount < 10) {
        setTimeout(() => fetchConnections(retryCount + 1), 2000);
      } else {
        setConnectionState(prev => ({ ...prev, isLoading: false, isRetrying: false }));
        toast({
          title: "Error",
          description: error.message || "Failed to fetch connections",
          variant: "destructive",
        });
      }
    }
  };

  const fetchCertificateStatus = async (connection) => {
    try {
      const response = await apiCall(`/data/${connection.id}/certificate`);
      const data = await response.json();
      setCertificateStatuses(prev => ({ ...prev, [connection.id]: data }));
    } catch (error) {
      console.error(`Error fetching certificate status for ${connection.name}:`, error);
      setCertificateStatuses(prev => ({ ...prev, [connection.id]: { error: error.message } }));
    }
  };

  const handleConnectionAdded = () => {
    fetchConnections();
  };

  const handleConnectionUpdated = async () => {
    setEditingConnection(null);
    await fetchConnections();
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    
    // If the string is already a formatted date (contains "at" and timezone), return as is
    if (typeof dateString === 'string' && dateString.includes(' at ') && 
        (dateString.includes('PDT') || dateString.includes('PST') || dateString.includes('EST') || dateString.includes('EDT'))) {
      return dateString;
    }
    
    try {
      // Handle various date formats
      let date;
      
      // If it's already a Date object
      if (dateString instanceof Date) {
        date = dateString;
      }
      // If it's a number (timestamp)
      else if (typeof dateString === 'number') {
        date = new Date(dateString);
      }
      // If it's a string
      else {
        date = new Date(dateString);
      }
      
      if (isNaN(date.getTime())) {
        // Don't log warning for already formatted dates - just return the string
        return dateString;
      }
      
      return date.toLocaleDateString();
    } catch (error) {
      // Don't log error for already formatted dates - just return the string
      return dateString;
    }
  };

  const handleSSHTest = async (connection) => {
    // Add connection ID to testing set
    setTestingSSH(prev => new Set([...prev, connection.id]));
    
    try {
      toast({
        title: "Testing SSH Connection",
        description: `Testing SSH connection to ${connection.name}...`,
        duration: 3000,
      });

      const response = await apiCall(`/data/${connection.id}/test-ssh`, {
        method: 'POST'
      });
      
      if (response.ok) {
        const result = await response.json();
        toast({
          title: "SSH Test Successful",
          description: `Successfully connected to ${connection.name} via SSH`,
          duration: 5000,
        });
      } else {
        throw new Error('SSH test failed');
      }
    } catch (error) {
      console.error('SSH test error:', error);
      toast({
        title: "SSH Test Failed",
        description: `Failed to connect to ${connection.name} via SSH. Check credentials and connectivity.`,
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      // Remove connection ID from testing set
      setTestingSSH(prev => {
        const newSet = new Set(prev);
        newSet.delete(connection.id);
        return newSet;
      });
    }
  };

  const getCertificateStatus = (connection) => {
    // Check if connection is disabled first
    if (!isConnectionEnabled(connection)) {
      return {
        status: "disabled",
        text: "Disabled",
        color: "bg-gray-100 text-gray-800",
        icon: AlertCircle
      };
    }

    const certInfo = certificateStatuses[connection.id];
    if (!certInfo || certInfo.error) {
      return {
        status: "unknown",
        text: certInfo?.error || "Unable to check certificate",
        color: "bg-gray-100 text-gray-800",
        icon: AlertCircle
      };
    }

    if (!certInfo.isValid) {
      return {
        status: "expired",
        text: "Certificate Expired",
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

  const formatApplicationType = (type) => {
    const types = {
      "ise": "ISE",
      "vos": "VOS",
      "general": "GENERAL"
    };
    return types[type] || type.toUpperCase();
  };

  // Calculate overall status
  const overallStatus = useMemo(() => {
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

  // Update parent component status
  useEffect(() => {
    onStatusUpdate?.(overallStatus);
  }, [overallStatus, onStatusUpdate]);

  // Filtered and sorted connections
  const filteredConnections = useMemo(() => {
    // Show all connections (enabled and disabled) but apply styling differences
    let filtered = connectionState.connections.filter(conn => {
      const matchesSearch = conn.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          conn.hostname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          conn.domain.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesType = typeFilter === 'all' || conn.application_type === typeFilter;
      
      const status = getCertificateStatus(conn);
      let matchesStatus = true;
      if (statusFilter === 'valid') matchesStatus = status.status === 'valid';
      if (statusFilter === 'expiring') matchesStatus = status.status === 'expiring';
      if (statusFilter === 'expired') matchesStatus = status.status === 'expired';
      
      return matchesSearch && matchesType && matchesStatus;
    });

    // Sort connections
    filtered.sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'status':
          aVal = getCertificateStatus(a).days || 0;
          bVal = getCertificateStatus(b).days || 0;
          break;
        case 'type':
          aVal = a.application_type;
          bVal = b.application_type;
          break;
        case 'expiry':
          aVal = getCertificateStatus(a).days || 0;
          bVal = getCertificateStatus(b).days || 0;
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [connectionState.connections, searchTerm, statusFilter, typeFilter, sortBy, sortOrder, certificateStatuses]);

  useEffect(() => {
    fetchConnections();
  }, []);

  const toggleRowExpansion = (connectionId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(connectionId)) {
      newExpanded.delete(connectionId);
    } else {
      newExpanded.add(connectionId);
    }
    setExpandedRows(newExpanded);
  };

  const toggleCardExpansion = (connectionId) => {
    const newExpanded = new Set(expandedCards);
    if (newExpanded.has(connectionId)) {
      newExpanded.delete(connectionId);
    } else {
      newExpanded.add(connectionId);
    }
    setExpandedCards(newExpanded);
  };

  const getStatusBadge = (connection) => {
    const status = getCertificateStatus(connection);
    const statusColors = {
      valid: "success",
      expiring: "warning", 
      expired: "destructive",
      unknown: "secondary",
      disabled: "secondary"
    };
    return <Badge variant={statusColors[status.status] || "secondary"} className="rounded-[4px]">{status.text}</Badge>;
  };

  const renderConnectionCard = (connection) => {
    const status = getCertificateStatus(connection);
    const certInfo = certificateStatuses[connection.id];
    const isExpanded = expandedCards.has(connection.id);
    const operations = getConnectionOperations(connection.id);
    const activeOperation = operations.find(op => 
      ['pending', 'in_progress'].includes(op.status)
    );
    const isEnabled = isConnectionEnabled(connection);

    return (
      <Card key={connection.id} className={`overflow-hidden bg-card/85 backdrop-blur-sm ${!isEnabled ? 'opacity-50 grayscale' : ''}`}>
        <Collapsible open={isExpanded} onOpenChange={() => toggleCardExpansion(connection.id)}>
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold">{connection.name}</h3>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs px-2 py-1 rounded-[4px]">
                            {formatApplicationType(connection.application_type)}
                          </Badge>
                          {connection.auto_renew && connection.dns_provider !== 'custom' && (
                            <Badge variant="secondary" className="text-xs px-2 py-1 rounded-[4px]">
                              <RefreshCw className="h-3 w-3 mr-1" />
                              AUTO-RENEW
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span>{getConnectionDisplayHostname(connection)}</span>
                        <span>•</span>
                        <span>{connection.ssl_provider}</span>
                        <span>•</span>
                        <span>{connection.dns_provider}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <Badge variant={status.status === 'valid' ? 'success' : status.status === 'expiring' ? 'warning' : 'destructive'} className="flex items-center gap-1 rounded-[4px]">
                        <status.icon className="h-4 w-4" />
                        <span>{status.text}</span>
                      </Badge>
                      
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4">
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-5 h-9">
                  <TabsTrigger value="overview" className="text-xs">
                    <Info className="h-3 w-3 mr-1" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="certificate" className="text-xs">
                    <Shield className="h-3 w-3 mr-1" />
                    Certificate
                  </TabsTrigger>
                  <TabsTrigger value="performance" className="text-xs">
                    <Zap className="h-3 w-3 mr-1" />
                    Performance
                  </TabsTrigger>
                  <TabsTrigger value="tools" className="text-xs">
                    <Wrench className="h-3 w-3 mr-1" />
                    Tools
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="text-xs">
                    <Settings className="h-3 w-3 mr-1" />
                    Settings
                  </TabsTrigger>
                </TabsList>
                
                <div className="mt-4">
                  <TabsContent value="overview" className="mt-0">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Full Domain</p>
                        <p className="text-sm">{getConnectionDisplayHostname(connection)}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Application Type</p>
                        <p className="text-sm">{formatApplicationType(connection.application_type)}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">SSL Provider</p>
                        <p className="text-sm capitalize">{connection.ssl_provider}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">DNS Provider</p>
                        <p className="text-sm capitalize">{connection.dns_provider}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Certificate Status</p>
                        <div className="flex items-center gap-2 mt-1">
                          {(() => {
                            const status = getCertificateStatus(connection);
                            const StatusIcon = status.icon;
                            return (
                              <>
                                <StatusIcon className="h-4 w-4" />
                                <span className="text-sm">{status.text}</span>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Auto-renewal</p>
                        <p className="text-sm">{connection.auto_renew && connection.dns_provider !== 'custom' ? 'Enabled' : 'Disabled'}</p>
                      </div>
                      {connection.application_type === 'vos' && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">SSH Access</p>
                          <p className="text-sm">{connection.enable_ssh ? 'Enabled' : 'Disabled'}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Last Issued</p>
                        <p className="text-sm">{connection.last_cert_issued ? new Date(connection.last_cert_issued).toLocaleDateString() : 'Never'}</p>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="certificate" className="mt-0">
                    {(() => {
                      const certInfo = certificateStatuses[connection.id];
                      if (!certInfo) {
                        return <div className="text-sm text-muted-foreground">Certificate information not available</div>;
                      }
                      return (
                        <div className="space-y-4">
                          {/* Subject Information */}
                          <div>
                            <h4 className="font-medium text-sm mb-3">Subject Certificate</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="font-medium text-muted-foreground">Common Name (CN):</span>
                                <p className="mt-1">{certInfo.subject?.CN || 'N/A'}</p>
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">Organization (O):</span>
                                <p className="mt-1">{certInfo.subject?.O || 'N/A'}</p>
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">Organizational Unit (OU):</span>
                                <p className="mt-1">{certInfo.subject?.OU || 'N/A'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Issuer Information */}
                          <div>
                            <h4 className="font-medium text-sm mb-3">Issuer Certificate</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="font-medium text-muted-foreground">Common Name (CN):</span>
                                <p className="mt-1">{certInfo.issuer?.CN || 'N/A'}</p>
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">Organization (O):</span>
                                <p className="mt-1">{certInfo.issuer?.O || 'N/A'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Certificate Details */}
                          <div>
                            <h4 className="font-medium text-sm mb-3">Certificate Details</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="font-medium text-muted-foreground">Valid From:</span>
                                <p className="mt-1">{formatDate(certInfo.validFrom)}</p>
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">Valid To:</span>
                                <p className="mt-1">{formatDate(certInfo.validTo)}</p>
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">Serial Number:</span>
                                <p className="mt-1 font-mono text-xs">{certInfo.serialNumber || 'N/A'}</p>
                              </div>
                              <div>
                                <span className="font-medium text-muted-foreground">Algorithm:</span>
                                <p className="mt-1">{certInfo.signatureAlgorithm || 'N/A'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Subject Alternative Names */}
                          {certInfo.subjectAltNames && certInfo.subjectAltNames.length > 0 && (
                            <div>
                              <h4 className="font-medium text-sm mb-3">Subject Alternative Names</h4>
                              <div className="text-sm">
                                <div className="flex flex-wrap gap-2">
                                  {certInfo.subjectAltNames.map((san, index) => (
                                    <Badge key={index} variant="secondary" className="text-xs rounded-[4px]">
                                      {san}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </TabsContent>
                  
                  <TabsContent value="performance" className="mt-0">
                    <PerformanceMetricsChart 
                      connectionId={connection.id}
                      connectionName={connection.name}
                      showIcons={true}
                      showGrade={true}
                    />
                  </TabsContent>
                  
                  <TabsContent value="tools" className="mt-0">
                    <div className="grid grid-cols-2 gap-2">
                      <CertificateRenewalButton
                        connection={connection}
                        onSuccess={() => {
                          fetchCertificateStatus(connection);
                          fetchConnections();
                          setDownloadRefreshTrigger(prev => prev + 1);
                        }}
                        refresh={() => fetchCertificateStatus(connection)}
                        isDisabled={activeOperation}
                      />
                      
                      <CertificateDownloadButton
                        connection={connection}
                        refreshTrigger={downloadRefreshTrigger}
                      />

                      {connection.application_type === 'vos' && connection.enable_ssh && (
                        <ServiceRestartButton
                          connection={connection}
                          onSuccess={() => fetchCertificateStatus(connection)}
                          isDisabled={activeOperation}
                        />
                      )}

                      {connection.application_type === 'vos' && connection.enable_ssh && (
                        <Button
                          onClick={() => {
                            console.log('SSH Test - Connection:', connection);
                            console.log('SSH Test - App Type:', connection.application_type);
                            console.log('SSH Test - Enable SSH:', connection.enable_ssh);
                            handleSSHTest(connection);
                          }}
                          size="sm"
                          variant="outline"
                          disabled={testingSSH.has(connection.id)}
                          className="justify-center border-blue-200 hover:border-blue-300 hover:bg-blue-50 dark:border-blue-800 dark:hover:border-blue-700 dark:hover:bg-blue-950"
                        >
                          {testingSSH.has(connection.id) ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Testing...
                            </>
                          ) : (
                            <>
                              <Terminal className="h-4 w-4 mr-2 text-blue-600 dark:text-blue-400" />
                              Test SSH
                            </>
                          )}
                        </Button>
                      )}

                      <Button
                        onClick={() => navigate(`/logs?connection=${connection.id}`)}
                        size="sm"
                        variant="outline"
                        className="justify-center border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-900"
                      >
                        <FileText className="h-4 w-4 mr-2 text-gray-600 dark:text-gray-400" />
                        View Logs
                      </Button>

                      <Button
                        onClick={() => window.open(`https://${getConnectionDisplayHostname(connection)}`, '_blank')}
                        size="sm"
                        variant="outline"
                        className="justify-center border-green-200 hover:border-green-300 hover:bg-green-50 dark:border-green-800 dark:hover:border-green-700 dark:hover:bg-green-950"
                      >
                        <ExternalLink className="h-4 w-4 mr-2 text-green-600 dark:text-green-400" />
                        View in Browser
                      </Button>

                      <Button
                        onClick={() => setEditingConnection(connection)}
                        size="sm"
                        variant="outline"
                        className="justify-center border-purple-200 hover:border-purple-300 hover:bg-purple-50 dark:border-purple-800 dark:hover:border-purple-700 dark:hover:bg-purple-950"
                      >
                        <Edit className="h-4 w-4 mr-2 text-purple-600 dark:text-purple-400" />
                        Edit
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="settings" className="mt-0">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                      <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                        <div>
                          <p className="font-medium text-sm">Auto-renewal</p>
                          <p className="text-xs text-muted-foreground">Automatic certificate renewal</p>
                        </div>
                        <Badge variant={connection.auto_renew && connection.dns_provider !== 'custom' ? "default" : "secondary"} className="rounded-[4px]">
                          {connection.auto_renew && connection.dns_provider !== 'custom' ? "On" : "Off"}
                        </Badge>
                      </div>
                      {connection.application_type === 'vos' && (
                        <>
                          <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                            <div>
                              <p className="font-medium text-sm">SSH Access</p>
                              <p className="text-xs text-muted-foreground">Allow SSH connections</p>
                            </div>
                            <Badge variant={connection.enable_ssh ? "default" : "secondary"} className="rounded-[4px]">
                              {connection.enable_ssh ? "On" : "Off"}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                            <div>
                              <p className="font-medium text-sm">Auto Restart</p>
                              <p className="text-xs text-muted-foreground">Restart service after cert</p>
                            </div>
                            <Badge variant={connection.auto_restart_service ? "default" : "secondary"} className="rounded-[4px]">
                              {connection.auto_restart_service ? "On" : "Off"}
                            </Badge>
                          </div>
                        </>
                      )}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  };

  const renderExpandedRow = (connection) => {
    const certInfo = certificateStatuses[connection.id];
    const operations = getConnectionOperations(connection.id);
    const activeOperation = operations.find(op => 
      ['pending', 'in_progress'].includes(op.status)
    );
    
    return (
      <tr key={`${connection.id}-expanded`}>
        <td colSpan="8" className="p-0">
          <div className="bg-muted/30 border-t">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="w-full justify-start rounded-none bg-transparent border-b h-12 px-4">
                <TabsTrigger value="overview" className="gap-2">
                  <Info className="h-4 w-4" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="certificate" className="gap-2">
                  <Shield className="h-4 w-4" />
                  Certificate
                </TabsTrigger>
                <TabsTrigger value="performance" className="gap-2">
                  <Zap className="h-4 w-4" />
                  Performance
                </TabsTrigger>
                <TabsTrigger value="tools" className="gap-2">
                  <Wrench className="h-4 w-4" />
                  Tools
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>
              
              <div className="p-4">
                <TabsContent value="overview" className="mt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Full Domain</p>
                      <p className="text-sm">{getConnectionDisplayHostname(connection)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">SSL Provider</p>
                      <p className="text-sm capitalize">{connection.ssl_provider}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">DNS Provider</p>
                      <p className="text-sm capitalize">{connection.dns_provider}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Last Issued</p>
                      <p className="text-sm">{connection.last_cert_issued ? new Date(connection.last_cert_issued).toLocaleDateString() : 'Never'}</p>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="certificate" className="mt-0">
                  <CertificateInfo connectionId={connection.id} detailed />
                </TabsContent>
                
                <TabsContent value="performance" className="mt-0">
                  <PerformanceMetricsChart 
                    connectionId={connection.id}
                    connectionName={connection.name}
                    showIcons={true}
                    showGrade={true}
                  />
                </TabsContent>
                
                <TabsContent value="tools" className="mt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <CertificateRenewalButton
                      connection={connection}
                      onSuccess={() => {
                        fetchCertificateStatus(connection);
                        fetchConnections();
                        setDownloadRefreshTrigger(prev => prev + 1);
                      }}
                      refresh={() => fetchCertificateStatus(connection)}
                      isDisabled={activeOperation}
                    />
                    
                    <CertificateDownloadButton
                      connection={connection}
                      refreshTrigger={downloadRefreshTrigger}
                    />

                    {connection.application_type === 'vos' && connection.enable_ssh && (
                      <ServiceRestartButton
                        connection={connection}
                        onSuccess={() => fetchCertificateStatus(connection)}
                        isDisabled={activeOperation}
                      />
                    )}

                    {connection.application_type === 'vos' && connection.enable_ssh && (
                      <Button
                        onClick={() => {
                          console.log('SSH Test (Compact) - Connection:', connection);
                          console.log('SSH Test (Compact) - App Type:', connection.application_type);
                          console.log('SSH Test (Compact) - Enable SSH:', connection.enable_ssh);
                          handleSSHTest(connection);
                        }}
                        size="sm"
                        variant="outline"
                        disabled={testingSSH.has(connection.id)}
                        className="justify-center border-blue-200 hover:border-blue-300 hover:bg-blue-50 dark:border-blue-800 dark:hover:border-blue-700 dark:hover:bg-blue-950"
                      >
                        {testingSSH.has(connection.id) ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Testing...
                          </>
                        ) : (
                          <>
                            <Terminal className="h-4 w-4 mr-2 text-blue-600 dark:text-blue-400" />
                            Test SSH
                          </>
                        )}
                      </Button>
                    )}

                    <Button
                      onClick={() => navigate(`/logs?connection=${connection.id}`)}
                      size="sm"
                      variant="outline"
                      className="justify-center border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-900"
                    >
                      <FileText className="h-4 w-4 mr-2 text-gray-600 dark:text-gray-400" />
                      Logs
                    </Button>

                    <Button
                      onClick={() => window.open(`https://${getConnectionDisplayHostname(connection)}`, '_blank')}
                      size="sm"
                      variant="outline"
                      className="justify-center border-green-200 hover:border-green-300 hover:bg-green-50 dark:border-green-800 dark:hover:border-green-700 dark:hover:bg-green-950"
                    >
                      <ExternalLink className="h-4 w-4 mr-2 text-green-600 dark:text-green-400" />
                      View
                    </Button>

                    <Button
                      onClick={() => {
                        console.log('Edit (Compact) - Connection being edited:', connection);
                        console.log('Edit (Compact) - App Type:', connection.application_type);
                        setEditingConnection(connection);
                      }}
                      size="sm"
                      variant="outline"
                      className="justify-center border-purple-200 hover:border-purple-300 hover:bg-purple-50 dark:border-purple-800 dark:hover:border-purple-700 dark:hover:bg-purple-950"
                    >
                      <Edit className="h-4 w-4 mr-2 text-purple-600 dark:text-purple-400" />
                      Edit
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="settings" className="mt-0">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                      <div>
                        <p className="font-medium text-sm">Auto-renewal</p>
                        <p className="text-xs text-muted-foreground">Automatic certificate renewal</p>
                      </div>
                      <Badge variant={connection.auto_renew && connection.dns_provider !== 'custom' ? "default" : "secondary"} className="rounded-[4px]">
                        {connection.auto_renew && connection.dns_provider !== 'custom' ? "On" : "Off"}
                      </Badge>
                    </div>
                    {connection.application_type === 'vos' && (
                      <>
                        <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                          <div>
                            <p className="font-medium text-sm">SSH Access</p>
                            <p className="text-xs text-muted-foreground">Allow SSH connections</p>
                          </div>
                          <Badge variant={connection.enable_ssh ? "default" : "secondary"} className="rounded-[4px]">
                            {connection.enable_ssh ? "On" : "Off"}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
                          <div>
                            <p className="font-medium text-sm">Auto Restart</p>
                            <p className="text-xs text-muted-foreground">Service restart after cert</p>
                          </div>
                          <Badge variant={connection.auto_restart_service ? "default" : "secondary"} className="rounded-[4px]">
                            {connection.auto_restart_service ? "On" : "Off"}
                          </Badge>
                        </div>
                      </>
                    )}
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </td>
      </tr>
    );
  };

  if (connectionState.isLoading && connectionState.retryAttempt === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BackgroundLogo />
        <p className="text-muted-foreground">Loading connections...</p>
      </div>
    );
  }

  if (connectionState.isRetrying) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BackgroundLogo />
        <div className="text-center">
          <p className="text-muted-foreground mb-2">Connecting to server...</p>
          <p className="text-sm text-muted-foreground">Attempt {connectionState.retryAttempt} of 10</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full py-20 relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <AutoRenewalNotifications />
      <div className="max-w-6xl mx-auto px-4">
        {/* Header with Stats */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold">Certificate Dashboard</h1>
            <div className="flex gap-2">
              <SettingsModal onConnectionsUpdated={fetchConnections} />
              <AddConnectionModal 
                onConnectionAdded={handleConnectionAdded} 
                trigger={
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Connection
                  </Button>
                }
              />
            </div>
          </div>
          
          {/* Overall Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
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

            <Card className="bg-card/85 backdrop-blur-sm relative overflow-visible">
              <div className="absolute -top-2 -right-2 z-10">
                <AutoRenewalCountdownBadge />
              </div>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Auto Renew</CardTitle>
                <RotateCcw className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600 mb-2">{overallStatus.autoRenew}</div>
                <NextAutoRenewalInfo />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Filters and Controls */}
        <Card className="mb-6 bg-card/85 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              {/* Search */}
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search connections..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Filters */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="valid">Valid</SelectItem>
                  <SelectItem value="expiring">Expiring</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="vos">VOS</SelectItem>
                  <SelectItem value="ise">ISE</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                  <SelectItem value="expiry">Expiry</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              >
                {sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
              </Button>

              {/* View Mode */}
              <div className="flex gap-1 border rounded-md p-1">
                <Button
                  variant={viewMode === 'full' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('full')}
                  title="Full View - Detailed cards with all information"
                  className="gap-1"
                >
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs">Full</span>
                </Button>
                <Button
                  variant={viewMode === 'compact' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('compact')}
                  title="Compact View - Table with expandable details"
                  className="gap-1"
                >
                  <TableIcon className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs">Compact</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {filteredConnections.length} of {connectionState.connections.length} connections
          </p>
        </div>

        {/* Content */}
        {viewMode === 'full' ? (
          <div className="space-y-4">
            {filteredConnections.map(renderConnectionCard)}
          </div>
        ) : (
          <Card className="bg-card/85 backdrop-blur-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-4">Name</th>
                      <th className="text-left p-4">Hostname</th>
                      <th className="text-left p-4">Type</th>
                      <th className="text-left p-4">Status</th>
                      <th className="text-left p-4">Expires</th>
                      <th className="text-left p-4">Provider</th>
                      <th className="text-left p-4">Auto-Renew</th>
                      <th className="text-right p-4 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConnections.map((connection) => {
                      const isExpanded = expandedRows.has(connection.id);
                      const isEnabled = isConnectionEnabled(connection);
                      
                      return (
                        <>
                          <tr 
                            key={connection.id} 
                            className={`border-b hover:bg-muted/50 cursor-pointer ${!isEnabled ? 'opacity-50 grayscale' : ''}`}
                            onClick={() => toggleRowExpansion(connection.id)}
                          >
                            <td className="p-4 font-medium">{connection.name}</td>
                            <td className="p-4">{getConnectionDisplayHostname(connection)}</td>
                            <td className="p-4">
                              <Badge variant="outline" className="px-2 py-1 rounded-[4px]">{formatApplicationType(connection.application_type)}</Badge>
                            </td>
                            <td className="p-4">{getStatusBadge(connection)}</td>
                            <td className="p-4">
                              {(() => {
                                const status = getCertificateStatus(connection);
                                return status.days !== undefined 
                                  ? status.days > 0 
                                    ? `${status.days} days`
                                    : `${Math.abs(status.days)} days ago`
                                  : 'N/A';
                              })()}
                            </td>
                            <td className="p-4 capitalize">{connection.ssl_provider}</td>
                            <td className="p-4">
                              {connection.auto_renew && connection.dns_provider !== 'custom' ? (
                                <Badge variant="default" className="px-2 py-1 rounded-[4px]">ENABLED</Badge>
                              ) : (
                                <Badge variant="secondary" className="px-2 py-1 rounded-[4px]">DISABLED</Badge>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRowExpansion(connection.id);
                                }}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </td>
                          </tr>
                          {isExpanded && renderExpandedRow(connection)}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {filteredConnections.length === 0 && (
          <Card className="bg-card/85 backdrop-blur-sm">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No connections match your current filters.</p>
            </CardContent>
          </Card>
        )}

        {/* Edit Modal */}
        {editingConnection && (
          <EditConnectionModalTabbed
            record={editingConnection}
            isOpen={!!editingConnection}
            onClose={() => setEditingConnection(null)}
            onConnectionUpdated={handleConnectionUpdated}
          />
        )}
      </div>
    </div>
  );
};

export default Home;