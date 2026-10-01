# SUPRIME · Pendientes consolidados (2026-09-30)

> Fuente: `PLAN-MEJORAS.md` (detalle por tarea) + verificación en producción.
> Regenerar este archivo al cerrar cada bloque.

## Estado base verificado

- Front en producción: **`https://www.suprime.xyz`** (Pages, auto-deploy en push a `main`); el apex 301 → www
- API en producción: `https://api.suprime.xyz` (Worker `2d52ec33`)
- Smoke: **94 PASS / 0 FAIL / 1 SKIP** · E2E (Playwright): **20/20** (10 móvil + 10 escritorio) — CSP del documento: **22/22** en producción (`npm run csp:check`)
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

## ✅ Hecho · Barrido de interacción (1-oct, tarde)

Recorrer la web **pulsando todo**, no solo mirando que las páginas pinten. Dos
herramientas en el repo: `npm run barrido` y `npm run carrito`.

**Un bug real arreglado:** las tarjetas de categoría se salían de la pantalla y
quedaban **cortadas** en móvil. `.category-card` es un `<button>`, y un botón dentro de
una columna de rejilla no baja de su ancho mínimo de contenido salvo que se le diga;
crecía más allá del hueco y el `overflow:hidden` de la propia tarjeta lo recortaba, así
que el nombre de la categoría quedaba cortado sin que el usuario pudiese verlo ni
desplazarlo. Medido: 107 elementos saliéndose en la home, hasta 425 px en una pantalla
de 393 px. Arreglado con `min-width:0` y `overflow-wrap`.

**Un test inestable del E2E, que era un agujero invisible:** el job salía en verde
con "19 passed" y un `test-failed-1.png`. Eso solo pasa cuando un test falla y luego
pasa: Playwright lo cuenta como *flaky* y el job no cae. La causa era que el timeout
global es de 60 s y ese test tardaba 59,5 s, o sea medio segundo de margen. Con el
CI en `retries: 1`, el fallo se escondía. Ahora ese test tiene `test.setTimeout(150_000)`.

**Siete cosas que parecían fallos y no lo eran.** Se listan porque es la segunda vez
que pasa y porque, sin mirar cuál de las dos era, se habría "arreglado" la web:

- El carrito no crecía al añadir. **Falso:** el carrito exige sesión a propósito
  (`handleAddToCartGated` abre el login). Con sesión funciona: tres productos,
  359,70 € de subtotal, envío gratis, quitar actualiza el panel y se llega al
  checkout. El primer barrido daba además un PASS falso, porque comprobaba
  `/carrito/i.test(innerText)` y esa palabra sale siempre en la cabecera.
- `/carrito` da 404. **No es un bug:** esa ruta no existe, el carrito es un panel
  lateral. No está en el router y nada lo enlaza. El test se la inventaba y pasaba
  porque la pantalla de 404 tiene texto de sobra.
- La búsqueda "pinta HTML crudo". **Falso:** React escapa siempre; se comprobó que
  aparece como `&lt;script&gt;` en un nodo de texto.
- 107 elementos fuera de pantalla. **La mayoría falsos:** el carrusel de relacionados
  tiene `overflow-x auto`, se sale a propósito. Los que sí se cortaban eran las
  tarjetas de categoría.
- El botón de checkout es "Proceder al Pago" y yo buscaba `/pagar/`.
- El de quitar es el emoji 🗑 y yo buscaba `/eliminar|quitar|remove/`.
- El `aria-label` del botón de añadir es "Agregar <nombre> al carrito", con
  palabras no adyacentes, así que `/agregar al carrito/` no encontraba ningún botón.

**Decisión de negocio, no un fallo:** el carrito pide iniciar sesión antes de añadir.
Es el cambio más grande que se puede hacer para vender más, porque cada paso antes
del pago pierde gente. Pero es decisión del dueño, no un bug.

---

## ✅ Hecho · Batería profunda de calidad (1-oct)

**183 de 183 comprobaciones en verde contra producción.** El detalle completo, con el
qué y el cómo de cada check, está en `BATERIA-PROFUNDA.md`. Se repite con
`npm run profunda` (o por partes: `seguridad`, `navegador`, `api`, `rendimiento`).

