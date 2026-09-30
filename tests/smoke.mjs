// Smoke tests de producción - https://api.suprime.xyz + https://suprime.xyz
// Uso: npm run smoke  (requiere Node 18+)
//
// 2FA: la cuenta que se usa NO es la del owner (su TOTP nunca se automatiza).
// Es `smoke@suprime.xyz`, rol `role-stock-manager`, con el secreto guardado en
// `_SECRETS/smoke.env` (fuera del repo) o en el entorno. Se crea/rota con:
//   npm run smoke:setup
// Ver la spec "Smoke con TOTP" (SUPRIME-Continuar.md, 2026-09-30).
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.SMOKE_API || 'https://api.suprime.xyz/api/v1';
const WEB = process.env.SMOKE_WEB || 'https://suprime.xyz';
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`PASS ${name}`); }
  else { fail++; results.push(`FAIL ${name} ${detail}`); }
}
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
// Timeout para no colgar la suite si la API no responde
const F = (url, opts = {}) => globalThis.fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
let skipped = 0;
function checkOrSkip(ok, name, cond, detail = '') {
  if (!ok) { skip(name + ' (requiere sesión de smoke)'); return; }
  check(name, cond, detail);
}
function skip(name) { skipped++; results.push(`SKIP ${name}`); }
// Con grant de step-up vivo, un 403 de admin ya NO es una respuesta aceptable:
// sería una regresión. Antes toleraba 403 o 200; ahora solo vale 200.
let grantLive = false;
// Rutas admin: PASS si hay grant (200 válido) o, sin grant, si exigen step-up (403 correcto)
async function checkAdmin(name, r, validate200) {
  if (r.status === 200) {
    const d = await j(r);
    try { check(`${name} (grant vigente)`, validate200(d)); }
    catch (e) { check(`${name} (grant vigente)`, false, String(e).slice(0, 80)); }
    return;
  }
  const e = await j(r);
  if (grantLive) { check(name, false, `403 con grant vigente: ${r.status} ${e.error}`); return; }
  check(`${name} (exige step-up)`, r.status === 403 && (e.error === 'ADMIN_2FA_REQUIRED' || e.error === 'ADMIN_2FA_SETUP_REQUIRED'), `${r.status} ${e.error}`);
}

// ─── Credenciales de la cuenta de smoke ─────────────────────────────────────
// Se leen del entorno y, si faltan, de `../_SECRETS/smoke.env` (fuera del repo).
// Nunca se hardcodean aquí: el smoke anterior llevaba la contraseña del owner
// escrita en el archivo.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(REPO, '..', '_SECRETS', 'smoke.env');
try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
} catch { /* no hay fichero: se usará solo el entorno */ }

const SMOKE_EMAIL = process.env.SMOKE_EMAIL;
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD;
const SMOKE_TOTP_SECRET = process.env.SMOKE_TOTP_SECRET;
const SMOKE_ROLE = process.env.SMOKE_ROLE || 'role-stock-manager';
const missing = [
  !SMOKE_EMAIL && 'SMOKE_EMAIL',
  !SMOKE_PASSWORD && 'SMOKE_PASSWORD',
  !SMOKE_TOTP_SECRET && 'SMOKE_TOTP_SECRET',
].filter(Boolean);
if (missing.length) {
  // Avisar y salir limpio: seguir con la clave a `undefined` convertiría la
  // mitad de la suite en FAIL/SKIP sin explicar por qué.
  console.error(`
Faltan las variables del smoke de 2FA: ${missing.join(', ')}

El smoke ya no usa la cuenta del owner (su TOTP no se automatiza). Necesita la
cuenta propia smoke@suprime.xyz, que se crea o rota con:

    npm run smoke:setup

Eso escribe las credenciales en ${ENV_FILE} (fuera del repo) y este script las
coge de ahí. Si prefieres el entorno:

    $env:SMOKE_EMAIL='smoke@suprime.xyz'
    $env:SMOKE_PASSWORD='...'
    $env:SMOKE_TOTP_SECRET='...'   # base32, sin guiones bajos
`);
  process.exit(2);
}

