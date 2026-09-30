# PLAN DE MEJORAS SUPRIME — Auditoría 2026-09-29

## Estado actual: 54/54 smoke, typecheck OK, sin overflow, PWA básica

---

## 🔴 CRÍTICO (SEO / Indexación)

| # | Issue | Fix |
|---|-------|-----|
| 1 | **Sitemap.xml devuelve HTML del SPA** (capturado por _redirects `/*`) | Excepción en _redirects → redirigir `/sitemap.xml` a `https://api.suprime.xyz/api/v1/catalog/sitemap.xml` (301) |
| 2 | **Falta og:image** en home, PDP, categorías | Añadir meta `og:image` + `twitter:image` con `/og-cover.jpg` (1200×630) en `index.html` + inyección dinámica en PDP/categoría |
| 3 | **Sin JSON-LD (schema.org)** en PDP / categorías | Inyectar `Product` / `ItemList` / `BreadcrumbList` via `<script type="application/ld+json">` |
| 4 | **Sin sitemap en robots.txt correcto** (apunta a HTML) | Ya apunta a `/sitemap.xml`; fix 1 lo resuelve |

---

## 🟡 ALTO (UX / Conversión / Accesibilidad)

| # | Issue | Fix | Estado |
|---|-------|-----|--------|
| 5 | **Favs/Carrito sin persistencia server-side** (solo localStorage) | Guardar en BD al login y sincronizar (ya medio hecho, verificar merge) | ✅ Verificar |
| 6 | **Checkout sin resumen de pedido visible** en móvil (sticky footer) | Ya implementado `checkout-sticky-footer`, verificar visibilidad | ✅ Verificar |
| 7 | **PDP sin botón "Compartir nativo"** (Web Share API) | Añadir `navigator.share` fallback copiar enlace | ✅ Hecho |
| 8 | **Categorías en home: imágenes con `object-fit: contain` pero sin altura fija → saltos de layout** | `aspect-ratio: 16/9` + `object-fit: cover` en `.category-card-img` | ✅ Hecho |
| 9 | **Botón 2FA en admin muy abajo, se sale del layout** | Mover a header del sidebar o hacerlo sticky | 🔄 |
| 10 | **Sin skeleton en tabla de usuarios/admin** | Añadir `SkeletonTable` mientras carga | 🔄 |
| 11 | **Error 403 en consola (admin step-up)** → ruido | Silenciar o manejar gracefully | ✅ Hecho |
| 12 | **Faltan `alt` descriptivos en imágenes de productos** | Usar `product.name` como alt obligatorio | ✅ Hecho |
| 13 | **Checkout: teléfono sin máscara visual MM/AA** | InputMask ligero o pattern + placeholder visible | ✅ Hecho |

---

## 🟠 CATÁLOGO / ADMIN — NUEVO (pedido 2026-09-30)

| # | Issue | Fix | Estado |
|---|-------|-----|--------|
| 25 | **No se pueden agregar departamentos ni subdepartamentos desde el panel de admin**. Solo hay lectura (`GET /catalog/departments`); crear jerarquía exige SQL manual en D1 | CRUD admin de catálogo + tab "Catálogo" en el panel | ✅ Hecho (commit `75945fb`) |

### **Desglose tarea #25 — Crear departamentos/subdepartamentos desde admin**

**Problema actual**
- `departments` / `subdepartments` solo se leen (público): `catalog.routes.ts` → `GET /catalog/departments`, `GET /catalog/departments/:slug/products`, `GET /catalog/subdepartments/:slug/products`.
- `admin.routes.ts` **no tiene** ninguna ruta de departamentos/subdepartamentos (solo `/stats`, `/users`, `/orders`, `/settings`, `/audit`, `/products`).
- **Acoplamiento hardcodeado**: `admin.routes.ts` línea ~392 → `VALUES (?, 'subdep-demo', ...)` en `POST /admin/products`. Todo producto nuevo cae en el subdemo, aunque el catálogo tenga otra jerarquía.
- `AdminPage.tsx` no tiene selector de subdepartamento en el formulario de producto.

**Trabajo**