| Parte | Checks | Qué mide |
|---|---|---|
| Seguridad | 48/48 | Inyección, sesión, CSRF/CORS, fugas, cabeceras |
| Navegador | 74/74 | Renders, interacción, accesibilidad, móvil y escritorio |
| API y datos | 48/48 | Contrato, paginación, datos, privilegios, SEO |
| Rendimiento e infra | 13/13 | Peso, peticiones, caché, secretos, interruptor |

**Cinco bugs reales encontrados**, y ninguno lo vio el typecheck porque son de
comportamiento, no de sintaxis:

1. **La ficha de producto se declaraba duplicado de la home.** El `canonical` era
   siempre `https://www.suprime.xyz/`, también en `/producto/xyz`, porque Pages
   sirve el mismo HTML para todas las rutas. Google no indexaba las fichas por
   separado: se perdía todo el tráfico orgánico de producto. El más caro.
2. **`/catalog/products` ignoraba `limit` y `offset`** (`?limit=1` devolvía los 11).
3. **La Cache Rule de la raíz estaba muerta**: apuntaba a `suprime.xyz` cuando el host
   canónico es `www`, así que no coincidía con nada. `config.js` —que lleva la URL de
   la API— llevaba un año de TTL.
4. **HSTS ausente en el front** (la API ya lo tenía).
5. **Objetivos táctiles por debajo de 44px** en botones, enlaces del pie y el selector
   de moneda.

Y cinco correcciones de accesibilidad: dos `h1` por página (el logo del header era
`h1` y se repite en todas) y saltos en la jerarquía de encabezados.

**Lección sobre los tests:** seis de los fallos que parecían bugs del sitio eran
fallos del propio test (el sitemap es XML y se exigía JSON, la ruta de "forgot" no era
la correcta, `expires_at` viene en segundos y se leía como milisegundos). Un test
roto no es un sitio roto, y sin mirar cuál de los dos es, se arregla lo que no era.

**El check de la Cache Rule era incapaz de ver el fallo que tenía delante:** preguntaba
"¿existe la regla?" por la API, que con estos tokens devuelve 0 reglas siempre. Ahora
pregunta por el TTL que llega en la respuesta. Preguntar por el efecto, no por la
configuración.

---

## ✅ Hecho · Interruptor de rate limit para trabajar sin toparte (1-oct)

Para no quedarse topado con los límites al trabajar, sin desactivar la protección
de fuerza bruta de la web.

### Qué es, y qué NO es

| | |
|---|---|
| **Por IP**, no global | Un flag global dejaría la web sin protección de fuerza bruta **para todo el mundo** mientras trabajas, que es lo contrario de blindarla. Con el bypass activo, los cubos de las demás IPs siguen contando igual. |
| **Con caducidad** | Es una entrada de KV con hora de expiración (45 min por defecto), no un flag eterno. Si se te olvida apagarlo, se apaga solo. |
| **Se apaga al hacer push** | El CI lo cierra antes de las pruebas. El automatismo va **solo en el lado seguro**: un push nunca *activa* el bypass (un push por descuido te dejaría la web desprotegida), un push siempre lo *apaga*. |
| **Lado seguro en toda ambigüedad** | Si el KV falla, se aplica el límite. Un fallo del sistema de avisos nunca se convierte en un bypass. |

### Lo que se pidió y no puede ser, y por qué

**El rango `192.168.0.1-0.10` no funciona contra producción, y no es cuestión de
configuración.** 192.168.0.0/24 es dirección **privada** (RFC 1918) y el router la
traduce por NAT, así que al Worker le llega la **IP pública** del router, nunca la
privada. La IP pública de esta máquina es `45.153.165.7`, que no está en ese rango.
Por eso el script guarda la IP pública detectada sola, y `anadir` permite meter más
si tu ISP te la cambia.

**Un Worker no puede dejar una petición esperando 5 minutos a que contestes.** La
petición muere antes (30 s de CPU en plan Free) y mantener conexiones abiertas es en
sí mismo un vector de ataque. El flujo que se implementó es **fail-closed**:
se bloquea → llega el Telegram con **Aprobar / Rechazar** → solo pasa si pulsas
Aprobar → si no pulsas nada, **se queda bloqueado**. El resultado de seguridad es el
pedido; lo único que cambia es que approving requiere reintentar, en vez de que la
petición continúe sola.

### Uso

