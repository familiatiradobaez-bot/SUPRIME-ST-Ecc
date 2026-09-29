import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: { 
    port: 5173,
    host: '0.0.0.0',
    strictPort: false,
    allowedHosts: ['localhost', 'phases-exceptional-wheels-sunset.trycloudflare.com']
  },
});