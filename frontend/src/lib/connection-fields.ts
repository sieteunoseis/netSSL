/**
 * Typed field definitions for connection forms.
 * Replaces the old frontend/public/dbSetup.json approach.
 */

export interface FieldDefinition {
  name: string;
  type: 'text' | 'password' | 'select' | 'textarea' | 'switch' | 'info';
  label: string;
  placeholder?: string;
  defaultValue?: string | boolean;
  optional?: boolean;
  description?: string;
  selectOptions?: Array<{ value: string; label: string }>;
  validation?: {
    name: string;
    options?: any;
  };
  rows?: number;
  /** Within-type dynamic visibility (e.g., SSH fields when enable_ssh is true) */
  visibleWhen?: {
    field: string;
    is?: string | boolean;
    isNot?: string | boolean;
  };
}

// ---------------------------------------------------------------------------
// Meta field — drives profile selection, always shown in basic tab
// ---------------------------------------------------------------------------

export const applicationTypeField: FieldDefinition = {
  name: 'application_type',
  type: 'select',
  label: 'Application Type',
  selectOptions: [
    { value: 'general', label: 'General Application' },
    { value: 'vos', label: 'Cisco VOS Application' },
    { value: 'ise', label: 'Cisco ISE' },
    { value: 'catalyst_center', label: 'Cisco Catalyst Center' },
  ],
  defaultValue: 'general',
  validation: { name: 'isIn', options: ['general', 'vos', 'ise', 'catalyst_center'] },
};

// ---------------------------------------------------------------------------
// Shared fields — used across multiple application types
// ---------------------------------------------------------------------------

export const nameField: FieldDefinition = {
  name: 'name',
  type: 'text',
  label: 'Connection Name',
  placeholder: 'e.g., CUCM Primary, ISE Primary, ESXi Host',
  validation: { name: 'isAscii', options: '' },
};

export const usernameField: FieldDefinition = {
  name: 'username',
  type: 'text',
  label: 'Username',
  placeholder: 'Server username',
  defaultValue: 'administrator',
  validation: { name: 'isAscii', options: '' },
};

export const passwordField: FieldDefinition = {
  name: 'password',
  type: 'password',
  label: 'Password',
  placeholder: 'Server password',
  validation: { name: 'isAscii', options: '' },
};

export const domainField: FieldDefinition = {
  name: 'domain',
  type: 'text',
  label: 'Domain Name',
  placeholder: 'e.g., example.com',
  validation: { name: 'isFQDN', options: { allow_numeric_tld: true } },
};

export const sslProviderField: FieldDefinition = {
  name: 'ssl_provider',
  type: 'select',
  label: 'SSL Provider',
  selectOptions: [
    { value: 'letsencrypt', label: "Let's Encrypt" },
    { value: 'zerossl', label: 'ZeroSSL' },
  ],
  defaultValue: 'letsencrypt',
  validation: { name: 'isIn', options: ['letsencrypt', 'zerossl'] },
};

export const dnsProviderField: FieldDefinition = {
  name: 'dns_provider',
  type: 'select',
  label: 'DNS Provider',
  selectOptions: [
    { value: 'cloudflare', label: 'Cloudflare' },
    { value: 'digitalocean', label: 'DigitalOcean' },
    { value: 'route53', label: 'AWS Route53' },
    { value: 'azure', label: 'Azure DNS' },
    { value: 'google', label: 'Google Cloud DNS' },
    { value: 'custom', label: 'Custom DNS (Manual)' },
  ],
  defaultValue: 'cloudflare',
  validation: { name: 'isIn', options: ['cloudflare', 'digitalocean', 'route53', 'azure', 'google', 'custom'] },
};

export const altNamesField: FieldDefinition = {
  name: 'alt_names',
  type: 'text',
  label: 'Alternative Names (SANs)',
  placeholder: 'e.g., server1.example.com, server2.example.com',
  optional: true,
  validation: { name: 'isAscii', options: '' },
};

export const autoRenewField: FieldDefinition = {
  name: 'auto_renew',
  type: 'switch',
  label: 'Auto Renew Certificate',
  description: 'Automatically renew certificate before expiration (requires API-based DNS provider)',
  defaultValue: false,
  visibleWhen: { field: 'dns_provider', isNot: 'custom' },
};

