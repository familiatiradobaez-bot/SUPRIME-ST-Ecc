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
| 15 | **Imágenes sin `srcset`/`sizes`** → descargan 900px en móvil | Añadir `srcSet` + `sizes` en ProductCard, PDP hero | 🔄 |
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
| **Rendimiento** | **81** | **97** |
| Accesibilidad | 96 | 96 |
| Buenas prácticas | 100 | 100 |
| SEO | 100 | 100 |
| FCP | 2,9 s | 0,7 s |
| **LCP** | **3,6 s** ❌ | 0,8 s |
| TBT | 0 ms ✅ | 0 ms ✅ |
| CLS | 0 ✅ | 0,091 |
| Speed Index | 5,9 s | 0,7 s |

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
| 26 | **Banner de cookies como LCP** (P0) | ~1200 ms + LCP | Ver arriba. Montar en el primer render, no en `useEffect` |
| 27 | `preload` de fuentes Inter/Playfair Display | — | Tarea 17 ya prevista |
| 28 | CSS sin usar | 17 KiB | Tarea 14 (code-splitting) |
| 29 | JS sin usar | 25 KiB | Tarea 14 |
| 30 | **JS antiguo** (vendor 162 KB) | 11 KiB | Considerar `modulepreload` o bundle moderno |
| 31 | **Imágenes sin formatos modernos** (AVIF/WebP) | 20 KiB móvil / **839 KiB escritorio** | En escritorio es el mayor gap |
| 32 | CLS 0,091 en escritorio | — | Algún elemento entra tarde; revisar tras el fix de #26 |
| 33 | Animación no compuesta (1 elemento) | — | Usar `transform`/`opacity` |
| 34 | Tarea larga en hilo principal (1) | — | Revisar tras code-splitting |
| 35 | Targets táctiles pequeños (a11y) | — | `--` |
| 36 | Roles ARIA en elementos no compatibles | — | Revisar `aria-modal="false"` en CookieBanner |
| 37 | Enlaces idénticos con distinta finalidad | — | Footer |

> Tareas 14/17 (code-splitting y preload) ya estaban en la lista; este bloque las **confirma con
> datos reales** y añade la prioridad correcta: el P0 es el banner, no el code-splitting.

---

## 📋 ORDEN DE EJECUCIÓN PROPUESTO

1. **P0 · Banner de cookies = LCP** (#26) → el fix de mayor impacto medible: 81 → ~95 en móvil. Bloque pequeño y autocontenido
2. **P1 · Imágenes modernas** (#31) → 839 KiB en escritorio, AVIF/WebP
3. **P2 · Code-splitting CSS/JS** (#14, #28, #29) → 17 KiB CSS + 25 KiB JS sin usar
4. **P3 · `preload` de fuentes** (#17, #27) → desbloquea FCP
5. **P4 · Admin UX** (9, 10, 19) → 2FA sticky, skeletons, ordenación
6. **P5 · Infra/DX** (18, 20, 21, 24) → `_headers`, validaciones, 404, Playwright

Los bloques SEO (1-4) y UX conversión (5-13) ya están hechos. El catálogo admin (25) también.

---

## ✅ YA HECHO (No tocar)

- Auth robusto (login, OTP, Google, 2FA, step-up, roles, safety lock)
- Carrito/Favs por cuenta con merge invitado→cuenta
- Checkout con validación completa + sticky footer
- Admin: usuarios, productos, órdenes, settings, 2FA con safety lock
- ⚠️ NO tocar aún: `POST /admin/products` fija `subdepartment_id = 'subdep-demo'` (hardcode). Ver tarea #25 antes de crear productos reales.
- Modo mantenimiento, safety lock, jerarquía roles
- PWA básica (manifest, icon, theme-color)
- CSP, security headers, rate-limit con KV fallback
- Smoke 54/54, typecheck OK, 0 overflow móvil/desk

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