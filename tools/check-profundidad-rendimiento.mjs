// =============================================================
// BATERÍA PROFUNDA · RENDIMIENTO E INFRAESTRUCTURA
// =============================================================
// Mide lo que el usuario siente y lo que se puede romper sin que nadie se entere.
//
// HONESTIDAD SOBRE LAS CIFRAS: las de Core Web Vitals desde esta maquina NO son
// fiables como Lighthouse. Con la CPU compartida se ha visto dar 0 y 32 en tres
// corridas seguidas de la misma pagina. Lo que se mide aqui es OBJETIVO y no
// depende de la maquina: numero de peticiones, peso, y dominios. El FCP se
// mide y se informa, pero knowing que el throttle de Playwright en una maquina
// compartida lo distorsiona; para la cifra buena hay que medir desde el movil del
// owner.
import { chromium, devices } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WWW = process.env.WWW || 'https://www.suprime.xyz';
const RAIZ = join(import.meta.dirname, '..');
let pass = 0, fail = 0;
const lineas = [];
const todo = [];
const check = (n, ok, d = '', p = '') => {
  if (ok) { pass++; lineas.push(`PASS ${n}${p ? '  (' + p + ')' : ''}`); } else { fail++; lineas.push(`FAIL ${n}  ${d}${p ? '  (' + p + ')' : ''}`); }
  todo.push({ n, ok, d, p });
};

console.log('=== 1. PESO Y PETICIONES (objetivos) ===\n');

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
    const total = res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0);
    return {
      peticiones: res.length + 1,
      kb: Math.round(total / 1024),
      fcp: Math.round(paints.find((p) => p.name === 'first-contentful-paint')?.startTime || 0),
      dcl: Math.round(nav?.domContentLoadedEventEnd || 0),
      dominios: [...new Set(res.map((r) => new URL(r.name).hostname))],
      mayores: res.map((r) => ({ n: r.name.split('/').pop()?.slice(0, 34), k: Math.round((r.transferSize || r.encodedBodySize) / 1024) })).sort((a, b) => b.k - a.k).slice(0, 4),
    };
  });

  console.log(`--- ${nombre} ---`);
  console.log(`  peticiones: ${m.peticiones}   peso: ${m.kb} KB   FCP: ${m.fcp} ms   DCL: ${m.dcl} ms`);
  console.log(`  dominios: ${m.dominios.join(', ')}`);
  console.log(`  mayores: ${m.mayores.map((b) => `${b.n} ${b.k}KB`).join(', ')}\n`);

  check(`${nombre} pesa menos de 1,6 MB`, m.kb < 1600, `${m.kb} KB`, 'por encima, tarda en verse con datos moviles');
  check(`${nombre} hace menos de 50 peticiones`, m.peticiones < 50, `${m.peticiones}`, 'cada una son ~100 ms de latencia en movil');
  // 1,8 s con el throttle 4x de Playwright. Se informa, no se falla: el numero
  // depende de la maquina. Con CPU compartida este valor fluctua mucho.
  check(`${nombre} FCP por debajo de 2,5 s`, m.fcp < 2500, `${m.fcp} ms (medido con throttle 4x, no es el numero final)`, 'por encima, se nota la espera');

  await ctx.close();
}
await browser.close();

console.log('=== 2. CACHE ===\n');
{
  const html = await (await fetch(`${WWW}/`)).text();
  const bundle = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
  if (bundle) {
    const r = await fetch(WWW + bundle);
    const cc = r.headers.get('cache-control') || '';
    check('el bundle se cachea un año (lleva hash)', /max-age=31536000/.test(cc), cc, 'sin hash no podria cachearse tanto');
    check('el bundle lleva immutable', /immutable/.test(cc), cc, 'avisa al navegador de que no vuelva a preguntar');
  } else {
    check('el bundle se cachea un año', false, 'no se encontro /assets/index-*.js en el HTML', 'no se puede comprobar el cacheo');
  }
}

console.log('\n=== 3. TTL DE LA RAIZ ===\n');
// Se mide el TTL REAL, no si la Cache Rule existe. Preguntar por la regla con la
// API de rulesets no servia: con ninguno de los dos tokens devuelve 0 reglas, y
// ese check era incapaz de detectar que la regla estaba rota (apuntaba a
// suprime.xyz cuando el host canonico es www, asi que no coincidia con nada).
{
  const conUnAno = [];
  for (const f of ['/config.js', '/favicon-32.png', '/apple-touch-icon.png', '/og-cover.svg', '/rayo-128.png', '/manifest.webmanifest']) {
    const r = await fetch(WWW + f, { method: 'HEAD' });
    const cc = r.headers.get('cache-control') || '';
    const m = /max-age=(\d+)/.exec(cc);
    if (m && Number(m[1]) > 30 * 24 * 3600) conUnAno.push(`${f} ${cc}`);
  }
  check('ningun fichero de la raiz se cachea mas de 30 dias', conUnAno.length === 0, conUnAno.join(' | '), 'sin hash en el nombre, un TTL largo hace que un cambio nunca llegue');
}

console.log('\n=== 4. INFRAESTRUCTURA ===\n');
{
  const envT = readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/cloudflare.env', 'utf8');
  const ce = {};
  for (const l of envT.split(/\r?\n/)) {
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    ce[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  const W = join(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const cf = (...c) => spawnSync(process.execPath, [W, ...c], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_TOKEN: ce.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: ce.CLOUDFLARE_ACCOUNT_ID } });

  const bypass = cf('kv', 'key', 'get', 'rlbypass:ips', '--namespace-id', 'c695ababca41469a97d90502eebf1620', '--remote');
  const apagado = bypass.status !== 0 || !bypass.stdout.trim();
  check('el bypass de rate limit esta apagado', apagado, apagado ? 'apagado' : (bypass.stdout || '').trim().slice(0, 70), 'si se queda encendido, la web va sin limite');

  const secretos = cf('secret', 'list');
  for (const s of ['TOTP_ENCRYPTION_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
    check(`el secreto ${s} existe en el Worker`, new RegExp(s).test(secretos.stdout || ''), 'no aparece en secret list', 'si falta, la funcion que lo usa falla en produccion');
  }
}

console.log('\n' + '='.repeat(60));
console.log(`RENDIMIENTO E INFRA: ${pass} PASS / ${fail} FAIL`);
for (const l of lineas) console.log('  ' + l);
console.log('='.repeat(60));

writeFileSync(process.env.SALIDA || 'C:/Users/VIP/AppData/Local/Temp/opencode/rendimiento.json', JSON.stringify({ pass, fail, todo }, null, 1), 'utf8');
process.exit(fail ? 1 : 0);