export const isEnabledField: FieldDefinition = {
  name: 'is_enabled',
  type: 'switch',
  label: 'Enable Connection',
  description: 'When disabled, connection will be hidden from dashboard but can still be managed',
  defaultValue: true,
};

// ---------------------------------------------------------------------------
// SSH fields — used by VOS and General
// ---------------------------------------------------------------------------

export const enableSshField: FieldDefinition = {
  name: 'enable_ssh',
  type: 'switch',
  label: 'Allow SSH',
  description: 'For testing and service management',
  defaultValue: false,
};

export const sshCertPathField: FieldDefinition = {
  name: 'ssh_cert_path',
  type: 'text',
  label: 'Remote Certificate Path',
  placeholder: '/etc/vmware/ssl/rui.crt',
  description: 'Full path on the remote server where the certificate file should be installed',
  optional: true,
  validation: { name: 'isAscii', options: '' },
  visibleWhen: { field: 'enable_ssh', is: true },
};

export const sshKeyPathField: FieldDefinition = {
  name: 'ssh_key_path',
  type: 'text',
  label: 'Remote Private Key Path',
  placeholder: '/etc/vmware/ssl/rui.key',
  description: 'Full path on the remote server where the private key file should be installed',
  optional: true,
  validation: { name: 'isAscii', options: '' },
  visibleWhen: { field: 'enable_ssh', is: true },
};

export const sshChainPathField: FieldDefinition = {
  name: 'ssh_chain_path',
  type: 'text',
  label: 'Remote Full Chain Path (Optional)',
  placeholder: '/etc/vmware/ssl/castore.pem',
  description: 'Full path for the certificate chain file (optional - leave blank to skip chain upload)',
  optional: true,
  validation: { name: 'isAscii', options: '' },
  visibleWhen: { field: 'enable_ssh', is: true },
};

export const sshRestartCommandField: FieldDefinition = {
  name: 'ssh_restart_command',
  type: 'text',
  label: 'Post-Install Restart Command (Optional)',
  placeholder: '/etc/init.d/hostd restart && /etc/init.d/vpxa restart',
  description: 'Shell command to execute after certificate installation to restart services. Leave blank to skip.',
  optional: true,
  validation: { name: 'isAscii', options: '' },
  visibleWhen: { field: 'enable_ssh', is: true },
};

// ---------------------------------------------------------------------------
// VOS-specific fields
// ---------------------------------------------------------------------------

export const hostnameVosField: FieldDefinition = {
  name: 'hostname',
  type: 'text',
  label: 'Server Hostname',
  placeholder: 'e.g., cucm01-pub, cucm02-sub',
  description: 'Hostname only - do not include domain name (e.g., \'server01\' not \'server01.domain.com\')',
  validation: { name: 'matches', options: '^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?$' },
};

export const applicationTypeInfoVosField: FieldDefinition = {
  name: 'application_type_info',
  type: 'info',
  label: '',
  description: 'Includes: CUCM, CUC, IM&P, and other VOS-based systems. Uses API to automatically generate CSR and upload certificate after obtaining from SSL provider. Note: Without SSH enabled, users will need to manually restart Tomcat service after certificate installation.',
};

export const autoRestartServiceField: FieldDefinition = {
  name: 'auto_restart_service',
  type: 'switch',
  label: 'Auto Restart Cisco Tomcat',
  description: 'Automatically restart Cisco Tomcat service after certificate installation',
  defaultValue: false,
  visibleWhen: { field: 'enable_ssh', is: true },
};

// ---------------------------------------------------------------------------
// ISE-specific fields
// ---------------------------------------------------------------------------

export const hostnameIseField: FieldDefinition = {
  name: 'hostname',
  type: 'text',
  label: 'Portal Hostname',
  placeholder: 'e.g., sponsor, guest1, * (wildcard), or leave blank',
  description: 'Portal hostname - can be a name, wildcard (*), or blank for domain-only certificates',
  validation: { name: 'matches', options: '^(\\*|[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?)?$' },
};

export const iseApplicationSubtypeField: FieldDefinition = {
  name: 'ise_application_subtype',
  type: 'select',
  label: 'ISE Application Subtype',
  selectOptions: [
    { value: 'guest', label: 'Guest' },
    { value: 'portal', label: 'Portal' },
    { value: 'admin', label: 'Admin' },
  ],
  defaultValue: 'guest',
  validation: { name: 'isIn', options: ['guest', 'portal', 'admin'] },
};

