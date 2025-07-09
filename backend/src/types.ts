export interface ConnectionRecord {
  id?: number;
  name: string;
  hostname: string;
  username: string;
  password: string;
  version: string;
  selected?: string | null;
}

export interface DatabaseError extends Error {
  code?: string;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}