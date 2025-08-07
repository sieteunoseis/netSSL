import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, XCircle, RefreshCw, Shield, AlertTriangle } from 'lucide-react';
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

export default function Admin() {
  const [activeRenewals, setActiveRenewals] = useState<ActiveRenewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
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

  useEffect(() => {
    fetchActiveRenewals();

    // Subscribe to admin updates via WebSocket
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
      // WebSocket will handle the update
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
              <p className="text-muted-foreground">Monitor and manage active certificate renewals</p>
            </div>
          </div>
          <Button onClick={fetchActiveRenewals} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
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

      <Card className="bg-card/85 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Active Certificate Renewals</CardTitle>
          <CardDescription>
            {activeRenewals.length} active renewal{activeRenewals.length !== 1 ? 's' : ''} in progress
          </CardDescription>
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
      </div>
    </div>
  );
}