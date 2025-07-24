import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Settings, Key, Check, X, Eye, EyeOff, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiCall } from "@/lib/api";

interface SettingsModalProps {
  trigger?: React.ReactNode;
}

interface Setting {
  key_name: string;
  provider: string;
  description?: string;
  has_value: boolean;
}

interface ProviderSettings {
  [key: string]: string;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ trigger }) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [, setSettings] = useState<Setting[]>([]);
  const [providerSettings, setProviderSettings] = useState<Record<string, ProviderSettings>>({});
  const [, setLoading] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const providers = [
    {
      id: 'renewal',
      name: 'Certificate Renewal',
      keys: ['CERT_RENEWAL_DAYS', 'CERT_WARNING_DAYS', 'CERT_CHECK_SCHEDULE'],
      description: 'Automatic certificate renewal settings',
      keyInfo: {
        'CERT_RENEWAL_DAYS': 'Number of days before certificate expiration to automatically renew (e.g., 7 = renew when 7 days left)',
        'CERT_WARNING_DAYS': 'Number of days before expiration to display warning in UI (e.g., 30 = warn when 30 days left)',
        'CERT_CHECK_SCHEDULE': 'Cron expression for when to check certificates (e.g., "0 0 * * *" = daily at midnight, "0 2 * * *" = daily at 2 AM)'
      },
      keyDefaults: {
        'CERT_RENEWAL_DAYS': '7',
        'CERT_WARNING_DAYS': '30',
        'CERT_CHECK_SCHEDULE': '0 0 * * *'
      }
    },
    { 
      id: 'letsencrypt', 
      name: 'Let\'s Encrypt', 
      keys: ['LETSENCRYPT_EMAIL'],
      description: 'Free SSL certificate provider',
      keyInfo: {
        'LETSENCRYPT_EMAIL': 'Email for account registration and renewal notifications'
      }
    },
    { 
      id: 'zerossl', 
      name: 'ZeroSSL', 
      keys: ['ZEROSSL_KEY', 'MXTOOLBOX_KEY'],
      description: 'SSL certificate provider with DNS verification via MXTOOLBOX',
      keyInfo: {
        'ZEROSSL_KEY': 'API key from ZeroSSL Dashboard > Developer > API Keys',
        'MXTOOLBOX_KEY': 'API key from MXTOOLBOX for DNS record verification'
      }
    },
    { 
      id: 'cloudflare', 
      name: 'Cloudflare', 
      keys: ['CF_KEY', 'CF_ZONE'],
      description: 'DNS provider for automatic DNS validation',
      keyInfo: {
        'CF_KEY': 'Global API Key from My Profile > API Tokens',
        'CF_ZONE': 'Zone ID from domain overview page'
      }
    },
    { 
      id: 'digitalocean', 
      name: 'DigitalOcean', 
      keys: ['DO_KEY'],
      description: 'DNS provider for automatic DNS validation',
      keyInfo: {
        'DO_KEY': 'Personal Access Token from API > Generate New Token'
      }
    },
    { 
      id: 'route53', 
      name: 'AWS Route53', 
      keys: ['AWS_ACCESS_KEY', 'AWS_SECRET_KEY', 'AWS_ZONE_ID'],
      description: 'DNS provider for automatic DNS validation',
      keyInfo: {
        'AWS_ACCESS_KEY': 'IAM user access key with Route53 permissions',
        'AWS_SECRET_KEY': 'Secret access key for the IAM user',
        'AWS_ZONE_ID': 'Hosted zone ID from Route53 console'
      }
    },
    { 
      id: 'azure', 
      name: 'Azure DNS', 
      keys: ['AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_ZONE_NAME'],
      description: 'DNS provider for automatic DNS validation',
      keyInfo: {
        'AZURE_SUBSCRIPTION_ID': 'Azure subscription containing DNS zones',
        'AZURE_RESOURCE_GROUP': 'Resource group containing DNS zone',
        'AZURE_ZONE_NAME': 'DNS zone name (e.g., example.com)'
      }
    },
    { 
      id: 'google', 
      name: 'Google Cloud DNS', 
      keys: ['GOOGLE_PROJECT_ID', 'GOOGLE_ZONE_NAME'],
      description: 'DNS provider for automatic DNS validation',
      keyInfo: {
        'GOOGLE_PROJECT_ID': 'GCP project ID containing Cloud DNS zones',
        'GOOGLE_ZONE_NAME': 'Cloud DNS zone name'
      }
    },
    { 
      id: 'custom', 
      name: 'Custom DNS', 
      keys: ['CUSTOM_DNS_SERVER_1', 'CUSTOM_DNS_SERVER_2'],
      description: 'Manual DNS configuration for custom setups',
      keyInfo: {
        'CUSTOM_DNS_SERVER_1': 'Primary DNS server IP address',
        'CUSTOM_DNS_SERVER_2': 'Secondary DNS server IP address (optional)'
      }
    }
  ];

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await apiCall('/settings');
      const data = await response.json();
      setSettings(data);

      // Fetch individual provider settings
      const providerData: Record<string, ProviderSettings> = {};
      for (const provider of providers) {
        const providerResponse = await apiCall(`/settings/${provider.id}`);
        const providerKeys = await providerResponse.json();
        providerData[provider.id] = providerKeys.reduce((acc: ProviderSettings, key: any) => {
          acc[key.key_name] = key.key_value;
          return acc;
        }, {});
      }
      setProviderSettings(providerData);
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast({
        title: "Error",
        description: "Failed to fetch settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSetting = async (providerId: string, keyName: string, value: string) => {
    try {
      const provider = providers.find(p => p.id === providerId);
      const description = `${provider?.name} configuration`;
      
      await apiCall('/settings', {
        method: 'POST',
        body: JSON.stringify({
          key_name: keyName,
          key_value: value,
          provider: providerId,
          description
        })
      });

      setProviderSettings(prev => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          [keyName]: value
        }
      }));

      toast({
        title: "Success",
        description: `${keyName} saved successfully`,
      });
    } catch (error) {
      console.error('Error saving setting:', error);
      toast({
        title: "Error",
        description: "Failed to save setting",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSetting = async (keyName: string) => {
    try {
      await apiCall(`/settings/${keyName}`, { method: 'DELETE' });
      
      // Remove from local state
      setProviderSettings(prev => {
        const newState = { ...prev };
        Object.keys(newState).forEach(provider => {
          if (newState[provider][keyName]) {
            delete newState[provider][keyName];
          }
        });
        return newState;
      });

      toast({
        title: "Success",
        description: `${keyName} deleted successfully`,
      });
    } catch (error) {
      console.error('Error deleting setting:', error);
      toast({
        title: "Error",
        description: "Failed to delete setting",
        variant: "destructive",
      });
    }
  };

  const getProviderStatus = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return { configured: false, missing: [] };
    
    const providerData = providerSettings[providerId] || {};
    const missing = provider.keys.filter(key => !providerData[key]);
    
    return {
      configured: missing.length === 0,
      missing
    };
  };

  const toggleVisibility = (keyName: string) => {
    setVisibleKeys(prev => ({
      ...prev,
      [keyName]: !prev[keyName]
    }));
  };

  const checkScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setShowLeftScroll(scrollLeft > 0);
      setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  const scrollTabs = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200;
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      // Check scroll on open
      setTimeout(checkScroll, 100);
    }
  }, [isOpen]);

  const defaultTrigger = (
    <Button variant="outline" className="flex items-center space-x-2">
      <Settings className="w-4 h-4" />
      <span>Settings</span>
    </Button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>API Keys & Settings</DialogTitle>
          <DialogDescription>
            Configure API keys for SSL and DNS providers
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="w-full flex flex-col flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="configure">Configure</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-2 flex-1 overflow-y-auto">
            <Accordion type="single" collapsible className="w-full">
              {providers.map(provider => {
                const status = getProviderStatus(provider.id);
                return (
                  <AccordionItem key={provider.id} value={provider.id}>
                    <AccordionTrigger className="py-2 hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-2">
                        <span className="text-sm font-medium">{provider.name}</span>
                        <Badge variant={status.configured ? "default" : "secondary"} className="ml-2">
                          {status.configured ? (
                            <><Check className="w-3 h-3 mr-1" /> Configured</>
                          ) : (
                            <><X className="w-3 h-3 mr-1" /> Not Configured</>
                          )}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="text-sm text-muted-foreground space-y-3">
                        <p className="text-xs">{provider.description}</p>
                        
                        <div>
                          <p className="font-medium text-foreground mb-2">Required Keys:</p>
                          <div className="space-y-2">
                            {provider.keys.map(key => (
                              <div key={key} className="bg-muted/50 p-2 rounded">
                                <code className="text-xs font-mono text-foreground">{key}</code>
                                <p className="text-xs mt-1">{provider.keyInfo[key]}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        
                        {status.missing.length > 0 && (
                          <p className="text-red-600 font-medium">Missing: {status.missing.join(', ')}</p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </TabsContent>
          
          <TabsContent value="configure" className="space-y-4 flex-1 flex flex-col">
            <Tabs defaultValue={providers[0].id} orientation="vertical" className="flex flex-col flex-1">
              <div className="relative group">
                {/* Left scroll button */}
                {showLeftScroll && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 bg-background/80 backdrop-blur-sm hover:bg-background"
                    onClick={() => scrollTabs('left')}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                
                {/* Scrollable tabs container */}
                <div 
                  ref={scrollContainerRef}
                  onScroll={checkScroll}
                  className="overflow-x-auto scrollbar-hide"
                >
                  <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground w-max">
                    {providers.map(provider => (
                      <TabsTrigger 
                        key={provider.id} 
                        value={provider.id} 
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                      >
                        {provider.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                
                {/* Right scroll button */}
                {showRightScroll && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 bg-background/80 backdrop-blur-sm hover:bg-background"
                    onClick={() => scrollTabs('right')}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                
                {/* Gradient fade indicators */}
                {showLeftScroll && (
                  <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background via-background/50 to-transparent" />
                )}
                {showRightScroll && (
                  <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background via-background/50 to-transparent" />
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto">
              {providers.map(provider => (
                <TabsContent key={provider.id} value={provider.id} className="space-y-4 mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center space-x-2">
                        <Key className="w-4 h-4" />
                        <span>{provider.name} Configuration</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {provider.keys.map(keyName => (
                        <div key={keyName} className="space-y-2">
                          <Label htmlFor={keyName}>{keyName}</Label>
                          {provider.keyInfo?.[keyName] && (
                            <p className="text-xs text-muted-foreground">{provider.keyInfo[keyName]}</p>
                          )}
                          <div className="flex space-x-2">
                            <div className="relative flex-1">
                              <Input
                                id={keyName}
                                type={visibleKeys[keyName] ? "text" : "password"}
                                placeholder={provider.keyDefaults?.[keyName] || `Enter ${keyName}`}
                                value={providerSettings[provider.id]?.[keyName] || ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setProviderSettings(prev => ({
                                    ...prev,
                                    [provider.id]: {
                                      ...prev[provider.id],
                                      [keyName]: value
                                    }
                                  }));
                                }}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                onClick={() => toggleVisibility(keyName)}
                              >
                                {visibleKeys[keyName] ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <Button
                              onClick={() => handleSaveSetting(provider.id, keyName, providerSettings[provider.id]?.[keyName] || '')}
                              disabled={!providerSettings[provider.id]?.[keyName]}
                            >
                              Save
                            </Button>
                            {providerSettings[provider.id]?.[keyName] && (
                              <Button
                                variant="destructive"
                                onClick={() => handleDeleteSetting(keyName)}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
              </div>
            </Tabs>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModal;