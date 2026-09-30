// Smoke tests de producción - https://api.suprime.xyz + https://suprime.xyz
// Uso: node smoke.mjs  (requiere Node 18+)
const API = 'https://api.suprime.xyz/api/v1';
const WEB = 'https://suprime.xyz';
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
  if (!ok) { skip(name + ' (requiere sesión; owner con 2FA)'); return; }
  check(name, cond, detail);
}
function skip(name) { skipped++; results.push(`SKIP ${name}`); }
// Rutas admin: PASS si hay grant (200 válido) o si exigen step-up (403 correcto)
async function checkAdmin(name, r, validate200) {
  if (r.status === 200) {
    const d = await j(r);
    try { check(`${name} (grant vigente)`, validate200(d)); }
    catch (e) { check(`${name} (grant vigente)`, false, String(e).slice(0, 80)); }
    return;
  }
  const e = await j(r);
  check(`${name} (exige step-up)`, r.status === 403 && (e.error === 'ADMIN_2FA_REQUIRED' || e.error === 'ADMIN_2FA_SETUP_REQUIRED'), `${r.status} ${e.error}`);
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
r = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', password: 'wrong' }) });
check('login mala clave 401', r.status === 401, r.status);
r = await F(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', password: '123456' }) });
const lj = await j(r);
const token = lj.data?.session?.token;
const authed = !!token;
check('login owner 200 + token', r.status === 200 && !!token, r.status);
const H = token ? { 'Authorization': `Bearer ${token}` } : {};
r = await F(`${API}/auth/me`, { headers: H });
const me = await j(r);
checkOrSkip(authed, 'me 200 + role owner', r.status === 200 && me.data?.role_id === 'role-owner', r.status);
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

console.log('== Admin ==');
r = await F(`${API}/admin/stats`);
check('admin stats sin auth 401', r.status === 401, r.status);
r = await F(`${API}/admin/stats`, { headers: H });
if (!authed) { skip('admin stats (requiere sesión; owner con 2FA)'); }
else if (r.status === 200) { check('admin stats con owner 200 (grant vigente)', true); }
else {
  const e = await j(r);
  check('admin stats exige step-up 403', r.status === 403 && (e.error === 'ADMIN_2FA_REQUIRED' || e.error === 'ADMIN_2FA_SETUP_REQUIRED'), `${r.status} ${e.error}`);
}
r = await F(`${API}/admin/products`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
if (r.status === 400) { check('crear producto vacío 400 (grant vigente)', true); }
else { const e = await j(r); check('crear producto (exige step-up)', r.status === 403 && !!e.error, `${r.status} ${e.error}`); }
r = await F(`${API}/admin/users`, { headers: H });
await checkAdmin('admin users 200', r, (d) => Array.isArray(d.data));

r = await F(`${API}/admin/users?limit=1&offset=0`, { headers: H });
const u1 = await j(r);
if (r.status === 200) { check('admin users paginado (limit=1 + total)', Array.isArray(u1.data) && u1.data.length <= 1 && typeof u1.pagination?.total === 'number', r.status); }
else { check('admin users (exige step-up)', r.status === 403, `${r.status} ${u1.error}`); }

console.log('== Upload/galería ==');
const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const UH = { ...H, 'Content-Type': 'application/json' };
r = await F(`${API}/upload/images`);
check('galería sin auth 401', r.status === 401, r.status);
r = await F(`${API}/upload/images`, { headers: H });
await checkAdmin('galería con owner 200 + array', r, (d) => Array.isArray(d.data));
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
r = await F(`${API}/auth/google-2fa`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', code: '000000' }) });
check('google-2fa sin pendiente/código malo 401/410', r.status === 401 || r.status === 410, r.status);
r = await F(`${API}/auth/google/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
check('google exchange sin code 400', r.status === 400, r.status);
r = await F(`${API}/auth/google/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '0'.repeat(64) }) });
check('google exchange code falso 410', r.status === 410, r.status);

console.log('== Password reset ==');
r = await F(`${API}/auth/admin-stepup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ code: '000000' }) });
checkOrSkip(authed, 'admin-stepup código malo 401', r.status === 401, r.status);
r = await F(`${API}/auth/me/totp/status`, { headers: H });
if (!authed) { skip('totp status (requiere sesión; owner con 2FA)'); }
else {
  const st = await j(r);
  const enabled = r.status === 200 && st.data?.enabled === true;
  check('owner 2FA sigue activado (smoke no lo toca)', enabled, `${r.status} enabled=${st.data?.enabled}`);
  if (enabled) {
    // Con 2FA activo y sin step-up, regenerar exige 403 (no muta nada)
    r = await F(`${API}/auth/me/totp/setup`, { method: 'POST', headers: H });
    const e = await j(r);
    check('totp setup sin step-up 403 (no destructivo)', r.status === 403 && e.error === 'ADMIN_2FA_REQUIRED', `${r.status} ${e.error}`);
  } else {
    skip('totp setup (sin 2FA no se toca para no regenerar el secreto)');
  }
}
r = await F(`${API}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nadie-xyz-123@example.com' }) });
check('forgot genérico 200 (anti-enumeración)', r.status === 200, r.status);
r = await F(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', code: '000000', newPassword: 'Test1234!' }) });
check('reset código malo 401/404', r.status === 401 || r.status === 404, r.status);
r = await F(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', code: '000000', newPassword: 'weak' }) });
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
  if (res.status === 403 && (e.error === 'ADMIN_2FA_REQUIRED' || e.error === 'ADMIN_2FA_SETUP_REQUIRED')) {
    skip(`${name} (exige step-up)`);
    return false;
  }
  check(name, false, `${res.status} ${e.error}`);
  return false;
}

if (!authed) {
  skip('validaciones catálogo admin (requiere sesión)');
} else {
  await checkAdminExpect('crear departamento vacío 400', () =>
    F(`${API}/admin/departments`, { method: 'POST', headers: JH, body: JSON.stringify({}) }), 400);
  await checkAdminExpect('departamento con name vacío 400', () =>
    F(`${API}/admin/departments`, { method: 'POST', headers: JH, body: JSON.stringify({ name: '' }) }), 400);
  await checkAdminExpect('subdepartamento con depto inexistente 404', () =>
    F(`${API}/admin/subdepartments`, { method: 'POST', headers: JH, body: JSON.stringify({ department_id: 'no-existe-xyz', name: 'X' }) }), 404);
  // Modo seguro (safety_lock) bloquea el borrado antes del 404 del recurso.
  r = await F(`${API}/admin/departments/no-existe-xyz`, { method: 'DELETE', headers: H });
  if (r.status === 403) {
    const e = await j(r);
    if (e.error === 'SAFETY_LOCKED') skip('borrar departamento inexistente 404 (modo seguro activo)');
    else skip('borrar departamento inexistente 404 (exige step-up)');
  } else {
    check('borrar departamento inexistente 404', r.status === 404, r.status);
  }
}
r = await F(`${API}/admin/catalog`, { headers: H });
await checkAdmin('admin catalog 200 + estructura', r, (d) => Array.isArray(d.data) && d.data.every((x) => Array.isArray(x.subdepartments)));

// Flujo real: depto → subdepto → producto dentro de él → visible en catálogo.
r = await F(`${API}/admin/catalog`, { headers: H });
const catOk = r.status === 200;
if (!catOk) {
  const e = await j(r);
  if (r.status === 403) skip('crear depto/subdepto/producto (exige step-up 2FA)');
  else check('admin catalog 200', false, `${r.status} ${e.error}`);
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

  r = await F(`${API}/admin/departments/no-existe-xyz`, { method: 'PUT', headers: JH, body: JSON.stringify({ name: 'X' }) });
  check('editar departamento inexistente 404', r.status === 404, r.status);
  r = await F(`${API}/admin/catalog`);
  check('admin catalog sin auth 401', r.status === 401, r.status);
}

// Limpieza: el smoke no debe dejar basura en el catálogo de producción.
// DELETE /products archiva (no borra) y DELETE de catálogo exige safety_lock
// apagado, así que con el modo seguro activo no se puede limpiar por API:
// se avisa con los ids exactos para borrarlos por SQL si hiciera falta.
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

console.log(`\nRESULTADO: ${pass} PASS / ${fail} FAIL / ${skipped} SKIP`);
for (const line of results) console.log(line);
process.exit(fail ? 1 : 0);
