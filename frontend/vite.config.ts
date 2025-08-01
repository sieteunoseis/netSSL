/// <reference types="vitest" />
import path from "path"
import react from "@vitejs/plugin-react-swc"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {

    // Try to load env file from parent directory, fallback to current directory
    let envDir = '..'
    let env: Record<string, string> = {}
    
    try {
      env = loadEnv(mode, path.join(process.cwd(), '..'), '')
    } catch (error) {
      // Fallback to current directory for Docker builds
      envDir = '.'
      env = loadEnv(mode, process.cwd(), '')
    }
    
    console.log('Loaded environment:', Object.keys(env)) // Using env to avoid the error

    return {
      plugins: [react()],
      envDir,
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src"),
        },
      },
      build: {
        // Optimize for faster builds
        target: 'es2020',
        minify: 'esbuild',
        sourcemap: false,
        rollupOptions: {
          output: {
            manualChunks: {
              // Split vendor chunks for better caching
              vendor: ['react', 'react-dom'],
              ui: ['@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-tabs'],
              charts: ['recharts'],
            }
          }
        }
      },
      server: {
        proxy: {
          '/api': {
            // In development, proxy to localhost. In Docker, this won't be used.
            target: `http://localhost:${env.PORT || 3000}`,
            changeOrigin: true
          }
        }
      },
      define: {
        // Make API URL available at build time for production
        __API_URL__: JSON.stringify(env.VITE_API_URL || '/api')
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
      }
    }
})
