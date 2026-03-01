/**
 * Per-application-type form layouts.
 * Each profile declares exactly which fields appear in which tabs.
 * No conditional visibility for application_type — the profile IS the condition.
 */
import {
  type FieldDefinition,
  applicationTypeField,
  ISE_CERT_IMPORT_DEFAULT,
  // Shared
  nameField,
  usernameField,
  passwordField,
  domainField,
  sslProviderField,
  dnsProviderField,
  altNamesField,
  autoRenewField,
  isEnabledField,
  // SSH
  enableSshField,
  sshCertPathField,
  sshKeyPathField,
  sshChainPathField,
  sshRestartCommandField,
  // VOS
  hostnameVosField,
  applicationTypeInfoVosField,
  autoRestartServiceField,
  // ISE (wizard-managed fields — not in profile tabs but needed for DataTable/defaults)
  applicationTypeInfoIseField,
  iseApplicationSubtypeField,
  iseNodesField,
  hostnameIseField,
  iseCsrSourceField,
  iseCertImportConfigField,
  // General
  hostnameGeneralField,
  applicationTypeInfoGeneralField,
  customCsrField,
  generalPrivateKeyField,
  // Catalyst Center
  hostnameCatalystCenterField,
  applicationTypeInfoCatalystCenterField,
  ccListOfUsersField,
} from './connection-fields';

export interface TypeProfile {
  id: string;
  label: string;
  tabs: {
    basic: FieldDefinition[];
    authentication: FieldDefinition[];
    certificate: FieldDefinition[];
    advanced: FieldDefinition[];
  };
}

// ---------------------------------------------------------------------------
// VOS Profile — Cisco VOS (CUCM, CUC, IM&P)
// ---------------------------------------------------------------------------
export const vosProfile: TypeProfile = {
  id: 'vos',
  label: 'Cisco VOS (CUCM, CUC, IM&P)',
  tabs: {
    basic: [
      nameField,
      hostnameVosField,
      applicationTypeInfoVosField,
    ],
    authentication: [
      usernameField,
      passwordField,
    ],
    certificate: [
      domainField,
      sslProviderField,
      dnsProviderField,
      altNamesField,
    ],
    advanced: [
      enableSshField,
      autoRestartServiceField,
      autoRenewField,
      isEnabledField,
    ],
  },
};

// ---------------------------------------------------------------------------
// ISE Profile — Cisco Identity Services Engine
// ---------------------------------------------------------------------------
export const iseProfile: TypeProfile = {
  id: 'ise',
  label: 'Cisco ISE',
  tabs: {
    basic: [
      nameField,
      applicationTypeInfoIseField,
    ],
    authentication: [
      hostnameIseField,
      usernameField,
      passwordField,
    ],
    certificate: [],  // ISECertificateWizard renders all certificate tab content
    advanced: [
      autoRenewField,
      isEnabledField,
    ],
  },
};

// ---------------------------------------------------------------------------
// General Profile — ESXi, non-Cisco systems
// ---------------------------------------------------------------------------
export const generalProfile: TypeProfile = {
  id: 'general',
  label: 'General Application',
  tabs: {
    basic: [
      nameField,
      hostnameGeneralField,
      applicationTypeInfoGeneralField,
    ],
    authentication: [
      usernameField,
      passwordField,
    ],
    certificate: [
      domainField,
      sslProviderField,
      dnsProviderField,
      altNamesField,
      customCsrField,
      generalPrivateKeyField,
    ],
    advanced: [
      enableSshField,
      sshCertPathField,
      sshKeyPathField,
      sshChainPathField,
      sshRestartCommandField,
      autoRenewField,
      isEnabledField,
    ],
  },
};

// ---------------------------------------------------------------------------
// Catalyst Center Profile — Cisco Catalyst Center (formerly DNAC)
// ---------------------------------------------------------------------------
export const catalystCenterProfile: TypeProfile = {
  id: 'catalyst_center',
  label: 'Cisco Catalyst Center',
  tabs: {
    basic: [
      nameField,
      hostnameCatalystCenterField,
      applicationTypeInfoCatalystCenterField,
    ],
    authentication: [
      usernameField,
      passwordField,
    ],
    certificate: [
      domainField,
      sslProviderField,
      dnsProviderField,
      altNamesField,
      ccListOfUsersField,
      customCsrField,
      generalPrivateKeyField,
    ],
    advanced: [
      autoRenewField,
      isEnabledField,
    ],
  },
};

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