```
npm run rl:on              # activa 45 min para tu IP publica (la detecta sola)
npm run rl:on -- 90        # 90 minutos
npm run rl:on -- <ip>      # para otra IP concreta
npm run rl:on -- anadir <ip>  # anade otra sin reiniciar la cuenta
npm run rl:estado          # que hay puesto y cuando caduca
npm run rl:off             # apaga y limpia tus cubos, para no quedarte topado
npm run rl:limpiar         # borra TODOS los cubos (util solo si hace falta)
npm run rl:telegram        # atiende los botones de Telegram pendientes
```

### Tres bugs que salieron al probarlo en producción

1. **El bypass no hacía nada.** Estaba solo en `checkRateLimit` (el que *consume*
   intentos), pero el 429 del login lo decide `loginBlocked`, que usa
   `peekRateLimit` (el que solo *mira*). Con un cubo ya lleno, activar el bypass no
   cambiaba nada. **El caso para el que existe el bypass era justo el que no
   funcionaba.** Arreglado con `exentaYLimpia` en `loginBlocked`.
2. **El borrado de cubos se quedaba a medias.** Era `kv.delete(...)` sin await, y
   en un Worker las promesas pendientes se cancelan al terminar la petición. Con el
   bypass activo los intentos pasaban, pero al apagarlo el cubo viejo seguía lleno
   y volvía el 429. **Un borrado que a veces no ocurre es peor que no borrar nada,
   porque aparenta que sí.**
3. **`rl:off` no limpiaba tus cubos.** Te topabas → activabas el bypass → trabajabas
   → lo apagabas → y el primer login te volvía a dar 429, porque el cubo de antes
   seguía ahí. Ahora `off` los borra.

Los tres los encontró la prueba de producción, no el typecheck ni el test unitario.

### Un cuarto bug, este solo en el CI

El paso del CI fallaba con `ENOENT`: el script leía las credenciales de una ruta
**absoluta de esta máquina** (`C:/Users/VIP/.../_SECRETS/cloudflare.env`), que en el
runner de Linux no existe. Ahora `RAIZ` sale de `import.meta.url` y las credenciales
se leen de `process.env` **primero**, con el fichero local como respaldo. El orden
decide cuál gana: al revés, el fichero local pisaría los secrets del CI.

Y un detalle que importa más de lo que parece: **sin credenciales, `estado` dice
DESCONOCIDO, no "apagado"**. Decir "apagado" sin haber mirado es peor que no
decir nada: si crees que está apagado y no lo está, te topas sin saber por qué; y
en el CI, un fallo de credenciales pasaría por un estado limpio y nadie lo vería.

### Verificación

- `tests/rl-bypass.test.mjs`: 24 checks con KV en memoria, incluidos los que
  fallaban (**cubo ya lleno + bypass**, que es el caso real de "me he quedado topado")
- CI: el paso `Apagar el bypass` corre en verde antes del smoke
  (`smoke 94/0/1`, `CSP 22/22`, `E2E 20/20`)
- Prueba en producción: sin bypass se ven 429, con el bypass **0 de 15**, la web sigue
  200, y tras apagar se vuelve a 401

---

## ✅ Hecho · CSP sin `unsafe-inline` en scripts (1-oct)

El token de sesión vive en `localStorage` ("recuérdame"), así que **un XSS exitoso es una sesión
robada**. `'unsafe-inline'` en `script-src` era justo lo que permitía ejecutar el HTML inyectado, y
Google lo señalaba en *Ensure CSP is effective against XSS attacks*.

**Por qué se podía quitar sin romper nada:** medido sobre el build, los dos `<script>` del documento
son **externos** (`/assets/index-*.js` y `/config.js`). Cero scripts inline, así que
`'unsafe-inline'` no hacía falta para nada y solo dejaba la puerta abierta.

**El riesgo real no eran los scripts, eran los manejadores inline.** Ahí el fallo es *silencioso*: no
salta ningún error, la página sigue cargando y simplemente algo deja de funcionar. Pasaba con el
`<link>` de Google Fonts, que lleva `onload="this.media='all'"` para que su CSS no bloquee el
render: con la política restringida el manejador queda bloqueado y **las fuentes dejan de aplicarse**
—la web se ve con las tipografías de reserva y no hay aviso—. La salida correcta no es devolver
`'unsafe-inline'` sino un **hash**: con `'unsafe-hashes'` en la directiva, los hashes sí valen para
manejadores. De ahí el `sha256-MhtPZXr7+...` en la CSP.

### Qué cambió

