import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2, XCircle, RefreshCw, Shield, AlertTriangle,
  Wifi, WifiOff, FolderCheck, Settings, Activity, Clock,
  CheckCircle2, XOctagon, HardDrive, Cpu
} from 'lucide-react';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useToast } from '@/hooks/use-toast';
import BackgroundLogo from '@/components/BackgroundLogo';
import { apiCall } from '@/lib/api';

interface ActiveRenewal {
  id: string;
  connectionId: number;
  connectionName: string;
  hostname: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  startedAt: string;
  createdBy: string;
  metadata?: any;
}

interface DiagnosticsData {
  websocket: {
    clientCount: number;
  };
  permissions: Record<string, {
    readable: boolean;
    writable: boolean;
    exists: boolean;
    error?: string;
  }>;
  process: {
    uid: number | null;
    gid: number | null;
    nodeVersion: string;
    platform: string;
    arch: string;
    uptime: number;
    memoryUsage: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
    };
    pid: number;
  };
  environment: Record<string, string>;
  accounts: {
    directory: string;
    totalFiles: number;
    totalSize: string;
    totalSizeBytes: number;
  };
  timestamp: string;
}

interface AutoRenewalStatus {
  total_auto_renew_connections: number;
  connections_due_for_renewal: number;
  cron_schedule: string;
  next_run_time: string;
  renewal_threshold_days: number;
}