export const typeProfiles: Record<string, TypeProfile> = {
  vos: vosProfile,
  ise: iseProfile,
  general: generalProfile,
  catalyst_center: catalystCenterProfile,
};

export function getProfile(appType: string): TypeProfile {
  return typeProfiles[appType] || generalProfile;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a field should be visible based on its visibleWhen condition */
export function isFieldVisible(field: FieldDefinition, formData: Record<string, any>): boolean {
  if (!field.visibleWhen) return true;

  const { field: condField, is, isNot } = field.visibleWhen;
  const currentValue = formData[condField];

  // Handle boolean comparisons (for SWITCH fields stored as 1/"1"/true)
  const normalize = (v: any): any => {
    if (v === true || v === 1 || v === '1') return true;
    if (v === false || v === 0 || v === '0' || v === undefined || v === null) return false;
    return v;
  };

  if (is !== undefined) {
    return normalize(currentValue) === normalize(is);
  }
  if (isNot !== undefined) {
    return normalize(currentValue) !== normalize(isNot);
  }

  return true;
}

/** Build default form data for a given application type */
export function getDefaultFormData(appType: string): Record<string, any> {
  const profile = getProfile(appType);
  const defaults: Record<string, any> = {
    application_type: appType,
  };

  // Collect defaults from all tabs
  const allFields = [
    ...profile.tabs.basic,
    ...profile.tabs.authentication,
    ...profile.tabs.certificate,
    ...profile.tabs.advanced,
  ];

  for (const field of allFields) {
    if (defaults[field.name] !== undefined) continue; // skip dupes
    if (field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
    } else if (field.type === 'switch') {
      defaults[field.name] = false;
    } else if (field.type !== 'info') {
      defaults[field.name] = '';
    }
  }

  // ISE wizard-managed fields (not in profile tabs, so defaults must be set explicitly)
  if (appType === 'ise') {
    if (defaults.ise_application_subtype === undefined) defaults.ise_application_subtype = 'multi_use';
    if (defaults.ise_cert_import_config === undefined) defaults.ise_cert_import_config = ISE_CERT_IMPORT_DEFAULT;
    if (defaults.ise_csr_source === undefined) defaults.ise_csr_source = 'api';
    if (defaults.ise_nodes === undefined) defaults.ise_nodes = '';
    if (defaults.hostname === undefined) defaults.hostname = '';
    if (defaults.ssl_provider === undefined) defaults.ssl_provider = '';
    if (defaults.dns_provider === undefined) defaults.dns_provider = '';
    if (defaults.ise_csr_config === undefined) defaults.ise_csr_config = '';
    if (defaults.ise_certificate === undefined) defaults.ise_certificate = '';
    if (defaults.alt_names === undefined) defaults.alt_names = '';
  }

  return defaults;
}

/** Get all field definitions for a profile (all tabs flattened), useful for DataTable */
export function getAllFieldsForType(appType: string): FieldDefinition[] {
  const profile = getProfile(appType);
  const fields = [
    applicationTypeField,
    ...profile.tabs.basic,
    ...profile.tabs.authentication,
    ...profile.tabs.certificate,
    ...profile.tabs.advanced,
  ];

  // ISE wizard renders these fields outside the profile tabs —
  // include them so DataTable and other consumers can still display them
  if (appType === 'ise') {
    fields.push(
      iseApplicationSubtypeField,
      iseNodesField,
      altNamesField,
      sslProviderField,
      dnsProviderField,
      iseCsrSourceField,
      iseCertImportConfigField,
    );
  }

  return fields;
}

/** Check if a tab has any visible fields */
export function hasVisibleFields(fields: FieldDefinition[], formData: Record<string, any>): boolean {
  return fields.some(f => isFieldVisible(f, formData));
}
