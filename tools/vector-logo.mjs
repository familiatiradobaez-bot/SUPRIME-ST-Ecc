// ============================================================================
// Vectoriza el logo desde el JPG original con marching squares.
//
// POR QUE NO SE USA EL SVG DE CONVERTIO: el trazado先天 falla. Su path grande
// es un rectangulo solido (medido: 93% opaco, igual con nonzero y con evenodd,
// o sea que el logo no esta ni como agujero ni como isla dentro) y los 46
// trazos sueltos solo cubren el 0.1%. Es decir, el arte se perdio al vectorizar.
// Ademas no lleva ningun color de relleno, asi que salia negro. La geometria
// util no esta ahi. Se vuelve al raster original, que es oro sobre negro: la
// luminancia los separa limpiamente (83-92% del lienzo es fondo).
//
// SALIDA: un <path> con la silueta, relleno con un degradado dorado, y
// fill-rule="evenodd" para que el sentido de los contornos sea irrelevante.
// ============================================================================
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

/** Lee la imagen y devuelve la luminancia como Float32Array normalizada 0..1. */
async function luminancia(ruta) {
  const { data, info } = await sharp(ruta).greyscale().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data[i] / 255;
  return { L: out, w: info.width, h: info.height };
}

/**
 * Marching squares con interseccion sub-pixel: en cada borde de celda se
 * interpola la luminancia real, no se usa el punto medio. Sin esto el borde
 * queda dentado al.githubusercontent de un pixel.
 *
 * Sentido de los segmentos: se recorre de forma que el interior (L>=umbral)
 * quede siempre a un lado fijo. Como la salida usa evenodd, el sentido da igual.
 */
function contornos(L, w, h, umbral) {
  // Tabla de casos: caso = (TL<<3)|(TR<<2)|(BR<<1)|BL, 1 = dentro.
  // Pares [bordeInicio, bordeFin] en orden T=0 R=1 B=2 L=3.
  const CASOS = [
    [], [[3, 2]], [[2, 1]], [[3, 1]],
    [[0, 1]], [], [[0, 2]], [[3, 0]],
    [[0, 3]], [[0, 2]], [], [[0, 1]],
    [[3, 1]], [[2, 1]], [[3, 2]], [],
  ];
  // Casos 5 y 10 son silla de montar: hay que decidir con el centro de la celda.
  const SILLAS = { 5: [[[0, 1], [3, 2]], [[0, 3], [2, 1]]], 10: [[[0, 3], [2, 1]], [[0, 1], [3, 2]]] };

  const dentro = (x, y) => L[y * w + x] >= umbral;
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;

  // Interseccion exacta en un borde, por interpolacion lineal.
  const T = (x, y) => interp(L, w, h, x, y, x + 1, y);
  const B = (x, y) => interp(L, w, h, x, y + 1, x + 1, y + 1);
  const Lf = (x, y) => interp(L, w, h, x, y, x, y + 1);
  const R = (x, y) => interp(L, w, h, x + 1, y, x + 1, y + 1);

  function interp(L, w, h, x0, y0, x1, y1) {
    const a = L[Math.min(h - 1, y0) * w + Math.min(w - 1, x0)];
    const b = L[Math.min(h - 1, y1) * w + Math.min(w - 1, x1)];
    const t = Math.abs(b - a) < 1e-9 ? 0.5 : (umbral - a) / (b - a);
    const t2 = Math.max(0, Math.min(1, t));
    return [x0 + (x1 - x0) * t2, y0 + (y1 - y0) * t2];
  }

  const punto = { 0: T, 1: R, 2: B, 3: Lf };
  const siguiente = new Map(); // clave de punto -> clave del siguiente
  const coords = new Map();

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = dentro(x, y) ? 1 : 0, tr = dentro(x + 1, y) ? 1 : 0;
      const br = dentro(x + 1, y + 1) ? 1 : 0, bl = dentro(x, y + 1) ? 1 : 0;
      const caso = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (caso === 0 || caso === 15) continue;

      let pares = CASOS[caso];
      if (SILLAS[caso]) {
        // La silla se resuelve mirando el centro: si el centro esta dentro, los
        // dos "dientes" de dentro se unen entre si.
        const centro = (L[y * w + x] + L[y * w + x + 1] + L[(y + 1) * w + x] + L[(y + 1) * w + x + 1]) / 4;
        pares = SILLAS[caso][centro >= umbral ? 0 : 1];
      }

      for (const [ea, eb] of pares) {
        const pa = punto[ea](x, y), pb = punto[eb](x, y);
        const ka = key(pa), kb = key(pb);
        coords.set(ka, pa); coords.set(kb, pb);
        siguiente.set(ka, kb);
      }
    }
  }
  return { siguiente, coords };
}