// ─── TOTP (RFC 6238) ────────────────────────────────────────────────────────
// ~40 líneas con node:crypto: mismo algoritmo que apps/api/src/lib/totp.ts (HMAC-SHA1
// propio, 6 dígitos, paso de 30 s). Ventana de ±1 paso por si el reloj de la
// máquina va atrasado; el endpoint además tiene anti-replay (last_counter), así
// que se prueban en orden y el primero que valida gana.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(input) {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`base32 inválido: "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function totp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(bin % 1e6).padStart(6, '0');
}
// Paso actual primero: es el que el anti-replay del servidor espera.
function totpWindow(secret) {
  const step = Math.floor(Date.now() / 1000 / 30);
  return [step, step + 1, step - 1].map((c) => totp(secret, c));
}

console.log('== Salud y catálogo ==');
let r = await F(`${API}/health`);
check('health 200', r.status === 200, r.status);
r = await F(`${API}/catalog/products`);
let products = [];
if (r.status === 200) { const d = await j(r); products = d.data || []; }
check('catalog products 200 + array', r.status === 200 && Array.isArray(products), r.status);
r = await F(`${API}/catalog/categories`);
check('catalog categories 200', r.status === 200, r.status);
if (products.length) {
  const p = products[0];
  r = await F(`${API}/catalog/products/${p.slug}`);
  check('product detail por slug 200', r.status === 200, r.status);
  check('product tiene precio/stock', p.price_cents >= 0 && p.stock_quantity >= 0, JSON.stringify(p).slice(0, 120));
} else { check('hay productos en catálogo', false, 'vacío'); }

console.log('== Auth ==');
r = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SMOKE_EMAIL, password: 'wrong' }) });
check('login mala clave 401', r.status === 401, r.status);
r = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }) });
const lj = await j(r);
const token = lj.data?.session?.token;
const authed = !!token;
check('login smoke 200 + token', r.status === 200 && !!token, r.status);
const H = token ? { 'Authorization': `Bearer ${token}` } : {};
r = await F(`${API}/auth/me`, { headers: H });
const me = await j(r);
checkOrSkip(authed, `me 200 + role ${SMOKE_ROLE}`, r.status === 200 && me.data?.role_id === SMOKE_ROLE, `${r.status} ${me.data?.role_id}`);
r = await F(`${API}/auth/me`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: '' }) });
checkOrSkip(authed, 'me PUT nombre vacío 400', r.status === 400, r.status);
const shipOk = { full_name: 'Test Owner', phone: '+34612345678', address: 'Calle Test 1', city: 'Madrid', postal_code: '28001' };
r = await F(`${API}/auth/me/shipping`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(shipOk) });
checkOrSkip(authed, 'me shipping PUT 200', r.status === 200, r.status);
r = await F(`${API}/auth/me/shipping`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...shipOk, postal_code: 'XX' }) });
checkOrSkip(authed, 'me shipping CP malo 400', r.status === 400, r.status);
r = await F(`${API}/auth/me`, { headers: H });
if (!authed) { skip('me shipping guardado (requiere sesión)'); }
else { const m2 = await j(r); check('me trae city+CP guardados', m2.data?.shipping?.city === 'Madrid' && m2.data?.shipping?.postal_code === '28001', r.status); }
if (authed && me.data?.shipping?.full_name) {
  await F(`${API}/auth/me/shipping`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: me.data.shipping.full_name, phone: me.data.shipping.phone, address: me.data.shipping.address, city: me.data.shipping.city, postal_code: me.data.shipping.postal_code }) });
}
r = await F(`${API}/auth/me`, { headers: { 'Authorization': 'Bearer ZmFrZTpyb2xlLW93bmVyOjEyMw==' } });
check('me token falso 401', r.status === 401, r.status);

console.log('== Admin: el candado y su llave ==');
r = await F(`${API}/admin/stats`);
check('admin stats sin auth 401', r.status === 401, r.status);

// 0) Estado limpio: el grant de una corrida anterior puede seguir vivo (1 h).
//    Se revoca para que la comprobación del candado sea determinista.
if (authed) {
  r = await F(`${API}/auth/admin-stepup/revoke`, { method: 'POST', headers: H });
  check('revocar step-up previo 200', r.status === 200, r.status);
}

