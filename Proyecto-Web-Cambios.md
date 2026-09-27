# Registro de cambios del proyecto

Este archivo registra cada cambio de código, configuración y decisión relevante del e-commerce.

## 2026-09-25 - Inicialización Cloudflare-first

- Se eligió Cloudflare Workers + Hono para la API.
- Se eligió Cloudflare D1 como destino de producción y Wrangler/D1 local para desarrollo.
- Se creó un monorepo mínimo con `apps/api`, `apps/web` y `db`; `packages/contracts` queda reservado para los contratos compartidos del siguiente bloque.
- Se añadió el esquema SQL inicial para roles, usuarios, sesiones, departamentos, subdepartamentos y productos.
- Se añadió una API pública inicial de salud y catálogo.
- Se añadió una pantalla inicial de catálogo en React con estados de carga, error y vacío.
- Se documentó que los tokens de Cloudflare no son necesarios para el desarrollo local. Serán necesarios al crear o vincular recursos remotos.
- Se añadió CORS para permitir el frontend local en `http://localhost:5173`.
- Validaciones completadas: typecheck de API y frontend, build Vite, migración D1 local y seed D1 local.
- Se ajustó la fecha de compatibilidad de Wrangler a `2025-07-18`, última fecha soportada por la versión instalada, evitando el fallback silencioso del runtime local.
- Se reemplazó el operador `&` del script raíz `dev` por `concurrently`, evitando concatenaciones de comandos en Windows.
- Se actualizó Wrangler a la rama 4 para mantener compatibilidad con el runtime local y las herramientas actuales de Cloudflare.
- Se añadió una ruta informativa en `/` para evitar el 404 al abrir la URL base del Worker; la API versionada continúa bajo `/api/v1`.
- `npm install` reporta 2 vulnerabilidades transitorias; quedan pendientes de revisión antes de producción.

### Próximo bloque

1. Extraer repositorio de productos y departamentos conectado a D1.
2. Añadir migraciones de índices y tests de integración.
3. Autenticación por sesión y middleware RBAC.
4. Panel privado de administración.

---

## 2026-09-26 - Conexión de botones a API real, túnel Cloudflare y servidor Node.js

### Backend

- Se creó la migración `db/migrations/0002_orders.sql` con tablas `orders` y `order_items` (estado, total, info de envío, método de pago).
- Se creó `apps/api/src/modules/auth/auth.routes.ts` con endpoints:
  - `POST /api/v1/auth/register` — crear cuenta (SHA-256, Zod validation).
  - `POST /api/v1/auth/login` — iniciar sesión (retorna token + usuario).
  - `POST /api/v1/auth/logout` — cerrar sesión.
  - `GET /api/v1/auth/me` — usuario actual desde token.
- Se creó `apps/api/src/modules/orders/orders.routes.ts` con endpoints:
  - `POST /api/v1/orders` — crear orden (valida stock, descuenta inventario).
  - `GET /api/v1/orders` — historial del usuario.
  - `GET /api/v1/orders/:id` — detalle de orden.
- Se actualizó `apps/api/src/app.ts` para registrar rutas `/auth` y `/orders`.

### Frontend (`apps/web/src/App.tsx`)

- Se añadieron tipos `User` y `Session` para manejo de sesión.
- Se implementó formulario de login + registro con validación y errores.
- Se añadió persistencia de sesión en `localStorage`.
- Se conectó `handleLogin` a `POST /api/v1/auth/login` y `POST /api/v1/auth/register`.
- Se conectó checkout a `POST /api/v1/orders` con items, envío y método de pago.
- Se añadió estado de carga (`actionLoading`) y manejo de errores (`actionError`).
- Se añadió función `handleLogout` con menú de usuario logueado.
- Se actualizó `getApiUrl` para usar la IP local o túnel según el contexto.

### Infraestructura y solución de problemas

- Se aplicó la migración `0002_orders` a la BD local (`npm run db:migrate`).
- Se configuró `wrangler.toml` con puerto fijo `8787`.
- **Problema:** Wrangler se queda colgado en Windows (bug conocido de Wrangler 4.139.0 con Node.js v24). El puerto se abre pero el worker no procesa peticiones.
- **Solución:** Se creó `apps/api/node-server.mjs` — servidor Node.js con `tsx` que ejecuta el worker de Hono directamente, usando `better-sqlite3` como adaptador D1.
- Se instaló `better-sqlite3` y `tsx` como dependencias de desarrollo.
- Se instaló Deno vía winget pero no funcionó (problemas de PATH).

