# SUPRIME · Pendientes consolidados (2026-09-30)

> Fuente: `PLAN-MEJORAS.md` (detalle por tarea) + verificación en producción.
> Regenerar este archivo al cerrar cada bloque.

## Estado base verificado

- Front en producción: `https://suprime.xyz` (Pages, auto-deploy en push a `main`)
- API en producción: `https://api.suprime.xyz` (Worker `2d52ec33`)
- Smoke: **68 PASS / 0 FAIL / 1 SKIP** · E2E (Playwright): **20/20** (10 móvil + 10 escritorio)
- Typecheck + build: OK
- D1: 3 usuarios (owner, admin, `smoke@suprime.xyz`) · 5 departamentos / 1 subdepartamento / 13 productos
- Lighthouse (local, `MovilLab/psi.mjs`): escritorio home **92** (LCP 1,0 s · TBT 40 ms · CLS 0,154) ·
  PDP 83. **Móvil no es fiable desde esta máquina**: la home dio 52, 0 y 91 (build local) en tres
  corridas seguidas; la PDP dio 80 y 54. Con la CPU compartida y el throttling 4× de Lighthouse la
  medida de móvil hay que tomarla con la máquina descargada, o desde la API de PageSpeed (hoy
  agotada: 429 por cuota diaria).

---

## ✅ Hecho · Smoke con TOTP (spec de `SUPRIME-Continuar.md`)

Los 5 SKIP ya no son un atajo que falta: son 5 checks que **se ejecutan de verdad** y que, además,
**verifican el candado en vez de esquivarlo**. `55/0/5` → `68/0/1`.

- `tools/smoke-setup.mjs` (`npm run smoke:setup`): crea/repara `smoke@suprime.xyz` con rol
  `role-stock-manager` (**no owner**) y su secreto TOTP, y deja las credenciales en
  `_SECRETS/smoke.env`, fuera del repo. Idempotente.
- `tests/smoke.mjs`: credenciales por `process.env` (con `_SECRETS/smoke.env` como respaldo); sin
  ellas avisa y sale con código 2. **Fuera la contraseña del owner que estaba escrita en el archivo.**
- El smoke **revoca** el grant, exige `403 ADMIN_2FA_REQUIRED`, pide el step-up con TOTP calculado y
  exige `200`. Con grant vivo, un 403 de admin ya es FAIL y no un resultado aceptable.
- El único SKIP que queda es el flujo que crea depto/subdepto/producto: `safety_lock` bloquea la
  limpieza, y el smoke lo detecta con un probe y se salta **en vez de dejar basura en el catálogo de
  producción** en cada corrida. Los restos de corridas viejas se limpiaron por SQL.

### 🔴 Bug de producción que destapó el propio smoke

`admin.routes.ts` `roleLevel()` quitaba el prefijo `role-` y ya, pero el id en D1 es
**`role-stock-manager`** (guion) y `roleRank` tiene **`stock_manager`** (subrayado). Nivel 0 →
**todo `/admin/*` devolvía 403 FORBIDDEN** a un stock manager que sí se autenticaba y pasaba el 2FA.
El front ya lo daba por bueno (`AdminPage` oculta solo Usuarios y Configuración a ese rol).
Corregido normalizando guion y subrayado. **El smoke con TOTP es lo que lo encontró**: sin grant,
ese 403 se aceptaba como respuesta correcta.

---

## ✅ Hecho · Pantalla en blanco por chunk que no carga

**Síntoma**: al abrir el panel, la página se quedaba en blanco. Sin header, sin footer, sin mensaje.

**Causa**: Cloudflare Pages sirve la SPA con 200 en cualquier ruta que no exista
(`/* /index.html 200`), y `_redirects` **no admite devolver 404** (doc: *"Rewrites (other status
codes): no"*). Para un `/assets/*.js` o `*.css` que aún no existe en un nodo, la respuesta es el
`index.html` con `content-type: text/html`. El navegador rechaza el módulo ES por MIME, el import
dinámico revienta y, sin nada que capturara el error, React desmontaba el árbol entero.

Peor: la **Cache Rule de `/assets/*` (1 año) guardaba ese HTML bajo una URL de `.js`**, y `_headers`
hace lo mismo por ruta (Pages aplica las cabeceras al fallback también). Se vieron **dos objetos
cacheados para la misma URL** (uno `application/javascript`, otro `text/html`) alternando según el
cliente. Y el JS del panel fallaba porque Vite emite la CSS del chunk como archivo aparte: si ese
CSS no baja, el import dinámico **entero** falla, no solo la CSS.