// 1) SIN grant: tiene que ser 403 ADMIN_2FA_REQUIRED. Esto no es un atajo que
//    falte, es justo el candado que hay que verificar. Antes el smoke aceptaba
//    este 403 como "bueno" y se quedaba sin ejecutar los checks de verdad.
r = await F(`${API}/admin/stats`, { headers: H });
if (!authed) {
  skip('admin stats sin grant (requiere sesión de smoke)');
  skip('step-up con TOTP (requiere sesión de smoke)');
} else {
  const e0 = await j(r);
  check('admin stats SIN grant 403 ADMIN_2FA_REQUIRED',
    r.status === 403 && (e0.error === 'ADMIN_2FA_REQUIRED' || e0.error === 'ADMIN_2FA_SETUP_REQUIRED'),
    `${r.status} ${e0.error}`);

  // 2) CON grant: TOTP de verdad contra POST /auth/admin-stepup (1 h de validez).
  let stepup = { status: 0, error: '' };
  const candidates = totpWindow(SMOKE_TOTP_SECRET);
  for (const code of candidates) {
    const res = await F(`${API}/auth/admin-stepup`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (res.status === 200) { stepup = { status: 200, error: '' }; break; }
    const e = await j(res);
    stepup = { status: res.status, error: e.error || '' };
  }
  check('admin-stepup con TOTP calculado 200 (grant 1h)', stepup.status === 200, `${stepup.status} ${stepup.error}`);
  grantLive = stepup.status === 200;

  // 3) El candado se abre: la misma ruta que antes daba 403 ahora da 200.
  r = await F(`${API}/admin/stats`, { headers: H });
  if (grantLive) {
    const d = await j(r);
    check('admin stats CON grant 200 (candado abierto de verdad)', r.status === 200 && typeof d.data?.products === 'number', `${r.status} ${JSON.stringify(d).slice(0, 80)}`);
  } else {
    skip('admin stats CON grant (el step-up no concedió)');
  }
}
r = await F(`${API}/admin/products`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
if (r.status === 400) { check('crear producto vacío 400 (grant vigente)', true); }
else if (!authed) { skip('crear producto (requiere sesión de smoke)'); }
else { const e = await j(r); check('crear producto (exige step-up)', r.status === 403 && !!e.error, `${r.status} ${e.error}`); }
r = await F(`${API}/admin/users`, { headers: H });
await checkAdmin('admin users 200', r, (d) => Array.isArray(d.data));

r = await F(`${API}/admin/users?limit=1&offset=0`, { headers: H });
const u1 = await j(r);
if (r.status === 200) { check('admin users paginado (limit=1 + total)', Array.isArray(u1.data) && u1.data.length <= 1 && typeof u1.pagination?.total === 'number', r.status); }
else if (grantLive) { check('admin users paginado (limit=1 + total)', false, `${r.status} ${u1.error}`); }
else { check('admin users (exige step-up)', r.status === 403, `${r.status} ${u1.error}`); }

console.log('== Upload/galería ==');
const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const UH = { ...H, 'Content-Type': 'application/json' };
r = await F(`${API}/upload/images`);
check('galería sin auth 401', r.status === 401, r.status);
r = await F(`${API}/upload/images`, { headers: H });
await checkAdmin('galería 200 + array', r, (d) => Array.isArray(d.data));
r = await F(`${API}/upload/images?limit=1&skip=0`, { headers: H });
await checkAdmin('galería paginada limit=1', r, (d) => Array.isArray(d.data) && d.data.length <= 1);
r = await F(`${API}/upload/imagekit`, { method: 'POST', headers: UH, body: JSON.stringify({ nope: 1 }) });
if (r.status === 400) { check('upload input inválido 400 (grant vigente)', true); }
else { const e = await j(r); check('upload (exige step-up)', r.status === 403, `${r.status} ${e.error}`); }
r = await F(`${API}/upload/imagekit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: tiny, filename: 'x.png' }) });
check('upload sin auth 401 (admin requerido)', r.status === 401, r.status);
r = await F(`${API}/upload/imagekit`, { method: 'POST', headers: UH, body: JSON.stringify({ dataUrl: tiny, filename: 'smoke.png' }) });
if (r.status === 200) {
  const up = await j(r);
  check('upload 1px 200 + url ik.imagekit (grant vigente)', (up.data?.url || '').includes('ik.imagekit.io'), r.status);
} else {
  const e = await j(r);
  check('upload (exige step-up)', r.status === 403, `${r.status} ${e.error}`);
}

console.log('== Órdenes/stock (sin mutar) ==');
const OH = { ...H, 'Content-Type': 'application/json' };
r = await F(`${API}/orders`, { method: 'POST', headers: OH, body: JSON.stringify({}) });
check('orders body vacío 400', r.status === 400, r.status);
r = await F(`${API}/admin/orders/00000000-0000-0000-0000-000000000000/status`, { method: 'PUT', headers: UH, body: JSON.stringify({ status: 'paid' }) });
if (r.status === 404) { check('order status inexistente 404 (grant vigente)', true); }
else { const e = await j(r); check('order status (exige step-up)', r.status === 403, `${r.status} ${e.error}`); }
r = await F(`${API}/admin/orders/00000000-0000-0000-0000-000000000000/status`, { method: 'PUT', headers: UH, body: JSON.stringify({ status: 'volar' }) });
if (r.status === 400) { check('order status inválido 400 (grant vigente)', true); }
else { const e = await j(r); check('order status inválido (exige step-up)', r.status === 403, `${r.status} ${e.error}`); }
r = await F(`${API}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ product_id: products[0]?.id || 'x', quantity: 1 }], shipping_name: 'T', shipping_email: 't@t.es', shipping_phone: '1', shipping_address: 'X', payment_method: 'paypal' }) });
check('orders sin auth 401 (login requerido)', r.status === 401, r.status);
if (products.length) {
  const p = products.find(x => x.stock_quantity >= 0);
  r = await F(`${API}/orders`, { method: 'POST', headers: OH, body: JSON.stringify({ items: [{ product_id: p.id, quantity: (p.stock_quantity || 0) + 50 }], shipping_name: 'T', shipping_email: 't@t.es', shipping_phone: '+34612345678', shipping_address: 'X', shipping_city: 'Madrid', shipping_postal_code: '28001', payment_method: 'paypal' }) });
  check('orders stock insuficiente 400 (rollback)', r.status === 400, r.status);
  r = await F(`${API}/orders`, { method: 'POST', headers: OH, body: JSON.stringify({ items: [{ product_id: p.id, quantity: 1 }], shipping_name: 'T', shipping_email: 't@t.es', shipping_phone: 'mal', shipping_address: 'X', shipping_city: 'Madrid', shipping_postal_code: '28001', payment_method: 'paypal' }) });
  check('orders teléfono malo 400', r.status === 400, r.status);
}