| # | Tarea | Archivos | Complejidad |
|---|-------|---------|-------------|
| 25.1 | `GET /admin/catalog` — listar departamentos + subdepartamentos + conteo de productos | `apps/api/src/modules/admin/admin.routes.ts` | ✅ Hecho |
| 25.2 | `POST /admin/departments` (name, slug, is_active) | idem | ✅ Hecho |
| 25.3 | `POST /admin/subdepartments` (department_id, name, slug) | idem | ✅ Hecho |
| 25.4 | `PUT`/`DELETE` de ambos | idem | ✅ Hecho |
| 25.5 | Quitar `'subdep-demo'` hardcodeado → `subdepartment_id` obligatorio + validado en `POST/PUT /admin/products` | idem | ✅ Hecho |
| 25.6 | Tab "Catálogo" 🗂️ en el sidebar admin (formulario + tabla) | `apps/web/src/pages/AdminPage.tsx`, `components/CatalogManager.tsx`, `styles/admin.css` | ✅ Hecho |
| 25.7 | Selector de subdepartamento (por departamento) en el formulario de producto | idem | ✅ Hecho |
| 25.8 | Slug autogenerado + normalizado, con des-dupe | idem | ✅ Hecho |
| 25.9 | Smoke checks nuevos (crear depto → crear subdepto → producto en ese subdepto) | `tests/smoke.mjs` | ✅ Hecho (16 checks) |

**Reglas**
- Permisos: reutilizar el guard de `admin.routes` (misma jerarquía que `/products`; `settings` sigue siendo owner/admin).
- Slug único: `departments.slug` es `UNIQUE`; `subdepartments` tiene `UNIQUE (department_id, slug)`.
- `departments.name` es `UNIQUE` global (ojo al crear homónimos).
- El catálogo público lee `WHERE is_active = 1` en `departments` → un depto inactivo desaparece de la nav.
- Sin migración D1 nueva: las tablas ya existen (`db/migrations/0001_initial.sql`).
- Validar en móvil (390×844) y desktop (1440×900) con `MovilLab/panorama.mjs`.

**Criterio de aceptación**
- ✅ Desde el panel, sin SQL, se puede crear un departamento → un subdepartamento → un producto dentro de ese subdepartamento, y el producto aparece en su URL pública de catálogo.
  Verificado en navegador (2026-09-30): alta de depto y subdepto, producto creado en el subdepto elegido, y
  `GET /catalog/subdepartments/sub-de-prueba/products` lo devuelve. Sin overflow horizontal.

**Desviaciones respecto a lo planificado**
- 25.4: se añadió guarda `409 DEPARTMENT_NOT_EMPTY` / `SUBDEPARTMENT_NOT_EMPTY` en los borrados. Motivo:
  `products.subdepartment_id` es `NOT NULL` **sin** `ON DELETE CASCADE`, así que el `CASCADE` de
  `subdepartments` habría dejado productos huérfanos o un 500 por FK. Se exige antes mover/archivar.
- 25.4: los borrados también pasan por `isSafetyLockOn`, igual que el borrado de productos.
- Extras: `audit_logs` en todas las mutaciones; `PUT` permite reubicar un subdepartamento de departamento;
  toggle de `is_active` (activar/desactivar sin editar).

---

## 🟢 MEDIO (Pulido / Rendimiento / DX)

| # | Issue | Fix | Estado |
|---|-------|-----|--------|
| 14 | **Bundle CSS 142 KB gzip 18 KB** → crítico para móvil 3G | Code-splitting CSS por ruta (Admin, PDP, Checkout) | 🔄 |
| 15 | **Imágenes sin `srcset`/`sizes`** → descargan 900px en móvil | Añadir `srcSet` + `sizes` en ProductCard, PDP hero | ✅ Hecho (`5a878c5`) |
| 16 | **Faltan `width`/`height` en imágenes** → CLS | Añadir `width`/`height` en `<img>` (PDP, Card, CategoryCard) | ✅ Hecho |
| 16 | **Falta `fetchpriority="high"` en hero PDP** | Añadir en PDP hero image | ✅ Hecho |
| 17 | **Sin `preload` de fuentes críticas** | `<link rel="preload" as="font" crossorigin href="...Inter.woff2">` | 🔄 |
| 18 | **Falta `_headers` para Cloudflare Pages** (CSP, HSTS, Permissions-Policy) | Crear `public/_headers` | 🔄 |
| 19 | **Admin: tabla usuarios sin ordenación/paginación visible** | Añadir controles | 🔄 |
| 20 | **Configuración: sin validación visual de puertos/envío** | Toast confirmación + validación numérica | 🔄 |
| 21 | **Falta página 404 personalizada** (SPA fallback usa index.html) | Página 404 amigable con búsqueda | 🔄 |
| 22 | **Falta `robots.txt` con `Host:` y `Sitemap:` absolutos** | Ya está, verificar | ✅ Hecho |
| 23 | **Checkout: botón "Proceder" deshabilitado hasta validar todo** | Ya está, verificar UX | ✅ Verificar |
| 24 | **Sin tests E2E (Playwright)** | Añadir suite crítica: login→add→checkout | 🔄 |