| Qué | Por qué |
|---|---|
| `ErrorBoundary` en rutas, modales y panel | Un fallo de descarga deja de ser una pantalla en blanco: mensaje + botón de recargar |
| `vite:preloadError` → recarga una vez | El archivo que faltaba ya está; si insiste, lo muestra el ErrorBoundary (sin bucle) |
| `admin.css` vuelve al bundle inicial | El panel pasa a ser un único chunk de JS sin dependencia de CSS. Cuesta 16,7 KB crudos / 2,5 KB gzip (CSS inicial 134 → 148 KB) |
| **Cache Rule de `/assets/*` eliminada** | Una CDN que cachea un fallback con TTL de un año bajo una URL de asset es peor que no cachear en el edge. Los assets siguen con `max-age` de un año **en el navegador** (content-hash) |
| `tools/purge-assets.mjs` + paso en CI | Purga `/assets/*` **y los ficheros de la raíz**, y ahora **espera al despliegue** (ver más abajo) |
| `waitForDeploy()` en el E2E | Si un chunk se sirve como HTML, falla con un mensaje claro en vez de un error de MIME sin pistas |

### 🔴 Lo que salió al cambiar el logo: la caché de la raíz tenía TTL de un año

Al cambiar el icono de marca se vio que **el icono nuevo no llegaba a quien ya había visitado la
web**. No es un error de nada: es caché, y Cloudflare no avisa.

- **Pages sirve la raíz con `max-age=31536000` por defecto.** Los bundles de `/assets/*` llevan hash,
  así que un año no importa. Pero `/favicon-32.png`, `/icon-192.png`, `/rayo-128.png`, `/config.js`
  **no llevan hash**: cambiar o borrar uno tardaba un año en llegar.
- **`_headers` no servía para nada en la raíz.** Dos motivos, ambos medidos con una sonda
  (`X-H-Probe`, cabecera que Cloudflare no toca): el fichero estaba **corrupto** (los acentos
  escritos como bytes rotos, y Pages lo parsea línea a línea), y además yo **dupliqué dos rutas**
  (`/favicon-32.png` y `/rayo-128.png`), cosa que hace que Pages aplique un bloque y descarte el
  otro. Aun arreglado eso, **Cloudflare sobrescribe el `Cache-Control`**: la sonda aparecía, el
  `Cache-Control` no.
- **Solución: `tools/cache-rule-root.mjs`** crea la Cache Rule `root-static-short-cache` en el
  ruleset de la zona (que estaba vacío). `browser_ttl` 1 h y `edge_ttl` 1 día para los 13 ficheros de
  la raíz. Los bundles siguen a un año, que es lo correcto.
- **La purga de CI se ejecutaba antes de que existiera el despliegue.** Pages despliega en un
  proceso asíncrono de ~5 min; la purga corría a los 3-4. Medido: purga a las 17:32, despliegue a
  las 17:35, y `/icon.svg` seguía sirviendo un fichero ya borrado del repo. Ahora
  `purge-assets.mjs --espera-deploy` espera a `deploy=success` del commit actual.
- **Lección:** `?cb=` **no** sirve para saltarse la caché. Pages incluye el query string en la
  búsqueda del asset, así que `config.js?cb=1` cae al fallback de la SPA y devuelve `text/html`.

---

## 🚧 Aparcado · CSS de admin duplicado entre `styles.css` y `styles/admin.css`

Quedan **44 selectores de admin definidos en las dos hojas**, que se cargan las dos
(`admin.css` va la última en `main.tsx`, así que sus reglas ganan). Consequences today:

- **No rompe nada**: por el orden de importación, cuando ambas definen la misma propiedad gana
  `admin.css`.
- **Ya ha causado un bug real** (2026-09-30): `.primary-badge` tenía `top` en `styles.css` y
  `bottom` en `admin.css`. Con los dos a la vez, un absoluto de altura automática se estira de
  arriba abajo y ocupaba el **58% de la miniatura del producto**, con un cuadro morado encima de la
  foto. Se quitó la copia de `styles.css` y quedó en 12%.
- **Unificar las dos hojas sigue aparcado**, y el motivo es el mismo de siempre: es un cambio
  visual de todo el panel y merece su propia verificación pantalla a pantalla. Se intentó
  automáticamente y se revirtió: un borrado a ciegas de 46 selectores perdía propiedades
  (`padding` del sidebar, fondo de los items) y terminó corrompiendo un bloque dentro de un
  `@media`. El intento automático queda en el historial; la limpieza, a mano.