console.log('== PDP y secciones ==');
if (products.length && products[0].slug) {
  const s = products[0].slug;
  r = await F(`${API}/catalog/products/${s}/related?limit=4`);
  const rel = await j(r);
  check('related 200 + array', r.status === 200 && Array.isArray(rel.data), r.status);
  if (products[0].department_slug) {
    r = await F(`${API}/catalog/departments/${products[0].department_slug}/products`);
    const dp = await j(r);
    check('dept products 200 + array', r.status === 200 && Array.isArray(dp.data?.products), r.status);
  }
  if (products[0].subdepartment_slug) {
    r = await F(`${API}/catalog/subdepartments/${products[0].subdepartment_slug}/products`);
    const sp = await j(r);
    check('subdept products 200 + array', r.status === 200 && Array.isArray(sp.data?.products), r.status);
  }
  r = await F(`${API}/catalog/products/no-existe-xyz`);
  check('detail inexistente 404', r.status === 404, r.status);
}
r = await F(`${API}/catalog/store-settings`);
const st = await j(r);
check('store-settings 200 + portes + maintenance off', r.status === 200 && st.data?.shipping_cost != null && st.data?.maintenance_mode === '0', r.status);

console.log('== Google OAuth ==');

r = await F(`${API}/auth/google/login`, { redirect: 'manual' });
const loc = r.headers.get('location') || '';
check('google login redirige 302', r.status === 302, r.status);
check('redirect a accounts.google + callback api.suprime', loc.includes('accounts.google.com') && loc.includes(encodeURIComponent('https://api.suprime.xyz/api/v1/auth/google/callback')), loc.slice(0, 120));
const setCookie = r.headers.get('set-cookie') || '';
check('google login fija cookie oauth_state', setCookie.includes('oauth_state='), setCookie.slice(0, 80));
r = await F(`${API}/auth/google/callback`);
check('callback sin code 400', r.status === 400, r.status);
r = await F(`${API}/auth/google/callback?code=fake&state=fake`, { redirect: 'manual' });
const errLoc = r.headers.get('location') || '';
check('callback state inválido redirige con error', r.status === 302 && errLoc.includes('login=error'), `${r.status} ${errLoc.slice(0, 80)}`);
r = await F(`${API}/auth/google-2fa`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SMOKE_EMAIL, code: '000000' }) });
check('google-2fa sin pendiente/código malo 401/410', r.status === 401 || r.status === 410, r.status);
r = await F(`${API}/auth/google/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
check('google exchange sin code 400', r.status === 400, r.status);
r = await F(`${API}/auth/google/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '0'.repeat(64) }) });
check('google exchange code falso 410', r.status === 410, r.status);