---

## 📊 **AUDITORÍA PAGESPEED INSIGHTS — 2026-09-30 (prod)**

Ejecutado con Lighthouse 13.5.0 sobre `https://suprime.xyz`, emulación Moto G Power (móvil)
y escritorio. API `pagespeedonline` devolvió 429 (cuota compartida agotada), datos obtenidos
del informe web.

| Métrica | Móvil | Escritorio |
|---------|-------|------------|
| **Rendimiento** | **81 → 90** ✅ | **97** |
| Accesibilidad | 96 → 91 | 96 |
| Buenas prácticas | 100 | 100 |
| SEO | 100 | 100 |
| FCP | 2,9 s → 2,8 s | 0,7 s |
| **LCP** | **3,6 s → 2,9 s** ✅ | 0,8 s |
| TBT | 0 ms ✅ | 0 ms ✅ |
| CLS | 0 ✅ | 0,091 |
| Speed Index | 5,9 s → 2,8 s | 0,7 s |

> **Verificado en producción tras el push de `fdde31a`**: el rendimiento móvil subió de 81 a 90
> y desaparecieron de la lista tanto "Desglose de LCP" como "Solicitudes que bloquean el
> renderizado", que eran ambos síntomas del banner de cookies. Queda pendiente medir el
> escritorio y el LCP de nuevo cuando Cloudflare Fonts esté activo.

### **Hallazgo crítico: el LCP móvil es el banner de cookies**

Desglose de LCP (móvil): **Time to First Byte 0 ms** · **Retraso de renderizado 3330 ms**.
El elemento LCP es el texto del banner de cookies ("Usamos almacenamiento técnico…"),
no una imagen ni el contenido principal.

Causa: `CookieBanner.tsx` monta con `useState(false)` y lo activa en un `useEffect` posterior,
así que aparece **después** del primer render. Al ser un bloque fijo grande y lo último en
pintarse, se convierte en el LCP. El escritorio no lo sufre porque renderiza antes de que
corra el efecto.

**Impacto**: es la causa prácticamente única del 81 en móvil. Arreglarlo sube el LCP de 3,6 s
a ~1 s y el rendimiento de 81 a ~95+.

### **Resto de oportunidades (por ahorro)**

| # | Oportunidad | Ahorro | Nota |
|---|-------------|--------|------|
| 26 | **Banner de cookies como LCP** (P0) | ~1200 ms + LCP | ✅ Hecho — el LCP pasa a coincidir con el FCP |
| 26b | **CSS de Google Fonts render-blocking** (P0) | FCP | ✅ Hecho — `media="print" onload` + `<noscript>` de seguridad |
| 26c | **`_headers` ausente: assets sin cachear en el edge** (P0) | `REVALIDATED` → edge | ✅ Hecho — `immutable` 1 año en `/assets/*` |
| 27 | `preload` de fuentes Inter/Playfair Display | — | Tarea 17 ya prevista |
| 28 | CSS sin usar | 17 KiB | Tarea 14 (code-splitting) |
| 29 | JS sin usar | 25 KiB | Tarea 14 |
| 30 | **JS antiguo** (vendor 162 KB) | 11 KiB | Considerar `modulepreload` o bundle moderno |
| 31 | **Imágenes sin formatos modernos** (AVIF/WebP) | 20 KiB móvil / **839 KiB escritorio** | ✅ Hecho (`5a878c5`), en código: Polish y Images son Pro+ |
| 32 | CLS 0,091 en escritorio | — | Algún elemento entra tarde; revisar tras el fix de #26 |
| 33 | Animación no compuesta (1 elemento) | — | Usar `transform`/`opacity` |
| 34 | Tarea larga en hilo principal (1) | — | Revisar tras code-splitting |
| 35 | Targets táctiles pequeños (a11y) | — | `--` |
| 36 | Roles ARIA en elementos no compatibles | — | Revisar `aria-modal="false"` en CookieBanner |
| 37 | Enlaces idénticos con distinta finalidad | — | Footer |

> Tareas 14/17 (code-splitting y preload) ya estaban en la lista; este bloque las **confirma con
> datos reales** y añade la prioridad correcta: el P0 es el banner, no el code-splitting.

---