---

## ✅ Hecho · Rate-limit distribuido de verdad (S3)

El namespace `RATE_LIMIT_KV` estaba creado pero **solo lo usaba `/auth/google/exchange`**: login,
forgot, verify/reset, resend, 2FA y las subidas de ImageKit tenían sus propios `Map` en memoria. En
Workers cada isolate tiene la suya, así que *"5 intentos de login"* eran 5 **por isolate**.

- Login cuenta **fallos**, no intentos, en dos cubos: **por IP (30/15 min)** corta el barrido
  automatizado y **por cuenta (5/15 min)** corta el ataque a una cuenta concreta desde IPs
  distintas — que es justo lo que el cubo por IP no veía. Con acierto se vacía el cubo de la cuenta
  (tres tecleos y entrar bien no debe dejarte con 2 de 5 gastados).
- El **registro** también lleva límite (5/15 min): manda correo y crea filas.
- `GET /upload/rate-limit-status` leía el `Map` a pelo; ahora usa `peekRateLimit()`, que lee el KV
  sin consumir intento.

> Verificado en producción: 6 aciertos seguidos pasan, 5 fallos a una cuenta cortan, y los fallos de
> una cuenta no bloquean a otra. Antes el smoke y la suite E2E se bloqueaban entre ellos y en 15
> minutos no se podía ni entrar con la clave correcta.

---

## ✅ Hecho · El grant de 2FA se podía cerrar

`admin_stepup` vivía 1 hora sin forma de revocarlo: "salir del panel" no cerraba el panel.

- `POST /auth/admin-stepup/revoke` + botón **🔒 Bloquear panel** en el sidebar (tira el grant sin
  cerrar la sesión de la tienda).
- `POST /auth/logout` revoca también el grant: cerrar sesión cierra el panel.

---

## ✅ Hecho · P3 Admin UX (#9 #10 #19 #20)

| # | Tarea | |
|---|-------|---|
| 9 | Botón 2FA sticky en el sidebar | Hecho: el scroll lo lleva la zona de pestañas y el pie queda fijo, con **Bloquear panel** |
| 10 | Skeleton en la tabla de usuarios | Hecho (`.skeleton-row`, con `prefers-reduced-motion`) |
| 19 | Ordenación/paginación en usuarios | Hecho: `?sort=`/`?dir=` con **allowlist** de columnas y desempate por id en SQL; cabeceras ordenables y paginación de 20 en 20 |
| 20 | Validación visual en Configuración + toast | Hecho: validación con los mismos límites que el servidor, error bajo el campo con `aria-invalid`, toast con `role=status` |

**Bug corregido de paso**: los campos de portes pintaban `parseInt(valor)/100` sobre el valor ya
editado, así que al cambiar el envío a 5,50 el campo se recolocaba a **0,05** en cuanto se tocaba
otro campo. Ahora el borrador va en euros (que es lo que espera el servidor) y tras guardar se releen
los ajustes del servidor.

---

## ✅ Hecho · P4 E2E con Playwright (#24)

Suite contra **lo desplegado**, no contra un `vite preview`: un E2E en verde con la API local no
dice nada de producción. **20/20** (10 móvil + 10 escritorio).

- `workers: 1` a propósito: el grant de 1 h y el anti-replay del TOTP no aguantan dos workers.
- `tienda.spec.mjs`: home con productos, PDP de un producto real (el slug sale de la API, no
  inventado), 404 con salidas, y **login → carrito → checkout → "Gracias por tu compra" → carrito a
  0**. Ese último paso es el que se rompía cuando un hook quedaba tras un `return` condicional.
- `admin.spec.mjs`: entrada al panel con TOTP, **Bloquear panel** revoca y deja volver a entrar, el
  pie sticky dentro del viewport, y la jerarquía de roles (stock_manager no ve Usuarios ni
  Configuración).
- `data-testid` en los puntos de interacción que el E2E necesita. No había ninguno.
- CI: credenciales de la cuenta de smoke como secrets del repo, y un job nuevo que corre el E2E.