console.log('== Password reset ==');
r = await F(`${API}/auth/admin-stepup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ code: '000000' }) });
checkOrSkip(authed, 'admin-stepup código malo 401', r.status === 401, r.status);
r = await F(`${API}/auth/me/totp/status`, { headers: H });
if (!authed) { skip('totp status (requiere sesión de smoke)'); }
else {
  const st = await j(r);
  const enabled = r.status === 200 && st.data?.enabled === true;
  check('2FA de la cuenta smoke sigue activado (el smoke no lo toca)', enabled, `${r.status} enabled=${st.data?.enabled}`);
  if (enabled) {
    // Regenerar el secreto sería destructivo (rompe el TOTP del smoke), así que
    // solo se comprueba que la ruta REGULA. Dos respuestas correctas:
    //  - SAFETY_LOCKED: hay grant pero el modo seguro bloquea la rotación.
    //  - ADMIN_2FA_REQUIRED: no hay grant de step-up vigente.
    r = await F(`${API}/auth/me/totp/setup`, { method: 'POST', headers: H });
    const e = await j(r);
    check('totp setup bloqueado 403 (no destructivo)',
      r.status === 403 && (e.error === 'ADMIN_2FA_REQUIRED' || e.error === 'SAFETY_LOCKED'),
      `${r.status} ${e.error}`);
  } else {
    skip('totp setup (sin 2FA no se toca para no regenerar el secreto)');
  }
}
r = await F(`${API}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nadie-xyz-123@example.com' }) });
check('forgot genérico 200 (anti-enumeración)', r.status === 200, r.status);
r = await F(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SMOKE_EMAIL, code: '000000', newPassword: 'Test1234!' }) });
check('reset código malo 401/404', r.status === 401 || r.status === 404, r.status);
r = await F(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SMOKE_EMAIL, code: '000000', newPassword: 'weak' }) });
check('reset clave débil 400', r.status === 400, r.status);

console.log('== Catálogo admin: departamentos/subdepartamentos (tarea #25) ==');
// Esta sección crea datos reales: se autogenera con sufijo y se limpia al final.
const stamp = Date.now().toString(36);
const JH = { ...H, 'Content-Type': 'application/json' };
let createdDeptId = null;
let createdSubId = null;
let createdProductId = null;

// Validaciones de entrada. Se mandan CON auth: el guard de admin responde 401
// antes de validar el body, así que sin sesión no se puede probar el 400.
async function checkAdminExpect(name, req, expected) {
  const res = await req();
  if (res.status === expected) { check(name, true); return true; }
  const e = await j(res);
  // Sin step-up vigente el guard responde 403 antes de llegar al handler.
  if (!grantLive && res.status === 403 && (e.error === 'ADMIN_2FA_REQUIRED' || e.error === 'ADMIN_2FA_SETUP_REQUIRED')) {
    skip(`${name} (exige step-up)`);
    return false;
  }
  check(name, false, `${res.status} ${e.error}`);
  return false;
}

