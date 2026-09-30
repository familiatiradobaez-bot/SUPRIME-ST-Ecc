# 📋 PRONT.md — HANDOFF PARA EL SIGUIENTE AGENTE (SUPRIME E-COMMERCE)

---

## 📁 **CONTEXTO COMPLETO — SUPRIME E-COMMERCE**

### **Estado Actual (2026-09-30)**
- **Repo**: `C:\Users\VIP\Desktop\Cerebro Obcidian\C proyectos Web` (git `main`, GitHub `familiatiradobaez-bot/SUPRIME-ST-Ecc`)
- **Front**: https://suprime.xyz (Cloudflare Pages, auto-deploy push a `main`)
- **API**: https://api.suprime.xyz (Worker `suprime-st-ecc-api`, `npx wrangler deploy`)
- **Stack**: React+Vite · Hono+Workers+D1 · ImageKit · Email CF/Resend
- **Smoke**: **69 PASS / 1 FAIL / 2 SKIP** ⚠️ (el FAIL es preexistente: `totp setup` vs `safety_lock`)
- **Typecheck**: OK ✅ | **Build**: OK ✅ | **Deploy**: API desplegada ✅ · Front pendiente de push
- **Commit actual**: `75945fb` (Catálogo admin #25 + regla de control de tokens)

---

## 📋 **ARCHIVOS CLAVE PARA EMPEZAR**

| Archivo | Qué contiene |
|---------|--------------|
| `SUPRIME-Continuar.md` | **Contexto completo**: restauración, estado, reglas, historial, pendientes, instrucciones |
| `PLAN-MEJORAS.md` | Plan detallado con tareas ordenadas y estado |
| `tests/smoke.mjs` | 71 checks E2E contra prod (API + Front) |
| `tools/token-check.mjs` | 🔑 Tokens de la sesión (`npm run tokens`) — control previo a cada bloque |
| `MovilLab/panorama.mjs` | Auditoría móvil + desktop (390×844 + 1440×900) |

---

## 🔧 **COMANDOS BÁSICOS**

```powershell
cd "C:\Users\VIP\Desktop\Cerebro Obcidian\C proyectos Web"
npm run tokens      # 🔑 tokens de la sesión (REGLA: antes de cada bloque)
npm run smoke       # 71 checks vs prod (referencia: 69 PASS / 1 FAIL preexistente / 2 SKIP)
npm run typecheck   # api + web
npm run build:web   # build front
npm run backup      # export D1 remoto
npx wrangler deploy # deploy API
npx wrangler d1 migrations apply DB --remote
npx wrangler tail --format pretty
```

---

## 👤 **CREDENCIALES OWNER (SOLO NOMBRES, NO SECRETS)**

| Dato | Valor |
|------|-------|
| Email | `admin@admin.com` |
| Password | `123456` |
| 2FA | TOTP activo (panel admin exige step-up 1h) |
| User | `Jose` / `role-owner` |

> **Solo nombres aquí**. Secrets reales solo en Cloudflare Dashboard / `.dev.vars` local. Rota si se expone.

---

## 📋 **REGLAS OBLIGATORIAS**

| Regla | Detalle |
|-------|---------|
| **Solo agente principal toca código** | Subagentes solo leen y reportan en `Sesiones/SUPRIME-2026-09-29/` |
| **No tocar secrets** | Solo nombres aquí; rotar si se expone |
| **Owner login** | `admin@admin.com` / `123456` + 2FA TOTP |
| **Smoke model** | Admin PASS si 200 con grant **O** 403 `ADMIN_2FA_REQUIRED/SETUP_REQUIRED` |
| **🔑 Control de tokens** | **Antes de CADA tarea/bloque**: `npm run tokens`. Si no alcanza → avisar y cambiar de agente, NO empezar a medias |
| **4 Fantásticos** | Auditoría móvil + desktop via `MovilLab/panorama.mjs` |
| **Commits** | 1 por bloque atómico; smoke + typecheck + build tras cada uno |
| **Tags** | `seo-done`, `ux-done`, `perf-done`, `infra-done` |

---

## 🎯 **PRÓXIMO BLOQUE SUGERIDO (🔴 P0 — Perf, según PageSpeed 2026-09-30)**

PageSpeed sobre `https://suprime.xyz` (Lighthouse 13.5.0): **móvil 81**, escritorio 97.
Accesibilidad 96, buenas prácticas 100, SEO 100. TBT 0 ms y CLS 0 en móvil.

> **Causa raíz del 81**: el LCP móvil (3,6 s) es el **banner de cookies**, con TTFB 0 ms y
> **3330 ms de retraso de renderizado**. Monta en `useEffect`, así que aparece tarde y, al ser
> un bloque fijo grande, se convierte en el elemento LCP. Es el P0: fix pequeño, gain grande.

| Orden | Tarea | Ganancia medida | Complejidad |
|-------|-------|-----------------|-------------|
| **1** | **Banner de cookies: primer render, no `useEffect`** | LCP 3,6 s → ~1 s · **81 → ~95** | **Baja** |
| 2 | Imágenes en AVIF/WebP | 839 KiB (escritorio) | Media |
| 3 | CSS/JS code-splitting | 17 KiB CSS + 25 KiB JS | Media |
| 4 | `preload` fuentes Inter/Playfair | FCP | Baja |
| 5 | `public/_headers` + 404 + Playwright | Infra | Baja/Media |

Detalle completo y resto de hallazgos en `PLAN-MEJORAS.md` (bloque "Auditoría PageSpeed").

| Orden | Tarea | Archivos clave | Complejidad |
|-------|-------|----------------|-------------|
| 1 | `srcset`/`sizes` en ProductCard, PDP, CategoryCard | `ProductCard.tsx`, `ProductPage.tsx`, `HomePage.tsx`, `styles.css` | Media |
| 2 | `preload` fonts Inter/Playfair Display | `index.html`, `vite.config.ts` | Media |
| 3 | CSS code-splitting (Admin, PDP, Checkout) | `vite.config.ts`, `AdminPage.tsx` lazy | Media |
| 4 | `public/_headers` (CSP, HSTS, Permissions-Policy) | `public/_headers` (nuevo) | Baja |
| 5 | Página 404 personalizada | `NotFoundPage.tsx`, `App.tsx` | Baja |
| 6 | Playwright E2E suite crítica | `tests/e2e/` (nuevo) | Alta |

> **Orden sugerido**: 1 → 2 → 3 → 4 → 5 (Perf primero, luego infra)

---

## 🧪 **SMOKE TEST — QUÉ HACE (71 checks)**

```bash
npm run smoke  # 71 checks vs https://api.suprime.xyz/api/v1 + https://suprime.xyz
```

| Sección | Checks |
|---------|--------|
| Salud/Catálogo | health, products, categories, product by slug |
| Auth | login wrong 401, OK 200, /auth/me, shipping CRUD, token falso 401 |
| Admin | /admin/stats (401/200/403), crear producto, users paginado |
| **Catálogo admin** | **validaciones 400/404, crear depto 201 + slug, duplicado 409, crear/editar subdepto, is_active, producto sin y con subdepto, borrados, limpieza** |
| Upload/Galería | auth, listado, paginación, upload, ImageKit |
| Órdenes/Stock | body vacío 400, stock rollback, tel +34, stock insuficiente |
| PDP/Secciones | related, deptos, subdeptos, 404, store-settings |
| Google OAuth | login 302, callback state, exchange code, 2FA, exchange code falso |
| Password Reset | admin step-up, TOTP status/setup (no destructivo), forgot/reset |
| Front | home 200 + bundle, viewport-fit=cover, CSP bigdatacloud |
| Logout | 200 → 401 |

**Config**: `AbortSignal.timeout(20000)`, owner `admin@admin.com`/`123456` (2FA TOTP), admin PASS si 200+grant **O** 403 step-up, **no destructivo** (no regenera 2FA).

> La sección de catálogo crea datos de prueba con sufijo y los limpia. Con `safety_lock` activo los
> borrados se bloquean: avisa con `WARN` y los ids exactos, y salta a SKIP los checks de borrado.

---

## 📊 **ESTADO ACTUAL (2026-09-30)**

| Métrica | Valor |
|---------|-------|
| **Commit actual** | `75945fb` (Catálogo admin #25 + regla de tokens) |
| **Smoke** | 69 PASS / 1 FAIL / 2 SKIP ⚠️ |
| **Typecheck** | OK ✅ |
| **Build** | OK ✅ (vendor 162KB + app 130KB) |
| **Deploy** | API ✅ desplegada (`f4de77aa`) · Front ⏳ pendiente de push |
| **Smoke checks** | 71 (54 + 16 de catálogo + 1 auth) |

> ⚠️ **El FAIL de `totp setup sin step-up 403` es preexistente**: espera `ADMIN_2FA_REQUIRED` pero
> producción tiene `safety_lock` activo y responde `SAFETY_LOCKED`. Se reproduce en el baseline
> (`3f86c2a` = 53 PASS / 1 FAIL). No lo introdujo la tarea #25.

### Commits recientes (HEAD → older)
```
75945fb Catálogo admin (#25) + control de tokens: CRUD depto/subdepto, quita subdep-demo
3f86c2a UX Alto: Web Share API, CategoryCard aspect-ratio, img CLS, tel mask, step-up silencioso
9682c40 SEO: BreadcrumbList JSON-LD, dynamic og:image, og-cover.svg, breadcrumb fix
12abe99 SEO: JSON-LD Product/ItemList, dynamic og:image, sitemap redirect
9dcfecf Móvil: categorías en acordeón
f0c91ae Cuenta: carrito/favs por usuario + última cuenta
... (15 commits totales desde 583c87e)
```

---

## 📋 **PENDIENTES ORDENADOS (ver PLAN-MEJORAS.md)**

| Prioridad | Tarea |
|-----------|-------|
| 🔴 **KV** | Crear namespace `RATE_LIMIT_KV` + binding en `wrangler.toml` |
| ✅ **Catálogo admin** | **Departamentos y subdepartamentos desde el panel** — HECHO (`75945fb`). Tab 🗂️ Catálogo + `GET/POST/PUT/DELETE /admin/{catalog,departments,subdepartments}`. Smoke 69 PASS |
| 🟡 **Admin UX** | 2FA button sticky, skeleton tables, tabla usuarios ordenación |
| 🟢 **Perf** | `srcset`/`sizes`, `preload` fonts, CSS code-splitting, `_headers` |
| 🟢 **Infra** | Página 404, Playwright E2E, `_headers` |
| ⏸️ **Post-lanzamiento** | Legales, Pasarela pago + R2, SMS Twilio |

---

## 🔧 **PUNTO DE RESTAURACIÓN (si algo falla)**

```bash
git reset --hard restore-20260929  # tag: restore-20260929 (commit 583c87e)
npx wrangler deploy                 # redeploy API
npx wrangler d1 execute DB --remote --file=MovilLab/d1-restore-20260929.sql  # si tocó D1
```

---

## 🚀 **PARA EMPEZAR AHORA**

```bash
cd "C:\Users\VIP\Desktop\Cerebro Obcidian\C proyectos Web"
npm run smoke       # confirma 69 PASS / 1 FAIL (preexistente) / 2 SKIP
npm run typecheck   # confirma OK
# Empezar con: srcset/sizes en ProductCard, PDP, CategoryCard
```

---

## 📱 **MOVILLAB (4 Fantásticos — auditoría móvil + desktop)**

```bash
cd MovilLab
node panorama.mjs    # móvil 390×844 + desktop 1440×900 → shots/ + panorama.json
```

**4 Fantásticos**: tester, bug-hunter, configs, UI/UX → reportan en `Sesiones/SUPRIME-2026-09-29/`

---

## ⚠️ **REGLAS DE ORO (NO NEGOCIABLES)**

0. **🔑 Control de tokens ANTES de cada tarea/bloque** — ejecutar `npm run tokens`. Si los tokens libres NO alcanzan para el bloque entero: **avisar al usuario y que cambie de agente**, nunca empezar y dejar el repo a medias. La cuota del plan gratuito y su hora de reset **no son accesibles desde local** (ver panel de OpenCode Zen); el script solo mide el consumo real de la sesión (`tools/token-check.mjs`)
1. **Solo agente principal toca código** — subagentes solo leen/reportan
2. **No tocar secrets** — solo nombres aquí; rotar si se expone
3. **Owner** = `admin@admin.com` / `123456` (2FA TOTP) → step-up 1h en admin
4. **Smoke asume ese modelo** — admin PASS si 200+grant **O** 403 step-up
5. **4 Fantásticos** — auditoría móvil + desktop via `MovilLab/panorama.mjs`
6. **Un commit por bloque** — smoke + typecheck + build tras cada bloque
7. **Tags** — `seo-done`, `ux-done`, `perf-done`, `infra-done`

---

## 📄 **ARCHIVOS DE REFERENCIA RÁPIDA**

| Archivo | Para qué |
|---------|----------|
| `SUPRIME-Continuar.md` | **Leer primero** — contexto completo, restauración, reglas, historial |
| `PLAN-MEJORAS.md` | Plan detallado con tareas, estado, orden de ejecución |
| `tests/smoke.mjs` | 71 checks E2E (leer para entender qué se testea) |
| `MovilLab/panorama.mjs` | Auditoría móvil + desktop automatizada |
| `Sesiones/SUPRIME-2026-09-29/` | Reportes de los 4 Fantásticos |

---

## ✅ **LISTO PARA EMPEZAR**

```bash
cd "C:\Users\VIP\Desktop\Cerebro Obcidian\C proyectos Web"
npm run smoke       # 69 PASS confirmado
npm run typecheck   # OK
# Empezar con: srcset/sizes en ProductCard, PDP, CategoryCard
```

**El proyecto está en excelente estado. ¡A por el bloque Perf/Infra!** 🚀

---

## 📋 **CHECKLIST DE INICIO RÁPIDO**

- [ ] `npm run tokens` → **¿alcanza para el bloque?** si no → avisar y cambiar agente
- [ ] `npm run smoke` → 69 PASS / 1 FAIL (preexistente) / 2 SKIP
- [ ] `npm run typecheck` → OK
- [ ] `npm run build:web` → OK
- [ ] Leer `PLAN-MEJORAS.md` → siguiente tarea: **#25 catálogo admin** (o `srcset`/`sizes`)
- [ ] Ejecutar tarea → smoke + typecheck + build → commit + push
- [ ] `npm run tokens` → comprobar margen tras el bloque
- [ ] Actualizar `PLAN-MEJORAS.md` y `SUPRIME-Continuar.md` al final

**¡Éxitos! El proyecto está en excelente estado.** 🚀