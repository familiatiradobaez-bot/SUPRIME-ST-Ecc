# Batería profunda de calidad · 1-oct-2026

Medida **contra producción**, no en local. Ninguna parte escribe datos de la tienda.

**183 de 183 comprobaciones en verde.** Se ejecuta con `npm run profunda` y queda en el
repo, así que se puede repetir cuando cambie algo.

| # | Parte | Qué mide | Resultado |
|---|---|---|---|
| 1 | `seguridad` | Inyección, sesión, CSRF/CORS, fugas de datos, cabeceras | **48/48** |
| 2 | `navegador` | Qué ve un usuario: renders, interacción, accesibilidad, móvil y escritorio | **74/74** |
| 3 | `api` | Contrato de la API, paginación, datos, privilegios, SEO | **48/48** |
| 4 | `rendimiento` | Peso, peticiones, caché, secretos del Worker, interruptor de rate limit | **13/13** |

Ficheros: `tools/check-profundidad.mjs` (runner), `tools/check-profundidad-seguridad.mjs`,
`tools/check-profundidad-rendimiento.mjs`, `tests/profunda-navegador.mjs`,
`tests/profunda-apidatos.mjs`.

---

## 1. Seguridad — 48/48

- **Inyección**: 8 payloads en el login (`' OR '1'='1`, `DROP TABLE`, `UNION SELECT
  password_hash`, `${jndi:...}`, `<script>`, `../../../etc/passwd`, escalado de rol)
  más 3 en otras superficies. Ninguno devuelve 200, ni 5xx, ni deja ver un hash.
- **Sesión**: 7 tokens inventados dan 401. El token real es de 64 hex, no es un JWT,
  no lleva el `user_id` dentro, y `logout` lo invalida de verdad.
- **CSRF/CORS**: 6 orígenes de atacante (otro proyecto de Pages, un túnel, localhost,
  `null`, un subdominio sucio) no reciben `Access-Control-Allow-Origin`. El front
  canónico sí.
- **Cabeceras**: `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  CSP y **HSTS en los dos hosts**, los dos con `max-age`.
- **Fugas**: 3 respuestas de error no filtran secretos ni rutas. El HTML y los
  2 bundles del front no contienen `cfat_`, `cfut_`, `sk_live_` ni claves privadas.
  La API no devuelve el HTML de la SPA en un 404.
- **Enumeración**: el login no distingue usuario inexistente de contraseña mala.

## 2. Navegador — 74/74

- 7 rutas × 2 dispositivos (Pixel 5 y 1440×900): pintan contenido real, **0 errores
  de JavaScript, 0 errores de consola, 0 peticiones fallidas**.
- Interacción: añadir al carrito funciona y no muestra error; el menú de cuenta abre.
- Accesibilidad: todas las imágenes con `alt`, todos los botones con nombre accesible,
  **un solo `h1`**, jerarquía de encabezados sin saltos, campos con etiqueta, `lang=es`,
  título no vacío, y **todos los controles táctiles ≥ 44px**.

## 3. API y datos — 48/48

- 5 endpoints públicos con la forma correcta; el `sitemap.xml` es XML válido con el
  host canónico y más de 5 URLs.
- **`limit` y `offset` funcionan de verdad**, con techo de 100. Sin `limit` sigue
  devolviendo el catálogo entero, que es lo que espera el front.
- 7 filtros maliciosos (precio negativo, comodines, `sort=; DROP TABLE`, `limit=abc`,
  `offset=-5`) no rompen la API.
- El producto público no expone campos internos, y tiene precio, nombre e imágenes.
- El `smoke@suprime.xyz` es `stock_manager` y **no** puede listar usuarios, ver
  configuración ni ver estadísticas; `/admin` exige el segundo factor.
- El rate limit topa de verdad y no genera 5xx.
- SEO: canonical y `og:url` a www, descripción, `og:image`, `lang=es`, y el apex
  redirige con 301.

## 4. Rendimiento e infraestructura — 13/13

| | Móvil | Escritorio |
|---|---|---|
| Peticiones | 32 | 32 |
| Peso | 562 KB | 311 KB |
| FCP | ~1,3 s | ~0,4 s |

- Los bundles llevan `max-age=31536000` e `immutable`; ningún fichero de la raíz
  pasa de 30 días.
- El interruptor de rate limit está **apagado**.
- Los tres secretos del Worker existen: `TOTP_ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`.

---

## Lo que encontró y se arregló

Cinco bugs reales. **Ninguno lo vio el typecheck**: son de comportamiento, y un
compilador que pasa no dice nada sobre si un `limit` se aplica.

1. **La ficha de producto se declaraba duplicado de la home.** Pages sirve el mismo
   `index.html` para todas las rutas, así que el `canonical` era siempre
   `https://www.suprime.xyz/`, también en `/producto/xyz`. Le decías a Google que
   todas las fichas eran la misma página que la portada: no las indexa por separado y
   se pierde el tráfico orgánico de producto. Es el más caro de los cinco.