// El modo seguro (safety_lock) bloquea los borrados ANTES de que el handler
// vea el recurso, así que un DELETE de un id inexistente responde 403
// SAFETY_LOCKED en vez de 404. Se detecta con un probe y se anota: con el
// candado de borrado cerrado, el flujo que crea datos reales no se puede
// limpiar después, y es preferible no ensuciar el catálogo de producción.
let deletesLocked = false;

if (!authed) {
  skip('validaciones catálogo admin (requiere sesión)');
} else {
  await checkAdminExpect('crear departamento vacío 400', () =>
    F(`${API}/admin/departments`, { method: 'POST', headers: JH, body: JSON.stringify({}) }), 400);
  await checkAdminExpect('departamento con name vacío 400', () =>
    F(`${API}/admin/departments`, { method: 'POST', headers: JH, body: JSON.stringify({ name: '' }) }), 400);
  await checkAdminExpect('subdepartamento con depto inexistente 404', () =>
    F(`${API}/admin/subdepartments`, { method: 'POST', headers: JH, body: JSON.stringify({ department_id: 'no-existe-xyz', name: 'X' }) }), 404);
  r = await F(`${API}/admin/departments/no-existe-xyz`, { method: 'DELETE', headers: H });
  if (r.status === 404) {
    check('borrar departamento inexistente 404', true);
  } else {
    const e = await j(r);
    deletesLocked = r.status === 403 && e.error === 'SAFETY_LOCKED';
    if (deletesLocked) {
      check('borrar departamento inexistente: 403 SAFETY_LOCKED (el modo seguro regula)', true);
    } else if (!grantLive && r.status === 403) {
      skip('borrar departamento inexistente 404 (exige step-up)');
    } else {
      check('borrar departamento inexistente 404', false, `${r.status} ${e.error}`);
    }
  }
}
r = await F(`${API}/admin/catalog`, { headers: H });
await checkAdmin('admin catalog 200 + estructura', r, (d) => Array.isArray(d.data) && d.data.every((x) => Array.isArray(x.subdepartments)));

// Checks de catálogo que no dependen del flujo de creación: se ejecutan siempre
// que haya sesión, incluso si el flujo de abajo se salta por el modo seguro.
if (authed) {
  r = await F(`${API}/admin/departments/no-existe-xyz`, { method: 'PUT', headers: JH, body: JSON.stringify({ name: 'X' }) });
  check('editar departamento inexistente 404', r.status === 404, r.status);
}
r = await F(`${API}/admin/catalog`);
check('admin catalog sin auth 401', r.status === 401, r.status);

