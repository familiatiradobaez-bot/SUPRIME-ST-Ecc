/**
 * Dominio y origenes permitidos, en un solo sitio.
 *
 * ESTO ESTA AQUI PORQUE EL DOMINIO ESTABA ESCRITO A MANO EN VARIOS FICHEROS
 * (app.ts, catalog.routes.ts, google.routes.ts, index.html, robots.txt,
 * ProductPage.tsx, CatalogPage.tsx). Con el dominio repetido, cambiarlo obliga a
 * cazarlo todo y es facil dejar una URL con el host viejo, que es como se
 * acaban teniendo dos versiones de la misma pagina indexadas.
 *
 * DECISION: www es el host canonico y suprime.xyz redirige con 301. Es la
 * convencion y ademas es lo que se ha pedido. Un solo host canonico:
 *  - el <link rel="canonical"> y el og:url apuntan a www
 *  - el sitemap emite www
 *  - robots.txt declara el sitemap de www
 *  - el JSON-LD de producto y catalogo usa www
 *  - el 301 de apex a www lo pone Cloudflare (herramienta tools/pages-www-redirect.mjs),
 *    no Pages, porque _redirects no puede mirar el Host
 *
 * El API NO cambia de host: sigue en api.suprime.xyz. El callback de Google
 * OAuth tambien, porque es lo que hay registrado en la consola de Google.
 */

/** Host canonico de la tienda, con https y sin barra final. */
export const SITIO_CANONICO = 'https://www.suprime.xyz';

/** Origenes validos en produccion. Solo el dominio de SUPRIME, por nombre exacto. */
export const ORIGENES_PRODUCCION: readonly string[] = [
  'https://www.suprime.xyz',
  'https://suprime.xyz',
  'https://suprime-st-ecc.pages.dev',
  'https://api.suprime.xyz',
];

/**
 * Origenes de DESARROLLO. Vacio a proposito: los de localhost, 127.0.0.1 y la
 * red local se cubren por patron en `comodinesDesarrollo`, porque Vite va con
 * `strictPort: false` y si el 5173 esta ocupado se va al 5174.
 *
 * Aqui se anade un dominio EXACTO solo si hace falta de verdad (por ejemplo un
 * tunel de una sesion concreta). Nunca un comodin: un comodin de tunnel deja
 * pasar a cualquiera que abra un tunel gratis, y asi estuvo en produccion hasta
 * el 30-sep.
 */
export const ORIGENES_DESARROLLO: readonly string[] = [];

/** Patrones que solo valen FUERA de produccion. */
export const comodinesDesarrollo = (u: string): boolean =>
  u.includes('localhost:') ||
  u.includes('127.0.0.1:') ||
  u.includes('192.168.');

/** Origen permitido segun el entorno. Se evalua por peticion porque APP_ENV vive en context.env. */
export const origenPermitido = (valor: string | undefined, esProduccion: boolean): boolean => {
  if (!valor) return false;
  let u: string;
  try {
    u = valor.startsWith('http') ? new URL(valor).origin : valor;
  } catch {
    return false;
  }
  if (ORIGENES_PRODUCCION.includes(u)) return true;
  if (esProduccion) return false;
  return ORIGENES_DESARROLLO.includes(u) || comodinesDesarrollo(u);
};
