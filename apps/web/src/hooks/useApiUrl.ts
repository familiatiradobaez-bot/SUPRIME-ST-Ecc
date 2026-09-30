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
      return 'https://api.suprime.xyz/api/v1';
    }

    // 4. Si se accede desde Cloudflare Pages (vista previa)
    if (host.includes('pages.dev')) {
      return 'https://suprime-st-ecc-api.familia-tirado-baez.workers.dev/api/v1';
    }

    // 5. Desarrollo local. Se cubre tambien el caso de abrirlo desde el movil en
    //    la red local (npm run network-info), en cuyo caso el host es la IP de
    //    este equipo y la API sigue estando en el puerto 8789 de la maquina.
    //    Antes habia aqui un caso para ngrok que apuntaba a 192.168.0.105:8789;
    //    se ha quitado porque el tunel ya no se usa y este caso cubre lo mismo.
    const apiHost = (host.startsWith('192.168') || host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'localhost' : host;
    return `${protocol}//${apiHost}:8789/api/v1`;
  }, []);
}
