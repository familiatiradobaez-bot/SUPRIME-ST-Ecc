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

## 🟡 P2 · Code-splitting y JS

| # | Tarea | Ahorro medido |
|---|-------|---------------|
| 14 | CSS code-splitting por ruta (Admin, PDP, Checkout) | 17 KiB CSS sin usar |
| 29 | JS code-splitting / lazy | 25 KiB JS sin usar |
| 30 | JS antiguo (vendor 162 KB) | 11 KiB — considerar `modulepreload` |

Archivos: `vite.config.ts`, `AdminPage.tsx` (lazy). Bloque medio: ~15-20K tokens.

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
| 21 | Página 404 personalizada (`NotFoundPage.tsx`, `App.tsx`) |
| 24 | Suite E2E crítica con Playwright: login → add → checkout |
| 17/27 | `preload` de fuentes Inter/Playfair — **parcialmente resuelto** por Cloudflare Fonts; ver P5 |

---

## 🟢 P5 · Panel de Cloudflare (gratis, sin código, ~10 min)

| Tarea | Estado |
|-------|--------|
| Cache Rule de `api.suprime.xyz` (bypass) | ✅ **Hecho por API.** Ruleset `4dd3a298…`, DNS verificado proxied |
| TTL de assets del proyecto Pages | ⚠️ El usuario dice que está correcto, pero la cabecera sigue en `max-age=14400` + `must-revalidate`. **Pendiente de verificar** |
| Speed Brain | ❓ No verificado (viene activo por defecto en Free) |
| Early Hints | ❓ Pendiente de activar |
| Cloudflare Fonts | ❓ Pendiente de activar. Requiere revisar el CSP si el HTML ya no usa `fonts.googleapis.com` |

**No activar:** Rocket Loader (rompe CSP y módulos ES), Polish/Images/Argo/Prefetch (Pro+ o Enterprise).

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
