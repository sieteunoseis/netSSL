import { useState, useEffect, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronDown, Check, Loader2, Download, Key } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiCall } from "@/lib/api";
import {
  type FieldDefinition,
  iseNodesField,
  altNamesField,
  sslProviderField,
  dnsProviderField,
  iseCsrSourceField,
  iseCsrConfigField,
  iseCertificateField,
  isePrivateKeyField,
  ISE_CSR_API_SUBJECT_DEFAULT,
} from "@/lib/connection-fields";
import { isFieldVisible } from "@/lib/type-profiles";

// ---------------------------------------------------------------------------
// Purpose definitions — mirrors backend getCertificateRoles + getPortsForConnection
// ---------------------------------------------------------------------------

interface ISEPurpose {
  value: string;
  label: string;
  description: string;
  port: number;
  roles: Record<string, boolean>;
}

const ISE_PURPOSES: ISEPurpose[] = [
  {
    value: "admin",
    label: "Admin",
    description: "Server authentication",
    port: 443,
    roles: { admin: true },
  },
  {
    value: "guest",
    label: "Guest Portal",
    description: "Guest self-registration portal",
    port: 8443,
    roles: { portal: true },
  },
  {
    value: "portal",
    label: "Sponsor Portal",
    description: "Sponsor approval portal",
    port: 8445,
    roles: { portal: true },
  },
  {
    value: "eap",
    label: "EAP Authentication",
    description: "RADIUS EAP server auth",
    port: 443,
    roles: { eap: true },
  },
  {
    value: "saml",
    label: "SAML",
    description: "SAML signing certificate",
    port: 443,
    roles: { saml: true },
  },
];

// ---------------------------------------------------------------------------
// Import config JSON generation
// ---------------------------------------------------------------------------

// Build a descriptive certificate name from the selected purposes.
// This is important because ISE uses the name as a key — two certs with the
// same name on the same node will overwrite each other.
function buildCertName(selectedPurposes: Set<string>): string {
  if (selectedPurposes.size === 0) return "netSSL Certificate";
  const labels = Array.from(selectedPurposes)
    .map((v) => ISE_PURPOSES.find((p) => p.value === v)?.label || v)
    .sort();
  return `netSSL ${labels.join(" + ")}`;
}

/**
 * Per-connection portal group tag. Embeds the connection name + purposes so
 * multiple netSSL connections don't collide on the same ISE portal group.
 * Truncated to 80 chars defensively — Cisco ISE's exact cap for this field
 * isn't well-documented and some UIs enforce tighter limits.
 */
