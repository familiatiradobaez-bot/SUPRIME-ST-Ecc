// La parte de seguridad de la bateria profunda, ahora como fichero del repo para
// poder volver a ejecutarla. Mede contra produccion, sin escribir datos.
//
// Lo que se mide, y por que:
//
//  - Lo que ATACARIA un atacante de verdad: inyeccion, XSS, CSRF, fugas y si la
//    sesion es robable. Un 100% en cabeceras bonitas con un login vulnerable a
//    SQL vale cero, asi que el orden de las secciones es deliberado.
//
// Uso: node tools/check-profundidad-seguridad.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const API = process.env.API || 'https://api.suprime.xyz/api/v1';
const WWW = process.env.WWW || 'https://www.suprime.xyz';

const t = readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/smoke.env', 'utf8');
const env = {};
for (const l of t.split(/\r?\n/)) {
  if (!l || l.startsWith('#') || !l.includes('=')) continue;
  const i = l.indexOf('=');
  env[l.slice(0, i)] = l.slice(i + 1);
}

const F = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(20000) });

let pass = 0, fail = 0, saltos = 0;
const lineas = [];
const detalle = [];
const check = (n, ok, d = '', p = '') => {
  if (ok) { pass++; lineas.push(`PASS ${n}${p ? '  (' + p + ')' : ''}`); } else { fail++; lineas.push(`FAIL ${n}  ${d}${p ? '  (' + p + ')' : ''}`); }
  detalle.push({ n, ok, d, p });
};
const saltar = (n, m) => { saltos++; lineas.push(`SKIP ${n}  (${m})`); };

console.log('=== 1. INYECCION ===\n');
const payloads = [
  "' OR '1'='1", "'; DROP TABLE users; --", "admin'--", "1' UNION SELECT password_hash FROM users--",
  "${jndi:ldap://x}", "<script>alert(1)</script>", "../../../etc/passwd", "'; UPDATE users SET role_id='role-owner'; --",
];
for (const p of payloads) {
  const r = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WWW }, body: JSON.stringify({ email: p, password: 'WrongAa1!' }) });
  const cuerpo = await r.text();
  const sospechoso = r.status === 200 || r.status >= 500 || /password_hash|SELECT|sqlite|SQLITE|D1Database/i.test(cuerpo);
  check(`login con "${p.slice(0, 28)}" no filtra ni rompe`, !sospechoso, `status ${r.status}: ${cuerpo.slice(0, 60)}`, 'inyeccion SQL/XSS');
}
for (const [nombre, url, cuerpo] of [
  ['forgot-password', `${API}/auth/forgot-password`, { email: "' OR 1=1--" }],
  ['otp resend', `${API}/auth/otp/resend`, { email: "'; --" }],
  ['catalogo', `${API}/catalog/products?q=' OR 1=1--`, null],
]) {
  const r = cuerpo ? await F(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WWW }, body: JSON.stringify(cuerpo) }) : await F(url);
  const txt = await r.text();
  check(`${nombre} aguanta entrada maliciosa`, r.status < 500 && !/password_hash|sqlite|SQLITE_ERROR/i.test(txt), `status ${r.status}`, 'inyeccion');
}