> **Gotcha del anti-replay**: el contador TOTP guardado en la D1 **no se reinicia entre ejecuciones**
> y la API exige contador estrictamente mayor. Dos pruebas seguidas en la misma ventana de 30 s, o
> una corrida anterior, hacen que un código correcto salga como "Código incorrecto". `freshCode()`
> lleva el **contador** (no el texto: dos pasos distintos pueden dar el mismo número de 6 dígitos) y
> `submitCode()` reintenta hasta 3 veces. Por eso el límite de step-up 2FA subió de 10/15 min a
> 30/15 min por IP: con "Bloquear panel" revalidar es una acción normal, y con la ventana ±1 del TOTP
> solo hay 3 códigos válidos por paso de 30 s, así que 30 intentos no alcanzan a fuerza bruta.

---

## ✅ Hecho · Panel de Cloudflare (verificado por API 2026-09-30)

| Tarea | Estado |
|-------|--------|
| Namespace `RATE_LIMIT_KV` (S3) | ✅ Creado **y activado** en `wrangler.toml`, y de verdad conectado al login |
| `always_use_https` | ✅ **Ya estaba `on`**: `http://api.suprime.xyz` y `http://suprime.xyz` dan 301 a https. El punto 🔴 de más abajo estaba **desactualizado**. El smoke lo comprueba para que no vuelva |
| `min_tls_version` | 🔴 **1.0 → 1.2** (estaba aceptando TLS 1.0) |
| Cache Rule de `/assets/*` | ⚠️ **Eliminada a propósito** (ver la sección de la pantalla en blanco). Los assets conservan `max-age` de un año en el navegador |
| Purgar `/assets/*` en cada despliegue | ✅ `npm run cf:purge-assets`, en CI |
| Cloudflare Fonts | ✅ **Ya activo**: el HTML sirve `/cf-fonts/v/inter/5.2.8/...` con `font-display: swap`. Se añade `rel="preload"` para la CSS, que en `media="print"` el navegador trata como baja prioridad |
| `tls_1_3`, `opportunistic_encryption`, `ssl`, `browser_check`, `security_level`, Early Hints, Brotli, HTTP3, IPv6 | ✅ on / correctos |
| Rocket Loader | ✅ off (rompería la CSP y los módulos ES) |
| No activar | Polish/Images/Argo/Prefetch (Pro+ o Enterprise); `minify` apagado (Vite ya minifica) |

---

## 🟡 Pendiente · CLS (cola larga, P6)

Medido hoy con Lighthouse: **escritorio home CLS 0,154** y **PDP 0,274**, por encima del 0,1 que
Lighthouse considera "bueno". Los dos Olympics (LCP y CLS) son el intercambio esqueleto→contenido
(`SECTION.products-section`) y el swap de fuentes (Playfair/Inter mueven la cabecera). Mover
`admin.css` al bundle inicial **no** lo empeora (el build local mide CLS 0,023 en móvil). Queda para
P6 con `size-adjust` en la fuente de reserva.

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

## ✅ P3 · Admin UX — cerrado

