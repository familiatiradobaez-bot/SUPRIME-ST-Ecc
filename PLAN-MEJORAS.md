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
| 25 | **No se pueden agregar departamentos ni subdepartamentos desde el panel de admin**. Solo hay lectura (`GET /catalog/departments`); crear jerarquía exige SQL manual en D1 | CRUD admin de catálogo + tab "Catálogo" en el panel | 🔄 Pendiente |

### **Desglose tarea #25 — Crear departamentos/subdepartamentos desde admin**

**Problema actual**
- `departments` / `subdepartments` solo se leen (público): `catalog.routes.ts` → `GET /catalog/departments`, `GET /catalog/departments/:slug/products`, `GET /catalog/subdepartments/:slug/products`.
- `admin.routes.ts` **no tiene** ninguna ruta de departamentos/subdepartamentos (solo `/stats`, `/users`, `/orders`, `/settings`, `/audit`, `/products`).
- **Acoplamiento hardcodeado**: `admin.routes.ts` línea ~392 → `VALUES (?, 'subdep-demo', ...)` en `POST /admin/products`. Todo producto nuevo cae en el subdemo, aunque el catálogo tenga otra jerarquía.
- `AdminPage.tsx` no tiene selector de subdepartamento en el formulario de producto.

**Trabajo**

| # | Tarea | Archivos | Complejidad |
|---|-------|---------|-------------|
| 25.1 | `GET /admin/catalog` — listar departamentos + subdepartamentos + conteo de productos | `apps/api/src/modules/admin/admin.routes.ts` | Baja |
| 25.2 | `POST /admin/departments` (name, slug, is_active) | idem | Baja |
| 25.3 | `POST /admin/subdepartments` (department_id, name, slug) | idem | Baja |
| 25.4 | `PUT`/`DELETE` de ambos (con `ON DELETE CASCADE` ya definido en `0001_initial.sql`) | idem | Media |
| 25.5 | Quitar `'subdep-demo'` hardcodeado → `subdepartment_id` obligatorio + validado en `POST/PUT /admin/products` | idem | Baja |
| 25.6 | Tab "Catálogo" 🗂️ en el sidebar admin (formulario + tabla) | `apps/web/src/pages/AdminPage.tsx`, `styles/admin.css` | Media |
| 25.7 | Selector de subdepartamento (por departamento) en el formulario de producto | idem | Baja |
| 25.8 | Slug autogenerado + normalizado, con des-dupe (patrón ya existente en `POST /products`) | idem | Baja |
| 25.9 | Smoke checks nuevos (crear depto → crear subdepto → producto en ese subdepto) | `tests/smoke.mjs` | Media |

**Reglas**
- Permisos: reutilizar el guard de `admin.routes` (misma jerarquía que `/products`; `settings` sigue siendo owner/admin).
- Slug único: `departments.slug` es `UNIQUE`; `subdepartments` tiene `UNIQUE (department_id, slug)`.
- `departments.name` es `UNIQUE` global (ojo al crear homónimos).
- El catálogo público lee `WHERE is_active = 1` en `departments` → un depto inactivo desaparece de la nav.
- Sin migración D1 nueva: las tablas ya existen (`db/migrations/0001_initial.sql`).
- Validar en móvil (390×844) y desktop (1440×900) con `MovilLab/panorama.mjs`.

**Criterio de aceptación**
- Desde el panel, sin SQL, se puede crear un departamento → un subdepartamento → un producto dentro de ese subdepartamento, y el producto aparece en su URL pública de catálogo.

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

## 📋 ORDEN DE EJECUCIÓN PROPUESTO

1. **Fixes críticos SEO** (1-4) → impacto inmediato en indexación
2. **UX conversión** (5-13) → dinero directo
3. **Catálogo admin** (25) → bloquea la gestión real del catálogo (requiere SQL hoy)
4. **Rendimiento/CLS** (14-17) → Core Web Vitals
5. **Infra/DX** (18-24) → mantenibilidad

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