## 📸 **BLOQUE DE IMÁGENES — 2026-09-30 (`5a878c5`): el `srcset` era mentira**

Tareas #15 y #31, cerradas. El hallazgo no fue "falta AVIF": fue que **el `srcset` que ya
existía no hacía nada**.

**Causa raíz.** Todas las imágenes del catálogo están en Unsplash (`?w=900`), no en ImageKit
(que solo recibe las subidas nuevas desde el panel). El helper `thumb()` aplicaba `?tr=w-N`
**solo** si la URL era de ImageKit; en cualquier otro host devolvía la URL intacta. Como
`ProductCard` construía el `srcset` con `thumb(url, 400)` y `thumb(url, 800)`, para Unsplash
las dos entradas eran **la misma URL con distinto descriptor de anchura**. El navegador
cumplía la spec, elegía la entrada de 800w y bajaba la foto a 900px. En el buscador de la
cabecera pasaba algo peor: una imagen de 900px dentro de una caja de 100px.

**Por qué importa el orden de trabajo**: un `srcset` que miente es peor que no tener
`srcset`, porque el inspector da la impresión de que ya está optimizado.

**Qué se ha hecho**

| Pieza | Detalle |
|-------|---------|
| `apps/web/src/lib/images.ts` | Adaptadores por proveedor: ImageKit `tr=w-,h-,q-,f-avif\|f-webp`; Unsplash `w=`, `h=`, `fit=crop`, `fm=`, `q=`. `imgSrcSet()` devuelve `undefined` si el host no es transformable, para que sea imposible volver a emitir un `srcset` mentiroso |
| `apps/web/src/components/SmartImage.tsx` | `<picture>` con `<source>` AVIF y WebP + `<img>` de reserva con `srcset` en el formato original. Si no hay formatos nuevos, degrada a un `<img>` normal |
| `styles.css` | `picture { display: contents }` — sin esto, los contenedores que miden a su `<img>` hijo (`.pdp-thumb img { height: 100% }`, wrappers con `aspect-ratio`) se rompen |
| Anchos por uso | Tarjetas 200/400/600 (la rejilla es `minmax(160px, 1fr)`, no 400px); hero PDP 400/800/1200; miniaturas 144; buscador 100; lightbox 1200 |

**Gotchas verificados contra los CDN, no de memoria**

- ImageKit **ignora** el `fm-webp`/`fm-avif` de la v1 y devuelve el JPEG original sin avisar.
  Solo convierte con `tr=f-webp` / `tr=f-avif`. Por eso `img-check` existe: un CDN que ignora
  un parámetro es indistinguible de uno que funciona si no se mira el `content-type`.
