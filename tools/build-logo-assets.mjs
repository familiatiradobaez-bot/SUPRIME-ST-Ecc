// ============================================================================
// Assets de marca de SUPRIME.
//
// QUE SE USA Y POR QUE.
//
// 1) El rayo: el del usuario, recortado y con ALFA real. Se calcula el alfa a
//    partir de la luminancia porque el original es dorado sobre negro: el negro
//    pasa a transparente y el resplandor se conserva como halo suave. Asi el
//    mismo archivo funciona sobre el #0a0a14 del site y sobre cualquier otro
//    fondo, sin el cuadrado negro que salia al aplanar.
//
// 2) La palabra "SUPRIME": NO se recorta de la imagen, se escribe como texto.
//    Motivo medido: la imagen del usuario dice "UPRIME", le falta la S. El
//    generador de imagen se la comio. Poner el recorte tal cual pondria "UPRIME"
//    en la web. Ademas el texto recortado sale borroso a tamano de cabecera y no
//    es seleccionable ni accesible. El rayo, que es lo distintivo, si se usa
//    tal cual.
//
// DE DONDE NO SE USA NADA (medido, no supuesto):
//   - Los SVG de convertio: el path principal es un rectangulo solido (93% opaco,
//     identico con nonzero y con evenodd, o sea que el logo no esta ni como
//     agujero ni como isla) y los 46 trazos restantes cubren el 0,1%. Ningun
//     path lleva `fill`. El dibujo se perdio al vectorizar; no hay nada que
//     retocar.
//   - Vectorizar el JPG: es un raster con resplandor difuso y las facetas
//     oscuras del rayo son mas oscuras que sus puntas, asi que a umbral bajo
//     manda el halo y a umbral alto el rayo se parte. 16 combinaciones de umbral
//     y cierre morfologico probadas: solo sobreviven las dos puntas.
// ============================================================================
import sharp from 'sharp';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(RAIZ, 'brand');
const PUB = join(RAIZ, 'apps/web/public');
const TMP = 'C:/Users/VIP/AppData/Local/Temp/opencode';
const DESCARGADOS = 'C:/Users/VIP/Downloads';

mkdirSync(BRAND, { recursive: true });
mkdirSync(PUB, { recursive: true });

// Caja del rayo, medida a umbral 0.25 en el original de 1024x892.
const CAJA_RAYO = { left: 250, top: 94, width: 532, height: 682 };

const fuenteRayo = join(DESCARGADOS, 'WhatsApp Image 2026-09-30 at 6.22.45 PM.jpeg');
const guardado = join(BRAND, 'rayo-original.jpeg');
copyFileSync(fuenteRayo, guardado);
console.log(`original del rayo -> ${guardado}`);

/**
 * Convierte dorado-sobre-negro en dorado-sobre-transparente.
 *
 * El alfa sale de la luminancia, con un umbral de corte: por debajo de `corte`
 * se desvanece (el resplandor), por encima es opaco (el rayo y sus facetas
 * oscuras, que si no se transparentarian y se veria el fondo a traves).
 */
async function conAlfa(entrada, corte = 0.16) {
  const { data, info } = await sharp(entrada).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const salida = Buffer.alloc(n * 4);
  const t = corte * 255;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const a = lum <= 0 ? 0 : lum >= t ? 255 : Math.round((lum / t) * 255);
    // El color se queda como es: el negro de fondo con alfa 0 ya no molesta.
    salida[i * 4] = r; salida[i * 4 + 1] = g; salida[i * 4 + 2] = b; salida[i * 4 + 3] = a;
  }
  return { data: salida, info };
}

const rayoCrudo = await sharp(guardado).extract(CAJA_RAYO).png().toBuffer();
const { data: rgba, info } = await conAlfa(rayoCrudo);
const rayo = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png().toBuffer();

// --- Iconos del rayo --------------------------------------------------------
// iOS NO acepta SVG en apple-touch-icon: con el SVG unico de antes, "anadir a
// pantalla de inicio" en iPhone no ponia icono. Y el manifest pide 192 y 512
// para que Chrome ofrezca instalar. Por eso PNG en todos los tamanos.
const ICONOS = [
  ['favicon-16.png', 16], ['favicon-32.png', 32], ['favicon-48.png', 48],
  ['apple-touch-icon-152.png', 152], ['apple-touch-icon-167.png', 167], ['apple-touch-icon.png', 180],
  ['icon-192.png', 192], ['icon-512.png', 512],
];
for (const [f, lado] of ICONOS) {
  // El rayo es alto y estrecho (532x682). Se mete en un cuadrado con margen
  // para que en un icono pequeno no quede pegado a los bordes.
  const lienzo = lado;
  const margen = Math.round(lienzo * 0.1);
  const disp = lienzo - margen * 2;
  const esc = Math.min(disp / 532, disp / 682);
  const w = Math.max(1, Math.round(532 * esc));
  const h = Math.max(1, Math.round(682 * esc));
  const buf = await sharp(rayo)
    .resize(w, h, { fit: 'fill' })
    .extend({
      top: Math.round((lienzo - h) / 2),
      bottom: lienzo - Math.round((lienzo - h) / 2) - h,
      left: Math.round((lienzo - w) / 2),
      right: lienzo - Math.round((lienzo - w) / 2) - w,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, palette: true, quality: 92 })
    .toBuffer();
  writeFileSync(join(PUB, f), buf);
  console.log(`  ${f.padEnd(26)} ${String(lado).padStart(3)}px  ${(buf.length / 1024).toFixed(1)} KB`);
}

// --- Rayo suelto para la cabecera ------------------------------------------
// Se deja cuadrado y con el rayo centrado, para poder dimensionarlo por CSS.
for (const [f, lado] of [['rayo-128.png', 128], ['rayo-256.png', 256]]) {
  const buf = await sharp(rayo)
    .resize({ width: Math.round(lado * (532 / 682)), fit: 'inside' })
    .png({ compressionLevel: 9, palette: true, quality: 94 })
    .toBuffer();
  writeFileSync(join(PUB, f), buf);
  console.log(`  ${f.padEnd(26)} ${lado}px   ${(buf.length / 1024).toFixed(1)} KB`);
}

// Comprobacion visual: el mismo icono sobre fondo oscuro y sobre fondo claro,
// que es donde se ve si el alfa funciona.
const base = await sharp(join(PUB, 'icon-192.png')).toBuffer();
const pruebas = await Promise.all(['#0a0a14', '#ffffff', '#6366f1'].map(async (bg) =>
  sharp({ create: { width: 192, height: 192, channels: 3, background: bg } })
    .composite([{ input: base, left: 0, top: 0 }]).png().toBuffer()));
writeFileSync(`${TMP}/icono-oscuro.png`, pruebas[0]);
writeFileSync(`${TMP}/icono-claro.png`, pruebas[1]);
writeFileSync(`${TMP}/icono-morado.png`, pruebas[2]);
console.log(`\ncomprobacion del alfa -> icono-oscuro.png / icono-claro.png / icono-morado.png`);

// Se borra el recorte del wordmark anterior: no se usa (la S no estaba).
writeFileSync(join(PUB, '.logo-wordmark-descartado'), 'El wordmark original dice UPRIME, sin la S. No se usa: la palabra se escribe como texto. Ver tools/build-logo-assets.mjs\n');

console.log('listo');
