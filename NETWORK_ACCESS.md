# 🌐 Acceso a SUPRIME desde Red Local

## Información de tu Red
- **IP Local de tu PC**: `192.168.0.105`
- **Puerto Frontend (Vite)**: `5173`
- **Puerto Backend (Node.js + tsx)**: `8789`

## URLs para Acceder desde tu Celular (Red Local)

### Frontend (Interfaz de la Tienda)
```
http://192.168.0.105:5173
```

### Backend (API)
```
http://192.168.0.105:8789/api/v1
```

También está el script, que imprime lo mismo:
```
npm run network-info
```

> **Nota sobre los túneles.** Este documento antes recomendaba abrir túneles de
> Cloudflare (`cloudflared tunnel --url ...`) y traía dos URLs concretas de
> sesiones antiguas. Se han quitado por dos motivos:
>
> 1. **Esos subdominios ya no existen.** Los túneles son efímeros: al cerrar la
>    sesión mueren.
> 2. **Dejaban un agujero en la API.** Los comodines `*.trycloudflare.com`,
>    `*.ngrok-free.dev` y `*.pages.dev` estaban en la lista de orígenes
>    permitidos de producción, así que **cualquier** túnel gratis de cualquiera
>    pasaba la validación de CSRF/CORS igual que `suprime.xyz`. Se comprobó en
>    producción antes de quitarlo.
>
> La red local no necesita nada de eso. Si algún día hace falta un túnel, se abre
> y se añade **su dominio exacto** a `ORIGENES_DESARROLLO` en
> `apps/api/src/app.ts` (y a `allowedHosts` de `vite.config.ts`), nunca un comodín.

## URLs para Acceder desde tu PC (Red Local)
```
http://localhost:5173        (o http://127.0.0.1:5173)
```

## Requisitos Previos

1. ✅ Asegúrate de que tu celular está conectado a la **misma red Wi-Fi** que tu PC
2. ✅ La red Wi-Fi NO debe tener aislamiento de dispositivos activado
3. ✅ El firewall de Windows no debe bloquear los puertos 5173 y 8787

## Pasos para Acceder desde tu Celular

### En Android/iOS
1. Abre el navegador (Chrome, Safari, etc.)
2. En la barra de direcciones, escribe:
   ```
   http://192.168.0.105:5173
   ```
3. Presiona Enter

¡Listo! Deberías ver la tienda SUPRIME funcionando en tu celular.

## Solución de Problemas

### No puedo acceder desde el celular
- [ ] Verifica que tu PC y celular están en la **misma red Wi-Fi**
- [ ] Intenta hacer ping a la IP:
  ```
  ping 192.168.0.105
  ```
- [ ] Verifica que los servidores están corriendo:
  - Frontend: `npm run dev:web` (debe estar en puerto 5173)
  - Backend: `npm run dev:api` (debe estar en puerto 8787)

### No se carga la página
- [ ] Espera 10 segundos a que Vite termine de compilar
- [ ] Revisa la consola del navegador (F12) para ver errores
- [ ] Intenta acceder primero desde `http://localhost:5173` en tu PC

### El API no responde desde el celular
- [ ] Asegúrate que Wrangler está corriendo en `0.0.0.0`
- [ ] Verifica en la terminal que aparece: `Ready on http://0.0.0.0:8787`
- [ ] Intenta acceder primero desde `http://localhost:8787/api/v1/health`

## Cambiar la Red Wi-Fi

Si cambias de red Wi-Fi o tu IP cambia, actualiza:
1. La IP en el navegador del celular
2. El archivo `NETWORK_ACCESS.md` con la nueva IP (ejecuta `ipconfig | findstr "IPv4"`)

## Comandos Útiles

```bash
# Ver información de la red
npm run network-info

# Obtener tu IP local actual
ipconfig | findstr "IPv4"

# Iniciar desarrollo normal (accesible globalmente)
npm run dev

# Iniciar solo frontend
npm run dev:web

# Iniciar solo backend
npm run dev:api
```

---

✨ **SUPRIME - Tienda E-commerce Full Stack**  
Accesible desde cualquier dispositivo en tu red local
