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

console.log('== Salud y catálogo ==');
let r = await fetch(`${API}/health`);
check('health 200', r.status === 200, r.status);
r = await fetch(`${API}/catalog/products`);
let products = [];
if (r.status === 200) { const d = await j(r); products = d.data || []; }
check('catalog products 200 + array', r.status === 200 && Array.isArray(products), r.status);
r = await fetch(`${API}/catalog/categories`);
check('catalog categories 200', r.status === 200, r.status);
if (products.length) {
  const p = products[0];
  r = await fetch(`${API}/catalog/products/${p.slug}`);
  check('product detail por slug 200', r.status === 200, r.status);
  check('product tiene precio/stock', p.price_cents >= 0 && p.stock_quantity >= 0, JSON.stringify(p).slice(0, 120));
} else { check('hay productos en catálogo', false, 'vacío'); }

console.log('== Auth ==');
r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', password: 'wrong' }) });
check('login mala clave 401', r.status === 401, r.status);
r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', password: '123456' }) });
const lj = await j(r);
const token = lj.data?.session?.token;
check('login owner 200 + token', r.status === 200 && !!token, r.status);
const H = token ? { 'Authorization': `Bearer ${token}` } : {};
r = await fetch(`${API}/auth/me`, { headers: H });
const me = await j(r);
check('me 200 + role owner', r.status === 200 && me.data?.role_id === 'role-owner', r.status);
r = await fetch(`${API}/auth/me`, { headers: { 'Authorization': 'Bearer ZmFrZTpyb2xlLW93bmVyOjEyMw==' } });
check('me token falso 401', r.status === 401, r.status);