/** Encadena los segmentos en polilineas cerradas y descarta las sueltas. */
function encadenar({ siguiente, coords }) {
  const lineas = [];
  const visto = new Set();
  for (const ka of coords.keys()) {
    if (visto.has(ka)) continue;
    const linea = [];
    let cur = ka, guard = 0;
    while (cur && !visto.has(cur) && guard++ < 500000) {
      visto.add(cur);
      linea.push(coords.get(cur));
      cur = siguiente.get(cur);
    }
    if (linea.length >= 4) lineas.push(linea);
  }
  return lineas;
}

/** Douglas-Peucker: quita puntos que no cambian la forma. */
function simplificar(puntos, eps) {
  if (puntos.length < 3) return puntos;
  const dentro1 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = dx * dx + dy * dy;
    if (d === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const dp = (pts) => {
    let maxi = 0, maxd = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = dentro1(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxd) { maxd = d; maxi = i; }
    }
    if (maxd <= eps) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, maxi + 1)).slice(0, -1), ...dp(pts.slice(maxi))];
  };
  return dp(puntos);
}

/** Area con signo de una polilinea. */
function area(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] * p[i][1] - p[i][0] * p[j][1]);
  return a / 2;
}

/** Caja envolvente. */
function caja(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

/** Punto dentro de una polilinea por cruce de rayos. */
function dentro(punto, poly, c) {
  const [px, py] = punto;
  if (px < c.x0 || px > c.x1 || py < c.y0 || py > c.y1) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Decide que contornos son agujeros, por CONTENcion y no por el signo del area.
 *
 * El signo no vale: al encadenar los segmentos de marching squares el sentido
 * depende de como se entro en cada celda, y en este logo hay mas agujeros que
 * formas, asi que contar signos da el mayoritario equivocado y se acababa
 * descartando justo el rayo entero.
 *
 * Se recorren de mayor a menor area: un contorno contenido en uno ya aceptado
 * es un agujero suyo. `rellenar` quita los agujeros, y con `fill-rule="evenodd"`
 * quitarlos de la lista es justo lo que los pinta: asi el rayo sale entero en
 * vez de partido, porque sus facetas oscuras son agujeros.
 */
function clasificar(lineas, rellenar) {
  const conCaja = lineas.map((l) => ({ l, c: caja(l), a: Math.abs(area(l)), hijos: [] }));
  conCaja.sort((p, q) => q.a - p.a);
  const aceptados = [];
  const salida = [];
  for (const item of conCaja) {
    // Un punto dentro de un contorno ya aceptado lo hace agujero suyo. Se prueban
    // varios puntos por si el primero cae justo en un borde.
    const prueba = [item.l[0], item.l[(item.l.length / 2) | 0], item.l[item.l.length - 1]];
    const dentroDe = aceptados.find((a) => prueba.some((p) => dentro(p, a.l, a.c)));
    if (dentroDe) {
      // Ojo: `hijos` se inicializa arriba para TODOS, no solo para los que
      // Accepted. Un agujero puede contener islas, y al visitarlo se leen sus
      // hijos: si no estan inicializados, revienta con "n.hijos is not iterable".
      dentroDe.hijos.push(item);
    } else {
      aceptados.push(item);
      salida.push(item);
    }
  }
  if (!rellenar) return salida.map((s) => s.l);
  // Rellenar: se queda la forma y todo lo que cuelgue de ella (islas), y se
  // descartan los intermediios que solo son agujeros de un agujero.
  const out = [];
  const visitar = (n) => { out.push(n.l); for (const h of n.hijos) visitar(h); };
  for (const s of salida) visitar(s);
  return out;
}

/** Convierte todo en un unico atributo d. */
function aPath(lineas, decimales = 1) {
  const d = [];
  for (const l of lineas) {
    d.push(`M${l[0][0].toFixed(decimales)} ${l[0][1].toFixed(decimales)}`);
    for (let i = 1; i < l.length; i++) d.push(`L${l[i][0].toFixed(decimales)} ${l[i][1].toFixed(decimales)}`);
    d.push('Z');
  }
  return d.join('');
}

/**
 * Cierra la mascara: dilata y luego erosiona.
 *
 * POR QUE hace falta, y por que el umbral solo no llega. El logo original es un
 * rayo facetado sobre negro, con un resplandor difuso alrededor. Cualquier
 * umbral lo bastante bajo para incluir las facetas oscuras del rayo mete
 * tambien el halo, y el halo es una mancha enorme: el rayo queda contenido en
 * el y se clasifica como agujero suyo (medido: el resultado eran un par de
 * astillas). Al umbral alto el rayo sale partido por los huecos de las facetas.
 *
 * El cierre resuelve las dos cosas a la vez: el umbral ALTO separa el rayo del
 * resplandor, y la dilatacion puentea los huecos de las facetas para que la
 * silueta quede solida.
 *
 * Se hace con un desenfoque gaussiano y un umbral distinto en cada sentido,
 * que es la forma barata de dilatar y de erosionar: tras el blur, subir el
 * umbral encoge la mascara (erosion) y bajarlo la engorda (dilatacion).
 */
async function cerrar(ruta, { umbral = 0.3, sigma = 6 } = {}) {
  const erosionar = Math.max(1, Math.round(sigma * 0.9));
  const dilatar = Math.max(1, Math.round(sigma * 1.6));
  // Cada paso se materializa a PNG: si se encadena sobre el buffer anterior sin
  // formatear, sharp pierde las dimensiones y falla con "bad dimensions".
  const b1 = await sharp(ruta).greyscale().toColourspace('b-w').threshold(Math.round(umbral * 255)).png().toBuffer();
  // Erosionar = subir el umbral tras el desenfoque. Dilatar = bajarlo.
  const b2 = await sharp(b1).blur(erosionar).threshold(128 + erosionar * 4).png().toBuffer();
  const b3 = await sharp(b2).blur(dilatar).threshold(Math.max(1, 128 - dilatar * 4)).png().toBuffer();
  return sharp(b3).greyscale().raw().toBuffer({ resolveWithObject: true });
}

export async function vectorizar(ruta, { umbral = 0.2, eps = 0.8, areaMin = 12, rellenar = true, cerrar: sigma = 0 } = {}) {
  let L, w, h;
  if (sigma > 0) {
    const r = await cerrar(ruta, { umbral, sigma });
    // Ojo: r.info se llama width/height, no w/h. Desestructurar {w, h} de ahi
    // daria undefined en silencio, contornos leeria NaN en los indices y
    // devolveria cero contornos sin decir nada.
    w = r.info.width;
    h = r.info.height;
    const total = w * h;
    L = new Float32Array(total);
    for (let i = 0; i < total; i++) L[i] = r.data[i] / 255;
  } else {
    ({ L, w, h } = await luminancia(ruta));
  }
  const brutos = encadenar(contornos(L, w, h, 0.5))
    .filter((l) => Math.abs(area(l)) >= areaMin)
    .map((l) => simplificar(l, eps))
    .filter((l) => l.length >= 3);
  const utiles = clasificar(brutos, rellenar);
  const puntos = utiles.reduce((n, l) => n + l.length, 0);
  return { d: aPath(utiles), lineas: utiles.length, puntos, w, h };
}
