import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import BackgroundLogo from "@/components/BackgroundLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AddConnectionModal from "@/components/AddConnectionModalTabbed";
import SettingsModal from "@/components/SettingsModal";
import ConnectionDetailsTabs from "@/components/ConnectionDetailsTabs";
import LoadingState from "@/components/LoadingState";
import EditConnectionModalTabbed from "@/components/EditConnectionModalTabbed";
import { apiCall } from "@/lib/api";
import { filterEnabledConnections, getConnectionDisplayHostname, isConnectionEnabled } from "@/lib/connection-utils";
import { useWebSocket } from "@/contexts/WebSocketContext";
import { AutoRenewalNotifications } from "@/components/AutoRenewalNotifications";
import { NextAutoRenewalInfo } from "@/components/NextAutoRenewalInfo";
import { AutoRenewalCountdownBadge } from "@/components/AutoRenewalCountdownBadge";
import { useCertificateSettings } from "@/hooks/useCertificateSettings";
import {
  Server, AlertCircle, CheckCircle, Clock, RefreshCw,
  RotateCcw, Plus, Search,
  SortAsc, SortDesc, LayoutGrid, Table as TableIcon, ChevronDown,
  ChevronRight, X, Edit, FileText, ExternalLink, Trash2, ToggleLeft, ToggleRight
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const Home = ({ onStatusUpdate }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getConnectionOperations } = useWebSocket();
  const certificateSettings = useCertificateSettings();

  // View state — restore from localStorage
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('netssl-viewMode') || 'full');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('netssl-sortBy') || 'name');
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('netssl-sortOrder') || 'asc');
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
      
      const result = await response.json();
      if (response.ok && result.success) {
        toast({
          title: "SSH Test Successful",
          description: result.message || `Successfully connected to ${connection.name} via SSH`,
          duration: 5000,
        });
      } else {
        throw new Error(result.error || 'SSH test failed');
      }
    } catch (error) {
      console.error('SSH test error:', error);
      toast({
        title: "SSH Test Failed",
        description: error.message || `Failed to connect to ${connection.name} via SSH. Check credentials and connectivity.`,
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

  const handleToggleConnection = async (connection) => {
    const isEnabled = isConnectionEnabled(connection);
    try {
      const getResponse = await apiCall(`/data?id=${connection.id}`);
      const fullConnection = await getResponse.json();
      const response = await apiCall(`/data/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...fullConnection, is_enabled: !isEnabled })
      });
      if (response.ok) {
        toast({
          title: !isEnabled ? "Connection Enabled" : "Connection Disabled",
          description: `${connection.name} has been ${!isEnabled ? 'enabled' : 'disabled'}`,
        });
        fetchConnections();
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update connection", variant: "destructive" });
    }
  };

  const handleDeleteConnection = async (connection) => {
    if (!confirm(`Delete "${connection.name}"? This cannot be undone.`)) return;
    try {
      const response = await apiCall(`/data/${connection.id}`, { method: 'DELETE' });
      if (response.ok) {
        toast({ title: "Deleted", description: `${connection.name} has been removed` });
        fetchConnections();
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete connection", variant: "destructive" });
    }
  };

  const getCertificateStatus = (connection) => {
    // Check if connection is disabled first
    if (!isConnectionEnabled(connection)) {
      return {
        status: "disabled",
        text: "Disabled",
        icon: AlertCircle
      };
    }

    const certInfo = certificateStatuses[connection.id];
    if (!certInfo || certInfo.error) {
      return {
        status: "unknown",
        text: certInfo?.error || "Unable to check certificate",
        icon: AlertCircle
      };
    }

    if (!certInfo.isValid) {
      return {
        status: "expired",
        text: "Certificate Expired",
        icon: AlertCircle,
        days: certInfo.daysUntilExpiry
      };
    }

    if (certInfo.daysUntilExpiry <= certificateSettings.warningDays) {
      return {
        status: "expiring",
        text: `Expires in ${certInfo.daysUntilExpiry} days`,
        icon: Clock,
        days: certInfo.daysUntilExpiry
      };
    } else {
      return {
        status: "valid",
        text: `Valid for ${certInfo.daysUntilExpiry} days`,
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

  // Persist view preferences to localStorage
  useEffect(() => { localStorage.setItem('netssl-viewMode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('netssl-sortBy', sortBy); }, [sortBy]);
  useEffect(() => { localStorage.setItem('netssl-sortOrder', sortOrder); }, [sortOrder]);

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

  // Auto-expand connection from ?expand= URL param (e.g. navigating back from Logs)
  useEffect(() => {
    const expandId = searchParams.get('expand');
    if (expandId && connectionState.connections.length > 0) {
      const id = Number(expandId);
      setExpandedCards(prev => new Set([...prev, id]));
      setExpandedRows(prev => new Set([...prev, id]));
      // Clean up the URL param
      searchParams.delete('expand');
      setSearchParams(searchParams, { replace: true });
    }
  }, [connectionState.connections, searchParams]);

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
    return <Badge variant={statusColors[status.status] || "secondary"}>{status.text}</Badge>;
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
      <Card key={connection.id} className={`overflow-hidden border-l-2 ${status.status === 'valid' ? 'border-l-status-valid' : status.status === 'expiring' ? 'border-l-status-warning' : status.status === 'expired' ? 'border-l-status-expired' : 'border-l-border'} ${!isEnabled ? 'opacity-40 grayscale border-dashed' : ''}`}>
        <Collapsible open={isExpanded} onOpenChange={() => toggleCardExpansion(connection.id)}>
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold">{connection.name}</h3>
                        <div className="w-px h-4 bg-border"></div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs px-2 py-1 ">
                            {formatApplicationType(connection.application_type)}
                          </Badge>
                          {connection.auto_renew && connection.dns_provider !== 'custom' && (
                            <Badge variant="secondary" className="text-xs px-2 py-1 ">
                              <RefreshCw className="h-3 w-3 mr-1" />
                              AUTO-RENEW
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="font-mono">{getConnectionDisplayHostname(connection)}</span>
                        <span>•</span>
                        <span>{connection.ssl_provider}</span>
                        <span>•</span>
                        <span>{connection.dns_provider}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Badge variant={status.status === 'valid' ? 'success' : status.status === 'expiring' ? 'warning' : 'destructive'} className="flex items-center gap-1">
                        <status.icon className="h-4 w-4" />
                        <span>{status.text}</span>
                      </Badge>

                      <div className="flex items-center gap-1 ml-1" onClick={(e) => e.stopPropagation()}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); handleToggleConnection(connection); }}>
                              {isEnabled ? <ToggleRight className="h-3.5 w-3.5 text-status-valid" /> : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{isEnabled ? "Disable" : "Enable"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); setEditingConnection(connection); }}>
                              <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); navigate(`/logs?connection=${connection.id}`); }}>
                              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Logs</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); window.open(`https://${getConnectionDisplayHostname(connection)}`, '_blank'); }}>
                              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Open in Browser</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); handleDeleteConnection(connection); }}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </div>

                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4">
              <ConnectionDetailsTabs
                connection={connection}
                certInfo={certInfo}
                variant="card"
                status={status}
                activeOperation={activeOperation}
                testingSSH={testingSSH.has(connection.id)}
                downloadRefreshTrigger={downloadRefreshTrigger}
                onRenewSuccess={() => {
                  fetchCertificateStatus(connection);
                  fetchConnections();
                  setDownloadRefreshTrigger(prev => prev + 1);
                }}
                onRefreshCert={() => fetchCertificateStatus(connection)}
                onSSHTest={handleSSHTest}
                onNavigate={navigate}
                onEdit={setEditingConnection}
                formatApplicationType={formatApplicationType}
              />
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  };

  const renderExpandedRow = (connection) => {
    const status = getCertificateStatus(connection);
    const certInfo = certificateStatuses[connection.id];
    const operations = getConnectionOperations(connection.id);
    const activeOperation = operations.find(op =>
      ['pending', 'in_progress'].includes(op.status)
    );

    return (
      <tr key={`${connection.id}-expanded`}>
        <td colSpan="8" className="p-0">
          <div className="bg-muted/30 border-t">
            <ConnectionDetailsTabs
              connection={connection}
              certInfo={certInfo}
              variant="table"
              status={status}
              activeOperation={activeOperation}
              testingSSH={testingSSH.has(connection.id)}
              downloadRefreshTrigger={downloadRefreshTrigger}
              onRenewSuccess={() => {
                fetchCertificateStatus(connection);
                fetchConnections();
                setDownloadRefreshTrigger(prev => prev + 1);
              }}
              onRefreshCert={() => fetchCertificateStatus(connection)}
              onSSHTest={handleSSHTest}
              onNavigate={navigate}
              onEdit={setEditingConnection}
              formatApplicationType={formatApplicationType}
            />
          </div>
        </td>
      </tr>
    );
  };

  if (connectionState.isLoading && connectionState.retryAttempt === 0) {
    return (
      <>
        <BackgroundLogo />
        <LoadingState variant="page" text="Loading connections..." />
      </>
    );
  }

  if (connectionState.isRetrying) {
    return (
      <>
        <BackgroundLogo />
        <LoadingState variant="page" text={`Connecting to server... (attempt ${connectionState.retryAttempt} of 10)`} />
      </>
    );
  }

  return (
    <div className="min-h-full w-full py-20 relative bg-background">
      <BackgroundLogo />
      <AutoRenewalNotifications />
      <div className="max-w-6xl mx-auto px-4">
        {/* Header with Stats */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold">Certificate Dashboard</h1>
            <div className="flex gap-2">
              <SettingsModal />
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
            <Card className="border-l-2 border-l-status-info animate-slide-up animate-stagger-1">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Servers</CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{overallStatus.total}</div>
              </CardContent>
            </Card>

            <Card className="border-l-2 border-l-status-valid animate-slide-up animate-stagger-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Valid Certificates</CardTitle>
                <CheckCircle className="h-4 w-4 text-status-valid" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-status-valid">{overallStatus.valid}</div>
              </CardContent>
            </Card>

            <Card className="border-l-2 border-l-status-warning animate-slide-up animate-stagger-3">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
                <Clock className="h-4 w-4 text-status-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-status-warning">{overallStatus.expiring}</div>
              </CardContent>
            </Card>

            <Card className="border-l-2 border-l-status-expired animate-slide-up animate-stagger-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Expired</CardTitle>
                <AlertCircle className="h-4 w-4 text-status-expired" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-status-expired">{overallStatus.expired}</div>
              </CardContent>
            </Card>

            <Card className="border-l-2 border-l-primary relative overflow-visible animate-slide-up animate-stagger-5">
              <div className="absolute -top-2 -right-2 z-10">
                <AutoRenewalCountdownBadge />
              </div>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Auto Renew</CardTitle>
                <RotateCcw className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-primary mb-2">{overallStatus.autoRenew}</div>
                <NextAutoRenewalInfo />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Filters and Controls */}
        <Card className="mb-6">
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

        {/* Results count + active filter tags */}
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-mono font-medium text-foreground">{filteredConnections.length}</span> of {connectionState.connections.length} connections
            </p>
            {searchTerm && (
              <Badge variant="outline" className="gap-1 text-xs cursor-pointer" onClick={() => setSearchTerm('')}>
                Search: "{searchTerm}" <X className="w-3 h-3" />
              </Badge>
            )}
            {statusFilter !== 'all' && (
              <Badge variant="outline" className="gap-1 text-xs cursor-pointer" onClick={() => setStatusFilter('all')}>
                Status: {statusFilter} <X className="w-3 h-3" />
              </Badge>
            )}
            {typeFilter !== 'all' && (
              <Badge variant="outline" className="gap-1 text-xs cursor-pointer" onClick={() => setTypeFilter('all')}>
                Type: {typeFilter} <X className="w-3 h-3" />
              </Badge>
            )}
          </div>
        </div>

        {/* Content */}
        {viewMode === 'full' ? (
          <div className="space-y-4">
            {filteredConnections.map(renderConnectionCard)}
          </div>
        ) : (
          <Card className="bg-card">
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
                      <th className="text-left p-4 whitespace-nowrap">Auto-Renew</th>
                      <th className="text-left p-4">Actions</th>
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
                            className={`border-b hover:bg-muted/50 cursor-pointer ${!isEnabled ? 'opacity-40 grayscale border-dashed' : ''}`}
                            onClick={() => toggleRowExpansion(connection.id)}
                          >
                            <td className="p-4 font-medium">{connection.name}</td>
                            <td className="p-4 font-mono text-sm">{getConnectionDisplayHostname(connection)}</td>
                            <td className="p-4">
                              <Badge variant="outline" className="px-2 py-1 ">{formatApplicationType(connection.application_type)}</Badge>
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
                                <Badge variant="default" className="px-2 py-1 ">ENABLED</Badge>
                              ) : (
                                <Badge variant="secondary" className="px-2 py-1 ">DISABLED</Badge>
                              )}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); handleToggleConnection(connection); }}>
                                      {isEnabled ? <ToggleRight className="h-3.5 w-3.5 text-status-valid" /> : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{isEnabled ? "Disable" : "Enable"}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setEditingConnection(connection); }}>
                                      <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); navigate(`/logs?connection=${connection.id}`); }}>
                                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Logs</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); window.open(`https://${getConnectionDisplayHostname(connection)}`, '_blank'); }}>
                                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Open in Browser</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); handleDeleteConnection(connection); }}>
                                      <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete</TooltipContent>
                                </Tooltip>
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
                              </div>
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
          <Card className="bg-card">
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