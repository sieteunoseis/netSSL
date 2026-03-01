import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { ChevronDown, Check, Loader2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiCall } from '@/lib/api';
import {
  type FieldDefinition,
  iseNodesField,
  altNamesField,
  sslProviderField,
  dnsProviderField,
  iseCsrSourceField,
  iseCsrConfigField,
  iseCertificateField,
} from '@/lib/connection-fields';
import { isFieldVisible } from '@/lib/type-profiles';

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
    value: 'admin',
    label: 'Admin',
    description: 'Server authentication',
    port: 443,
    roles: { admin: true },
  },
  {
    value: 'guest',
    label: 'Guest Portal',
    description: 'Guest self-registration portal',
    port: 8443,
    roles: { portal: true },
  },
  {
    value: 'portal',
    label: 'Sponsor Portal',
    description: 'Sponsor approval portal',
    port: 8445,
    roles: { portal: true },
  },
  {
    value: 'eap',
    label: 'EAP Authentication',
    description: 'RADIUS EAP server auth',
    port: 443,
    roles: { eap: true },
  },
  {
    value: 'saml',
    label: 'SAML',
    description: 'SAML signing certificate',
    port: 443,
    roles: { saml: true },
  },
];

// ---------------------------------------------------------------------------
// Import config JSON generation
// ---------------------------------------------------------------------------

function buildImportConfig(selectedPurposes: Set<string>): string {
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
    name: 'netSSL Imported Certificate',
    password: '',
    portal: false,
    portalGroupTag: 'My Default Portal Certificate Group',
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

  return JSON.stringify(config, null, 2);
}

// Derive ise_application_subtype from the set of selected purposes
function deriveSubtype(selected: Set<string>): string {
  if (selected.size === 0) return 'admin';
  if (selected.size === 1) return Array.from(selected)[0];
  return 'multi_use';
}

