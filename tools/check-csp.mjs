// Comprueba la CSP del DOCUMENTO desplegado, que es la que protege de verdad.
//
// POR QUE ESTA FUERA DEL SMOKE Y NO DENTRO
//
// El smoke corre en el push, y Pages no despliega en el push: lanza un proceso
// asincrono de unos 5 minutos. Si estos checks estuvieran en el smoke,
// fallarian en el mismo push que los arregla, porque estarian leyendo el HTML
// viejo. Por eso esto se ejecuta DESPUES de tools/purge-assets.mjs
// --espera-deploy, que es el paso que ya espera a que el despliegue exista.
// Ver el job e2e de .github/workflows/ci.yml.
//
// QUE COMPRUEBA Y POR QUE
//
// La cabecera CSP de la API se mira en el smoke, pero esa no restringe nada por
// si sola: una CSP solo se aplica a quien la recibe como DOCUMENTO, y las
// respuestas de la API son JSON. La del <meta http-equiv> del index.html es la
// unica que bloquea scripts.
//
// El cambio: quitar 'unsafe-inline' de script-src, que es lo que permitia
// ejecutar HTML inyectado. Se quito porque los dos scripts del documento son
// externos (medido sobre el build: /assets/index-*.js y /config.js, cero
// inline), asi que no hacia falta para nada.
//
// EL RIESGO REAL DE ESTE CAMBIO, Y POR QUE HAY UN HASH
//
// Quitar 'unsafe-inline' no rompe solo scripts. Rompe tambien los manejadores
// de evento inline (onclick=), y ahi el fallo es SILENCIOSO: no salta ningun
// error, la pagina sigue cargando y simplemente algo deja de funcionar. Pasaba
// con el <link> de Google Fonts, que lleva onload="this.media='all'" para que su
// CSS no bloquee el render. Con la CSP endurecida ese manejador queda bloqueado
// y las fuentes dejan de aplicarse: la web se ve con las tipografias de reserva y
// no hay aviso. La salida correcta no es devolver 'unsafe-inline' (que es
// justo lo que se quiere quitar) sino un hash: con 'unsafe-hashes' en la
// directiva, los hashes si valen para manejadores. De ahi el sha256 en la CSP.
//
// Ademas se quito 'frame-ancestors' del <meta>: la especificacion dice que en un
// meta se ignora, solo funciona como cabecera HTTP. Dejarlo ahi es tener una
// directiva que no hace nada y da falsa sensacion de proteccion.
//
// Uso: node tools/check-csp.mjs [url]
// Salida: codigo 1 si algo falla, 0 si todo correcto.
import { readFileSync } from 'node:fs';

