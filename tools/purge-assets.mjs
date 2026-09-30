#!/usr/bin/env node
/**
 * purge-assets.mjs — Purga /assets/* en la CDN de Cloudflare.
 *
 * POR QUÉ HACE FALTA (incidente real, 2026-09-30):
 *
 *   Cloudflare Pages sirve la SPA con 200 en TODA ruta que no exista
 *   (`/* /index.html 200` en _redirects). `_redirects` no admite devolver un
 *   404 —la tabla de la doc pone "Rewrites (other status codes): no"—, así que
 *   un asset que todavia no existe responde 200 con el index.html dentro.
 *
 *   El problema es que esa respuesta se cachea COMO SI FUERA EL ASSET:
 *   - la Cache Rule de la zona para /assets/* (1 año), y
 *   - la cabecera `Cache-Control: public, max-age=31536000, immutable` de
 *     _headers, que Pages aplica por ruta, no por tipo de contenido.
 *
 *   Resultado: un visitante que pide ese chunk durante la ventana del
 *   despliegue se guarda un text/html con TTL de un año bajo una URL .js. Cuando
 *   el asset real llega, la CDN sigue sirviendo el HTML cacheado, y el
 *   navegador rechaza el módulo ES por MIME ("Expected a JavaScript-or-Wasm
 *   module script"). El panel de admin, la PDP, el carrito y el modal de login
 *   dejan de cargar: pantalla en blanco. Y no se sana solo en un año.
 *
 *   Se observó en producción: tras un push, la CDN devino el AdminPage chunk
 *   como text/html (cf-cache-status: HIT, age 990 s) mientras un fetch() normal
 *   del mismo URL devolvia application/javascript. Habia DOS objetos cacheados
 *   para la misma URL.
 *
 * QUÉ HACE: purga el prefijo /assets/* (Cloudflare admite un comodín al final).
 * Se ejecuta en CI después del despliegue. No borra nada del origen: los
 * assets se regeneran solos en la siguiente petición.
 *
 * Uso:
 *   node tools/purge-assets.mjs --dry-run   # solo lista lo que se pediría
 *   CLOUDFLARE_API_TOKEN=... node tools/purge-assets.mjs
 *   node tools/purge-assets.mjs --token cfat_xxx
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const ZONE = process.env.CLOUDFLARE_ZONE_ID || '76d7164bb1f6a909167e1c1dc6b46b54';
const PREFIX = process.env.CLOUDFLARE_PURGE_PREFIX || 'https://suprime.xyz/assets/*';

function readToken() {
  const i = args.indexOf('--token');
  if (i !== -1 && args[i + 1]) return args[i + 1];
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  // Fallback al archivo de secretos local (fuera del repo). En CI solo se usa
  // la variable de entorno.
  try {
    const s = readFileSync(join(REPO, '..', '_SECRETS', 'cloudflare.env'), 'utf8');
    const m = s.match(/^CLOUDFLARE_API_TOKEN=(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const token = readToken();
if (!token) {
  console.error('Falta CLOUDFLARE_API_TOKEN. Exportala o usa --token.');
  process.exit(2);
}

if (dryRun) {
  console.log(`(dry-run) purgaría: ${PREFIX}  en la zona ${ZONE}`);
  process.exit(0);
}

const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ files: [PREFIX] }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok || !body.success) {
  console.error(`purga fallida (${res.status}): ${JSON.stringify(body.errors || body).slice(0, 300)}`);
  process.exit(1);
}
console.log(`✓ purgado ${PREFIX} (id ${body.result?.id})`);

// Comprobación: si algún asset sigue saliendo como HTML, la purga no ha tocado
// el nodo que lo servía y hay que avisar (no se puede arreglar desde aquí).
const html = await fetch(process.env.CLOUDFLARE_PURGE_ORIGIN || 'https://suprime.xyz/').then((r) => r.text());
const assets = [...html.matchAll(/\/assets\/[A-Za-z0-9_.\-]+\.js/g)].map((m) => m[0]);
let bad = 0;
for (const a of assets) {
  const r = await fetch(`https://suprime.xyz${a}`);
  const type = r.headers.get('content-type') || '';
  if (!/javascript/.test(type)) {
    bad++;
    console.error(`  ROTO ${a} -> ${type}`);
  }
}
console.log(bad === 0
  ? `✓ los ${assets.length} JS del index se sirven como JavaScript`
  : `✗ ${bad} de ${assets.length} siguen como HTML`);
process.exit(bad === 0 ? 0 : 1);
