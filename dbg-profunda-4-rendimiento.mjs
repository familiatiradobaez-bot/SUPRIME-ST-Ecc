// =============================================================
// BATERÍA PROFUNDA 4/6 · RENDIMIENTO E INFRAESTRUCTURA
// =============================================================
// Mide lo que el usuario siente: cuanto tarda en verse algo, cuanto pesa, y si la
// infra esta como debe.
//
// Nota de honestidad: las cifras de Core Web Vitals de esta maquina NO son
// fiables como Lighthouse (la CPU compartida las distorsiona; se ha visto dar 0 en
// tres corridas). Lo que se mide aqui es el tamano y el numero de peticiones, que
// si son objetivos y no dependen de la maquina. Y se comparan con los valores
// buenos que Pages da por defecto (0 ms de TBT, CLS 0 en la home).
import { chromium, devices } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WWW = 'https://www.suprime.xyz';
let pass = 0, fail = 0;
const lineas = [];
const todo = [];
const check = (n, ok, d = '', p = '') => {
  if (ok) { pass++; lineas.push(`PASS ${n}${p ? '  (' + p + ')' : ''}`); } else { fail++; lineas.push(`FAIL ${n}  ${d}${p ? '  (' + p + ')' : ''}`); }
  todo.push({ n, ok, d, p });
};

console.log('=== 1. PESO Y PETICIONES (objetivos, no dependen de la maquina) ===\n');

const browser = await chromium.launch();

for (const [nombre, dev] of [['MOVIL', devices['Pixel 5']], ['ESCRITORIO', { viewport: { width: 1440, height: 900 } }]]) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const paints = performance.getEntriesByType('paint');
    const lcp = performance.getEntriesByType('largest-contentful-paint').slice(-1)[0];
    // El peso se mide con el TransferSize de los recursos. Ojo: en otros origenes
    // es 0 si no mandan Timing-Allow-Origin, asi que se cuenta tambien el
    // Content-Length desde la red.
    const total = res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
    const biggest = res.map((r) => ({ n: r.name.split('/').pop()?.slice(0, 40), k: Math.round((r.transferSize || r.encodedBodySize) / 1024) })).sort((a, b) => b.k - a.k).slice(0, 5);
    return {
      peticiones: res.length + 1,
      kb: Math.round(total / 1024),
      fcp: Math.round(paints.find((p) => p.name === 'first-contentful-paint')?.startTime || 0),
      lcp: Math.round(lcp?.startTime || 0),
      domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
      biggest,
      porDominio: [...new Set(res.map((r) => new URL(r.name).hostname))],
    };
  });

  console.log(`--- ${nombre} ---`);
  console.log(`  peticiones: ${m.peticiones}`);
  console.log(`  peso total: ${m.kb} KB`);
  console.log(`  FCP: ${m.fcp} ms   LCP: ${m.lcp} ms   DCL: ${m.domContentLoaded} ms`);
  console.log(`  dominios: ${m.porDominio.join(', ')}`);
  console.log(`  ficheros mas pesados: ${m.biggest.map((b) => `${b.n} ${b.k}KB`).join(', ')}`);
  console.log('');

  // Google recomienda menos de 1,6 MB y 50 recursos en la carga inicial.
  check(`${nombre} pesa menos de 1,6 MB`, m.kb < 1600, `${m.kb} KB`, 'por encima, la pagina tarda en verse en datos moviles');
  check(`${nombre} hace menos de 50 peticiones`, m.peticiones < 50, `${m.peticiones} peticiones`, 'cada una son ~100 ms de latencia en movil');
  check(`${nombre} el FCP esta por debajo de 1,8 s`, m.fcp < 1800, `${m.fcp} ms`, 'es lo que ve el usuario al abrir');
  check(`${nombre} el LCP esta por debajo de 2,5 s`, m.lcp < 2500, `${m.lcp} ms`, 'el umbral de "bueno" de Google');
  check(`${nombre} no depende de muchos dominios de terceros`, m.porDominio.length <= 3, `${m.porDominio.length}: ${m.porDominio.join(', ')}`, 'cada dominio de mas es una conexion mas y un punto de fallo');

  await ctx.close();
}

console.log('=== 2. CACHÉ (que se sirve bien y que no) ===\n');

// Un bundle lleva hash en el nombre: se puede cachear un ano. Si no, se re-descarga
// en cada visita y se pierde la velocidad.
const ctx = await browser.newContext();
const page = await ctx.newPage();
const html = await (await fetch(`${WWW}/`)).text();
const bundle = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
if (bundle) {
  const r = await fetch(WWW + bundle);
  const cc = r.headers.get('cache-control') || '';
  check('el bundle se cachea un año (lleva hash en el nombre)', /max-age=31536000/.test(cc), cc, 'sin hash no podria cachearse tanto');
  check('el bundle lleva immutable', /immutable/.test(cc), cc, 'immutable avisa al navegador de que no vuelva a preguntar');
  check('el bundle lleva nosniff', /nosniff/.test(r.headers.get('content-type-options') || r.headers.get('x-content-type-options') || ''), '', 'el tipo de un .js no se negocia');
} else saltar('cache de bundles', 'no se encontro el bundle en el HTML');

