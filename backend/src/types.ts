export interface ConnectionRecord {
  id?: number;
  name: string;
  hostname: string;
  username: string;
  password: string;
  domain: string;
  ssl_provider: string;
  dns_provider: string;
  version?: string;
  alt_names?: string;
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