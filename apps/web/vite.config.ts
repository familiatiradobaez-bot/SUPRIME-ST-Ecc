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
    host: '0.0.0.0', // para poder abrirlo desde el movil en la red local
    strictPort: false,
    // Sin `allowedHosts`: estaba con un tunel de Cloudflare de una sesion vieja
    // (phases-exceptional-wheels-sunset.trycloudflare.com) que ya no existe. Vite
    // permite localhost y 127.0.0.1 por su cuenta, y con host 0.0.0.0 tambien
    // se abre desde la IP de la red local. Si algun dia hace falta un tunel, se
    // anade aqui SU dominio exacto.
  },
});