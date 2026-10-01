/**
 * Dominio canonico de la tienda, del lado del front.
 *
 * El equivalente a `apps/api/src/lib/site.ts` en la API. Existe por el mismo
 * motivo: el dominio estaba escrito a mano en varios ficheros (ProductPage,
 * CatalogPage y el index.html) y con el dominio repetido es facil que uno se
 * quede con el host viejo, que es como se acaban teniendo dos URLs para la misma
 * pagina indexadas.
 *
 * www es el host canonico y suprime.xyz redirige con 301 (lo pone Cloudflare;
 * ver tools/pages-www-redirect.mjs). Es lo que va en canonical, og:url, el
 * sitemap y el JSON-LD.
 *
 * El index.html es estatico y no puede importar nada, asi que ahi el dominio va
 * escrito a mano. Si cambia, hay que cambiarlo tambien alli: son tres lineas
 * (canonical, og:url y las dos imagenes og/twitter).
 */
export const SITE_URL = 'https://www.suprime.xyz';


/**
 * Origen canonico, para construir canonical y og:url desde JS.
 *
 * Existe por el mismo motivo que SITIO_CANONICO: el host estaba escrito a mano
 * en varios ficheros, y con el host repetido es facil que uno se quede con el
 * viejo. Notar que es SIN barra final a proposito: se concatena con la ruta
 * ('/producto/x') y con las dos barras saldria 'https://www.suprime.xyz//producto/x'.
 */
export const ORIGEN_CANONICO = SITE_URL.replace(/\/+$/, '');
