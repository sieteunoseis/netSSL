import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Search, FileText, Server, AlertCircle, Download, Copy, Play, Pause, ArrowLeft, SortAsc, SortDesc } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/api";
import { getConnectionDisplayHostname } from "@/lib/connection-utils";
import BackgroundLogo from "@/components/BackgroundLogo";

const Logs = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [logSearchTerm, setLogSearchTerm] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(null);
  const [sortOrder, setSortOrder] = useState('asc');
  const scrollAreaRef = useRef(null);
  const logsEndRef = useRef(null);
  const initialSelectionDone = useRef(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await apiCall('/logs/all');
      const data = await response.json();

      if (response.ok) {
        setAccounts(data.accounts);
        setLastUpdated(data.timestamp);

        // Auto-select account: prefer URL param ?connection=id, else first with logs
        if (!initialSelectionDone.current && data.accounts.length > 0) {
          initialSelectionDone.current = true;
          const connectionId = searchParams.get('connection');
          if (connectionId) {
            const targetAccount = data.accounts.find(acc => String(acc.connection.id) === connectionId);
            if (targetAccount) {
              setSelectedAccount(targetAccount);
            }
          }
          if (!connectionId || !data.accounts.find(acc => String(acc.connection.id) === connectionId)) {
            const firstAccountWithLogs = data.accounts.find(acc => acc.hasLogs);
            if (firstAccountWithLogs) {
              setSelectedAccount(firstAccountWithLogs);
            }
          }
        }
      } else {
        throw new Error(data.error || 'Failed to fetch logs');
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast({
        title: "Error",
        description: "Failed to fetch logs: " + error.message,
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 5000); // Refresh every 5 seconds
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    } else {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        setRefreshInterval(null);
      }
    }
  }, [autoRefresh]);

  // Scroll to bottom when account is selected or logs change
  useEffect(() => {
    if (selectedAccount && selectedAccount.hasLogs && scrollAreaRef.current && logsEndRef.current) {
      // Small delay to ensure DOM has updated
      setTimeout(() => {
        // Scroll within the ScrollArea viewport instead of the entire page
        const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      }, 100);
    }
  }, [selectedAccount, logSearchTerm]);

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  const filteredAccounts = accounts
    .filter(account =>
      account.connection.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (account.domain && account.domain.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (account.connection.portal_url && account.connection.portal_url.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => {
      const cmp = a.connection.name.localeCompare(b.connection.name);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

  const filteredLogs = selectedAccount ?
    selectedAccount.logs.filter(log =>
      log.toLowerCase().includes(logSearchTerm.toLowerCase())
    ) : [];

  const handleCopyLogs = () => {
    if (selectedAccount) {
      const logText = selectedAccount.logs.join('\n');
      navigator.clipboard.writeText(logText);
      toast({
        title: "Copied",
        description: "Logs copied to clipboard",
        duration: 2000,
      });
    }
  };

  const handleDownloadLogs = () => {
    if (selectedAccount) {
      const logText = selectedAccount.logs.join('\n');
      const blob = new Blob([logText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedAccount.domain}_renewal_logs.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Downloaded",
        description: "Logs downloaded successfully",
        duration: 2000,
      });
    }
  };

  const formatApplicationType = (type) => {
    const types = { "ise": "ISE", "vos": "VOS", "general": "GENERAL" };
    return types[type] || type.toUpperCase();
  };

  const formatLogLine = (log) => {
    // Extract timestamp and message
    const timestampMatch = log.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (timestampMatch) {
      const timestamp = timestampMatch[1];
      const message = timestampMatch[2];
      const date = new Date(timestamp);
      const formattedTime = date.toISOString();

      return {
        timestamp: formattedTime,
        message: message,
        isError: message.toLowerCase().includes('error') || message.toLowerCase().includes('failed'),
        isWarning: message.toLowerCase().includes('warning') || message.toLowerCase().includes('warn'),
        isSuccess: message.toLowerCase().includes('success') || message.toLowerCase().includes('completed')
      };
    }

    return {
      timestamp: '',
      message: log,
      isError: false,
      isWarning: false,
      isSuccess: false
    };
  };

  return (
    <div className="h-full bg-background relative overflow-hidden flex flex-col">
      <BackgroundLogo />
      <div className="flex-1 pt-8 pb-12 px-4 md:px-8 lg:px-12 flex flex-col min-h-0">
        <div className="flex-1 flex bg-card overflow-hidden rounded-lg border border-border min-w-0">
          {/* Left Sidebar - Accounts */}
          <div className="w-80 min-w-64 max-w-80 flex-shrink bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center">
              <Server className="w-5 h-5 mr-2" />
              Accounts
            </h2>
            <div className="flex items-center space-x-2">
              <Button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                variant="outline"
                size="sm"
              >
                {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
              </Button>
              <Button
                onClick={toggleAutoRefresh}
                variant="outline"
                size="sm"
                className={autoRefresh ? 'bg-status-valid/10 border-status-valid/30 text-status-valid' : ''}
              >
                {autoRefresh ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button
                onClick={fetchLogs}
                variant="outline"
                size="sm"
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {lastUpdated && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-muted-foreground">
                Last updated: {new Date(lastUpdated).toLocaleTimeString()}
              </p>
              {autoRefresh && (
                <div className="flex items-center text-status-valid">
                  <div className="w-2 h-2 bg-status-valid rounded-full animate-pulse mr-1"></div>
                  <span className="text-xs">Auto-refresh</span>
                </div>
              )}
            </div>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filteredAccounts.map((account) => (
              <Card
                key={account.connection.id}
                className={`cursor-pointer transition-all ${
                  selectedAccount?.connection.id === account.connection.id
                    ? 'bg-primary/10 border-primary/30'
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => setSelectedAccount(account)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {account.connection.name}
                      </p>
                      <p className="text-sm text-muted-foreground font-mono truncate">
                        {getConnectionDisplayHostname(account.connection) || account.domain || 'No domain'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <Badge variant="outline" className="text-xs px-2 py-1">
                        {formatApplicationType(account.connection.application_type)}
                      </Badge>
                      <div className="flex items-center">
                        {account.hasLogs ? (
                          <div className="flex items-center text-status-valid">
                            <FileText className="w-3 h-3 mr-1" />
                            <span className="text-xs font-mono">{account.logs.length}</span>
                          </div>
                        ) : (
                          <div className="flex items-center text-muted-foreground">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            <span className="text-xs">No logs</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
          </div>

          {/* Right Panel - Log Viewer */}
          <div className="flex-1 flex flex-col min-w-0">
        {selectedAccount ? (
          <>
            <div className="p-4 bg-card border-b border-border">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => navigate(`/?expand=${selectedAccount.connection.id}`)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div>
                    <h3 className="text-lg font-semibold">
                      {selectedAccount.connection.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono">{getConnectionDisplayHostname(selectedAccount.connection) || selectedAccount.domain || 'No domain'}</span> • <span className="font-mono">{selectedAccount.logs.length}</span> log entries
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    onClick={handleCopyLogs}
                    variant="outline"
                    size="sm"
                    disabled={!selectedAccount.hasLogs}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>
                  <Button
                    onClick={handleDownloadLogs}
                    variant="outline"
                    size="sm"
                    disabled={!selectedAccount.hasLogs}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search logs..."
                  value={logSearchTerm}
                  onChange={(e) => setLogSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex-1 bg-[hsl(222,47%,6%)] text-[hsl(152,69%,45%)] font-mono text-sm overflow-hidden leading-tight">
              <ScrollArea ref={scrollAreaRef} className="h-full w-full overflow-x-hidden">
                <div className="p-4 pr-6 space-y-0.5 w-full">
                  {filteredLogs.length > 0 ? (
                    <>
                      {filteredLogs.map((log, index) => {
                        const formatted = formatLogLine(log);
                        return (
                          <div key={index} className="w-full overflow-hidden">
                            <div className="flex w-full min-w-0">
                              <span className="text-muted-foreground w-56 flex-shrink-0 whitespace-nowrap pr-2">
                                [{formatted.timestamp}]
                              </span>
                              <div className={`flex-1 min-w-0 break-all ${
                                formatted.isError ? 'text-status-expired' :
                                formatted.isWarning ? 'text-status-warning' :
                                formatted.isSuccess ? 'text-[hsl(152,69%,45%)]' :
                                'text-[hsl(210,20%,70%)]'
                              }`}>
                                {formatted.message}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={logsEndRef} className="h-1" />
                    </>
                  ) : logSearchTerm ? (
                    <div className="text-muted-foreground text-center py-8">
                      No logs match your search term
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-center py-8">
                      No logs available for this account
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/30">
            <div className="text-center">
              <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                Select an Account
              </h3>
              <p className="text-muted-foreground">
                Choose an account from the sidebar to view its renewal logs
              </p>
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Logs;