// Flujo real: depto → subdepto → producto dentro de él → visible en catálogo.
// Es el único bloque que deja basura: necesita poder borrar al final. Con
// safety_lock activo se declara SKIP en vez de dejar un "Smoke Dept" en el
// catálogo público de producción en cada corrida.
r = await F(`${API}/admin/catalog`, { headers: H });
const catOk = r.status === 200;
if (!catOk) {
  const e = await j(r);
  if (r.status === 403) skip('crear depto/subdepto/producto (exige step-up 2FA)');
  else check('admin catalog 200', false, `${r.status} ${e.error}`);
} else if (deletesLocked) {
  skip('crear depto/subdepto/producto (safety_lock bloquea la limpieza)');
} else {
  r = await F(`${API}/admin/departments`, { method: 'POST', headers: JH, body: JSON.stringify({ name: `Smoke Dept ${stamp}` }) });
  const dj = await j(r);
  if (r.status === 201 && dj.data?.id) {
    createdDeptId = dj.data.id;
    check('crear departamento 201 + slug autogenerado', dj.data.slug === `smoke-dept-${stamp}`, dj.data.slug);
  } else {
    check('crear departamento 201', false, `${r.status} ${dj.error} ${dj.message || ''}`);
  }

  // departments.name es UNIQUE global: repetir el mismo nombre da 409, no 500.
  r = await F(`${API}/admin/departments`, { method: 'POST', headers: JH, body: JSON.stringify({ name: `Smoke Dept ${stamp}` }) });
  const dupe = await j(r);
  check('departamento duplicado 409 (name UNIQUE)', r.status === 409, `${r.status} ${dupe.error}`);

  if (createdDeptId) {
    r = await F(`${API}/admin/subdepartments`, { method: 'POST', headers: JH, body: JSON.stringify({ department_id: createdDeptId, name: `Smoke Sub ${stamp}` }) });
    const sj = await j(r);
    if (r.status === 201 && sj.data?.id) {
      createdSubId = sj.data.id;
      check('crear subdepartamento 201', !!sj.data.slug, sj.data.slug);
    } else {
      check('crear subdepartamento 201', false, `${r.status} ${sj.error} ${sj.message || ''}`);
    }

    r = await F(`${API}/admin/departments/${createdDeptId}`, { method: 'PUT', headers: JH, body: JSON.stringify({ name: `Smoke Dept ${stamp} Renamed` }) });
    const uj = await j(r);
    check('editar departamento 200 + slug recalculado', r.status === 200 && uj.data?.slug === `smoke-dept-${stamp}-renamed`, `${r.status} ${uj.data?.slug}`);

    r = await F(`${API}/admin/departments/${createdDeptId}`, { method: 'PUT', headers: JH, body: JSON.stringify({ is_active: 0 }) });
    const tj = await j(r);
    check('desactivar departamento 200', r.status === 200 && tj.data?.is_active === 0, r.status);

    r = await F(`${API}/catalog/departments`);
    const pub = await j(r);
    const visible = Array.isArray(pub.data) && pub.data.some((d) => d.id === createdDeptId);
    check('departamento inactivo no aparece en catálogo público', !visible, 'visible pese a is_active=0');

    await F(`${API}/admin/departments/${createdDeptId}`, { method: 'PUT', headers: JH, body: JSON.stringify({ is_active: 1 }) });
  }

  // Producto: ya no debe caer en 'subdep-demo' hardcodeado.
  r = await F(`${API}/admin/products`, { method: 'POST', headers: JH, body: JSON.stringify({ name: `Smoke Prod ${stamp}`, description: 'x', image_url: 'https://example.com/x.png', price_cents: 100, stock_quantity: 1 }) });
  const noSub = await j(r);
  check('crear producto sin subdepartment_id 400 (ya no hardcodea subdep-demo)', r.status === 400, `${r.status} ${noSub.error}`);

  if (createdSubId) {
    r = await F(`${API}/admin/products`, { method: 'POST', headers: JH, body: JSON.stringify({ name: `Smoke Prod ${stamp}`, description: 'x', image_url: 'https://example.com/x.png', subdepartment_id: createdSubId, price_cents: 100, stock_quantity: 1 }) });
    const pj = await j(r);
    if (r.status === 201 && pj.data?.id) {
      createdProductId = pj.data.id;
      check('crear producto en subdepartamento elegido 201', !!pj.data.slug, pj.data.slug);

      r = await F(`${API}/catalog/products`);
      const pl = await j(r);
      const found = Array.isArray(pl.data) && pl.data.find((x) => x.id === createdProductId);
      check('producto nuevo cuelga del subdepartamento correcto', found?.subdepartment_id === createdSubId, found?.subdepartment_slug);
      check('producto expone nombre de depto/subdepto', !!found?.department_name && !!found?.subdepartment_name, `${found?.department_name} / ${found?.subdepartment_name}`);

      // Borrar el subdepartamento con productos vivos debe rebotar 409.
      // Con safety_lock activo el guard corta antes con 403 SAFETY_LOCKED.
      r = await F(`${API}/admin/subdepartments/${createdSubId}`, { method: 'DELETE', headers: H });
      const busy = await j(r);
      if (r.status === 403 && busy.error === 'SAFETY_LOCKED') {
        skip('borrar subdepto con productos vivos 409 (modo seguro activo)');
      } else {
        check('borrar subdepto con productos vivos 409', r.status === 409, `${r.status} ${busy.error}`);
      }
    } else {
      check('crear producto en subdepartamento elegido 201', false, `${r.status} ${pj.error} ${pj.message || ''}`);
    }
  }
}

