# SUPRIME · Pendientes consolidados (2026-09-30)

> Fuente: `PLAN-MEJORAS.md` (detalle por tarea) + verificación en producción.
> Regenerar este archivo al cerrar cada bloque. **Sesión anterior: contexto bloated (110%), cambiar de agente.**

## Estado base verificado

- Front en producción: `https://suprime.xyz` (Pages, auto-deploy en push a `main`)
- API en producción: `https://api.suprime.xyz` (Worker `f4de77aa`)
- Smoke: **70 PASS / 0 FAIL / 2 SKIP** (los 2 SKIP son correctos: `safety_lock` bloquea borrados)
- PageSpeed móvil: **90** (era 81 → el bloque P0 lo subió)
- Typecheck + build: OK
- D1 limpio: 5 departamentos / 1 subdepartamento / 13 productos

---

## 🔴 P1 · Imágenes (mayor impacto medido que queda)

| # | Tarea | Ganancia | Notas |
|---|-------|----------|-------|
| 31 | AVIF/WebP + `srcset`/`sizes` | **839 KiB** en escritorio, 20 KiB móvil | ⚠️ **Polish y Cloudflare Images son Pro+**: hay que hacerlo en código, no en el panel. ImageKit ya está integrado y puede servir WebP |
| 15 | `srcset`/`sizes` en ProductCard, PDP hero, CategoryCard | — | Parte de #31 |

Archivos: `ProductCard.tsx`, `ProductPage.tsx`, `HomePage.tsx`, `styles.css`

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

1. **P1 imágenes** — mayor ganancia medible, toca front pero es mecánico
2. **P5 panel Cloudflare** — gratis, 10 min, sin riesgo
3. **P2 code-splitting** — bloque medio, esperar a tener contexto
4. **P3 admin UX** — bajo riesgo
5. **P4 infra** — 404 antes que Playwright (más valor por token)
6. **S1-S3 seguridad** — el usuario lo tiene en la mano, no consume tokens de código
