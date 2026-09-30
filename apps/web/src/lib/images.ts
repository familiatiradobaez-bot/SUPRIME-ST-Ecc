// Transformaciones de imagen por proveedor + `srcset` responsive.
//
// Por qué existe este módulo: el catálogo mezcla dos orígenes — ImageKit (las
// subidas del panel, `ik.imagekit.io`) e Imgix detrás de Unsplash (los productos
// de ejemplo) — y cada CDN usa una sintaxis distinta. Antes solo `thumb()`,
// que aplicaba `?tr=w-N` y solo a ImageKit. Para las URLs de Unsplash devolvía
// la URL sin tocar, así que el `srcset` de `ProductCard` acababa con DOS
// entradas apuntando al mismo fichero (`400w` y `800w` con la misma URL): el
// navegador elegía la de 800w y descargaba la imagen a 900px. Medido en
// producción: 839 KiB de imágenes en escritorio que no hacían falta.
//
// Sintaxis verificada contra los CDN reales (2026-09-30), no de memoria:
//   ImageKit  `?tr=w-800,h-600,c-main,f-avif,q-70` → 800x600 image/avif
//   Unsplash  `?w=800&h=600&fit=crop&fm=avif&q=70` → 800x600 image/avif
//   ImageKit  `?tr=f-webp` / `?fm=webp` → solo la primera convierte; el
//             `fm-` de la v1 está obsoleto y se ignora en silencio.

export type ImgFormat = 'avif' | 'webp' | 'orig';

export type ImgOpts = {
  /** Ancho en px. Se ignora si el host no admite transformaciones. */
  w?: number;
  /** Alto en px. */
  h?: number;
  /**
   * Proporción (ancho/alto). Si se pasa, calcula el alto a partir del ancho
   * para que todas las variantes del `srcset` compartan proporción. Nota: con
   * `ar` el CDN **recorta**; en el catálogo no se usa porque el diseño pide
   * mostrar la foto entera (`object-fit: contain` en la PDP).
   */
  ar?: number;
  /** Formato de salida. `orig` (por defecto) mantiene el del fichero original. */
  f?: ImgFormat;
  /** Calidad 1-100. Si no se pasa, la del proveedor. */
  q?: number;
};

type Adapter = {
  /** Host (o sufijo) que reconoce el proveedor. */
  matches: (host: string) => boolean;
  apply: (u: URL, o: Required<Pick<ImgOpts, 'w' | 'h'>> & ImgOpts) => void;
};

// ImageKit: las transformaciones van todas en un único `tr` separada por comas.
const imagekit: Adapter = {
  matches: (host) => host === 'ik.imagekit.io' || host.endsWith('.ik.imagekit.io'),
  apply(u, o) {
    const tr: string[] = [];
    if (o.w) tr.push(`w-${o.w}`);
    if (o.h) tr.push(`h-${o.h}`);
    if (o.q) tr.push(`q-${o.q}`);
    if (o.f === 'avif') tr.push('f-avif');
    else if (o.f === 'webp') tr.push('f-webp');
    if (tr.length === 0) return;
    const current = u.searchParams.get('tr');
    u.searchParams.set('tr', current ? `${current},${tr.join(',')}` : tr.join(','));
  },
};

// Unsplash/Imgix: un parámetro por transformación.
const unsplash: Adapter = {
  matches: (host) => host === 'images.unsplash.com',
  apply(u, o) {
    if (o.w) u.searchParams.set('w', String(o.w));
    if (o.h) {
      u.searchParams.set('h', String(o.h));
      // `fit` solo tiene sentido con caja fija; sin él Unsplash ignora el alto.
      if (!u.searchParams.has('fit')) u.searchParams.set('fit', 'crop');
    }
    if (o.q) u.searchParams.set('q', String(o.q));
    if (o.f === 'avif') u.searchParams.set('fm', 'avif');
    else if (o.f === 'webp') u.searchParams.set('fm', 'webp');
  },
};

const ADAPTERS: Adapter[] = [imagekit, unsplash];

function adapterFor(host: string): Adapter | null {
  return ADAPTERS.find(a => a.matches(host)) ?? null;
}

/** ¿Se puede transformar esta URL (o el host no lo permite → devolver tal cual)? */
export function canTransform(url: string): boolean {
  if (!url) return false;
  try {
    return adapterFor(new URL(url).hostname) !== null;
  } catch {
    return false;
  }
}

/**
 * URL de la imagen redimensionada (y opcionalmente en otro formato).
 * Si el host no es un proveedor conocido devuelve la URL intacta: es preferible
 * servir la original que romper una imagen que hoy funciona.
 */
export function img(url: string, opts: ImgOpts = {}): string {
  if (!url) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const adapter = adapterFor(u.hostname);
  if (!adapter) return url;

  const w = opts.w ?? 0;
  // `ar` deriva el alto para que todas las variantes mantengan la proporción.
  const h = opts.h ?? (opts.ar && w ? Math.round(w / opts.ar) : 0);
  adapter.apply(u, { ...opts, w, h });
  return u.toString();
}

/**
 * `srcset` para los anchos indicados, o `undefined` si el host no admite
 * transformaciones. `undefined` es deliberado: emitir un `srcset` con la misma
 * URL repetida fue exactamente el bug que motivó este módulo.
 */
export function imgSrcSet(url: string, widths: number[], opts: ImgOpts = {}): string | undefined {
  if (!canTransform(url)) return undefined;
  const list = [...new Set(widths.filter(w => Number.isFinite(w) && w > 0))].sort((a, b) => a - b);
  if (list.length === 0) return undefined;
  return list.map(w => `${img(url, { ...opts, w })} ${w}w`).join(', ');
}