export default function Admin() {
  const [activeRenewals, setActiveRenewals] = useState<ActiveRenewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [autoRenewalStatus, setAutoRenewalStatus] = useState<AutoRenewalStatus | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [wsTesting, setWsTesting] = useState(false);
  const wsTestingRef = useRef(false);
  const { socket, connected } = useWebSocket();
  const { toast } = useToast();

  const fetchActiveRenewals = async () => {
    try {
      setLoading(true);
      const response = await apiCall('/admin/active-renewals');
      const data = await response.json();
      setActiveRenewals(data);
    } catch (error) {
      console.error('Error fetching active renewals:', error);
      toast({
        title: 'Error',
        description: 'Failed to load active renewals',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    try {
      const [diagResponse, renewalResponse] = await Promise.all([
        apiCall('/admin/diagnostics'),
        apiCall('/auto-renewal/status')
      ]);
      const diagData = await diagResponse.json();
      const renewalData = await renewalResponse.json();
      setDiagnostics(diagData);
      setAutoRenewalStatus(renewalData);
    } catch (error) {
      console.error('Error fetching diagnostics:', error);
      toast({
        title: 'Error',
        description: 'Failed to load diagnostics data',
        variant: 'destructive'
      });
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [toast]);

  const testWebSocket = useCallback(() => {
    if (!socket || !connected) {
      toast({
        title: 'Error',
        description: 'WebSocket is not connected',
        variant: 'destructive'
      });
      return;
    }

    setWsTesting(true);
    wsTestingRef.current = true;
    const startTime = Date.now();

    const onPong = () => {
      const latency = Date.now() - startTime;
      setWsLatency(latency);
      setWsTesting(false);
      wsTestingRef.current = false;
      socket.off('pong', onPong);
    };

    socket.on('pong', onPong);
    socket.emit('ping');

    setTimeout(() => {
      socket.off('pong', onPong);
      if (wsTestingRef.current) {
        setWsTesting(false);
        wsTestingRef.current = false;
        setWsLatency(null);
        toast({
          title: 'Timeout',
          description: 'WebSocket ping test timed out after 5s',
          variant: 'destructive'
        });
      }
    }, 5000);
  }, [socket, connected, toast]);

  useEffect(() => {
    fetchActiveRenewals();

    if (socket && connected) {
      socket.emit('subscribe:admin');

      socket.on('admin:renewal:started', (renewal: ActiveRenewal) => {
        setActiveRenewals(prev => [...prev, renewal]);
      });

      socket.on('admin:renewal:updated', (update: { id: string; status: string; progress: number; message: string }) => {
        setActiveRenewals(prev => prev.map(r =>
          r.id === update.id
            ? { ...r, status: update.status, progress: update.progress, message: update.message }
            : r
        ));
      });

      socket.on('admin:renewal:completed', (id: string) => {
        setActiveRenewals(prev => prev.filter(r => r.id !== id));
        toast({
          title: 'Success',
          description: 'Renewal completed'
        });
      });

      socket.on('admin:renewal:cancelled', (id: string) => {
        setActiveRenewals(prev => prev.filter(r => r.id !== id));
        toast({
          title: 'Info',
          description: 'Renewal cancelled'
        });
      });

      return () => {
        socket.emit('unsubscribe:admin');
        socket.off('admin:renewal:started');
        socket.off('admin:renewal:updated');
        socket.off('admin:renewal:completed');
        socket.off('admin:renewal:cancelled');
      };
    }
  }, [socket, connected]);

  const cancelRenewal = async (renewalId: string) => {
    if (!confirm('Are you sure you want to cancel this renewal?')) {
      return;
    }

    setCancelling(renewalId);
    try {
      await apiCall(`/admin/cancel-renewal/${renewalId}`, {
        method: 'POST'
      });

      toast({
        title: 'Success',
        description: 'Renewal cancellation requested'
      });
    } catch (error) {
      console.error('Error cancelling renewal:', error);
      toast({
        title: 'Error',
        description: 'Failed to cancel renewal',
        variant: 'destructive'
      });
    } finally {
      setCancelling(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500';
      case 'in_progress':
      case 'generating_csr':
      case 'creating_account':
      case 'requesting_certificate':
      case 'creating_dns_challenge':
      case 'dns_validation':
      case 'waiting_dns_propagation':
      case 'completing_validation':
      case 'downloading_certificate':
      case 'uploading_certificate':
        return 'bg-blue-500';
      case 'waiting_manual_dns':
        return 'bg-orange-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleString();
    } catch {
      return 'Invalid Date';
    }
  };

  const calculateDuration = (startedAt: string) => {
    if (!startedAt) return '0m 0s';
    try {
      const start = new Date(startedAt).getTime();
      if (isNaN(start)) return '0m 0s';
      const now = Date.now();
      const diff = now - start;
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    } catch {
      return '0m 0s';
    }
  };

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-full w-full py-20 relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                <p className="text-muted-foreground">Monitor and manage certificate renewals and system health</p>
              </div>
            </div>
          </div>
        </div>

        {!connected && (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              WebSocket disconnected. Real-time updates are unavailable. Data shown may be outdated.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="renewals" className="space-y-4">
          <TabsList>
            <TabsTrigger value="renewals">Active Renewals</TabsTrigger>
            <TabsTrigger value="diagnostics" onClick={() => { if (!diagnostics) fetchDiagnostics(); }}>
              Diagnostics
            </TabsTrigger>
          </TabsList>

          {/* Active Renewals Tab */}
          <TabsContent value="renewals">
            <Card className="bg-card/85 backdrop-blur-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Active Certificate Renewals</CardTitle>
                  <CardDescription>
                    {activeRenewals.length} active renewal{activeRenewals.length !== 1 ? 's' : ''} in progress
                  </CardDescription>
                </div>
                <Button onClick={fetchActiveRenewals} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {activeRenewals.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No active renewals at this time
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeRenewals.map((renewal) => (
                      <div key={renewal.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <h3 className="font-semibold">
                                {renewal.connectionName !== 'Unknown'
                                  ? renewal.connectionName
                                  : `Connection ${renewal.connectionId}`}
                              </h3>
                              <Badge className={getStatusColor(renewal.status)} variant="secondary">
                                {renewal.status.replace(/_/g, ' ')}
                              </Badge>
                              <Badge variant="outline">
                                {renewal.createdBy || 'system'}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {renewal.hostname !== 'Unknown' ? renewal.hostname : 'No hostname available'}
                            </p>
                            <p className="text-sm text-muted-foreground">ID: {renewal.id}</p>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => cancelRenewal(renewal.id)}
                            disabled={cancelling === renewal.id}
                          >
                            {cancelling === renewal.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                            <span className="ml-2">Cancel</span>
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Progress</span>
                            <span>{renewal.progress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full transition-all duration-300"
                              style={{ width: `${renewal.progress}%` }}
                            />
                          </div>
                        </div>

                        <div className="space-y-1 text-sm">
                          <p className="text-muted-foreground">Status: {renewal.message}</p>
                          <p className="text-muted-foreground">Started: {formatDate(renewal.startedAt)}</p>
                          <p className="text-muted-foreground">Duration: {calculateDuration(renewal.startedAt)}</p>
                        </div>

                        {renewal.metadata && (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              Metadata
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                              {JSON.stringify(renewal.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Diagnostics Tab */}
          <TabsContent value="diagnostics">
            {diagnosticsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : diagnostics ? (
              <div className="space-y-4">
                {/* WebSocket Status */}
                <Card className="bg-card/85 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Activity className="h-5 w-5" />
                      WebSocket Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {connected ? (
                          <Badge className="bg-green-500 text-white">
                            <Wifi className="h-3 w-3 mr-1" /> Connected
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500 text-white">
                            <WifiOff className="h-3 w-3 mr-1" /> Disconnected
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground">
                          {diagnostics.websocket.clientCount} client{diagnostics.websocket.clientCount !== 1 ? 's' : ''} connected to server
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {wsLatency !== null && (
                          <Badge variant="outline" className="font-mono">
                            {wsLatency}ms
                          </Badge>
                        )}
                        <Button onClick={testWebSocket} variant="outline" size="sm" disabled={wsTesting || !connected}>
                          {wsTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Activity className="h-4 w-4 mr-2" />}
                          Test WebSocket
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Permission Validation */}
                <Card className="bg-card/85 backdrop-blur-sm">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <FolderCheck className="h-5 w-5" />
                      Permission Validation
                    </CardTitle>
                    <Button onClick={fetchDiagnostics} variant="outline" size="sm">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Re-check
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {Object.entries(diagnostics.permissions).map(([dirName, perms]) => (
                        <div key={dirName} className="border rounded-lg p-4 space-y-2">
                          <div className="flex items-center gap-2 font-semibold">
                            <HardDrive className="h-4 w-4" />
                            {dirName}/
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2">
                              {perms.exists ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XOctagon className="h-4 w-4 text-red-500" />}
                              Exists
                            </div>
                            <div className="flex items-center gap-2">
                              {perms.readable ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XOctagon className="h-4 w-4 text-red-500" />}
                              Readable
                            </div>
                            <div className="flex items-center gap-2">
                              {perms.writable ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XOctagon className="h-4 w-4 text-red-500" />}
                              Writable
                            </div>
                          </div>
                          {perms.error && (
                            <p className="text-xs text-destructive">{perms.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="text-sm text-muted-foreground border-t pt-3">
                      <span className="font-medium">Process:</span>{' '}
                      UID={diagnostics.process.uid ?? 'N/A'}, GID={diagnostics.process.gid ?? 'N/A'} |{' '}
                      Node {diagnostics.process.nodeVersion} | {diagnostics.process.platform}/{diagnostics.process.arch} |{' '}
                      PID {diagnostics.process.pid} | Uptime: {formatUptime(diagnostics.process.uptime)}
                    </div>
                  </CardContent>
                </Card>

                {/* Environment & System Info */}
                <Card className="bg-card/85 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Settings className="h-5 w-5" />
                      Environment & System Info
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Environment Variables */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(diagnostics.environment).map(([key, value]) => (
                        <div key={key} className="flex justify-between items-center border rounded px-3 py-2">
                          <span className="text-sm font-mono text-muted-foreground">{key}</span>
                          <Badge variant="outline">{value}</Badge>
                        </div>
                      ))}
                    </div>

                    {/* Accounts Stats */}
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <HardDrive className="h-4 w-4" /> Accounts Directory
                      </h4>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Path:</span>
                          <span className="ml-2 font-mono">{diagnostics.accounts.directory}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Files:</span>
                          <span className="ml-2">{diagnostics.accounts.totalFiles}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Size:</span>
                          <span className="ml-2">{diagnostics.accounts.totalSize}</span>
                        </div>
                      </div>
                    </div>

                    {/* Auto-Renewal Summary */}
                    {autoRenewalStatus && (
                      <div className="border rounded-lg p-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <Clock className="h-4 w-4" /> Auto-Renewal Status
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Eligible:</span>
                            <span className="ml-2 font-semibold">{autoRenewalStatus.total_auto_renew_connections}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Due:</span>
                            <span className="ml-2 font-semibold">{autoRenewalStatus.connections_due_for_renewal}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Schedule:</span>
                            <span className="ml-2 font-mono">{autoRenewalStatus.cron_schedule}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Next run:</span>
                            <span className="ml-2">{new Date(autoRenewalStatus.next_run_time).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Memory Usage */}
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <Cpu className="h-4 w-4" /> Memory Usage
                      </h4>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">RSS:</span>
                          <span className="ml-2">{formatBytes(diagnostics.process.memoryUsage.rss)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Heap Used:</span>
                          <span className="ml-2">{formatBytes(diagnostics.process.memoryUsage.heapUsed)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Heap Total:</span>
                          <span className="ml-2">{formatBytes(diagnostics.process.memoryUsage.heapTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                Click the Diagnostics tab to load system information
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
