// API configuration for both development and production
const getApiUrl = (): string => {
  // In production build, use the defined API URL
  if (typeof __API_URL__ !== 'undefined') {
    return __API_URL__;
  }
  
  // In development, use relative URLs (handled by Vite proxy)
  return '';
};

export const API_BASE_URL = getApiUrl();

// Helper function to make API calls
export const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const url = API_BASE_URL ? `${API_BASE_URL}${endpoint}` : endpoint;
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  return response;
};

// Declare the global variable for TypeScript
declare const __API_URL__: string;