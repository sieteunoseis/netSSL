/**
 * Per-application-type form layouts.
 * Each profile declares exactly which fields appear in which tabs.
 * No conditional visibility for application_type — the profile IS the condition.
 */
import {
  type FieldDefinition,
  applicationTypeField,
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
  // ISE
  hostnameIseField,
  iseApplicationSubtypeField,
  iseSubtypeInfoGuestField,
  iseSubtypeInfoPortalField,
  iseSubtypeInfoAdminField,
  applicationTypeInfoIseField,
  iseNodesField,
  iseCertificateField,
  isePrivateKeyField,
  iseCertImportConfigField,
  // General
  hostnameGeneralField,
  applicationTypeInfoGeneralField,
  customCsrField,
  generalPrivateKeyField,
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
      iseApplicationSubtypeField,
      iseSubtypeInfoGuestField,
      iseSubtypeInfoPortalField,
      iseSubtypeInfoAdminField,
      applicationTypeInfoIseField,
    ],
    authentication: [
      usernameField,
      passwordField,
    ],
    certificate: [
      hostnameIseField,
      domainField,
      sslProviderField,
      dnsProviderField,
      altNamesField,
      iseNodesField,
      iseCertificateField,
      isePrivateKeyField,
      iseCertImportConfigField,
    ],
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
// Profile lookup
// ---------------------------------------------------------------------------

export const typeProfiles: Record<string, TypeProfile> = {
  vos: vosProfile,
  ise: iseProfile,
  general: generalProfile,
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

  return defaults;
}

/** Get all field definitions for a profile (all tabs flattened), useful for DataTable */
export function getAllFieldsForType(appType: string): FieldDefinition[] {
  const profile = getProfile(appType);
  return [
    applicationTypeField,
    ...profile.tabs.basic,
    ...profile.tabs.authentication,
    ...profile.tabs.certificate,
    ...profile.tabs.advanced,
  ];
}

/** Check if a tab has any visible fields */
export function hasVisibleFields(fields: FieldDefinition[], formData: Record<string, any>): boolean {
  return fields.some(f => isFieldVisible(f, formData));
}
