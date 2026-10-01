import { useEffect } from 'react';
import { ORIGEN_CANONICO } from '../lib/site';

const BASE_TITLE = 'SUPRIME - Tienda Premium';
const BASE_DESC = 'SUPRIME: productos premium con envío en 24-48h. Calidad, estilo y excelencia en cada compra.';

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Escribe el <link rel="canonical">, que se actualiza, no se puede dejar fijo en
 * el index.html.
 *
 * Es lo que arregla el hallazgo de SEO: Pages sirve el mismo HTML para todas las
 * rutas, asi que el canonical del index.html siempre es el de la home, y eso le
 * dice a Google que todas las fichas son duplicados. Aqui se corrige por ruta.
 */
function setCanonical(url: string) {
  let el = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
}

/**
 * Escribe el title, la description, las etiquetas de Open Graph y el canonical.
 *
 * ruta: la ruta REAL de la pagina, con barra inicial ('/producto/x'). Sin ella el
 * canonical se queda en la home, que es el bug que se arregla aqui.
 * imagen: la imagen para la vista previa al compartir.
 */
export function useDocumentTitle(
  title?: string,
  description?: string,
  ruta?: string,
  imagen?: string,
) {
  useEffect(() => {
    const t = title ? `${title} | SUPRIME` : BASE_TITLE;
    const d = description || BASE_DESC;
    document.title = t;
    setMeta('description', d);
    setMeta('og:title', t, 'property');
    setMeta('og:description', d, 'property');
    setMeta('twitter:title', t);
    setMeta('twitter:description', d);

    // El canonical va con la ruta real. Sin ruta (la home), es el origen solo.
    const rutaLimpia = ruta && ruta !== '/' ? (ruta.startsWith('/') ? ruta : `/${ruta}`).split('?')[0] : '/';
    const url = `${ORIGEN_CANONICO}${rutaLimpia}`;
    setCanonical(url);
    setMeta('og:url', url, 'property');
    // og:type: una ficha de producto no es un "website". Sin esto, la vista previa
    // la trata como la pagina principal de la tienda.
    setMeta('og:type', rutaLimpia.startsWith('/producto/') ? 'product' : 'website', 'property');

    if (imagen) {
      setMeta('og:image', imagen, 'property');
      setMeta('twitter:image', imagen);
    }

    return () => {
      document.title = BASE_TITLE;
      setMeta('description', BASE_DESC);
    };
  }, [title, description, ruta, imagen]);
}
