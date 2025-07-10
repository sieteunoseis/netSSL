import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Key, Check, X, Eye, EyeOff } from "lucide-react";
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
  const [settings, setSettings] = useState<Setting[]>([]);
  const [providerSettings, setProviderSettings] = useState<Record<string, ProviderSettings>>({});
  const [loading, setLoading] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  const providers = [
    { id: 'letsencrypt', name: 'Let\'s Encrypt', keys: ['LETSENCRYPT_EMAIL'] },
    { id: 'zerossl', name: 'ZeroSSL', keys: ['ZEROSSL_KEY', 'MXTOOLBOX_KEY'] },
    { id: 'cloudflare', name: 'Cloudflare', keys: ['CF_KEY', 'CF_ZONE'] },
    { id: 'digitalocean', name: 'DigitalOcean', keys: ['DO_KEY'] },
    { id: 'route53', name: 'AWS Route53', keys: ['AWS_ACCESS_KEY', 'AWS_SECRET_KEY', 'AWS_ZONE_ID'] },
    { id: 'azure', name: 'Azure DNS', keys: ['AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'AZURE_ZONE_NAME'] },
    { id: 'google', name: 'Google Cloud DNS', keys: ['GOOGLE_PROJECT_ID', 'GOOGLE_ZONE_NAME'] }
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

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
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
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-none dark:[&::-webkit-scrollbar-track]:bg-gray-800 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600">
        <DialogHeader>
          <DialogTitle>API Keys & Settings</DialogTitle>
          <DialogDescription>
            Configure API keys for SSL and DNS providers
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="configure">Configure</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4">
              {providers.map(provider => {
                const status = getProviderStatus(provider.id);
                return (
                  <Card key={provider.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{provider.name}</CardTitle>
                        <Badge variant={status.configured ? "default" : "secondary"}>
                          {status.configured ? (
                            <><Check className="w-3 h-3 mr-1" /> Configured</>
                          ) : (
                            <><X className="w-3 h-3 mr-1" /> Missing Keys</>
                          )}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Required keys: {provider.keys.join(', ')}
                        </p>
                        {status.missing.length > 0 && (
                          <p className="text-sm text-red-600">
                            Missing: {status.missing.join(', ')}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
          
          <TabsContent value="configure" className="space-y-4">
            <Tabs defaultValue={providers[0].id} orientation="vertical">
              <TabsList className="grid w-full grid-cols-3 lg:grid-cols-7">
                {providers.map(provider => (
                  <TabsTrigger key={provider.id} value={provider.id} className="text-xs">
                    {provider.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              
              {providers.map(provider => (
                <TabsContent key={provider.id} value={provider.id} className="space-y-4">
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
                          <div className="flex space-x-2">
                            <div className="relative flex-1">
                              <Input
                                id={keyName}
                                type={visibleKeys[keyName] ? "text" : "password"}
                                placeholder={`Enter ${keyName}`}
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
            </Tabs>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModal;