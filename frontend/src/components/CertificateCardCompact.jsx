import { useState } from 'react';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Shield, Clock, AlertCircle, CheckCircle, ChevronDown,
  RefreshCw, Download, Upload, ExternalLink, Settings,
  Server, Globe, Key, Calendar, Info, Activity, Zap, Wifi
} from "lucide-react";

const CertificateCardCompact = ({ connection, certInfo }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Mock data for demonstration
  const status = certInfo?.isValid ? 'valid' : 'expired';
  const daysUntilExpiry = certInfo?.daysUntilExpiry || 0;
  
  const getStatusDetails = () => {
    if (status === 'expired') {
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        color: 'destructive',
        text: 'Expired'
      };
    }
    if (daysUntilExpiry <= 7) {
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        color: 'destructive',
        text: `Expires in ${daysUntilExpiry} days`
      };
    }
    if (daysUntilExpiry <= 30) {
      return {
        icon: <Clock className="h-4 w-4" />,
        color: 'warning',
        text: `Expires in ${daysUntilExpiry} days`
      };
    }
    return {
      icon: <CheckCircle className="h-4 w-4" />,
      color: 'success',
      text: `Valid for ${daysUntilExpiry} days`
    };
  };

  const statusDetails = getStatusDetails();

  return (
    <Card className="overflow-hidden">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-4 flex-1">
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{connection.name}</h3>
                    <Badge variant="outline" className="text-xs rounded-[4px]">
                      {connection.application_type}
                    </Badge>
                    {connection.auto_renew && (
                      <Badge variant="secondary" className="text-xs rounded-[4px]">
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Auto-renew
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{connection.hostname}.{connection.domain}</span>
                    <span>•</span>
                    <span>{connection.ssl_provider}</span>
                    <span>•</span>
                    <span>{connection.dns_provider}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Badge variant={statusDetails.color} className="flex items-center gap-1 rounded-[4px]">
                    {statusDetails.icon}
                    <span>{statusDetails.text}</span>
                  </Badge>
                  
                  <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-6 h-9">
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
                <TabsTrigger value="actions" className="text-xs">
                  <Activity className="h-3 w-3 mr-1" />
                  Actions
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs">
                  <Clock className="h-3 w-3 mr-1" />
                  History
                </TabsTrigger>
                <TabsTrigger value="settings" className="text-xs">
                  <Settings className="h-3 w-3 mr-1" />
                  Settings
                </TabsTrigger>
              </TabsList>
              
              <div className="mt-4">
                <TabsContent value="overview" className="mt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Status</p>
                      <div className="flex items-center gap-1">
                        {statusDetails.icon}
                        <span className="text-sm font-medium">{status}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Expires</p>
                      <p className="text-sm font-medium">{certInfo?.validTo || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Issuer</p>
                      <p className="text-sm font-medium">{certInfo?.issuer || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Last Renewed</p>
                      <p className="text-sm font-medium">{connection.last_renewal || 'Never'}</p>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="certificate" className="mt-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Subject</p>
                        <p className="text-sm font-mono">{certInfo?.subject || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Serial Number</p>
                        <p className="text-sm font-mono">{certInfo?.serialNumber || 'N/A'}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Algorithm</p>
                        <p className="text-sm">{certInfo?.algorithm || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Key Size</p>
                        <p className="text-sm">{certInfo?.keySize || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="performance" className="mt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">DNS Resolve</p>
                      <div className="flex items-center gap-1">
                        <Wifi className="h-3 w-3 text-blue-500" />
                        <span className="text-sm font-medium">{certInfo?.timings?.dnsResolve || '--'}ms</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">TCP Connect</p>
                      <div className="flex items-center gap-1">
                        <Activity className="h-3 w-3 text-green-500" />
                        <span className="text-sm font-medium">{certInfo?.timings?.tcpConnect || '--'}ms</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">TLS Handshake</p>
                      <div className="flex items-center gap-1">
                        <Shield className="h-3 w-3 text-orange-500" />
                        <span className="text-sm font-medium">{certInfo?.timings?.tlsHandshake || '--'}ms</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Total Time</p>
                      <div className="flex items-center gap-1">
                        <Zap className="h-3 w-3 text-purple-500" />
                        <span className="text-sm font-medium">{certInfo?.timings?.totalTime || '--'}ms</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-muted/50 rounded-md">
                    <p className="text-xs text-muted-foreground mb-2">Performance Grade</p>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const totalTime = certInfo?.timings?.totalTime || 0;
                        if (totalTime === 0) return <Badge variant="secondary" className="rounded-[4px]">No Data</Badge>;
                        if (totalTime < 500) return <Badge className="bg-green-500 rounded-[4px]">Excellent</Badge>;
                        if (totalTime < 1000) return <Badge className="bg-blue-500 rounded-[4px]">Good</Badge>;
                        if (totalTime < 2000) return <Badge className="bg-yellow-500 rounded-[4px]">Fair</Badge>;
                        return <Badge className="bg-red-500 rounded-[4px]">Poor</Badge>;
                      })()}
                      <span className="text-xs text-muted-foreground">
                        Last checked: {new Date().toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="actions" className="mt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Button size="sm" variant="outline" className="justify-start">
                      <RefreshCw className="mr-2 h-3 w-3" />
                      Renew
                    </Button>
                    <Button size="sm" variant="outline" className="justify-start">
                      <Download className="mr-2 h-3 w-3" />
                      Download
                    </Button>
                    <Button size="sm" variant="outline" className="justify-start">
                      <Upload className="mr-2 h-3 w-3" />
                      Import
                    </Button>
                    <Button size="sm" variant="outline" className="justify-start">
                      <ExternalLink className="mr-2 h-3 w-3" />
                      View
                    </Button>
                  </div>
                </TabsContent>
                
                <TabsContent value="history" className="mt-0">
                  <div className="space-y-2">
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">Last renewal attempt</p>
                      <p>{connection.auto_renew_last_attempt || 'No attempts yet'}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">Status</p>
                      <p>{connection.auto_renew_status || 'N/A'}</p>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="settings" className="mt-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <span className="text-sm">Auto-renewal</span>
                      <Badge variant={connection.auto_renew ? "default" : "secondary"} className="text-xs rounded-[4px]">
                        {connection.auto_renew ? "On" : "Off"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <span className="text-sm">SSH Access</span>
                      <Badge variant={connection.enable_ssh ? "default" : "secondary"} className="text-xs rounded-[4px]">
                        {connection.enable_ssh ? "On" : "Off"}
                      </Badge>
                    </div>
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

export default CertificateCardCompact;