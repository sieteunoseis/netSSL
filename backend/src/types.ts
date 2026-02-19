export interface ConnectionRecord {
  id?: number;
  name: string;
  hostname: string;
  username?: string;
  password?: string;
  domain: string;
  ssl_provider: string;
  dns_provider: string;
  dns_challenge_mode?: string;
  application_type?: 'vos' | 'ise' | 'general';
  ise_application_subtype?: 'guest' | 'portal' | 'admin';
  version?: string;
  alt_names?: string;
  custom_csr?: string;
  general_private_key?: string;
  ise_nodes?: string;
  ise_certificate?: string;
  ise_private_key?: string;
  ise_cert_import_config?: string;
  enable_ssh?: boolean;
  auto_restart_service?: boolean;
  auto_renew?: boolean;
  auto_renew_status?: string;
  auto_renew_last_attempt?: string;
  ssh_cert_path?: string;
  ssh_key_path?: string;
  ssh_chain_path?: string;
  ssh_restart_command?: string;
  is_enabled?: boolean | number;
  last_cert_issued?: string;
  cert_count_this_week?: number;
  cert_count_reset_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DatabaseError extends Error {
  code?: string;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}