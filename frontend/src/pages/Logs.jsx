import { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Search, FileText, Server, AlertCircle, Download, Copy, Play, Pause } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/api";
import { getConnectionDisplayHostname } from "@/lib/connection-utils";
import BackgroundLogo from "@/components/BackgroundLogo";

const Logs = () => {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [logSearchTerm, setLogSearchTerm] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await apiCall('/logs/all');
      const data = await response.json();
      
      if (response.ok) {
        setAccounts(data.accounts);
        setLastUpdated(data.timestamp);
        
        // Auto-select first account with logs if none selected
        if (!selectedAccount && data.accounts.length > 0) {
          const firstAccountWithLogs = data.accounts.find(acc => acc.hasLogs);
          if (firstAccountWithLogs) {
            setSelectedAccount(firstAccountWithLogs);
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

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  const filteredAccounts = accounts.filter(account => 
    account.connection.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (account.domain && account.domain.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (account.connection.portal_url && account.connection.portal_url.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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

  const getApplicationTypeColor = (type) => {
    switch (type) {
      case 'vos': return 'bg-blue-100 text-blue-800';
      case 'general': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatLogLine = (log) => {
    // Extract timestamp and message
    const timestampMatch = log.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (timestampMatch) {
      const timestamp = timestampMatch[1];
      const message = timestampMatch[2];
      const date = new Date(timestamp);
      const formattedTime = date.toLocaleTimeString();
      
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
    <div className="fixed inset-0 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <div className="absolute inset-0 pt-24 pb-12 px-16">        
        <div className="h-full flex bg-gray-50 dark:bg-gray-900/80 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700/60">
          {/* Left Sidebar - Accounts */}
          <div className="w-80 flex-shrink-0 bg-white dark:bg-gray-800/80 border-r border-gray-200 dark:border-gray-700/60 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center">
              <Server className="w-5 h-5 mr-2" />
              Accounts
            </h2>
            <div className="flex items-center space-x-2">
              <Button
                onClick={toggleAutoRefresh}
                variant="outline"
                size="sm"
                className={autoRefresh ? 'bg-green-50 border-green-200 text-green-700' : ''}
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
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          {lastUpdated && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-500">
                Last updated: {new Date(lastUpdated).toLocaleTimeString()}
              </p>
              {autoRefresh && (
                <div className="flex items-center text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1"></div>
                  <span className="text-xs">Auto-refresh</span>
                </div>
              )}
            </div>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            {filteredAccounts.map((account) => (
              <Card
                key={account.connection.id}
                className={`cursor-pointer transition-all hover:shadow-md backdrop-blur-sm ${
                  selectedAccount?.connection.id === account.connection.id
                    ? 'bg-blue-50/85 border-blue-200 dark:bg-blue-950/85 dark:border-blue-800'
                    : 'bg-card/85 hover:bg-gray-50/85 dark:hover:bg-gray-700/85'
                }`}
                onClick={() => setSelectedAccount(account)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {account.connection.name}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        {getConnectionDisplayHostname(account.connection) || account.domain || 'No domain'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <Badge className={getApplicationTypeColor(account.connection.application_type)}>
                        {account.connection.application_type}
                      </Badge>
                      <div className="flex items-center">
                        {account.hasLogs ? (
                          <div className="flex items-center text-green-600">
                            <FileText className="w-3 h-3 mr-1" />
                            <span className="text-xs">{account.logs.length}</span>
                          </div>
                        ) : (
                          <div className="flex items-center text-gray-400">
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
            <div className="p-4 bg-white dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700/60">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    {selectedAccount.connection.name}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {getConnectionDisplayHostname(selectedAccount.connection) || selectedAccount.domain || 'No domain'} • {selectedAccount.logs.length} log entries
                  </p>
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
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search logs..."
                  value={logSearchTerm}
                  onChange={(e) => setLogSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex-1 bg-black text-green-400 font-mono text-sm overflow-hidden">
              <ScrollArea className="h-full w-full">
                <div className="p-4 pr-6 space-y-1 w-full">
                  {filteredLogs.length > 0 ? (
                    filteredLogs.map((log, index) => {
                      const formatted = formatLogLine(log);
                      return (
                        <div key={index} className="w-full">
                          <div className="flex w-full">
                            <span className="text-gray-500 w-24 flex-shrink-0 whitespace-nowrap pr-2">
                              {formatted.timestamp}
                            </span>
                            <span className="text-gray-600 flex-shrink-0 px-3">
                              -
                            </span>
                            <div className={`flex-1 word-break break-all ${
                              formatted.isError ? 'text-red-400' :
                              formatted.isWarning ? 'text-yellow-400' :
                              formatted.isSuccess ? 'text-green-400' :
                              'text-gray-300'
                            }`}>
                              {formatted.message}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : logSearchTerm ? (
                    <div className="text-gray-500 text-center py-8">
                      No logs match your search term
                    </div>
                  ) : (
                    <div className="text-gray-500 text-center py-8">
                      No logs available for this account
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/60">
            <div className="text-center">
              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Select an Account
              </h3>
              <p className="text-gray-500">
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