| | antes | ahora |
|---|---|---|
| `script-src` | `'self' 'unsafe-inline'` + fuentes + beacon | `'self' 'unsafe-hashes' 'sha256-MhtP…' + fuentes + beacon` |
| `style-src` | `'self' 'unsafe-inline'` + fuentes | **igual, a propósito** (91 atributos `style=`) |
| refuerzo | — | `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` |
| `frame-ancestors` | en el `<meta>` | **fuera del `<meta>`**, se queda en la cabecera de la API |
| `connect-src` (front) | con `*.trycloudflare.com`, `*.ngrok-free.dev`, `*.pages.dev`, `192.168.0.105` | sin comodines ni IP local |

- `'unsafe-inline'` **se queda en `style-src`**: el front usa 91 atributos `style={{...}}` y sin eso
  no aplica sus estilos. CSS inyectado no ejecuta código, que es la diferencia con el caso de script.
- `frame-ancestors` fuera del `<meta>` porque **la especificación dice que ahí se ignora**, solo
  funciona como cabecera HTTP. Dejarlo da falsa sensación de protección; en la cabecera de la API sí
  funciona, y ahí se queda.
- Los comodines de túnel se quitaron también del front, no solo de la API (se habían limpiado ayer en
  la API y se habían olvidado aquí).

### Verificado en un navegador contra producción

- **0 violaciones** de CSP en carga y en las 5 rutas (home, categoría, PDP, carrito, 404)
- **Script inline inyectado → BLOQUEADO.** Manejador `on*` inyectado → **BLOQUEADO**
- Las fuentes **se aplican de verdad**: Inter 417 px vs 399 px de la de reserva, Playfair 389 px vs
  359 px de serif. Este era el fallo silencioso y aquí es donde se habría visto
- `object-src`, `base-uri` y `form-action` presentes; el beacon de Cloudflare sigue cargando

### `tools/check-csp.mjs` (22 checks) + paso en el CI

**Por qué está fuera del smoke:** el smoke corre en el push, y Pages no despliega en el push —lanza
un proceso asíncrono de ~5 min—, así que estos checks leerían el HTML viejo y fallarían en el mismo
push que los arregla. Va en el job `e2e`, **después** de `purge-assets.mjs --espera-deploy`, que es
donde ya se sabe que el despliegue existe.

El primer commit lo dejó **21/22 y el CI en rojo**: el check exigía `onload="this.media='all'"`
literal, y en `www.suprime.xyz` ese manejador no existe porque está activo **Cloudflare Fonts** (sustituye
el `<link>` de Google Fonts por un `<style>` inline con `@font-face` a `/cf-fonts/…`). El check pasó
a exigir la **propiedad** —ningún manejador inline sin hash— en vez del literal, y a reconocer de
dónde vienen las fuentes. El `sha256` **se conserva** en la CSP aunque hoy no lo necesite nadie: es la
red si algún día se apaga Cloudflare Fonts.

Prueba negativa: **25 roturas detectadas una a una** en los dos caminos de fuentes, para que la
herramienta no pueda dar un OK vacío.

---

## ✅ Hecho · Cloudflare Fonts activo en www (descubierto al verificar la CSP)

`www.suprime.xyz` sirve `@font-face` apuntando a `/cf-fonts/v/inter/5.2.8/…/normal.woff2`: **ya no
se pide nada a Google Fonts** (0 peticiones a `fonts.gstatic.com`, 200 a `/cf-fonts/`). Es la
"alternativa mejor" que ya estaba anotada como comentario en el `index.html`, y quita el
third-party del camino crítico de las fuentes.

**Consecuencia a tener en cuenta:** `www.suprime.xyz` y `suprime-st-ecc.pages.dev` **sirven HTML
distinto** (Cloudflare Fonts es un ajuste de zona, y `pages.dev` queda fuera). El `onload` sigue
en el fichero del repo, así que si se apaga Cloudflare Fonts vuelve a estar y el `hash` de la CSP lo
cubre. Mientras tanto `fonts.googleapis.com` y `fonts.gstatic.com` siguen estando en la CSP como red.

---

## ✅ Hecho · DMARC publicado en modo observación (1-oct)

`_dmarc.suprime.xyz` no existía (NXDOMAIN confirmado por DoH): sin DMARC no hay
política anti-spoofing ni informes, y cualquiera podía enviar como
`noreply@suprime.xyz` sin que ningún buzón lo tratara distinto por eso.

