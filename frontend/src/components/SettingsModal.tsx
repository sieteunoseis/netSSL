import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Settings,
  Key,
  Check,
  X,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Zap,
} from "lucide-react";
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

interface ProviderConfig {
  id: string;
  name: string;
  keys: string[];
  optionalKeys?: string[];
  description: string;
  keyInfo: Record<string, string>;
  keyDefaults?: Record<string, string>;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ trigger }) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [, setSettings] = useState<Setting[]>([]);
  const [providerSettings, setProviderSettings] = useState<
    Record<string, ProviderSettings>
  >({});
  const [, setLoading] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // Cloudflare zone picker state
  const [cfZones, setCfZones] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [cfFetchingZones, setCfFetchingZones] = useState(false);
  const [cfZonesError, setCfZonesError] = useState("");
  const [cfPendingSelection, setCfPendingSelection] = useState<Set<string>>(
    new Set(),
  );

  const handleRefreshCloudflareZones = async () => {
    const apiKey = providerSettings.cloudflare?.CF_KEY;
    if (!apiKey) {
      toast({
        title: "CF_KEY required",
        description: "Save your CF_KEY first, then click Refresh Zones.",
        variant: "destructive",
      });
      return;
    }
    setCfFetchingZones(true);
    setCfZonesError("");
    try {
      const response = await apiCall("/cloudflare/zones", {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
      const data = await response.json();
      const zones: Array<{ id: string; name: string }> = data.zones || [];
      setCfZones(zones);
      // Pre-check whatever is already saved
      const savedIds = String(providerSettings.cloudflare?.CF_ZONE || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      setCfPendingSelection(new Set(savedIds));
    } catch (err: any) {
      setCfZones([]);
      setCfZonesError(
        err.details || err.message || "Failed to fetch zones from Cloudflare.",
      );
    } finally {
      setCfFetchingZones(false);
    }
  };

  const handleSaveCloudflareZoneSelection = async () => {
    const ids = Array.from(cfPendingSelection);
    const map: Record<string, string> = {};
    for (const z of cfZones) {
      if (cfPendingSelection.has(z.id)) map[z.id] = z.name;
    }
    try {
      await apiCall("/settings", {
        method: "POST",
        body: JSON.stringify({
          key_name: "CF_ZONE",
          key_value: ids.join(","),
          provider: "cloudflare",
          description: "Cloudflare configuration",
        }),
      });
      await apiCall("/settings", {
        method: "POST",
        body: JSON.stringify({
          key_name: "CF_ZONE_MAP",
          key_value: JSON.stringify(map),
          provider: "cloudflare",
          description: "Cloudflare configuration",
        }),
      });
      setProviderSettings((prev) => ({
        ...prev,
        cloudflare: {
          ...prev.cloudflare,
          CF_ZONE: ids.join(","),
          CF_ZONE_MAP: JSON.stringify(map),
        },
      }));
      toast({
        title: "Zones saved",
        description: `${ids.length} zone${ids.length === 1 ? "" : "s"} selected.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to save zones",
        description: err.message || "",
        variant: "destructive",
      });
    }
  };

  const providers: ProviderConfig[] = [
    {
      id: "letsencrypt",
      name: "Let's Encrypt",
      keys: ["LETSENCRYPT_EMAIL"],
      description: "Free SSL certificate provider",
      keyInfo: {
        LETSENCRYPT_EMAIL:
          "Email for account registration and renewal notifications",
      },
    },
    {
      id: "zerossl",
      name: "ZeroSSL",
      keys: ["ZEROSSL_KEY", "MXTOOLBOX_KEY"],
      description:
        "SSL certificate provider with DNS verification via MXTOOLBOX",
      keyInfo: {
        ZEROSSL_KEY: "API key from ZeroSSL Dashboard > Developer > API Keys",
        MXTOOLBOX_KEY: "API key from MXTOOLBOX for DNS record verification",
      },
    },
    {
      id: "cloudflare",
      name: "Cloudflare",
      keys: ["CF_KEY", "CF_ZONE", "CF_ZONE_MAP"],
      optionalKeys: ["CF_ZONE_MAP"],
      description: "DNS provider for automatic DNS validation",
      keyInfo: {
        CF_KEY:
          "Global API Key from My Profile > API Tokens (or a scoped API Token with Zone:Read + DNS:Edit)",
        CF_ZONE:
          "Comma-separated zone IDs. Use Refresh Zones below to fetch and pick from your account.",
        CF_ZONE_MAP:
          "Auto-managed: JSON map of zone ID → name, used to pick the right zone for each domain.",
      },
    },
    {
      id: "digitalocean",
      name: "DigitalOcean",
      keys: ["DO_KEY"],
      description: "DNS provider for automatic DNS validation",
      keyInfo: {
        DO_KEY: "Personal Access Token from API > Generate New Token",
      },
    },
    {
      id: "route53",
      name: "AWS Route53",
      keys: ["AWS_ACCESS_KEY", "AWS_SECRET_KEY", "AWS_ZONE_ID", "AWS_ENDPOINT"],
      optionalKeys: ["AWS_ENDPOINT"],
      description: "DNS provider for automatic DNS validation",
      keyInfo: {
        AWS_ACCESS_KEY: "IAM user access key with Route53 permissions",
        AWS_SECRET_KEY: "Secret access key for the IAM user",
        AWS_ZONE_ID: "Hosted zone ID from Route53 console",
        AWS_ENDPOINT:
          "Optional: custom endpoint URL (e.g., http://localhost:4566 for LocalStack)",
      },
    },
    {
      id: "azure",
      name: "Azure DNS",
      keys: [
        "AZURE_SUBSCRIPTION_ID",
        "AZURE_RESOURCE_GROUP",
        "AZURE_ZONE_NAME",
      ],
      description: "DNS provider for automatic DNS validation",
      keyInfo: {
        AZURE_SUBSCRIPTION_ID: "Azure subscription containing DNS zones",
        AZURE_RESOURCE_GROUP: "Resource group containing DNS zone",
        AZURE_ZONE_NAME: "DNS zone name (e.g., example.com)",
      },
    },
    {
      id: "google",
      name: "Google Cloud DNS",
      keys: ["GOOGLE_PROJECT_ID", "GOOGLE_ZONE_NAME"],
      description: "DNS provider for automatic DNS validation",
      keyInfo: {
        GOOGLE_PROJECT_ID: "GCP project ID containing Cloud DNS zones",
        GOOGLE_ZONE_NAME: "Cloud DNS zone name",
      },
    },
    {
      id: "custom",
      name: "Custom DNS",
      keys: ["CUSTOM_DNS_SERVER_1", "CUSTOM_DNS_SERVER_2"],
      description: "Manual DNS configuration for custom setups",
      keyInfo: {
        CUSTOM_DNS_SERVER_1: "Primary DNS server IP address",
        CUSTOM_DNS_SERVER_2: "Secondary DNS server IP address (optional)",
      },
    },
  ];

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await apiCall("/settings");
      const data = await response.json();
      setSettings(data);

      // Fetch individual provider settings
      const providerData: Record<string, ProviderSettings> = {};
      for (const provider of providers) {
        const providerResponse = await apiCall(`/settings/${provider.id}`);
        const providerKeys = await providerResponse.json();
        providerData[provider.id] = providerKeys.reduce(
          (acc: ProviderSettings, key: any) => {
            acc[key.key_name] = key.key_value;
            return acc;
          },
          {},
        );
      }
      setProviderSettings(providerData);
    } catch (error) {
      console.error("Error fetching settings:", error);
      toast({
        title: "Error",
        description: "Failed to fetch settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSetting = async (
    providerId: string,
    keyName: string,
    value: string,
  ) => {
    try {
      const provider = providers.find((p) => p.id === providerId);
      const description = `${provider?.name} configuration`;

      await apiCall("/settings", {
        method: "POST",
        body: JSON.stringify({
          key_name: keyName,
          key_value: value,
          provider: providerId,
          description,
        }),
      });

      setProviderSettings((prev) => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          [keyName]: value,
        },
      }));

      toast({
        title: "Success",
        description: `${keyName} saved successfully`,
      });
    } catch (error) {
      console.error("Error saving setting:", error);
      toast({
        title: "Error",
        description: "Failed to save setting",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSetting = async (keyName: string) => {
    try {
      await apiCall(`/settings/${keyName}`, { method: "DELETE" });

      // Remove from local state
      setProviderSettings((prev) => {
        const newState = { ...prev };
        Object.keys(newState).forEach((provider) => {
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
      console.error("Error deleting setting:", error);
      toast({
        title: "Error",
        description: "Failed to delete setting",
        variant: "destructive",
      });
    }
  };

  const getProviderStatus = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return { configured: false, missing: [] };

    const providerData = providerSettings[providerId] || {};
    const optionalKeys = provider.optionalKeys || [];
    const missing = provider.keys.filter((key) => !providerData[key]);
    // Only required (non-optional) missing keys affect "configured" status
    const requiredMissing = missing.filter(
      (key) => !optionalKeys.includes(key),
    );

    return {
      configured: requiredMissing.length === 0,
      missing,
    };
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      const response = await apiCall(`/settings/${providerId}/test`, {
        method: "POST",
      });
      const data = await response.json();
      toast({
        title: data.success ? "Connection OK" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Test Failed",
        description: "Could not reach the server",
        variant: "destructive",
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const toggleVisibility = (keyName: string) => {
    setVisibleKeys((prev) => ({
      ...prev,
      [keyName]: !prev[keyName],
    }));
  };

  const checkScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } =
        scrollContainerRef.current;
      setShowLeftScroll(scrollLeft > 0);
      setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  const scrollTabs = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
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
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] !flex !flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>API Keys & Settings</DialogTitle>
            <DialogDescription>
              Configure API keys for SSL and DNS providers
            </DialogDescription>
          </DialogHeader>

          <div className="w-full flex flex-col flex-1 min-h-0 mt-2">
            <Tabs
              defaultValue={providers[0].id}
              orientation="vertical"
              className="flex flex-col flex-1 min-h-0"
            >
              <div className="relative group">
                {/* Left scroll button */}
                {showLeftScroll && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 bg-background/80 backdrop-blur-sm hover:bg-background"
                    onClick={() => scrollTabs("left")}
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
                  <TabsList className="inline-flex h-10 items-center justify-start gap-2 w-max">
                    {providers.map((provider) => {
                      const status = getProviderStatus(provider.id);
                      return (
                        <TabsTrigger
                          key={provider.id}
                          value={provider.id}
                          className="gap-1.5"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status.configured ? "bg-status-valid" : "bg-muted-foreground/40"}`}
                          />
                          {provider.name}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>

                {/* Right scroll button */}
                {showRightScroll && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 bg-background/80 backdrop-blur-sm hover:bg-background"
                    onClick={() => scrollTabs("right")}
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

              <div className="flex-1 overflow-y-auto min-h-0 pt-4">
                {providers.map((provider) => {
                  const status = getProviderStatus(provider.id);
                  return (
                    <TabsContent
                      key={provider.id}
                      value={provider.id}
                      className="space-y-4 mt-0"
                    >
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <Key className="w-4 h-4" />
                              <span>{provider.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {status.configured && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs"
                                  disabled={testingProvider === provider.id}
                                  onClick={() =>
                                    handleTestConnection(provider.id)
                                  }
                                >
                                  {testingProvider === provider.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <>
                                      <Zap className="w-3 h-3 mr-1" />
                                      Test
                                    </>
                                  )}
                                </Button>
                              )}
                              <Badge
                                variant={
                                  status.configured ? "success" : "secondary"
                                }
                                className="text-xs"
                              >
                                {status.configured ? (
                                  <>
                                    <Check className="w-3 h-3 mr-1" />{" "}
                                    Configured
                                  </>
                                ) : (
                                  <>
                                    <X className="w-3 h-3 mr-1" /> Not Set
                                  </>
                                )}
                              </Badge>
                            </div>
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {provider.description}
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {provider.keys
                            .filter(
                              (k) =>
                                !(
                                  provider.id === "cloudflare" &&
                                  (k === "CF_ZONE" || k === "CF_ZONE_MAP")
                                ),
                            )
                            .map((keyName) => (
                              <div key={keyName} className="space-y-2">
                                <Label
                                  htmlFor={keyName}
                                  className="font-mono text-xs"
                                >
                                  {keyName}
                                </Label>
                                {provider.keyInfo?.[keyName] && (
                                  <p className="text-xs text-muted-foreground">
                                    {provider.keyInfo[keyName] || ""}
                                  </p>
                                )}
                                <div className="flex space-x-2">
                                  <div className="relative flex-1">
                                    <Input
                                      id={keyName}
                                      type={
                                        visibleKeys[keyName]
                                          ? "text"
                                          : "password"
                                      }
                                      placeholder={
                                        (provider.keyDefaults &&
                                          provider.keyDefaults[keyName]) ||
                                        `Enter ${keyName}`
                                      }
                                      value={
                                        providerSettings[provider.id]?.[
                                          keyName
                                        ] || ""
                                      }
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        setProviderSettings((prev) => ({
                                          ...prev,
                                          [provider.id]: {
                                            ...prev[provider.id],
                                            [keyName]: value,
                                          },
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
                                    onClick={() =>
                                      handleSaveSetting(
                                        provider.id,
                                        keyName,
                                        providerSettings[provider.id]?.[
                                          keyName
                                        ] || "",
                                      )
                                    }
                                    disabled={
                                      !providerSettings[provider.id]?.[keyName]
                                    }
                                  >
                                    Save
                                  </Button>
                                  {providerSettings[provider.id]?.[keyName] && (
                                    <Button
                                      variant="destructive"
                                      onClick={() =>
                                        handleDeleteSetting(keyName)
                                      }
                                    >
                                      Delete
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}

                          {provider.id === "cloudflare" && (
                            <div className="space-y-2 rounded-md border border-dashed p-3">
                              <div className="flex items-center justify-between">
                                <Label className="font-mono text-xs">
                                  CF_ZONE — Managed Zones
                                </Label>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={handleRefreshCloudflareZones}
                                  disabled={
                                    cfFetchingZones ||
                                    !providerSettings.cloudflare?.CF_KEY
                                  }
                                >
                                  {cfFetchingZones ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                  ) : null}
                                  {cfFetchingZones
                                    ? "Fetching…"
                                    : "Refresh Zones"}
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Click Refresh Zones to fetch every zone your
                                CF_KEY can access. Tick the ones netSSL should
                                manage; the saved selection drives DNS-01
                                challenges. If you add a new zone in Cloudflare,
                                click Refresh again.
                              </p>
                              {cfZonesError && (
                                <p className="text-xs text-red-500">
                                  {cfZonesError}
                                </p>
                              )}
                              {cfZones.length > 0 && (
                                <>
                                  <div className="max-h-48 overflow-y-auto rounded border bg-background/30">
                                    {cfZones.map((z) => {
                                      const checked = cfPendingSelection.has(
                                        z.id,
                                      );
                                      return (
                                        <label
                                          key={z.id}
                                          className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/40 cursor-pointer"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              setCfPendingSelection((prev) => {
                                                const next = new Set(prev);
                                                if (e.target.checked)
                                                  next.add(z.id);
                                                else next.delete(z.id);
                                                return next;
                                              });
                                            }}
                                          />
                                          <span className="font-mono">
                                            {z.name}
                                          </span>
                                          <span className="text-muted-foreground ml-auto truncate">
                                            {z.id}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">
                                      {cfPendingSelection.size} of{" "}
                                      {cfZones.length} selected
                                    </span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={
                                        handleSaveCloudflareZoneSelection
                                      }
                                    >
                                      Save Selection
                                    </Button>
                                  </div>
                                </>
                              )}
                              {cfZones.length === 0 &&
                                providerSettings.cloudflare?.CF_ZONE && (
                                  <p className="text-xs text-muted-foreground">
                                    Currently saved:{" "}
                                    <span className="font-mono">
                                      {providerSettings.cloudflare.CF_ZONE}
                                    </span>
                                  </p>
                                )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>
                  );
                })}
              </div>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SettingsModal;