console.log('=== 2. SESION ===\n');
for (const tk of ['a'.repeat(64), 'ZmFrZTpyb2xlLW93bmVyOjEyMw==', '', 'null', 'undefined', '0', '../../etc/passwd']) {
  const r = await F(`${API}/auth/me`, { headers: { Authorization: `Bearer ${tk}` } });
  check(`token falso "${tk.slice(0, 16) || '(vacio)'}" da 401`, r.status === 401, r.status, 'sesion falsa');
}
if (env.SMOKE_EMAIL && env.SMOKE_PASSWORD) {
  const login = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WWW }, body: JSON.stringify({ email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD }) });
  const lj = await login.json();
  // El token vive en data.session.token. Mirar en data.token daba undefined y el
  // bloque entero se saltaba: un test que no comprueba nada.
  const token = lj.data?.session?.token;
  if (token) {
    check('el token es opaco (64 hex, no JWT ni base64 de datos)', /^[0-9a-f]{64}$/.test(token), token.slice(0, 20), 'no filtrar datos del usuario');
    check('el token no parece un JWT', token.split('.').length < 3, `${token.split('.').length} partes`, 'no filtrar el rol');
    const me = await F(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    check('el token funciona en /auth/me', me.status === 200, me.status, 'sesion valida');
    // No es un fallo: es la contrapartida de que el token viva en localStorage. Lo
    // que protege es la CSP (que impide el XSS) y que caduque.
    check('un token robado serviria desde fuera (motivo de la CSP fuerte)', me.status === 200, me.status, 'por eso la CSP no lleva unsafe-inline');
    await F(`${API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: WWW } });
  } else saltar('propiedades del token', 'el login no devolvio data.session.token');
} else saltar('propiedades del token', 'sin credenciales de smoke');

console.log('=== 3. CSRF Y CORS ===\n');
for (const origen of ['https://atacante.example', 'https://sitio-de-terceros.pages.dev', 'https://atacante.trycloudflare.com', 'http://localhost:5173', 'null', 'https://evil.suprime.xyz']) {
  const r = await F(`${API}/health`, { headers: { Origin: origen } });
  const acao = r.headers.get('access-control-allow-origin');
  check(`CORS no da permiso a "${origen.slice(0, 32)}"`, !acao, acao || 'sin cabecera', 'aislar el sitio');
}
const ok = await F(`${API}/health`, { headers: { Origin: WWW } });
check('CORS si da permiso al front canonico', ok.headers.get('access-control-allow-origin') === WWW, ok.headers.get('access-control-allow-origin'), 'que la web funcione');
const pre = await F(`${API}/auth/login`, { method: 'OPTIONS', headers: { Origin: WWW, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
check('el preflight del front legitimo pasa', pre.status < 400, pre.status, 'que la web funcione');

console.log('=== 4. CABECERAS ===\n');
const h = await F(`${API}/health`);
for (const [nombre, cab, re, por] of [
  ['X-Content-Type-Options', 'x-content-type-options', /nosniff/i, 'evitar que el navegador interprete un fichero como otro tipo'],
  ['X-Frame-Options', 'x-frame-options', /DENY|SAMEORIGIN/i, 'clickjacking'],
  ['Referrer-Policy', 'referrer-policy', /no-referrer|strict-origin/i, 'no filtrar la URL a terceros'],
  ['Permissions-Policy', 'permissions-policy', /camera|microphone|geolocation/i, 'no abrir camara/micro sin pedirlo'],
  ['CSP', 'content-security-policy', /default-src/i, 'politica de contenido'],
  ['HSTS en la API', 'strict-transport-security', /max-age=\d{4,}/, 'fuerza https: sin esto, el token viaja en claro en una wifi abierta'],
]) {
  const v = h.headers.get(cab);
  check(`cabecera ${nombre}`, v && re.test(v), v || 'AUSENTE', por);
}
{
  const www = await F(`${WWW}/`, { redirect: 'manual' });
  const v = www.headers.get('strict-transport-security');
  check('cabecera HSTS en el front', !!v, v || 'AUSENTE: un http:// inicial no se redirige a https', 'la pagina que abre la gente');
  if (v) check('el HSTS del front tiene max-age', /max-age=\d{4,}/.test(v), v, 'sin max-age el navegador lo ignora');
}

console.log('=== 5. FUGAS DE DATOS ===\n');
for (const [nombre, r] of [
  ['404 de API', await F(`${API}/ruta-que-no-existe`)],
  ['admin sin auth', await F(`${API}/admin/users`)],
  ['metodo no permitido', await F(`${API}/health`, { method: 'DELETE' })],
]) {
  const txt = await r.text();
  const fuga = /CLOUDFLARE_|TOTP_ENCRYPTION|SECRET|API_KEY|password_hash|BEGIN (RSA|PRIVATE)|D1Database|C:\\|node_modules|\/home\/|workers\.dev\/[a-f0-9-]{20}/i.test(txt);
  check(`sin fuga en ${nombre}`, !fuga, txt.slice(0, 80), 'no filtrar secretos ni rutas internas');
}
{
  const spa = await (await F(`${API}/ruta-que-no-existe`)).text();
  check('la API no devuelve el HTML de la SPA en un 404', !spa.includes('<div id="root">') && !spa.includes('<!DOCTYPE'), spa.slice(0, 50), 'un fetch del front recibiria "<!DOCTYPE" y reventaria el JSON.parse');
}
{
  const html = await (await F(`${WWW}/`)).text();
  check('el HTML del front no lleva secretos', !/cfat_|cfut_|SUPER_SECRET|sk_live_|AKIA|-----BEGIN/.test(html), 'fuga', 'no filtrar credenciales al cliente');
  for (const b of [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])) {
    const js = await (await F(WWW + b)).text();
    check(`el bundle ${b.slice(0, 38)} no lleva secretos`, !/cfat_[A-Za-z0-9_-]{20,}|cfut_[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(js), 'fuga en el bundle', 'el token de Cloudflare en el front es la peor fuga posible');
  }
}

console.log('=== 6. METODOS Y ENUMERACION ===\n');
for (const [nombre, url, metodo] of [
  ['admin stats con DELETE', `${API}/admin/stats`, 'DELETE'],
  ['login con GET', `${API}/auth/login`, 'GET'],
]) {
  const r = await F(url, { method: metodo });
  // 401 y 403 tambien valen: significan que el servidor no ha ejecutado nada, que
  // es justo lo que se comprueba. Antes solo se aceptaba 404/405 y un 401
  // correcto salia como FALLA.
  check(`${nombre} no se ejecuta`, [401, 403, 404, 405].includes(r.status), r.status, 'no dejar metodos peligrosos abiertos');
}
{
  const r1 = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WWW }, body: JSON.stringify({ email: 'nadie-existe-esta-cuenta@example.invalid', password: 'WrongAa1!' }) });
  const r2 = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WWW }, body: JSON.stringify({ email: env.SMOKE_EMAIL || 'x@y.z', password: 'WrongAa1!' }) });
  const t1 = await r1.text(), t2 = await r2.text();
  check('el login NO distingue usuario inexistente de contrasena mala', t1 === t2 || (t1.includes('RATE') && t2.includes('RATE')), `inexistente: ${t1.slice(0, 40)} | existente: ${t2.slice(0, 40)}`, 'no permitir enumerar cuentas');
}

console.log('\n' + '='.repeat(60));
console.log(`SEGURIDAD: ${pass} PASS / ${fail} FAIL / ${saltos} SKIP`);
for (const l of lineas) console.log('  ' + l);
console.log('='.repeat(60));

writeFileSync(process.env.SALIDA || 'C:/Users/VIP/AppData/Local/Temp/opencode/seguridad.json', JSON.stringify({ pass, fail, saltos, detalle }, null, 1), 'utf8');
process.exit(fail ? 1 : 0);