### Acceso desde el móvil

- Se crearon dos túneles de Cloudflare:
  - Frontend: `https://phases-exceptional-wheels-sunset.trycloudflare.com`
  - API: `https://difference-january-packets-alt.trycloudflare.com`
- Se actualizó CORS del API para permitir `localhost:5173-5176`, `192.168.0.105:5176` y `https://phases-exceptional-wheels-sunset.trycloudflare.com`.
- Se actualizó `vite.config.ts` con `allowedHosts` para el túnel.
- Se añadieron reglas de firewall de Windows (puertos 5176 y 8789).
- Se configuró el frontend para usar el túnel HTTPS de la API cuando se accede desde `trycloudflare.com`.

### Comandos útiles

```bash
# Iniciar API con Node.js (reemplazo de Wrangler)
cd apps/api && npx tsx node-server.mjs

# Iniciar frontend
cd apps/web && npm run dev

# Túnel frontend
npx cloudflared tunnel --url http://localhost:5176

# Túnel API
npx cloudflared tunnel --url http://localhost:8789

# Verificar API
curl http://localhost:8789/api/v1/health
```

### Pendiente

1. Reiniciar la app de OpenCode Desktop para conexión de navegador.
2. Probar registro y login desde el móvil.
3. Extraer repositorio de productos y departamentos conectado a D1.
4. Tests de integración.

---

## 2026-09-27 — Corrección de bugs y examen final

### Bugs corregidos (15 total)

#### Crítico
- **CRIT-01**: Eliminada duplicación de `const orderId` en `orders.routes.ts` (línea 81).

#### Alta severidad
- **AL-05**: `cartTotal` ahora valida que `price_cents` no sea `null` antes de calcular.
- **AL-06**: Checkout filtra productos inexistentes antes de enviar la orden.
- **AL-07**: `GET /orders/:id` ahora verifica autenticación y que el usuario sea dueño de la orden.
- **AL-08**: `POST /auth/logout` ahora valida el token antes de eliminar la sesión.

#### Media severidad
- **MD-07**: Fetch de productos con reintento automático (máx 3 intentos) con backoff exponencial.
- **MD-08**: Validación de stock al agregar al carrito (no permite agregar más de lo disponible).
- **MD-09**: Eliminada función redundante `getApiUrlValue`.
- **MD-10**: Agregada validación de tarjeta (número, expiración, CVV) cuando `payment_method = card`.
- **MD-11**: Verificación de expiración de sesión al restaurar desde `localStorage`.
- **MD-12**: URL del API ahora usa `window.location.protocol` en lugar de hardcodear `http`.
- **MD-13**: URL del túnel de Cloudflare ahora se deriva dinámicamente del nombre del túnel.

#### Baja severidad
- **BJ-09**: `addedToCartId` movido antes de `handleAddToCart` y usa `useRef` para el timeout.
- **BJ-10**: Cleanup en `useEffect` del fetch con flag `cancelled`.
- **BJ-11**: `setTimeout` de `addedToCartId` ahora se limpia correctamente.

### Falsos positivos (3)
- **MD-14**: Transacciones `BEGIN IMMEDIATE` — limitación del adaptador `better-sqlite3`, no un bug.
- **BJ-12**: Token = ID de sesión — diseño funcional.
- **BJ-13**: INSERT en orders — el conteo de placeholders era correcto.

### Productos de prueba agregados (5)
- Auriculares Bluetooth Pro (79.90€, 25 unidades)
- Teclado Mecánico RGB (129.90€, 18 unidades)
- Ratón Gaming Inalámbrico (59.90€, 30 unidades)
- Monitor 27" 4K UHD (349.90€, 8 unidades)
- Webcam 1080p Full HD (49.90€, 22 unidades)

### Estado final
- Frontend: Compila sin errores, corriendo en `localhost:5173`
- Backend: Compila sin errores, corriendo en `localhost:8789`
- Base de datos: 6 productos totales
- Health check: OK

### Próximos pasos sugeridos
1. Extraer repositorio de productos y departamentos conectado a D1.
2. Añadir tests de integración.
3. Implementar Google OAuth 2.0.
4. Configurar producción (D1 remoto, dominio propio).