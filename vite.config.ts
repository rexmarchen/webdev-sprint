import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// NODE_ENV is forced to production by scripts/build-web.mjs. Vite would
// otherwise read NODE_ENV=development from a local `.env` and emit React's
// development bundle even during a production build.
export default defineConfig(({ mode }) => {
  // Keep the development proxy aligned with the API port in .env. This avoids
  // silently proxying to a different local project when the default port is in use.
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = `http://localhost:${env.PORT || '8787'}`;

  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@shared': path.resolve(import.meta.dirname, 'shared'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/sitemap.xml': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/robots.txt': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Do not publish source maps in the production bundle.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
  };
});