Publicado `v=DMARC1; p=none; rua=mailto:tienda@suprime.xyz;` (verificado visible
por DoH). `p=none` no toca el correo legítimo: solo observa. El envío ya
autentica: SPF en `send.suprime.xyz` (Return-Path de Resend) y DKIM en
`resend._domainkey`, ambos alineados con `suprime.xyz`.

**Estado (1-oct, tarde):** el dueño confirmó que `tienda@suprime.xyz` **recibe
correo** (prueba desde Gmail). Los informes agregados llegarán solos cada día o
dos. Cuando confirme que todo lo legítimo pasa, subir a `p=quarantine` y luego
`p=reject`. Hasta entonces, `p=none`: observa sin tocar nada.

Comprobación permanente: `tools/check-dmarc.mjs` (`npm run dmarc:check`), 11
checks por DoH (DMARC válido, rua con MX, SPF raíz y de `send`, DKIM RSA, MX).
Probada contra un dominio vacío para que no dé OK falsos.

## ✅ Hecho · Orígenes de desarrollo fuera de producción (30-sep)

`allowedOrigins` era **un solo array con todo mezclado**, y como `admin.css` en el CSS, el orden
decidía: los comodines de desarrollo competían también **en producción**.

**Comodido antes del arreglo, comprobado contra producción:**

| Origen enviado | Resultado |
|---|---|
| `https://tunel-aleatorio.ngrok-free.dev` | `401 INVALID_CREDENTIALS` → **pasó** |
| `https://sitio-de-terceros.pages.dev` | `401 INVALID_CREDENTIALS` → **pasó** |
| `http://localhost:5173` | `401 INVALID_CREDENTIALS` → **pasó** |
| `https://sitio-de-terceros.pages.dev` (CORS) | recibió `Access-Control-Allow-Origin` **con credenciales** |

Es decir: un túnel `ngrok`/`trycloudflare` (gratis, sin cuenta, se abre en segundos) o cualquier
proyecto de `pages.dev` de cualquier cuenta de Cloudflare pasaba la validación igual que
`suprime.xyz`. Y una página servida desde el `localhost` del propio visitante también.

**Severidad: baja, no alta.** La autenticación *no* era vulnerable a esto: va por
`Authorization: Bearer` en `localStorage`, que otra origen no puede leer, y la cookie
`session_token` es `HttpOnly` + `SameSite=Strict`, que el navegador ni siquiera manda cross-site
(verificado antes: `/admin/*` solo con cookie → `401`). Lo que estaba anulada es la **barrera de
defensa en profundidad** del middleware, que existe para proteger si algún día se mete un endpoint
que sí use la cookie.

**Qué se hizo:**

- `ORIGENES_PRODUCCION` (4 dominios exactos) y `ORIGENES_DESARROLLO`, decididos **por petición**
  según `context.env.APP_ENV`.
- En producción solo entran los 4 dominios exactos. Fuera se añade `localhost` (cualquier puerto),
  `127.0.0.1` y la red local.
- **Comodines eliminados en los dos lados**: `.trycloudflare.com`, `.ngrok-free.dev` y `.pages.dev`.
  No hacen falta para `npm run dev`: el flujo documentado es abrir la web desde el móvil en la red
  local, que ya cubren `192.168.*` y `host: 0.0.0.0` en Vite.
- El CSP también arrastraba los comodines; quitados en ambas variantes.
- **Sin lista de puertos en desarrollo**: Vite va con `strictPort: false`, así que si el 5173 está
  ocupado se va al 5174 y la lista fija se quedaba corta sola.
- Se mantiene que `https://suprime-st-ecc.pages.dev` **sigue entrando**, ahora por nombre exacto.

**Limpieza del mismo grupo (todo muerto):**

| Fichero | Qué sobraba |
|---|---|
| `apps/web/vite.config.ts` | `allowedHosts` con `phases-exceptional-wheels-sunset.trycloudflare.com`, un túnel de sesión vieja |
| `apps/web/src/hooks/useApiUrl.ts` | Caso "si el host incluye ngrok" → `192.168.0.105:8789`. El caso siguiente ya cubría exactamente eso |
| `NETWORK_ACCESS.md` | Recomendaba abrir túneles de `cloudflared` con dos URLs de subdominios que ya no existen |

