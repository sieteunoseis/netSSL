// API configuration for both development and production
const getApiUrl = (): string => {
  // In development, use relative URLs (handled by Vite proxy)
  if (import.meta.env.DEV) {
    return '/api';
  }
  
  // In production build, use the defined API URL
  if (typeof __API_URL__ !== 'undefined') {
    return __API_URL__;
  }
  
  return '/api';
};

export const API_BASE_URL = getApiUrl();

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to make API calls with retry logic
export const apiCall = async (endpoint: string, options: RequestInit & { retries?: number; retryDelay?: number } = {}) => {
  const url = API_BASE_URL ? `${API_BASE_URL}${endpoint}` : endpoint;
  const { retries = 10, retryDelay = 2000, ...fetchOptions } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...fetchOptions.headers,
        },
        ...fetchOptions,
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      
      // Check if it's a connection error (backend not ready)
      const isConnectionError = 
        error instanceof TypeError && error.message.includes('fetch') ||
        (error as any)?.code === 'ECONNREFUSED' ||
        (error as any)?.cause?.code === 'ECONNREFUSED';
      
      // Only retry on connection errors and if we have retries left
      if (isConnectionError && attempt < retries) {
        console.log(`API call to ${endpoint} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${retryDelay}ms...`);
        await delay(retryDelay * (attempt + 1)); // Exponential backoff
      } else {
        // Don't retry on other errors or if we're out of retries
        throw error;
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error('API call failed after all retries');
};

// Declare the global variable for TypeScript
declare const __API_URL__: string;