import { useMemo } from 'react';

export function useApiUrl(): string {
  return useMemo(() => {
    // 1. Configuración dinámica desde public/config.js
    const dynamicConfig = (window as any).__APP_CONFIG__;
    if (dynamicConfig?.API_URL) {
      return dynamicConfig.API_URL;
    }

    // 2. Variable de entorno de Vite
    if (import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL;
    }

    const host = window.location.hostname;
    const protocol = window.location.protocol;

    // 3. Si se accede desde el dominio personalizado suprime.xyz (API en subdominio)
    if (host.includes('suprime.xyz')) {
      return 'https://api.suprime.xyz';
    }

    // 4. Si se accede desde ngrok
    if (host.includes('ngrok')) {
      return `http://192.168.0.105:8789/api/v1`;
    }

    // 5. Si se accede desde Cloudflare Pages
    if (host.includes('pages.dev')) {
      return 'https://suprime-st-ecc-api.familia-tirado-baez.workers.dev/api/v1';
    }

    // 6. Desarrollo local
    const apiHost = (host.startsWith('192.168') || host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'localhost' : host;
    return `${protocol}//${apiHost}:8789/api/v1`;
  }, []);
}