export const iseSubtypeInfoGuestField: FieldDefinition = {
  name: 'ise_subtype_info_guest',
  type: 'info',
  label: '',
  description: 'Checks the Guest Portal certificate on port 8443. Certificate roles (portal, eap, radius, etc.) are controlled via the Certificate Import Configuration JSON below.',
  visibleWhen: { field: 'ise_application_subtype', is: 'guest' },
};

export const iseSubtypeInfoPortalField: FieldDefinition = {
  name: 'ise_subtype_info_portal',
  type: 'info',
  label: '',
  description: 'Checks the Sponsor Portal certificate on port 8445. Certificate roles are controlled via the Certificate Import Configuration JSON below.',
  visibleWhen: { field: 'ise_application_subtype', is: 'portal' },
};

export const iseSubtypeInfoAdminField: FieldDefinition = {
  name: 'ise_subtype_info_admin',
  type: 'info',
  label: '',
  description: 'Checks the Admin interface certificate on port 443. This covers Admin, EAP Authentication, RADIUS DTLS, SAML, and pxGrid \u2014 roles that share the admin certificate. Certificate roles are controlled via the Certificate Import Configuration JSON below.',
  visibleWhen: { field: 'ise_application_subtype', is: 'admin' },
};

export const applicationTypeInfoIseField: FieldDefinition = {
  name: 'application_type_info_ise',
  type: 'info',
  label: '',
  description: 'Includes: Cisco Identity Services Engine for Guest and Sponsor portals. Requires manual CSR generation and certificate installation through ISE admin interface.',
};

export const iseNodesField: FieldDefinition = {
  name: 'ise_nodes',
  type: 'text',
  label: 'ISE Nodes (for certificate installation)',
  placeholder: 'e.g., ise01.automate.builder, ise02.automate.builder (comma-separated)',
  validation: { name: 'isAscii', options: '' },
};

export const iseCertificateField: FieldDefinition = {
  name: 'ise_certificate',
  type: 'textarea',
  label: 'CSR (PEM Format)',
  placeholder: '-----BEGIN CERTIFICATE REQUEST-----\nPaste your Certificate Signing Request here\n-----END CERTIFICATE REQUEST-----',
  validation: { name: 'isAscii', options: '' },
  rows: 6,
};

export const isePrivateKeyField: FieldDefinition = {
  name: 'ise_private_key',
  type: 'textarea',
  label: 'Private Key (PEM Format)',
  placeholder: '-----BEGIN PRIVATE KEY-----\nPaste your private key here\n-----END PRIVATE KEY-----',
  validation: { name: 'isAscii', options: '' },
  rows: 6,
};

const ISE_CERT_IMPORT_DEFAULT = `{
  "admin": false,
  "allowExtendedValidity": true,
  "allowOutOfDateCert": true,
  "allowPortalTagTransferForSameSubject": true,
  "allowReplacementOfCertificates": true,
  "allowReplacementOfPortalGroupTag": true,
  "allowRoleTransferForSameSubject": true,
  "allowSHA1Certificates": true,
  "allowWildCardCertificates": false,
  "eap": false,
  "ims": false,
  "name": "netSSL Imported Certificate",
  "password": "",
  "portal": true,
  "portalGroupTag": "My Default Portal Certificate Group",
  "pxgrid": false,
  "radius": false,
  "saml": false,
  "validateCertificateExtensions": false
}`;

export const iseCertImportConfigField: FieldDefinition = {
  name: 'ise_cert_import_config',
  type: 'textarea',
  label: 'Certificate Import Configuration (JSON)',
  placeholder: ISE_CERT_IMPORT_DEFAULT,
  defaultValue: ISE_CERT_IMPORT_DEFAULT,
  description: 'Default configuration sent to the ISE certificate import API. Modify any values to override the defaults. Only changed fields need to be included \u2014 they will be merged with the defaults shown above.',
  optional: true,
  validation: { name: 'isJSON', options: '' },
  rows: 6,
};

// ---------------------------------------------------------------------------
// General-specific fields
// ---------------------------------------------------------------------------

export const hostnameGeneralField: FieldDefinition = {
  name: 'hostname',
  type: 'text',
  label: 'Server Hostname',
  placeholder: 'e.g., hostname, * (wildcard), or leave blank',
  description: 'Server hostname - can be a name, wildcard (*), or blank for domain-only certificates',
  validation: { name: 'matches', options: '^(\\*|[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?)?$' },
};