function buildPortalGroupTag(
  selectedPurposes: Set<string>,
  connectionName: string,
): string {
  const name = (connectionName || "").trim();
  // Tag reflects portal-relevant purposes only (guest/sponsor). Admin/EAP/SAML don't use it.
  const portalPurposes = ["guest", "portal"].filter((p) =>
    selectedPurposes.has(p),
  );
  const labels = portalPurposes
    .map((v) => ISE_PURPOSES.find((p) => p.value === v)?.label || v)
    .sort();
  // ISE portalGroupTag must match ^[a-zA-Z0-9 ._/-]*$ — no '+' allowed.
  const suffix = labels.length > 0 ? labels.join(" - ") : "Portal";
  const parts = ["netSSL", name, suffix].filter(Boolean);
  const raw = parts.join(" ");
  // Replace any disallowed char with hyphen, collapse runs of hyphens/spaces.
  const sanitized = raw
    .replace(/[^a-zA-Z0-9 ._/-]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim();
  return sanitized.length > 80 ? sanitized.slice(0, 80) : sanitized;
}

function buildImportConfig(
  selectedPurposes: Set<string>,
  connectionName: string,
): string {
  const config: Record<string, any> = {
    admin: false,
    allowExtendedValidity: true,
    allowOutOfDateCert: true,
    allowPortalTagTransferForSameSubject: true,
    allowReplacementOfCertificates: true,
    allowReplacementOfPortalGroupTag: true,
    allowRoleTransferForSameSubject: true,
    allowSHA1Certificates: true,
    allowWildCardCertificates: false,
    eap: false,
    ims: false,
    name: buildCertName(selectedPurposes),
    password: "",
    portal: false,
    pxgrid: false,
    radius: false,
    saml: false,
    validateCertificateExtensions: false,
  };

  for (const purposeValue of selectedPurposes) {
    const purpose = ISE_PURPOSES.find((p) => p.value === purposeValue);
    if (purpose) {
      for (const [key, value] of Object.entries(purpose.roles)) {
        if (value) config[key] = true;
      }
    }
  }

  // Only emit portalGroupTag when portal role is actually active — ISE ignores it otherwise.
  if (config.portal) {
    config.portalGroupTag = buildPortalGroupTag(
      selectedPurposes,
      connectionName,
    );
  }

  // Store the exact selected purposes so we can reconstruct them on re-edit
  // (guest and sponsor both map to portal:true, so the role flags alone are ambiguous)
  config._selectedPurposes = Array.from(selectedPurposes).sort();

  return JSON.stringify(config, null, 2);
}

// Derive ise_application_subtype from the set of selected purposes
function deriveSubtype(selected: Set<string>): string {
  if (selected.size === 0) return "admin";
  if (selected.size === 1) return Array.from(selected)[0];
  return "multi_use";
}

// Derive selected purpose cards from saved data (for edit mode)
function deriveSelectionsFromConfig(
  configJson: string,
  subtype: string,
): Set<string> {
  const selected = new Set<string>();

  // Specific single-purpose subtypes
  if (subtype && subtype !== "multi_use") {
    selected.add(subtype);
    return selected;
  }

  // For multi_use, parse the import config JSON to figure out which roles
  try {
    const config = JSON.parse(configJson);

    // Prefer the explicit selection list (added to disambiguate guest vs sponsor)
    if (Array.isArray(config._selectedPurposes)) {
      for (const p of config._selectedPurposes) {
        selected.add(p);
      }
      return selected;
    }

    // Legacy fallback: derive from role flags (can't distinguish guest vs sponsor)
    if (config.admin) selected.add("admin");
    if (config.eap) selected.add("eap");
    if (config.saml) selected.add("saml");
    if (config.portal) {
      selected.add("guest");
      selected.add("portal");
    }
  } catch {
    // Fallback to the classic multi_use roles
    selected.add("admin");
    selected.add("guest");
    selected.add("eap");
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ISECertificateWizardProps {
  formData: Record<string, string | boolean>;
  errors: Record<string, string>;
  renderField: (field: FieldDefinition) => React.ReactNode;
  onFieldChange: (name: string, value: any) => void;
  onCsrGenerateClick: () => void;
}

const ISECertificateWizard: React.FC<ISECertificateWizardProps> = ({
  formData,
  errors,
  renderField,
  onFieldChange,
  onCsrGenerateClick,
}) => {
  const [isJsonOpen, setIsJsonOpen] = useState(false);
  const [jsonError, setJsonError] = useState("");
  const [isFetchingNodes, setIsFetchingNodes] = useState(false);
  const [fetchError, setFetchError] = useState("");

  // Track selected purposes (multi-select)
  const [selectedPurposes, setSelectedPurposes] = useState<Set<string>>(() => {
    const subtype = String(formData.ise_application_subtype || "multi_use");
    const configJson = String(formData.ise_cert_import_config || "");
    return deriveSelectionsFromConfig(configJson, subtype);
  });

  // Re-seed source-appropriate default purposes whenever the user picks a different source,
  // unless they have already manually toggled purposes (in which case preserve their choices).
  // Initialize true if the saved import config already carries _selectedPurposes — that
  // means an existing edit, so we shouldn't overwrite their choices.
  const userToggledPurposesRef = useRef(
    (() => {
      try {
        const parsed = JSON.parse(
          String(formData.ise_cert_import_config || ""),
        );
        return Array.isArray(parsed._selectedPurposes);
      } catch {
        return false;
      }
    })(),
  );

  // Separate URL state for guest/sponsor portal inputs
  const [guestUrl, setGuestUrl] = useState("");
  const [sponsorUrl, setSponsorUrl] = useState("");

  // Local-CSR mode: CN + key size live in ise_csr_config JSON so no schema change is needed
  const [localCn, setLocalCn] = useState("");
  const [localKeySize, setLocalKeySize] = useState("2048");

  const csrSource = String(formData.ise_csr_source || "");

  // Decoded CSR summary (for source=gui): server-parsed CN/SANs/key info
  interface DecodedCsr {
    commonName: string;
    subject: string;
    sans: string[];
    keyAlgorithm: string;
    keySize: number;
    signatureAlgorithm: string;
  }
  const [decodedCsr, setDecodedCsr] = useState<DecodedCsr | null>(null);
  const [decodingCsr, setDecodingCsr] = useState(false);
  const [decodeError, setDecodeError] = useState("");

  // Debounced decode whenever the pasted or generated CSR changes (gui or local)
  useEffect(() => {
    if (csrSource !== "gui" && csrSource !== "local") {
      setDecodedCsr(null);
      setDecodeError("");
      return;
    }
    const pem = String(formData.ise_certificate || "").trim();
    if (!pem.includes("CERTIFICATE REQUEST")) {
      setDecodedCsr(null);
      setDecodeError("");
      return;
    }

    setDecodingCsr(true);
    setDecodeError("");
    const handle = setTimeout(async () => {
      try {
        const response = await apiCall("/csr/decode", {
          method: "POST",
          body: JSON.stringify({ pem }),
          retries: 0,
        });
        const data = await response.json();
        setDecodedCsr(data);
      } catch (err: any) {
        setDecodedCsr(null);
        setDecodeError(err.details || err.message || "Failed to decode CSR.");
      } finally {
        setDecodingCsr(false);
      }
    }, 400);

    return () => clearTimeout(handle);
  }, [csrSource, formData.ise_certificate]);

  // Hydrate local CSR inputs from ise_csr_config JSON on mount/switch
  useEffect(() => {
    if (csrSource !== "local") return;
    try {
      const cfg = JSON.parse(String(formData.ise_csr_config || "{}"));
      if (typeof cfg.commonName === "string") setLocalCn(cfg.commonName);
      if (typeof cfg.keySize === "string") setLocalKeySize(cfg.keySize);
    } catch {
      // ignore — empty or non-JSON config just leaves defaults in place
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csrSource]);

  const syncLocalCsrConfig = useCallback(
    (cn: string, keySize: string) => {
      onFieldChange(
        "ise_csr_config",
        JSON.stringify({ commonName: cn, keySize }),
      );
    },
    [onFieldChange],
  );

  const handleLocalCnChange = (value: string) => {
    setLocalCn(value);
    syncLocalCsrConfig(value, localKeySize);
  };

  const handleLocalKeySizeChange = (value: string) => {
    setLocalKeySize(value);
    syncLocalCsrConfig(localCn, value);
  };

  const getSourceHint = (): string => {
    switch (csrSource) {
      case "api":
        return "ISE generates the CSR using the first node FQDN as the CN. Private key stays on ISE. Supports auto-renewal.";
      case "gui":
        return "Paste a CSR you generated in the ISE GUI. SANs come from the CSR itself. One-time issuance only — cannot auto-renew.";
      case "local":
        return "netSSL generates the CSR with a custom CN (and any portal URLs / SANs above embedded as Subject Alternative Names) and stores the private key locally. Uses ISE's import API.";
      default:
        return "";
    }
  };

  // Re-shape ise_csr_config when the source changes so the textarea/inputs reflect the right schema.
  // api needs subject defaults (country/state/locality/keySize); local needs {commonName, keySize}.
  // Existing custom configs are preserved (we only rewrite when the shape doesn't match).
  useEffect(() => {
    if (!csrSource) return;

    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(String(formData.ise_csr_config || "{}"));
    } catch {
      cfg = {};
    }

    if (csrSource === "api") {
      const looksLikeApi = typeof cfg.country === "string";
      if (!looksLikeApi) {
        onFieldChange("ise_csr_config", ISE_CSR_API_SUBJECT_DEFAULT);
      }
    } else if (csrSource === "local") {
      const looksLikeLocal = "commonName" in cfg;
      if (!looksLikeLocal) {
        onFieldChange(
          "ise_csr_config",
          JSON.stringify({ commonName: "", keySize: "2048" }),
        );
      }
    }
    // gui doesn't use ise_csr_config
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csrSource]);

  // Apply source-specific default purposes whenever the source changes — unless either
  // (a) this connection has user-customized purposes saved (existing edit), or
  // (b) the user has manually toggled purposes in this session (don't wipe their choices).
  // api → admin + guest + eap + sponsor; gui/local → guest + sponsor.
  useEffect(() => {
    if (!csrSource) return;
    if (userToggledPurposesRef.current) return;

    const defaults =
      csrSource === "api"
        ? new Set(["admin", "guest", "eap", "portal"])
        : new Set(["guest", "portal"]);

    setSelectedPurposes(defaults);
    onFieldChange("ise_application_subtype", deriveSubtype(defaults));
    onFieldChange(
      "ise_cert_import_config",
      buildImportConfig(defaults, String(formData.name || "")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csrSource]);

  // Re-derive the import config (including portalGroupTag) when the connection name
  // changes — but only if the user hasn't customized purposes (preserves their edits).
  useEffect(() => {
    if (userToggledPurposesRef.current) return;
    if (selectedPurposes.size === 0) return;
    onFieldChange(
      "ise_cert_import_config",
      buildImportConfig(selectedPurposes, String(formData.name || "")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.name]);

  // Initialize portal URLs from alt_names on mount
  useEffect(() => {
    const altNames = String(formData.alt_names || "");
    const parts = altNames
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const hasGuest = selectedPurposes.has("guest");
    const hasSponsor = selectedPurposes.has("portal");

    if (hasGuest && hasSponsor) {
      setGuestUrl(parts[0] || "");
      setSponsorUrl(parts[1] || "");
    } else if (hasGuest) {
      setGuestUrl(parts[0] || "");
    } else if (hasSponsor) {
      setSponsorUrl(parts[0] || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync guest/sponsor URLs into the alt_names field
  const syncAltNames = useCallback(
    (guest: string, sponsor: string) => {
      const parts = [guest, sponsor].filter(Boolean);
      onFieldChange("alt_names", parts.join(", "));
    },
    [onFieldChange],
  );

  const handleGuestUrlChange = (value: string) => {
    setGuestUrl(value);
    syncAltNames(value, sponsorUrl);
  };

  const handleSponsorUrlChange = (value: string) => {
    setSponsorUrl(value);
    syncAltNames(guestUrl, value);
  };

  const togglePurpose = useCallback(
    (purposeValue: string) => {
      userToggledPurposesRef.current = true;
      setSelectedPurposes((prev) => {
        const next = new Set(prev);
        if (next.has(purposeValue)) {
          next.delete(purposeValue);
        } else {
          next.add(purposeValue);
        }

        // Update derived fields
        onFieldChange("ise_application_subtype", deriveSubtype(next));
        onFieldChange(
          "ise_cert_import_config",
          buildImportConfig(next, String(formData.name || "")),
        );

        return next;
      });
    },
    [onFieldChange, formData.name],
  );

  // Fetch ISE deployment nodes from the API
  const handleFetchNodes = async () => {
    const hostname = String(formData.hostname || "");
    const username = String(formData.username || "");
    const password = String(formData.password || "");

    if (!hostname || !username || !password) {
      setFetchError(
        "ISE admin node, username, and password are required. Fill in the Authentication tab first.",
      );
      return;
    }

    setIsFetchingNodes(true);
    setFetchError("");

    try {
      const response = await apiCall("/ise/nodes", {
        method: "POST",
        body: JSON.stringify({ hostname, username, password }),
        retries: 0,
      });

      const data = await response.json();
      const fqdns: string[] = data.nodes
        .map((n: { fqdn: string }) => n.fqdn)
        .filter(Boolean);

      if (fqdns.length === 0) {
        setFetchError("No nodes returned from ISE deployment.");
        return;
      }

      onFieldChange("ise_nodes", fqdns.join(", "));
    } catch (error: any) {
      setFetchError(
        error.details || error.message || "Failed to fetch ISE nodes.",
      );
    } finally {
      setIsFetchingNodes(false);
    }
  };

  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    onFieldChange("ise_cert_import_config", value);

    if (value.trim() === "") {
      setJsonError("");
      return;
    }

    try {
      JSON.parse(value);
      setJsonError("");
    } catch {
      setJsonError("Must be valid JSON");
    }
  };

  // Build context message based on current selections
  const getContextMessage = (): string | null => {
    if (selectedPurposes.size === 0)
      return "Select one or more certificate roles above.";

    const parts: string[] = [];
    const ports = new Set<number>();

    for (const value of selectedPurposes) {
      const purpose = ISE_PURPOSES.find((p) => p.value === value);
      if (purpose) {
        parts.push(purpose.label);
        ports.add(purpose.port);
      }
    }

    const portStr = Array.from(ports)
      .sort((a, b) => a - b)
      .map((p) => `:${p}`)
      .join(", ");

    if (selectedPurposes.size === 1) {
      return `${parts[0]} certificate. Monitored on port ${portStr}.`;
    }

    return `Multi-use certificate: ${parts.join(", ")}. Monitored on port${ports.size > 1 ? "s" : ""} ${portStr}.`;
  };

  const sourceHint = getSourceHint();
  const nodesDescription =
    csrSource === "api"
      ? "The first node becomes the certificate CN and is also added as a SAN (modern TLS clients only validate SAN, not CN). All other nodes — plus the Guest/Sponsor portal URLs below — are appended to the SAN list. All listed nodes receive the signed certificate."
      : csrSource === "gui"
        ? "Nodes that receive the signed certificate via bind. The CN comes from the pasted CSR, not this list."
        : csrSource === "local"
          ? "Nodes that receive the signed certificate via import. The CN comes from the field above."
          : "";

  return (
    <div className="space-y-6">
      {/* Section 1: CSR Source — always first */}
      <div className="space-y-1.5">
        {renderField(iseCsrSourceField)}
        {sourceHint && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            {sourceHint}
          </p>
        )}
      </div>

      {/* Everything below is hidden until a CSR source is selected */}
      {csrSource && (
        <>
          {/* Section 2: Certificate Purpose (multi-select) */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              What is this certificate for?
            </Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Select one or more roles. Multiple selections create a multi-use
              certificate.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {ISE_PURPOSES.map((purpose) => {
                const isSelected = selectedPurposes.has(purpose.value);
                return (
                  <button
                    key={purpose.value}
                    type="button"
                    onClick={() => togglePurpose(purpose.value)}
                    className={cn(
                      "relative flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-colors text-left",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2">
                        <Check className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">
                        {purpose.label}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        :{purpose.port}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {purpose.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Context message */}
            {getContextMessage() && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                {getContextMessage()}
              </p>
            )}
          </div>

          {/* Local CSR: CN + key size + Generate button (only when source=local) */}
          {csrSource === "local" && (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <div className="space-y-1.5">
                <Label htmlFor="ise-local-cn" className="text-sm font-medium">
                  Certificate CN
                </Label>
                <Input
                  id="ise-local-cn"
                  type="text"
                  placeholder="e.g., portal.example.com"
                  value={localCn}
                  onChange={(e) => handleLocalCnChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Common Name embedded in the locally-generated CSR. Does not
                  need to match an ISE node FQDN.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ise-local-sans" className="text-sm font-medium">
                  Subject Alternative Names
                </Label>
                <Input
                  id="ise-local-sans"
                  type="text"
                  placeholder="e.g., guest.example.com, sponsor.example.com"
                  value={String(formData.alt_names || "")}
                  onChange={(e) => onFieldChange("alt_names", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated FQDNs embedded as SANs in the generated CSR.
                  The CN is auto-included so you don&apos;t need to repeat it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="ise-local-key-size"
                  className="text-sm font-medium"
                >
                  Key Size
                </Label>
                <select
                  id="ise-local-key-size"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={localKeySize}
                  onChange={(e) => handleLocalKeySizeChange(e.target.value)}
                >
                  <option value="2048">RSA 2048</option>
                  <option value="3072">RSA 3072</option>
                  <option value="4096">RSA 4096</option>
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCsrGenerateClick}
                disabled={!localCn.trim()}
              >
                <Key className="h-3.5 w-3.5 mr-1.5" />
                Generate CSR &amp; Key
              </Button>
              {!localCn.trim() && (
                <p className="text-xs text-muted-foreground">
                  Enter a Certificate CN first.
                </p>
              )}
            </div>
          )}

          {/* For "local" source, hide everything below until a CSR has actually been generated */}
          {(csrSource !== "local" ||
            String(formData.ise_certificate || "").trim()) && (
            <>
              {/* Section 3: ISE Nodes with Fetch button — description swaps per source */}
              <div className="space-y-1.5">
                {renderField({
                  ...iseNodesField,
                  description: nodesDescription || iseNodesField.description,
                })}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFetchNodes}
                    disabled={isFetchingNodes}
                  >
                    {isFetchingNodes ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {isFetchingNodes ? "Fetching..." : "Fetch Nodes from ISE"}
                  </Button>
                  {fetchError && (
                    <span className="text-red-500 text-xs">{fetchError}</span>
                  )}
                </div>
              </div>

              {/* Portal URL inputs — only for api source (ISE generates CSR with node CN + these SANs). For gui/local, SANs come from the CSR. */}
              {csrSource === "api" && selectedPurposes.has("guest") && (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="ise-guest-url"
                    className="text-sm font-medium"
                  >
                    Guest Portal URL
                  </Label>
                  <Input
                    id="ise-guest-url"
                    type="text"
                    placeholder="e.g., guest.example.com"
                    value={guestUrl}
                    onChange={(e) => handleGuestUrlChange(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Guest portal FQDN — added to the certificate SAN and
                    monitored on port 8443.
                  </p>
                </div>
              )}

              {csrSource === "api" && selectedPurposes.has("portal") && (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="ise-sponsor-url"
                    className="text-sm font-medium"
                  >
                    Sponsor Portal URL
                  </Label>
                  <Input
                    id="ise-sponsor-url"
                    type="text"
                    placeholder="e.g., sponsor.example.com"
                    value={sponsorUrl}
                    onChange={(e) => handleSponsorUrlChange(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Sponsor portal FQDN — added to the certificate SAN and
                    monitored on port 8445.
                  </p>
                </div>
              )}

              {/* Section 4: Source-specific inputs (CSR paste / CSR subject JSON) */}
              {csrSource === "api" && renderField(iseCsrConfigField)}
              {(csrSource === "gui" || csrSource === "local") && (
                <div className="space-y-2">
                  {renderField(iseCertificateField)}
                  {csrSource === "local" && renderField(isePrivateKeyField)}
                  {decodingCsr && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Decoding CSR…
                    </p>
                  )}
                  {decodeError && (
                    <p className="text-xs text-red-500">{decodeError}</p>
                  )}
                  {decodedCsr && (
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
                      <div className="font-medium text-sm mb-1">
                        Decoded CSR
                      </div>
                      <div>
                        <span className="text-muted-foreground">CN:</span>{" "}
                        <span className="font-mono">
                          {decodedCsr.commonName || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Subject:</span>{" "}
                        <span className="font-mono">{decodedCsr.subject}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">SANs:</span>{" "}
                        <span className="font-mono">
                          {decodedCsr.sans.length > 0
                            ? decodedCsr.sans.join(", ")
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Key:</span>{" "}
                        <span className="font-mono">
                          {decodedCsr.keyAlgorithm} {decodedCsr.keySize || "?"}
                        </span>
                        <span className="text-muted-foreground"> · sig:</span>{" "}
                        <span className="font-mono">
                          {decodedCsr.signatureAlgorithm}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 5: Additional SANs — only for api. For local, SANs are entered inside the local section. For gui, SANs come from the pasted CSR. */}
              {csrSource === "api" && renderField(altNamesField)}

              {/* Section 6: Certificate Provider */}
              {renderField(sslProviderField)}
              {isFieldVisible(dnsProviderField, formData) &&
                renderField(dnsProviderField)}

              {/* Section 7: Import Configuration JSON (Collapsible) */}
              <Collapsible open={isJsonOpen} onOpenChange={setIsJsonOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      isJsonOpen && "rotate-180",
                    )}
                  />
                  Advanced: Import Configuration JSON
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Auto-generated from the selected roles above. Edit to
                    override role flags or import settings. Changes here take
                    precedence over the role selection.
                  </p>
                  <Textarea
                    name="ise_cert_import_config"
                    value={String(formData.ise_cert_import_config || "")}
                    rows={12}
                    className="font-mono text-xs resize-none"
                    onChange={handleJsonChange}
                  />
                  {(jsonError || errors.ise_cert_import_config) && (
                    <span className="text-red-500 text-sm font-semibold">
                      {jsonError || errors.ise_cert_import_config}
                    </span>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ISECertificateWizard;