const BASE = (process.argv[2] || process.env.CSP_CHECK_URL || 'https://www.suprime.xyz').replace(/\/$/, '');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  OK    ${name}${detail ? '  -> ' + detail : ''}`); }
  else { fail++; console.log(`  FALLA ${name}${detail ? '  -> ' + detail : ''}`); }
};

console.log(`== CSP del documento en ${BASE} ==`);

const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
const html = await res.text();

if (!res.ok) { console.log(`  el sitio devolvio ${res.status}, no se puede comprobar`); process.exit(1); }

const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
const d = meta ? meta[1] : '';

check('hay meta CSP en el HTML desplegado', !!meta, meta ? 'encontrada' : 'NO HAY META CSP');

if (!meta) {
  console.log(`\n${fail} FALLAN: sin CSP no hay nada que comprobar y la web queda sin proteccion`);
  process.exit(1);
}

console.log('\n-- la politica que se sirve --');
for (const dir of d.split('; ').filter(Boolean)) console.log('  ' + dir);
console.log('');

const directriz = (nombre) => (d.match(new RegExp(`${nombre} ([^;]*)`)) || [, ''])[1].trim();
const scriptSrc = directriz('script-src');
const styleSrc = directriz('style-src');
const connectSrc = directriz('connect-src');

// --- El nucleo del cambio ---
check("script-src SIN 'unsafe-inline'", !/unsafe-inline/.test(scriptSrc), scriptSrc.slice(0, 110) || '(script-src vacio)');

// --- Las fuentes, y el truco de no bloquear el render ---
//
// Hay dos caminos validos y hay que aceptar los dos:
//   a) Google Fonts con el truco de media="print" onload="this.media='all'",
//      que necesita el hash para que el manejador pase.
//   b) Cloudflare Fonts, que sustituye ese <link> por un <style> inline con
//      @font-face apuntando a /cf-fonts/... y no deja ningun manejador inline.
//      www.suprime.xyz esta en este caso, asi que exigir (a) daria un falso fallo.
const hayTruccoFuentes = /onload\s*=\s*["']?this\.media/.test(html);
const cloudflareFonts = html.includes('/cf-fonts/');
const estilosInline = /<style[^>]*>@font-face/.test(html);

if (hayTruccoFuentes) {
  check("el <link> de Google Fonts con el truco onload tiene 'unsafe-hashes'", /unsafe-hashes/.test(scriptSrc), /unsafe-hashes/.test(scriptSrc) ? 'unsafe-hashes presente' : 'SIN unsafe-hashes: el manejador quedaria bloqueado y las fuentes no se aplicarian');
  check('el hash sha256 del manejador de las fuentes esta presente', /sha256-[A-Za-z0-9+/=]+/.test(scriptSrc), /sha256-[A-Za-z0-9+/=]+/.test(scriptSrc) ? 'con hash sha256' : 'SIN hash: el manejador quedaria bloqueado');
  check("el <link> de Google Fonts conserva el onload que el hash cubre", /onload\s*=\s*["']this\.media=['"]all['"]/.test(html), 'el onload cambio: recalcula su sha256 y actualiza la CSP, o las fuentes se quedan en silencio con la de reserva');
  check('el <link> de Google Fonts conserva media=print (el truco de no bloquear el render)', /media=["']print["'][^>]*onload/.test(html) || /onload[^>]*media=["']print["']/.test(html), 'media=print junto al onload');
} else {
  console.log('  -- sin el truco de Google Fonts: se acepta el camino de Cloudflare Fonts --');
  check('las fuentes vienen por Cloudflare Fonts (@font-face inline a /cf-fonts/)', estilosInline && cloudflareFonts,
    estilosInline ? (cloudflareFonts ? 'ok' : 'hay @font-face inline pero no apunta a /cf-fonts/') : 'ni @font-face inline ni truco onload: no se ve de donde salen las fuentes');
  // El hash sigue en la CSP aunque hoy no lo use nadie: si se apaga Cloudflare
  // Fonts, el <link> con el onload vuelve y este hash es lo que lo deja pasar.
  check("el hash se conserva aunque hoy no sea necesario (red si se apaga Cloudflare Fonts)", /sha256-[A-Za-z0-9+/=]+/.test(scriptSrc), /sha256-[A-Za-z0-9+/=]+/.test(scriptSrc) ? 'hash conservado como red de seguridad' : 'SIN hash: apagar Cloudflare Fonts dejaria las fuentes sin aplicar en silencio');
  check("font-src permite /cf-fonts (mismo origen, covered por 'self')", /font-src[^;]*'self'/.test(d), /font-src[^;]*'self'/.test(d) ? "'self' cubre /cf-fonts (mismo origen)" : "font-src SIN 'self': las fuentes de Cloudflare no cargarian");
  check('style-src permite el <style> inline que inyecta Cloudflare Fonts', /style-src[^;]*'unsafe-inline'/.test(d), /style-src[^;]*'unsafe-inline'/.test(d) ? "unsafe-inline presente, el <style> se aplica" : "SIN unsafe-inline: el <style> de Cloudflare Fonts no se aplicaria");
}

// --- style-src: aqui unsafe-inline es INTENCIONAL ---
// El front tiene 91 atributos style= (React style={{...}}). Sin 'unsafe-inline'
// en style-src la app no aplica sus estilos. CSS inyectado no ejecuta codigo,
// que es la diferencia con el caso de script, asi que aqui se acepta.
check("style-src conserva 'unsafe-inline' a proposito (91 estilos inline del front)", /unsafe-inline/.test(styleSrc), styleSrc.slice(0, 110));
check("script-src NO copia el 'unsafe-inline' de style-src por error", !/script-src[^;]*unsafe-inline(?!-hashes)/.test(d), 'se colaria en script-src');

// --- Refuerzo ---
check("object-src 'none'", /object-src 'none'/.test(d), 'presente');
check("base-uri 'self'", /base-uri 'self'/.test(d), 'presente');
check("form-action 'self'", /form-action 'self'/.test(d), 'presente');
check('default-src self', /default-src 'self'/.test(d), d.split(';')[0]);

// --- frame-ancestors en el meta no hace nada ---
check('sin frame-ancestors (se ignora en <meta>, solo funciona como cabecera HTTP)', !/frame-ancestors/.test(d), 'frame-ancestors en el meta es inerte');

// --- Origenes ---
check('connect-src sin comodines de tunel', !/trycloudflare|ngrok-free/.test(connectSrc), 'comodin de tunel: cualquiera con ese subdominio puede llamar a la API desde el navegador');
check('connect-src sin wildcard de Pages', !/\*\.pages\.dev/.test(connectSrc), 'cualquier otro proyecto de Pages podria llamar a la API');
check('connect-src sin IPs de red local', !/localhost|127\.0\.0\.1|192\.168\./.test(connectSrc), 'IP local en la politica de produccion');
check('connect-src sigue incluyendo la API', connectSrc.includes('api.suprime.xyz'), 'sin la API, el front no llama al backend');
check('script-src permite el beacon de Cloudflare', scriptSrc.includes('static.cloudflareinsights.com'), 'sin el, se rompe la analitica de Cloudflare');
check('font-src permite fonts.gstatic.com', /font-src[^;]*fonts\.gstatic\.com/.test(d), 'gstatic permitido (sin el, las fuentes no cargan)');

// --- Comprobacion funcional, no solo de texto ---
// Las directivas pueden estar escritas y aun asi no aplicarse. Esto prueba que
// los <script> del documento tienen src (siAppearance inline, la CSP los
// bloquearia al no estar permitido) y que no hay scripts inline que dependan de
// 'unsafe-inline' para ejecutarse.
const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
const conSrc = scripts.filter((a) => /\ssrc=/.test(a));
const sinSrc = scripts.filter((a) => !/\ssrc=/.test(a));
check(`todos los <script> del documento son externos (${scripts.length} en total)`, sinSrc.length === 0,
  sinSrc.length ? `${sinSrc.length} inline: ${sinSrc.map((a) => a.trim().slice(0, 70)).join(' | ')}` : `${conSrc.length} con src`);
check('hay al menos un script de la app', conSrc.some((a) => /\/assets\/index-/.test(a)), 'bundle /assets/index-*.js presente');

// Los manejadores inline que hay en el documento tienen que estar cubiertos por
// el hash. Si aparece uno nuevo sin hash, quedaria bloqueado en silencio.
const manejadores = [...html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
const { createHash } = await import('node:crypto');
const hashes = new Set([...d.matchAll(/sha256-([A-Za-z0-9+/=]+)/g)].map((m) => m[1]));
const sinCubrir = manejadores.filter((h) => {
  const b64 = createHash('sha256').update(h, 'utf8').digest('base64');
  return !hashes.has(b64);
});
check(`los ${manejadores.length} manejadores inline del documento estan cubiertos por un hash`, sinCubrir.length === 0,
  sinCubrir.length ? `sin hash y quedarian BLOQUEADOS en silencio: ${sinCubrir.map((h) => JSON.stringify(h).slice(0, 60)).join(' | ')}` : 'todos con hash');

console.log(`\n${fail === 0 ? 'TODO CORRECTO' : fail + ' COMPROBACIONES FALLAN'}: ${pass} OK, ${fail} falla(s)`);
process.exit(fail ? 1 : 0);