Las cuatro tareas (#9, #10, #19, #20) y el smoke con TOTP están hechos. Ver las secciones
**"Smoke con TOTP"**, **"P3 Admin UX"** y **"El grant de 2FA se podía cerrar"** más arriba.

---

## ✅ P4 · Infra y DX — cerrado

| # | Tarea | |
|---|-------|---|
| 24 | Suite E2E crítica con Playwright: login → add → checkout | ✅ **20/20** contra lo desplegado |
| 17/27 | `preload` de fuentes Inter/Playfair | ✅ Cloudflare Fonts **ya estaba activo**; añadido `rel="preload"` para la CSS |
| 30 | JS antiguo (vendor 162 KB) | ⚪ Sin hacer: es React + React Router, 52,8 KB gzip. Modernizar el bundle no compensa el riesgo |

✅ **21 · Página 404** cerrada en `a51f362`: `NotFoundPage` con la ruta que falló, buscador que
lleva a la home filtrada, salidas a tienda/contacto y `noindex,follow` mientras está montada.
`/producto/:slug` sigue con su propio "Producto no encontrado" (más preciso: la ruta sí existe).
Limitación conocida: Cloudflare Pages sirve la SPA con 200 en toda ruta (`/* /index.html 200`), así
que no hay 404 HTTP real sin una Pages Function; se controla el `noindex` en su lugar.

---

## ✅ P5 · Panel de Cloudflare — cerrado

Todo verificado por API el 2026-09-30; el detalle está en la sección "Panel de Cloudflare" de más
arriba. Lo que cambia respecto a la nota anterior:

- 🔴 **`http://api.suprime.xyz` NO sirve en claro**: `always_use_https` ya estaba en `on` y
  `http://api.suprime.xyz/api/v1/health` da **301 a https**. La advertencia estaba desactualizada.
  (El token de `_SECRETS/` sí tiene *Zone Settings: Edit*; el de wrangler OAuth no.)
- 🔴 **`min_tls_version` estaba en 1.0** → subido a **1.2**.
- ⚠️ **Cache Rule de `/assets/*` eliminada**, no creada. Curaba de `MISS` a `HIT`, pero cacheaba
  el fallback de la SPA con TTL de un año bajo URLs de asset (pantalla en blanco; ver arriba). En su
  lugar, purga en cada despliegue.
- ✅ Cloudflare Fonts **sí estaba activo** (`/cf-fonts/v/inter/5.2.8/...`).
- ✅ `browser_cache_ttl` = 1 año; Early Hints, Brotli, HTTP3, IPv6, `ssl`, `tls_1_3`,
  `opportunistic_encryption`, `browser_check` y `security_level` correctos.
- ✅ Rocket Loader off (rompería la CSP y los módulos ES).

**No activar:** Polish/Images/Argo/Prefetch (Pro+ o Enterprise). `minify` se deja apagado: Vite ya
minifica y el HTML pesa 3,6 KB.

> El detalle por tarea sigue en la sección "Plan de acción Cloudflare" de `PLAN-MEJORAS.md`.

---

## 🟢 P6 · Limpieza de Core Web Vitals (cola larga, - bajo impacto)

| # | Tarea |
|---|-------|
| 32 | CLS en escritorio: **0,154** en home y **0,274** en PDP (medido hoy). Es el intercambio esqueleto→contenido y el swap de fuentes; probar `size-adjust` en la fuente de reserva |
| 33 | Animación no compuesta (1 elemento) → usar `transform`/`opacity` |
| 34 | Tarea larga en hilo principal (1) |
| 35 | Targets táctiles pequeños (a11y) |
| 36 | Roles ARIA en elementos no compatibles — **parcialmente hecho** (banner de cookies arreglado) |
| 37 | Enlaces idénticos con distinta finalidad (footer) |

---

## 🔴 Tareas de seguridad / mantenimiento (del usuario, no del código)

| # | Tarea |
|---|-------|
| S1 | **Rotar secretos expuestos**: tokens `cfat_`/`cfut_` y clave R2. Pasos en `_SECRETS/cloudflare.env`. ⚠️ El `cfat_` está ahora **también** como secret `CLOUDFLARE_API_TOKEN` del repo de GitHub (lo usa la purga de CI): al rotarlo hay que actualizar las dos cosas |
| S2 | Crear token Cloudflare nuevo con **alcance mínimo** (D1, Workers, R2, Purge), no "All permissions" |
| S3 | Namespace `RATE_LIMIT_KV` | ✅ Creado, activado en `wrangler.toml` y **conectado de verdad** a login, 2FA y subidas (ver la sección de rate-limit) |
| S4 | Revisar `SEGURIDAD_CSRF_DESACTIVADA.md` (heredado, sin revisar) |

---

## ⏸️ Post-lanzamiento (aparcado)

- Legales con asesor (los textos actuales son plantilla)
- Pasarela de pago + R2 (ya está el endpoint configurado, falta la pasarela)
- Verificación de teléfono por SMS (Twilio, con coste)

---

## Orden recomendado

1. ~~**P1 imágenes**~~ ✅ `5a878c5`
2. ~~**P5 panel Cloudflare**~~ ✅ verificado y arreglado por API
3. ~~**P2 code-splitting**~~ ✅ `cd86000`
4. ~~**P3 admin UX**~~ ✅ #9 #10 #19 #20 + smoke con TOTP
5. ~~**P4 infra**~~ ✅ 404 (`a51f362`) y E2E **20/20**
6. ~~**S3 KV**~~ ✅ creado, activado y conectado de verdad
7. **S1-S2 seguridad** — ⚠️ **lo único que queda en tus manos**: rotar los tokens `cfat_`/`cfut_`
   y la clave R2, y crear un token nuevo de alcance mínimo. Actualiza también el secret
   `CLOUDFLARE_API_TOKEN` del repo de GitHub cuando lo rotes.
8. **CLS (P6)** — cola larga, ya medido y documentado
9. **Post-lanzamiento**: pasarela de pago + R2, legales con asesor, verificación por SMS