console.log('== Admin ==');
r = await fetch(`${API}/admin/stats`);
check('admin stats sin auth 401', r.status === 401, r.status);
r = await fetch(`${API}/admin/stats`, { headers: H });
check('admin stats con owner 200', r.status === 200, r.status);
r = await fetch(`${API}/admin/products`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
check('crear producto vacío 400', r.status === 400, r.status);
r = await fetch(`${API}/admin/users`, { headers: H });
check('admin users 200', r.status === 200, r.status);

r = await fetch(`${API}/admin/users?limit=1&offset=0`, { headers: H });
const u1 = await j(r);
check('admin users paginado (limit=1 + total)', r.status === 200 && Array.isArray(u1.data) && u1.data.length <= 1 && typeof u1.pagination?.total === 'number', r.status);

console.log('== Upload/galería ==');
const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const UH = { ...H, 'Content-Type': 'application/json' };
r = await fetch(`${API}/upload/images`);
check('galería sin auth 401', r.status === 401, r.status);
r = await fetch(`${API}/upload/images`, { headers: H });
const g = await j(r);
check('galería con owner 200 + array', r.status === 200 && Array.isArray(g.data), r.status);
r = await fetch(`${API}/upload/images?limit=1&skip=0`, { headers: H });
const g1 = await j(r);
check('galería paginada limit=1', r.status === 200 && Array.isArray(g1.data) && g1.data.length <= 1, r.status);
r = await fetch(`${API}/upload/imagekit`, { method: 'POST', headers: UH, body: JSON.stringify({ nope: 1 }) });
check('upload input inválido 400', r.status === 400, r.status);
r = await fetch(`${API}/upload/imagekit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: tiny, filename: 'x.png' }) });
check('upload sin auth 401 (admin requerido)', r.status === 401, r.status);
r = await fetch(`${API}/upload/imagekit`, { method: 'POST', headers: UH, body: JSON.stringify({ dataUrl: tiny, filename: 'smoke.png' }) });
const up = await j(r);
check('upload 1px 200 + url ik.imagekit', r.status === 200 && (up.data?.url || '').includes('ik.imagekit.io'), r.status);

console.log('== Órdenes/stock (sin mutar) ==');
const OH = { ...H, 'Content-Type': 'application/json' };
r = await fetch(`${API}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
check('orders body vacío 400', r.status === 400, r.status);
r = await fetch(`${API}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ product_id: products[0]?.id || 'x', quantity: 1 }], shipping_name: 'T', shipping_email: 't@t.es', shipping_phone: '1', shipping_address: 'X', payment_method: 'paypal' }) });
check('orders sin auth 401 (login requerido)', r.status === 401, r.status);
if (products.length) {
  const p = products.find(x => x.stock_quantity >= 0);
  r = await fetch(`${API}/orders`, { method: 'POST', headers: OH, body: JSON.stringify({ items: [{ product_id: p.id, quantity: (p.stock_quantity || 0) + 50 }], shipping_name: 'T', shipping_email: 't@t.es', shipping_phone: '1', shipping_address: 'X', payment_method: 'paypal' }) });
  check('orders stock insuficiente 400 (rollback)', r.status === 400, r.status);
}

console.log('== PDP y secciones ==');
if (products.length && products[0].slug) {
  const s = products[0].slug;
  r = await fetch(`${API}/catalog/products/${s}/related?limit=4`);
  const rel = await j(r);
  check('related 200 + array', r.status === 200 && Array.isArray(rel.data), r.status);
  if (products[0].department_slug) {
    r = await fetch(`${API}/catalog/departments/${products[0].department_slug}/products`);
    const dp = await j(r);
    check('dept products 200 + array', r.status === 200 && Array.isArray(dp.data?.products), r.status);
  }
  if (products[0].subdepartment_slug) {
    r = await fetch(`${API}/catalog/subdepartments/${products[0].subdepartment_slug}/products`);
    const sp = await j(r);
    check('subdept products 200 + array', r.status === 200 && Array.isArray(sp.data?.products), r.status);
  }
  r = await fetch(`${API}/catalog/products/no-existe-xyz`);
  check('detail inexistente 404', r.status === 404, r.status);
}

console.log('== Google OAuth ==');

r = await fetch(`${API}/auth/google/login`, { redirect: 'manual' });
const loc = r.headers.get('location') || '';
check('google login redirige 302', r.status === 302, r.status);
check('redirect a accounts.google + callback api.suprime', loc.includes('accounts.google.com') && loc.includes(encodeURIComponent('https://api.suprime.xyz/api/v1/auth/google/callback')), loc.slice(0, 120));
const setCookie = r.headers.get('set-cookie') || '';
check('google login fija cookie oauth_state', setCookie.includes('oauth_state='), setCookie.slice(0, 80));
r = await fetch(`${API}/auth/google/callback`);
check('callback sin code 400', r.status === 400, r.status);
r = await fetch(`${API}/auth/google/callback?code=fake&state=fake`);
check('callback state inválido 403', r.status === 403, r.status);

console.log('== Password reset ==');
r = await fetch(`${API}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nadie-xyz-123@example.com' }) });
check('forgot genérico 200 (anti-enumeración)', r.status === 200, r.status);
r = await fetch(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', code: '000000', newPassword: 'Test1234!' }) });
check('reset código malo 401/404', r.status === 401 || r.status === 404, r.status);
r = await fetch(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@admin.com', code: '000000', newPassword: 'weak' }) });
check('reset clave débil 400', r.status === 400, r.status);

console.log('== Front ==');
r = await fetch(WEB);
const html = await r.text();
check('home 200 + bundle', r.status === 200 && html.includes('/assets/index-'), r.status);

console.log('== Logout ==');
r = await fetch(`${API}/auth/logout`, { method: 'POST', headers: H });
check('logout 200', r.status === 200, r.status);
r = await fetch(`${API}/auth/me`, { headers: H });
check('me tras logout 401', r.status === 401, r.status);

console.log(`\nRESULTADO: ${pass} PASS / ${fail} FAIL`);
for (const line of results) console.log(line);
process.exit(fail ? 1 : 0);