export const applicationTypeInfoGeneralField: FieldDefinition = {
  name: 'application_type_info_general',
  type: 'info',
  label: '',
  description: 'Includes: ESXi, other non-Cisco applications, or any system requiring certificate management. Enable SSH to automatically deploy certificates via SFTP, or download certificate files for manual installation.',
};

export const customCsrField: FieldDefinition = {
  name: 'custom_csr',
  type: 'textarea',
  label: 'CSR (Required for General Applications)',
  placeholder: '-----BEGIN CERTIFICATE REQUEST-----\nPaste your Certificate Signing Request here\n-----END CERTIFICATE REQUEST-----',
  validation: { name: 'isAscii', options: '' },
  rows: 6,
};

export const generalPrivateKeyField: FieldDefinition = {
  name: 'general_private_key',
  type: 'textarea',
  label: 'Private Key (PEM Format)',
  placeholder: '-----BEGIN PRIVATE KEY-----\nPaste your private key here\n-----END PRIVATE KEY-----',
  validation: { name: 'isAscii', options: '' },
  rows: 6,
};

// ---------------------------------------------------------------------------
// Catalyst Center-specific fields
// ---------------------------------------------------------------------------

export const hostnameCatalystCenterField: FieldDefinition = {
  name: 'hostname',
  type: 'text',
  label: 'Catalyst Center Hostname',
  placeholder: 'e.g., catalyst-center, dnac01',
  description: 'Hostname of the Catalyst Center appliance — do not include domain name',
  validation: { name: 'matches', options: '^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?$' },
};

export const applicationTypeInfoCatalystCenterField: FieldDefinition = {
  name: 'application_type_info_cc',
  type: 'info',
  label: '',
  description: 'Cisco Catalyst Center (formerly DNA Center). Uses token-based REST API to import certificates. CSR is generated locally — no SSH required.',
};

export const ccListOfUsersField: FieldDefinition = {
  name: 'cc_list_of_users',
  type: 'select',
  label: 'Used For',
  selectOptions: [
    { value: 'server', label: 'Controller' },
    { value: 'ipsec', label: 'DR IPSec' },
    { value: 'server,ipsec', label: 'Both (Controller + DR IPSec)' },
  ],
  defaultValue: 'server',
  validation: { name: 'isIn', options: ['server', 'ipsec', 'server,ipsec'] },
};

// ---------------------------------------------------------------------------
// Field registry — flat lookup by database column name
// Used by DataTable for column metadata. For fields with per-type variants
// (hostname), the generic entry is used; profiles provide the specific one.
// ---------------------------------------------------------------------------

export const fieldRegistry: Record<string, FieldDefinition> = {
  application_type: applicationTypeField,
  name: nameField,
  hostname: hostnameVosField, // generic fallback — profiles provide specific variant
  username: usernameField,
  password: passwordField,
  domain: domainField,
  ssl_provider: sslProviderField,
  dns_provider: dnsProviderField,
  alt_names: altNamesField,
  enable_ssh: enableSshField,
  auto_restart_service: autoRestartServiceField,
  ssh_cert_path: sshCertPathField,
  ssh_key_path: sshKeyPathField,
  ssh_chain_path: sshChainPathField,
  ssh_restart_command: sshRestartCommandField,
  auto_renew: autoRenewField,
  is_enabled: isEnabledField,
  ise_application_subtype: iseApplicationSubtypeField,
  ise_nodes: iseNodesField,
  ise_certificate: iseCertificateField,
  ise_private_key: isePrivateKeyField,
  ise_cert_import_config: iseCertImportConfigField,
  custom_csr: customCsrField,
  general_private_key: generalPrivateKeyField,
  cc_list_of_users: ccListOfUsersField,
  // INFO fields (not database columns, but included for completeness)
  application_type_info: applicationTypeInfoVosField,
  application_type_info_ise: applicationTypeInfoIseField,
  application_type_info_general: applicationTypeInfoGeneralField,
  application_type_info_cc: applicationTypeInfoCatalystCenterField,
  ise_subtype_info_guest: iseSubtypeInfoGuestField,
  ise_subtype_info_portal: iseSubtypeInfoPortalField,
  ise_subtype_info_admin: iseSubtypeInfoAdminField,
};