// Limpieza: el smoke no debe dejar basura en el catálogo de producción.
// DELETE /products archiva (no borra) y DELETE de catálogo exige safety_lock
// apagado, así que con el modo seguro activo no se puede limpiar por API.
//
// Además del borrado por id, se barre por prefijo: si una corrida anterior
// murió a mitad (o el DELETE quedó bloqueado), sus filas no tienen id guardado
// aquí y solo se detectan buscando por nombre.
const SMOKE_PREFIX = 'smoke';
if (createdProductId || createdSubId || createdDeptId) {
  const del = await Promise.all([
    createdProductId ? F(`${API}/admin/products/${createdProductId}`, { method: 'DELETE', headers: H }) : null,
    createdSubId ? F(`${API}/admin/subdepartments/${createdSubId}`, { method: 'DELETE', headers: H }) : null,
    createdDeptId ? F(`${API}/admin/departments/${createdDeptId}`, { method: 'DELETE', headers: H }) : null,
  ].filter(Boolean));

  const blocked = del.filter((x) => x.status !== 200);
  if (blocked.length === 0) {
    r = await F(`${API}/admin/catalog`, { headers: H });
    const leftover = await j(r);
    const gone = Array.isArray(leftover.data)
      && !leftover.data.some((d) => d.id === createdDeptId || d.subdepartments.some((s) => s.id === createdSubId));
    check('limpieza: depto/subdepto de prueba fuera del catálogo', gone, 'quedan restos');
  } else {
    // No es FAIL del código bajo prueba, pero hay que ser explícito.
    results.push(`WARN limpieza catálogo bloqueada (safety_lock) — dept=${createdDeptId} sub=${createdSubId} prod=${createdProductId} (producto queda archivado, no se ve en el catálogo público)`);
  }
}

// Barrido de seguridad: busca restos de cualquier corrida previa por prefijo.
if (authed) {
  r = await F(`${API}/admin/catalog`, { headers: H });
  const cat = await j(r);
  if (Array.isArray(cat.data)) {
    const staleDepts = cat.data.filter((d) => d.name.toLowerCase().startsWith(SMOKE_PREFIX));
    const staleSubs = cat.data.flatMap((d) => (d.subdepartments || [])
      .filter((s) => s.name.toLowerCase().startsWith(SMOKE_PREFIX)
        || s.slug.toLowerCase().startsWith(SMOKE_PREFIX)
        || d.name.toLowerCase().startsWith(SMOKE_PREFIX)));
    if (staleDepts.length || staleSubs.length) {
      results.push('WARN quedan restos de corridas previas (borrar por SQL; safety_lock los bloquea por API):');
      for (const d of staleDepts) results.push(`  WARN   departamento "${d.name}" (${d.id})`);
      for (const s of staleSubs) results.push(`  WARN   subdepartamento "${s.name}" (${s.id})`);
    } else {
      check('sin restos de corridas de smoke anteriores', true);
    }
  }
}

console.log('== Front ==');
r = await F(WEB);
const html = await r.text();
check('home 200 + bundle', r.status === 200 && html.includes('/assets/index-'), r.status);
check('home viewport-fit notch', html.includes('viewport-fit=cover'), 'sin viewport-fit');
check('home CSP permite bigdatacloud', html.includes('api.bigdatacloud.net'), 'CSP sin bigdatacloud');

console.log('== Logout ==');
r = await F(`${API}/auth/logout`, { method: 'POST', headers: H });
check('logout 200', r.status === 200, r.status);
r = await F(`${API}/auth/me`, { headers: H });
check('me tras logout 401', r.status === 401, r.status);
// Cerrar sesión tiene que cerrar también el panel: si el grant sobrevive al
// logout, "salir" deja el admin abierto hasta una hora.
const relogin = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }) });const rt = (await j(relogin)).data?.session?.token;
if (!rt) { skip('logout revoca el grant de admin (sin sesión para repetir)'); }
else {
  const RH = { 'Authorization': `Bearer ${rt}` };
  r = await F(`${API}/admin/stats`, { headers: RH });
  const e = await j(r);
  check('logout revoca el grant de admin (403 de nuevo)', r.status === 403 && (e.error === 'ADMIN_2FA_REQUIRED' || e.error === 'ADMIN_2FA_SETUP_REQUIRED'), `${r.status} ${e.error}`);
  await F(`${API}/auth/logout`, { method: 'POST', headers: RH });
}

console.log(`\nRESULTADO: ${pass} PASS / ${fail} FAIL / ${skipped} SKIP`);
for (const line of results) console.log(line);
process.exit(fail ? 1 : 0);
