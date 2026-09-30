# SUPRIME · Pendientes consolidados (2026-09-30)

> Fuente: `PLAN-MEJORAS.md` (detalle por tarea) + verificación en producción.
> Regenerar este archivo al cerrar cada bloque.

## Estado base verificado

- Front en producción: `https://suprime.xyz` (Pages, auto-deploy en push a `main`)
- API en producción: `https://api.suprime.xyz` (Worker `f4de77aa`)
- Smoke: **55 PASS / 0 FAIL / 5 SKIP** · con grant de step-up vigente son 70 PASS / 2 SKIP
  (sin grant, los 5 SKIP son checks de catálogo admin que exigen el 2FA y el smoke no puede
  hacerlo; con grant, los 2 SKIP son los borrados por `safety_lock`)
- PageSpeed móvil: **90** (era 81 → el bloque P0 lo subió). Pendiente re-medir tras el de imágenes
- Typecheck + build: OK
- D1 limpio: 5 departamentos / 1 subdepartamento / 13 productos

---

## ✅ Hecho · P1 Imágenes (`5a878c5`)

**Causa raíz de los 839 KiB**: todas las imágenes de producción son de **Unsplash**, no de
ImageKit, y el antiguo `thumb()` solo transformaba URLs de ImageKit. Para el resto devolvía la
URL sin tocar, así que el `srcset` de `ProductCard` acababa con dos entradas **al mismo
fichero** (400w y 800w con URL idéntica): el navegador elegía la de 800w y descargaba la foto a
900px. En el buscador, además, se pedía la imagen a 900px para una caja de 100px.

- `apps/web/src/lib/images.ts` (transformaciones por proveedor) +
  `apps/web/src/components/SmartImage.tsx` (`<picture>` con AVIF/WebP) +
  `picture { display: contents }` para no tocar el CSS de cada componente.
- Medido con el mismo navegador y las mismas URLs, antes y después en **producción**:

| Vista | Antes | Después | |
|-------|-------|---------|---|
| móvil / home | 921 KB | 373 KB | **-59%** |
| escritorio / home | 921 KB | 122 KB | **-87%** |
| móvil / PDP | — (rota) | 212 KB | |
| escritorio / PDP | — (rota) | 67 KB | |

- Verificación: `npm run img:check` (transformaciones contra los CDN reales),
  `npm run imgs` en `MovilLab/` (peso real por pantalla), panorama 7 pantallas × 2 viewports.
- Gotcha de CDN: ImageKit **ignora** el `fm-webp` antiguo; solo convierte con `tr=f-webp` / `f-avif`.
- Las imágenes de admin (`ImageKit` galería y QR de 2FA) no se tocan: son de otro flujo.

---

## 🔴 P0 · Encontrado y arreglado en el mismo commit (`5a878c5`)