// Derive selected purpose cards from saved data (for edit mode)
function deriveSelectionsFromConfig(
  configJson: string,
  subtype: string
): Set<string> {
  const selected = new Set<string>();

  // Specific single-purpose subtypes
  if (subtype && subtype !== 'multi_use') {
    selected.add(subtype);
    return selected;
  }

  // For multi_use, parse the import config JSON to figure out which roles
  try {
    const config = JSON.parse(configJson);
    if (config.admin) selected.add('admin');
    if (config.eap) selected.add('eap');
    if (config.saml) selected.add('saml');
    if (config.portal) {
      // portal role is shared by guest and sponsor — select both
      selected.add('guest');
      selected.add('portal');
    }
  } catch {
    // Fallback to the classic multi_use roles
    selected.add('admin');
    selected.add('guest');
    selected.add('eap');
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
}) => {
  const [isJsonOpen, setIsJsonOpen] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [isFetchingNodes, setIsFetchingNodes] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // Track selected purposes (multi-select)
  const [selectedPurposes, setSelectedPurposes] = useState<Set<string>>(() => {
    const subtype = String(formData.ise_application_subtype || 'multi_use');
    const configJson = String(formData.ise_cert_import_config || '');
    return deriveSelectionsFromConfig(configJson, subtype);
  });

  // Separate URL state for guest/sponsor portal inputs
  const [guestUrl, setGuestUrl] = useState('');
  const [sponsorUrl, setSponsorUrl] = useState('');

  // Initialize portal URLs from alt_names on mount
  useEffect(() => {
    const altNames = String(formData.alt_names || '');
    const parts = altNames
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const hasGuest = selectedPurposes.has('guest');
    const hasSponsor = selectedPurposes.has('portal');

    if (hasGuest && hasSponsor) {
      setGuestUrl(parts[0] || '');
      setSponsorUrl(parts[1] || '');
    } else if (hasGuest) {
      setGuestUrl(parts[0] || '');
    } else if (hasSponsor) {
      setSponsorUrl(parts[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync guest/sponsor URLs into the alt_names field
  const syncAltNames = useCallback(
    (guest: string, sponsor: string) => {
      const parts = [guest, sponsor].filter(Boolean);
      onFieldChange('alt_names', parts.join(', '));
    },
    [onFieldChange]
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
      setSelectedPurposes((prev) => {
        const next = new Set(prev);
        if (next.has(purposeValue)) {
          next.delete(purposeValue);
        } else {
          next.add(purposeValue);
        }

        // Update derived fields
        onFieldChange('ise_application_subtype', deriveSubtype(next));
        onFieldChange('ise_cert_import_config', buildImportConfig(next));

        return next;
      });
    },
    [onFieldChange]
  );

  // Fetch ISE deployment nodes from the API
  const handleFetchNodes = async () => {
    const hostname = String(formData.hostname || '');
    const username = String(formData.username || '');
    const password = String(formData.password || '');

    if (!hostname || !username || !password) {
      setFetchError(
        'ISE admin node, username, and password are required. Fill in the Authentication tab first.'
      );
      return;
    }

    setIsFetchingNodes(true);
    setFetchError('');

    try {
      const response = await apiCall('/ise/nodes', {
        method: 'POST',
        body: JSON.stringify({ hostname, username, password }),
        retries: 0,
      });

      const data = await response.json();
      const fqdns: string[] = data.nodes
        .map((n: { fqdn: string }) => n.fqdn)
        .filter(Boolean);

      if (fqdns.length === 0) {
        setFetchError('No nodes returned from ISE deployment.');
        return;
      }

      onFieldChange('ise_nodes', fqdns.join(', '));
    } catch (error: any) {
      setFetchError(error.details || error.message || 'Failed to fetch ISE nodes.');
    } finally {
      setIsFetchingNodes(false);
    }
  };

  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    onFieldChange('ise_cert_import_config', value);

    if (value.trim() === '') {
      setJsonError('');
      return;
    }

    try {
      JSON.parse(value);
      setJsonError('');
    } catch {
      setJsonError('Must be valid JSON');
    }
  };

  // Build context message based on current selections
  const getContextMessage = (): string | null => {
    if (selectedPurposes.size === 0)
      return 'Select one or more certificate roles above.';

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
      .join(', ');

    if (selectedPurposes.size === 1) {
      return `${parts[0]} certificate. Monitored on port ${portStr}.`;
    }

    return `Multi-use certificate: ${parts.join(', ')}. Monitored on port${ports.size > 1 ? 's' : ''} ${portStr}.`;
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Certificate Purpose (multi-select) */}
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
                  'relative flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-colors text-left',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                )}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">{purpose.label}</span>
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

      {/* Conditional portal URL inputs */}
      {selectedPurposes.has('guest') && (
        <div className="space-y-1.5">
          <Label htmlFor="ise-guest-url" className="text-sm font-medium">
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
            Guest portal FQDN — added to the certificate SAN and monitored on
            port 8443.
          </p>
        </div>
      )}

      {selectedPurposes.has('portal') && (
        <div className="space-y-1.5">
          <Label htmlFor="ise-sponsor-url" className="text-sm font-medium">
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
            Sponsor portal FQDN — added to the certificate SAN and monitored on
            port 8445.
          </p>
        </div>
      )}

      {/* Section 2: ISE Nodes with Fetch button */}
      <div className="space-y-1.5">
        {renderField(iseNodesField)}
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
            {isFetchingNodes ? 'Fetching...' : 'Fetch Nodes from ISE'}
          </Button>
          {fetchError && (
            <span className="text-red-500 text-xs">{fetchError}</span>
          )}
        </div>
      </div>

      {/* Section 3: Additional SANs — always visible */}
      {renderField(altNamesField)}

      {/* Section 4: Certificate Provider */}
      {renderField(sslProviderField)}
      {renderField(dnsProviderField)}

      {/* Section 5: CSR Source */}
      {renderField(iseCsrSourceField)}
      {isFieldVisible(iseCsrConfigField, formData) &&
        renderField(iseCsrConfigField)}
      {isFieldVisible(iseCertificateField, formData) &&
        renderField(iseCertificateField)}

      {/* Section 6: Import Configuration JSON (Collapsible) */}
      <Collapsible open={isJsonOpen} onOpenChange={setIsJsonOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              isJsonOpen && 'rotate-180'
            )}
          />
          Advanced: Import Configuration JSON
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Auto-generated from the selected roles above. Edit to override role
            flags or import settings. Changes here take precedence over the role
            selection.
          </p>
          <Textarea
            name="ise_cert_import_config"
            value={String(formData.ise_cert_import_config || '')}
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
    </div>
  );
};

export default ISECertificateWizard;