**Verificación:** 10 checks nuevos del smoke (5 de origen de tercero → `403`, 4 de CORS, 1 de CSP).
Antes de quitar los comodines fallaron cuatro de los cinco checks de origen: así se confirmó que
el fallo era real. Smoke **84 PASS / 0 FAIL / 1 SKIP** y E2E **20/20** contra producción, que es
lo que demuestra que la lista de orígenes no se quedó demasiado estricta.

---

## 🟡 No es un bug · No corras smoke y E2E seguidos desde el mismo equipo

Comprobado el 30-sep. Al lanzar `npm run e2e` justo después de `npm run smoke`
fallearon 3 tests de admin en móvil. **No es una regresión**: los mismos tests
en aislamiento pasaron 5/5, y la suite completa pasó 20/20 al repetirla con los
contadores ya reseteados.

**Por qué pasa:** los dos suites usan la cuenta de smoke y salen desde la misma
IP, y el rate-limit es por IP además de por cuenta:

- `rl:loginIp` — 30 intentos / 15 min
- `rl:twofa` — 30 step-ups / 15 min

El smoke hace login + TOTP step-up muchas veces (los checks de CSRF, el grant, el
bloqueo), y el E2E repite login y TOTP en casi cada test. Juntos, desde el mismo
`45.153.165.7`, se pasan los dos límites.

**En CI no ocurre:** `build-and-smoke` y `e2e` corren en runners distintos, con
IPs distintas, y sus cubos son independientes.

**Si pasa en local:** esperar 15 minutos, o borrar el cubo a mano:
```
npx wrangler kv key delete --namespace-id c695ababca41469a97d90502eebf1620 --remote "rl:twofa:<TU_IP>"
npx wrangler kv key delete --namespace-id c695ababca41469a97d90502eebf1620 --remote "rl:loginIp:<TU_IP>"
```

---

| # | Tarea |
|---|-------|
| S1 | **Rotar secretos expuestos**: tokens `cfat_`/`cfut_` y clave R2. Pasos en `_SECRETS/cloudflare.env`. ⚠️ El `cfat_` está ahora **también** como secret `CLOUDFLARE_API_TOKEN` del repo de GitHub (lo usa la purga de CI): al rotarlo hay que actualizar las dos cosas |
| S2 | Crear token Cloudflare nuevo con **alcance mínimo**, no "All permissions". ⚠️ Desde el 30-sep necesita **tres** permisos, no uno: **Pages: leer** (lo usa `--espera-deploy`), **Cache Rules: editar** (la regla `root-static-short-cache`) y **Purge cache**. Con solo D1/Workers/R2/Purge la purga de CI se rompe |
| **S3** | Namespace `RATE_LIMIT_KV` | ✅ Creado, activado en `wrangler.toml` y **conectado de verdad** a login, 2FA y subidas (ver la sección de rate-limit) |
| S4 | ~~Revisar `SEGURIDAD_CSRF_DESACTIVADA.md`~~ | ✅ **Cerrado** (30-sep): el middleware se reactivó con la regla correcta (solo se valida el origen si la petición trae `Origin` o `Referer`) y el documento se reescribió con las mediciones. Este artículo estaba caducado en la lista |

---

## ⏳ Temporal · Puente Telegram <-> OpenCode (1-oct)

El dueño lo pidió para hablar desde el móvil sin estar pegado al PC. **Se quita
cuando lo diga.** Vive en `C:\Users\VIP\AppData\Local\Temp\opencode\puente-telegram.mjs`
(a propósito fuera del repo, con `.log`, `.pid` y `.offset` al lado).

Cómo funciona: lee su chat (solo el 5304543747, resto ignorado), ejecuta cada
mensaje con `opencode run --title puente-tg` y devuelve la respuesta. Comandos:
`/estado`, `/off`, `/ayuda`. Cola secuencial, timeout 25 min por respuesta,
apagado solo tras 60 min sin mensajes. Operaciones peligrosas (deploy, push,
borrar, secretos, DNS, KV): el agente las explica y espera su sí, no las ejecuta.

Límites conocidos: el PC tiene que estar encendido; cada mensaje gasta cuota como
aquí; cada respuesta es una sesión nueva (lee PENDIENTES.md, pero el hilo fino de
"eso no, lo otro" se puede perder: el puente guarda las últimas 6 líneas).

Para quitarlo: `/off` por Telegram, o matar el PID del `.pid` y borrar los cuatro
ficheros del Temp. Al quitarlo, borrar también este bloque.

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