**La PDP estaba en blanco en producción.** El `useEffect` que actualiza `og:image` estaba
declarado **después** de los `return` de carga/error: al pasar del esqueleto al producto React
veía más hooks que en el render anterior y tumbaba el árbol entero (error #310). Movido por
encima de los `return` condicionales y verificado en producción.

> **Regla para los siguientes bloques**: ningún hook (`useState`/`useEffect`/`useMemo`…) puede
> quedar después de un `return` condicional. Ni el smoke ni los checks de API lo detectan — es
> un fallo de render. Solo se ve abriendo la página en un navegador.

---

## ✅ Hecho · P2 Code-splitting (`cd86000`)

`React.lazy` + `Suspense` para el panel de admin, las rutas (PDP, catálogo, favoritos,
legales, 404) y los modales de cuenta/carrito/checkout. `admin.css` (16,7 KB) se importa
desde `AdminPage.tsx` para que viaje en su chunk y no en el bundle inicial.

| Bundle inicial (lo que descarga un visitante) | Antes | Después | |
|---|---|---|---|
| JS | 133 KB | 48 KB | **-85 KB** |
| CSS | 145 KB | 134 KB | -11 KB |
| **Total** | **440 KB / 108 KB gzip** | **343 KB / 86 KB gzip** | **-22,8 KB gzip (-21%)** |

`AdminPage` queda en 40,7 KB + 12,3 KB de CSS que solo se piden al abrir el panel.

> **Trampa**: un componente `lazy` necesita su límite de `Suspense`. La primera versión dejó
> `LoginForm` y `CheckoutForm` fuera de él y el login dejó de funcionar (React se queda sin
> fallback y el árbol no monta). Lo cazó el panorama al fallar el login; el smoke de API no
> lo ve porque no renderiza nada.

---

## 🟡 P3 · Admin UX (nada bloquea, todo son tablas y estados)

| # | Tarea |
|---|-------|
| 9 | Botón 2FA sticky en el sidebar del admin |
| 10 | Skeleton en la tabla de usuarios |
| 19 | Ordenación/paginación visible en tabla de usuarios |
| 20 | Validación visual en Configuración (puertos/envío) + toast de confirmación |

---

## 🟢 P4 · Infra y DX

| # | Tarea |
|---|-------|
| 24 | Suite E2E crítica con Playwright: login → add → checkout |
| 17/27 | `preload` de fuentes Inter/Playfair — **parcialmente resuelto** por Cloudflare Fonts; ver P5 |
| 30 | JS antiguo (vendor 162 KB) | ⚪ Sin hacer: es React + React Router, 52,8 KB gzip. Modernizar el bundle no compensa el riesgo |

✅ **21 · Página 404** cerrada en `a51f362`: `NotFoundPage` con la ruta que falló, buscador que
lleva a la home filtrada, salidas a tienda/contacto y `noindex,follow` mientras está montada.
`/producto/:slug` sigue con su propio "Producto no encontrado" (más preciso: la ruta sí existe).
Limitación conocida: Cloudflare Pages sirve la SPA con 200 en toda ruta (`/* /index.html 200`), así
que no hay 404 HTTP real sin una Pages Function; se controla el `noindex` en su lugar.

---

## 🟢 P5 · Panel de Cloudflare (gratis, sin código) — verificado por API 2026-09-30

| Tarea | Estado |
|-------|--------|
| Early Hints | ✅ **Ya estaba `on`** (la nota anterior decía "pendiente") |
| Brotli / HTTP3 / IPv6 | ✅ on |
| Rocket Loader | ✅ off (rompería la CSP y los módulos ES) |
| TTL de assets del proyecto | ✅ **`browser_cache_ttl` = 1 año**: el `max-age=14400` ya no sale. En vivo: `max-age=31536000, immutable` |
| Cache Rule `/assets/*` (edge) | ✅ **Creada** (`suprime_assets_1y`): los assets pasaron de `MISS` en cada visita a `HIT` |
| Cache Rule de la API (bypass) | ⚪ **innecesaria**: la API es un Worker y no pasa por la caché de la zona (no devuelve `cf-cache-status`). Se deja la que hay, no estorba |
| Speed Brain / Tiered Cache | ⚪ No expuestos por la API (solo panel). Speed Brain viene activo por defecto en Free |
| Cloudflare Fonts | ❓ Sin verificar. Hay que revisar la CSP si el HTML deja de usar `fonts.googleapis.com` |
| `always_use_https` | 🔴 **off, y la API sirve http en claro** → ver abajo |

**🔴 Nuevo, y lo primero que arreglaría**: `http://api.suprime.xyz/api/v1/health` responde
**200 sin redirigir**, mientras `http://suprime.xyz/` sí da 301. El subdominio del Worker acepta
peticiones sin cifrar (login incluido). La app no usa http, pero el arreglo son 30 s:
**Workers → Routes → `api.suprime.xyz` → Settings → "Redirect HTTP to HTTPS" → On**.
Por API haría falta un token con *Zone Settings: Edit*; el de `_SECRETS/` no lo tiene
(403 `10000`), y para las reglas de caché sí sirve el `..._LEGACY_RULESETS_ONLY`.

**No activar:** Rocket Loader, Polish/Images/Argo/Prefetch (Pro+ o Enterprise). `minify` se deja
apagado: Vite ya minifica y el HTML pesa 3,6 KB.

> Detalle en la sección "Plan de acción Cloudflare" de `PLAN-MEJORAS.md`.

---

## 🟢 P6 · Limpieza de Core Web Vitals (cola larga, - bajo impacto)

| # | Tarea |
|---|-------|
| 32 | CLS 0,091 en escritorio — revisar tras el fix del banner |
| 33 | Animación no compuesta (1 elemento) → usar `transform`/`opacity` |
| 34 | Tarea larga en hilo principal (1) |
| 35 | Targets táctiles pequeños (a11y) |
| 36 | Roles ARIA en elementos no compatibles — **parcialmente hecho** (banner de cookies arreglado) |
| 37 | Enlaces idénticos con distinta finalidad (footer) |

---

## 🔴 Tareas de seguridad / mantenimiento (del usuario, no del código)

| # | Tarea |
|---|-------|
| S1 | **Rotar secretos expuestos**: API tokens `cfat_`/`cfut_` y clave R2. Pasos en `_SECRETS/cloudflare.env` |
| S2 | Crear token Cloudflare nuevo con **alcance mínimo** (D1, Workers, R2), no "All permissions" |
| S3 | Namespace `RATE_LIMIT_KV` en `wrangler.toml` (usado como fallback en memoria hoy) |
| S4 | Revisar `SEGURIDAD_CSRF_DESACTIVADA.md` (heredado, sin revisar) |

---

## ⏸️ Post-lanzamiento (aparcado)

- Legales con asesor (los textos actuales son plantilla)
- Pasarela de pago + R2 (ya está el endpoint configurado, falta la pasarela)
- Verificación de teléfono por SMS (Twilio, con coste)

---

## Orden recomendado

1. ~~**P1 imágenes**~~ — ✅ hecho (`5a878c5`)
2. **P5 panel Cloudflare** — gratis, 10 min, sin riesgo
3. **P2 code-splitting** — bloque medio, esperar a tener contexto
4. **P3 admin UX** — bajo riesgo
5. **P4 infra** — 404 antes que Playwright (más valor por token)
6. **S1-S3 seguridad** — el usuario lo tiene en la mano, no consume tokens de código
7. **Re-medir PageSpeed** móvil y escritorio: el bloque de imágenes debería empujar el
   escritorio por encima de 97. En móvil sigue atado al DPR 3 (las tarjetas piden 600px)