- `width`/`height` + `srcset` no_crop: en la PDP el diseño pide `object-fit: contain` (foto
  entera, sin recortes), así que **no** se fuerza proporción en el CDN aunque `ImgOpts` lo
  permita con `ar`. Queda pendiente para el CLS de escritorio (#32).

**Medición (mismo navegador, mismas URLs, antes y después en producción)**

| Vista | Antes | Después | |
|-------|-------|---------|---|
| móvil / home | 921 KB / 11 img | 373 KB / 15 img | **-59%** |
| escritorio / home | 921 KB / 11 img | 122 KB / 15 img | **-87%** |
| móvil / PDP | 0 KB (ver abajo) | 212 KB / 9 img | |
| escritorio / PDP | 0 KB (ver abajo) | 67 KB / 9 img | |

Se sirven **más** imágenes que antes y pesan menos de la mitad: la PDP es una página entera que
antes no renderizaba.

### 🔴 Hallazgo colateral: **la PDP estaba en blanco en producción**

Auditar las imágenes llevó a abrir la PDP, que **no renderizaba nada**: React error #310
(*"Rendered more hooks than during the previous render"*). El `useEffect` que actualiza
`og:image`/`twitter:image` estaba declarado **después** de los `return` de carga y de error, así
que el primer render (esqueleto) ejecutaba menos hooks que el render con el producto cargado.
React desmonta el árbol entero y la pantalla se queda vacía.

Cómo se Nk caughtó: el `smoke` de API (70 checks) no lo puede detectar porque no renderiza
nada; el `panorama` de MovilLab sí pasaba por la PDP, pero solo comprobaba `overflowX` y
recogía errores de consola sin mirar el texto renderizado. Ninguna de las dos herramientas
mira "**¿la página se ve?**".

> **Regla añadida a la estrategia de sesión**: ningún hook puede quedar después de un `return`
> condicional. Y el panorama debería fallar si una pantalla clave no tiene texto.

---

## ☁️ **CLOUDFLARE PLAN FREE — QUÉ SE PUEDE ACTIVAR (verificado en docs, 2026-09-30)**

Fuente: documentación pública de Cloudflare. **No se ha consultado la cuenta ni la tarjeta.**

| Feature | Free | Notas para SUPRIME |
|---------|------|--------------------|
| **Speed Brain** | ✅ **Activado por defecto** | Prefetchea páginas siguientes (Chromium 121+). Solo para HTML cacheable que no pase por Worker. **Verificar que esté activo** |
| **Cache Rules** | ✅ 10 reglas | Ver más abajo |
| **Early Hints** | ✅ Sí | En `Speed > Content Optimization`. Solo HTML/200/301/302 |
| **Cloudflare Fonts** | ✅ Sí | **Reescribe Google Fonts al propio dominio**, sin cambios de código. Elimina el third-party y el render-blocking |
| **Content compression (Brotli)** | ✅ Sí | Ya activo: `content-encoding: br` confirmado en prod |
| **HTTP/3 (QUIC)** | ✅ Sí | Ya activo: `alt-svc: h3` confirmado en prod |
| **Tiered Cache** | ✅ Sí | Solo Tiered Cache Smart; el custom es Enterprise |
| Auto Minify / Rocket Loader | ✅ Sí | ⚠️ **No activar Rocket Loader**: rompe la CSP y los scripts `type=module` de Vite |
| Cloudflare Images (transformaciones) | ❌ Pro+ | Polish también es **Pro+** → el P1 de imágenes hay que hacerlo en el código, no en el panel |
| Prefetch URLs | ❌ Solo Enterprise | Speed Brain ya cubre el caso en Free |
| Argo Smart Routing | ❌ Pro+ | — |
| Mirage | ⚠️ Deprecado | No |

### **🔴 Hallazgo: los assets no se cachean en el edge**

Medido sobre producción antes del fix:

| Recurso | `cf-cache-status` | `cache-control` |
|---------|-------------------|-----------------|
| `/` (HTML) | `DYNAMIC` | `public, max-age=0, must-revalidate` |
| `/assets/*.js` | `REVALIDATED` (constante) | `public, max-age=14400, must-revalidate` |
| `/assets/*.css` | `MISS` | `public, max-age=14400, must-revalidate` |

Es decir: **nada se servía desde el edge**, y los bundles se revalidaban en cada visita
(4 horas de TTL) pese a tener hash de contenido en el nombre. Causa: no existía
`apps/web/public/_headers` (tarea #18 del plan, marcada como pendiente desde hacía tiempo).

**Corregido en el bloque P0**: `_headers` con `immutable` y cabeceras de seguridad
(nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP) — todo verificado
vivo en producción.

⚠️ **Parcial**: `immutable` y las cabeceras de seguridad sí se aplican, pero `max-age` sigue
saliendo a `14400` porque Pages fusiona su valor por defecto con el del `_headers`
(`public, max-age=14400, immutable, must-revalidate`). La documentación confirma que `_headers`
debe sobrescribir, así que el valor por defecto de assets de Pages está gainando. **Pendiente:
configurar el TTL de assets en el panel** (ajustes de caché del proyecto en Pages) o usar una
Cache Rule en el plan Free (hay 10 disponibles) para `/assets/*` con Edge TTL de 1 año.

### **Regla de secretos (2026-09-30)**

Los secretos de infraestructura (API token, credenciales R2) **no** están en el repo.
Viven en `C:\Users\VIP\Desktop\Cerebro Obcidian\_SECRETS\cloudflare.env` (fuera de git).
En los `.md` del repo solo se documentan la ruta y los **nombres** de las variables,
nunca los valores. Verificar con `git grep -E "cfat_|cfut_|77e5a9ba"` antes de commitear.

### **Cache Rule de la API — aplicada (2026-09-30)**

Regla creada por API: match `(http.host eq "api.suprime.xyz")` → `set_cache_settings`
con `cache: false` (bypass). Ruleset `4dd3a298...` en la fase `http_request_cache_settings`.
Motivo: la API responde con sesión/cookies; cachearla serviría datos de un usuario a otro.
**Verificado**: `api.suprime.xyz` tiene DNS proxied (nube naranja), condición necesaria
para que la regla aplique.

> El `PUT` al entrypoint fallaba con error 10003 porque la fase no existía: hay que
> crearla primero con `POST /zones/:zone_id/rulesets`. Un `PUT` solo sirve para modificarla.

### **Plan de acción Cloudflare (panel, sin coste) — estado**

1. ✅ **Cache Rule de la API** → creada por API (ver arriba). Ya no queda nada por hacer aquí.
2. **Speed Brain** → `Speed > Content Optimization`: confirmar que está *On* (ya debería estarlo por defecto).
2. **Early Hints** → mismo panel: *On*. Complementa al `preload` de fuentes.
3. **Cloudflare Fonts** → *On*. Sustituye el fix manual de la CSS de fuentes y quita el third-party.
4. **Cache Rules** (10 disponibles) → 2 sugeridas:
   - `hostname eq api.suprime.xyz` → *Bypass* (la API ya es dinámica; no cachedear respuestas con cookies).
   - `uri.path starts_with "/assets/"` → *Eligible for cache* + *Edge TTL 1 año*.
5. **No activar** Rocket Loader (rompe CSP y módulos ES).

> Ninguna de estas necesita plan de pago ni tarjeta.

---

## 📋 ORDEN DE EJECUCIÓN PROPUESTO

> **Resumen operativo en `PENDIENTES.md`** (raíz del repo): qué hacer ahora, en orden de prioridad,
> con el impacto medido de cada uno y los avisos de seguridad. Este bloque es el detalle técnico.

Bloque P0 cerrado (banner + fuentes + `_headers`). Bloque P1 (imágenes) cerrado en `5a878c5`.
Queda:

1. **P5 · Activar en el panel Cloudflare** (gratis, 10 min, sin código): Speed Brain, Early Hints, Cloudflare Fonts, TTL de assets
2. **P2 · Code-splitting CSS/JS** (#14, #28, #29) → 17 KiB CSS + 25 KiB JS sin usar
3. **P3 · Admin UX** (9, 10, 19) → 2FA sticky, skeletons, ordenación
4. **P4 · Infra/DX** (20, 21, 24) → validaciones, 404, Playwright
5. **Re-medir PageSpeed** después de P1: el escritorio (839 KiB) era el mayor gap de la auditoría

Los bloques SEO (1-4), UX conversión (5-13), catálogo admin (25) e imágenes (15, 31) están hechos.

---

## ✅ YA HECHO (No tocar)

- Auth robusto (login, OTP, Google, 2FA, step-up, roles, safety lock)
- Carrito/Favs por cuenta con merge invitado→cuenta
- Checkout con validación completa + sticky footer
- Admin: usuarios, productos, órdenes, settings, 2FA con safety lock
- Catálogo completo desde el panel (deptos, subdeptos, productos) — tarea #25 cerrada
- Modo mantenimiento, safety lock, jerarquía roles
- PWA básica (manifest, icon, theme-color)
- CSP, security headers, rate-limit con KV fallback
- Imágenes responsive + AVIF/WebP (`SmartImage`) — tareas #15 y #31
- Smoke 0 FAIL, typecheck OK, 0 overflow móvil/desk

---

## 📊 ESTADO ACTUAL (2026-09-29)

**Completado esta sesión:**
- ✅ JSON-LD Product + BreadcrumbList en PDP
- ✅ JSON-LD ItemList en categorías/departamentos
- ✅ og:image / twitter:image dinámico en PDP y categorías
- ✅ og-cover.svg creado y referenciado
- ✅ BreadcrumbList JSON-LD en PDP
- ✅ ItemList JSON-LD en categorías
- ✅ BreadcrumbList function fix (category_slug removido)
- ✅ og-cover.svg creado (SVG 1200×630)
- ✅ og:image dinámico en PDP y categorías
- ✅ _redirects fix para sitemap.xml (pendiente deploy)
- ✅ TypeScript errors fixed (gallery scope, maxQty dup, category_slug, Product type)
- ✅ Smoke 54/54 PASS
- ✅ Typecheck OK
- ✅ Build OK

**Pendiente deploy:** sitemap.xml redirect (Cloudflare Pages)

---

## 🔄 ESTRATEGIA

- **Control de tokens antes de cada bloque**: `npm run tokens`. Si no alcanza → avisar
  y cambiar de agente. La cuota/reset del plan gratuito solo se ve en el panel de
  OpenCode Zen (no accesible desde local).
- Un commit por bloque (atómico, reversible)
- Smoke + typecheck + build tras cada bloque
- Deploy a staging (branch) → validar en móvil real → merge a main
- Tag por hito: `seo-done`, `ux-done`, `perf-done`, `infra-done`