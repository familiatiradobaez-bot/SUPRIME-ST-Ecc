// Verificación de `lib/images.ts` contra los CDN reales (no contra URLs escritas
// a mano): compila el módulo con esbuild y pide cada URL generada por HEAD.
//
//   node tools/img-check.mjs
//
// Sirve para pillar de inmediato una sintaxis de transformación que el CDN
// ignore en silencio (ImageKit devolvía JPEG con `fm-webp`, por ejemplo).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'apps/web/src/lib/images.ts');

const dir = mkdtempSync(join(tmpdir(), 'imgcheck-'));
const out = join(dir, 'images.mjs');
// esbuild viene como dependencia de Vite: se usa su API en vez de `npx`, que en
// Windows es `npx.cmd` y no se resuelve desde un proceso hijo.
await esbuild.build({ entryPoints: [SRC], bundle: true, format: 'esm', outfile: out });
const { img, imgSrcSet, canTransform } = await import('file:///' + out.replace(/\\/g, '/'));

// URLs reales de producción (verificado contra GET /catalog/products).
const UNSPLASH = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=900';
const IMAGEKIT = 'https://ik.imagekit.io/demo/medium_cafe_B1iTdD0C.jpg';
const AJENO = 'https://example.com/x.png';

const cases = [
  ['tarjeta 200 avif',  img(UNSPLASH, { w: 200, f: 'avif' })],
  ['tarjeta 400 webp',  img(UNSPLASH, { w: 400, f: 'webp' })],
  ['tarjeta 600 orig',  img(UNSPLASH, { w: 600 })],
  ['pdp 1200 avif',     img(UNSPLASH, { w: 1200, f: 'avif' })],
  ['miniatura 144',     img(UNSPLASH, { w: 144, f: 'webp' })],
  ['buscador 100',      img(UNSPLASH, { w: 100 })],
  ['imagekit 400 avif', img(IMAGEKIT, { w: 400, f: 'avif' })],
];

let fail = 0;
for (const [name, url] of cases) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const bytes = res.headers.get('content-length') ?? '?';
    console.log(
      `${res.ok ? 'OK  ' : 'FAIL'} ${name.padEnd(20)} ${String(res.status)} ` +
      `${(res.headers.get('content-type') ?? '?').padEnd(11)} ${String(bytes).padStart(7)} B  ${url}`
    );
    if (!res.ok) fail++;
  } catch (err) {
    console.log(`FAIL ${name.padEnd(20)} ${err}`);
    fail++;
  }
}

// Un host ajeno no se toca. No se pide por HTTP: el punto es que la cadena
// vuelva idéntica, porque hay productos de prueba con URLs que no existen
// (`https://example.com/x.png`, ver tests/smoke.mjs) y el `onError` de cada
// <img> ya las sustituye por el SVG de reserva.
const intact = img(AJENO, { w: 400, f: 'avif' }) === AJENO;
console.log(`${intact ? 'OK  ' : 'FAIL'} host ajeno intacto   ${img(AJENO, { w: 400, f: 'avif' })}`);
if (!intact) fail++;

// El srcset solo se emite si el host se puede transformar (si no, se repite la
// misma URL y el navegador se descarga la versión grande: era el bug original).
console.log('\nsrcset:');
console.log('  unsplash ->', imgSrcSet(UNSPLASH, [200, 400, 600], { f: 'avif' }));
console.log('  imagekit ->', imgSrcSet(IMAGEKIT, [200, 400], { f: 'avif' }));
console.log('  ajeno    ->', imgSrcSet(AJENO, [200, 400]), '(undefined esperado)');
console.log('  canTransform ajeno ->', canTransform(AJENO), '(false esperado)');

if (fail > 0 || imgSrcSet(AJENO, [200, 400]) !== undefined || canTransform(AJENO)) {
  console.error(`\n${fail} comprobaciones fallidas`);
  process.exit(1);
}
console.log('\nTodo correcto: los CDN devuelven 200 en el formato pedido.');