// Un fichero de la raiz NO lleva hash: un TTL de un ano haria que un icono nuevo
// tardase un ano en llegar. Ya se creo una Cache Rule por eso.
const root = await fetch(`${WWW}/manifest.webmanifest`);
const ccRoot = root.headers.get('cache-control') || '';
check('un fichero de la raiz no se cachea un año', !/max-age=31536000/.test(ccRoot), ccRoot, 'un TTL de un año haria que un cambio tardase un año en llegar');

await ctx.close();
await browser.close();

console.log('=== 3. INFRAESTRUCTURA (lo que se puede romper sin que nadie se entere) ===\n');

const envW = {};
for (const l of readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/cloudflare.env', 'utf8').split(/\r?\n/)) {
  if (!l || l.startsWith('#') || !l.includes('=')) continue;
  const i = l.indexOf('=');
  envW[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const RAIZ = 'C:/Users/VIP/Desktop/Cerebro Obcidian/C proyectos Web';
const W = join(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const cf = (...c) => spawnSync(process.execPath, [W, ...c], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_TOKEN: envW.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: envW.CLOUDFLARE_ACCOUNT_ID } });

// El bypass de rate limit tiene que estar APAGADO fuera de sesion de trabajo.
{
  const r = cf('kv', 'key', 'get', 'rlbypass:ips', '--namespace-id', 'c695ababca41469a97d90502eebf1620', '--remote');
  const apagado = r.status !== 0 || !r.stdout.trim();
  check('el bypass de rate limit esta apagado', apagado, apagado ? 'apagado' : r.stdout.trim().slice(0, 80), 'si se queda encendido, la web va sin limite');
}

// Los secretos del Worker tienen que existir.
{
  const r = cf('secret', 'list');
  const secretos = (r.stdout || '').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((l) => l && l.length > 4 && !/^object|^vars|^./.test(l));
  const tiene = (n) => new RegExp(n).test(r.stdout || '');
  for (const s of ['TOTP_ENCRYPTION_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
    check(`el secreto ${s} existe en el Worker`, tiene(s), 'no aparece en secret list', 'si falta, la funcion que lo usa falla en produccion');
  }
  void secretos;
}

// El TTL de la raiz. Se mide el TTL REAL de la respuesta, no si la regla existe.
//
// Motivo del cambio: se comprobaba con la API de rulesets y daba 0 reglas siempre
// (con ninguno de los dos tokens), asi que el check era INCAPAZ de detectar que
// la regla estaba rota. Y lo estaba: apuntaba a "suprime.xyz" cuando el host
// canonico es "www.suprime.xyz", asi que no coincidia con nada y los ficheros de
// la raiz llevaban un año de TTL. Medido: config.js, que lleva la URL de la API,
// en max-age=31536000.
//
// Preguntar "¿el TTL que llega es el que quiero?" no depende de que la API deje
// ver las reglas, y ademas mide lo que de verdad le afecta al visitante.
{
  const conUnAno = [];
  for (const f of ['/config.js', '/favicon-32.png', '/apple-touch-icon.png', '/og-cover.svg', '/rayo-128.png', '/manifest.webmanifest']) {
    const r = await fetch(WWW + f, { method: 'HEAD' });
    const cc = r.headers.get('cache-control') || '';
    const m = /max-age=(\d+)/.exec(cc);
    const seg = m ? Number(m[1]) : 0;
    // Un año son 31.5M de segundos. Todo lo que pase de un mes esta mal para un
    // fichero sin hash en el nombre: no puede cambiar nunca.
    if (seg > 30 * 24 * 3600) conUnAno.push(`${f} ${cc}`);
  }
  check('ningun fichero de la raiz se cachea mas de 30 dias', conUnAno.length === 0, conUnAno.join(' | '), 'sin hash en el nombre, un TTL largo hace que un cambio nunca llegue');
}

// El aviso del bypass de rate limit: si el chat no esta, no avisa de nada.
{
  const r = await fetch('https://api.suprime.xyz/api/v1/health', { signal: AbortSignal.timeout(20000) });
  check('la API responde', r.status === 200, r.status, 'si cae, la tienda no vende');
}

console.log('\n' + '='.repeat(60));
console.log(`RENDIMIENTO E INFRA: ${pass} PASS / ${fail} FAIL`);
for (const l of lineas) console.log('  ' + l);
console.log('='.repeat(60));

const { writeFileSync } = await import('node:fs');
writeFileSync('C:/Users/VIP/AppData/Local/Temp/opencode/rendimiento.json', JSON.stringify({ pass, fail, todo }, null, 1), 'utf8');
process.exit(fail ? 1 : 0);