2. **`/catalog/products` ignoraba `limit` y `offset`.** `?limit=1` devolvía los 11
   productos. Sin paginación posible, y cualquiera se llevaba el catálogo entero
   (hoy son 11; con 5.000 serían 5.000 por petición, pagado con la cuota de Workers).

3. **La Cache Rule de la raíz estaba muerta.** Apuntaba a `suprime.xyz` cuando el host
   canónico es `www.suprime.xyz`; desde que el apex solo devuelve un 301, no coincidía
   con nada. Cinco ficheros, incluido `config.js` (que lleva la URL de la API y se
   reescribe en cada despliegue), en `max-age=31536000`: un despliegue con la URL mal
   puesta se habría aguantado un año.

4. **HSTS ausente en el front.** La API ya lo tenía; el front, que es la página que
   abre la gente, no. Sin él, un atacante en una wifi abierta puede leer el token de
   sesión en claro.

5. **Objetos táctiles por debajo de 44px en móvil**: botones ("Buscar productos" era
   377×34), enlaces del pie ("Acerca de nosotros", 177×15) y el selector de moneda
   (82×30). Con 15px de alto fallan de margen al pulsar.

Y cinco correcciones de accesibilidad: dos `h1` en cada página (el logo del header era
`h1` y el header se repite en todas, así que cada página tenía dos), salto de `h1` a
`h3` en las ventajas y de `h2` a `h4` en el pie.

## Lo que se encontró que NO era un bug

Cinco fallos del propio test, corregidos para no reportar como problema lo que no lo era:

- El `sitemap.xml` se exigía en JSON cuando es XML.
- Se buscaba `price` cuando el campo es `price_cents`.
- La ruta real es `/auth/forgot-password`, no `/auth/forgot`: con la ruta mala daba
  404 y el test de rate limit no llegaba ni a probarse.
- El token se buscaba en `data.token` cuando está en `data.session.token`, así que el
  bloque entero se saltaba.
- `expires_at` viene en segundos y el check hacía `new Date(1791437597)`, que en
  JavaScript son milisegundos: decía "la sesión no caduca" cuando sí caduca.

## Lo que sigue abierto, y por qué no se arregla aquí

- **Las Core Web Vitals no son fiables desde esta máquina.** Con la CPU compartida la
  misma página ha dado 0 y 97 en corridas seguidas. Lo medido aquí y objetivo es el
  peso, el número de peticiones y los dominios. El FCP se informa pero no se toma
  como bueno: para el número real hay que medir desde el móvil del owner.
- **Un crawler que no ejecute JavaScript sigue viendo el canonical de la home.**
  Arreglarlo de raíz exige prerenderizar o SSR por ruta, que es un proyecto aparte.
- **Las imágenes se sirven desde `images.unsplash.com`.** Si Unsplash cae o limita, las
  fotos de producto desaparecen. Es una decisión de datos, no de código.
- **5 dominios en la carga**, uno de ellos `fonts.googleapis.com` por un
  `<link rel="preload">` que ya no sirve para nada con Cloudflare Fonts. Se deja
  deliberadamente: si se apaga Cloudflare Fonts, ese preload es lo que mantiene el
  truco de no bloquear el render. Son 2 KB.
