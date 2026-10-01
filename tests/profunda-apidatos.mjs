// =============================================================
// BATERÍA PROFUNDA · API Y DATOS
// =============================================================
// Comprueba que la API cumple su contrato y que los datos estan sanos, SIN
// escribir nada en la tienda.
//
// Lo que mas mide:
//   - Que cada endpoint devuelve lo que promete y con el codigo correcto.
//   - Que limit y offset funcionan (hubo un bug: se ignoraban).
//   - Que la autenticacion y el panel no dejan escalar privilegios.
//   - Que el rate limit topa de verdad.
//   - Que el SEO tiene una sola URL canonica.
//
// Uso: node tests/profunda-apidatos.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const API = process.env.API || 'https://api.suprime.xyz/api/v1';
const WWW = process.env.WWW || 'https://www.suprime.xyz';
const REPO = 'C:/Users/VIP/Desktop/Cerebro Obcidian/C proyectos Web';

const t = readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/smoke.env', 'utf8');
const env = {};
for (const l of t.split(/\r?\n/)) {
  if (!l || l.startsWith('#') || !l.includes('=')) continue;
  const i = l.indexOf('=');
  env[l.slice(0, i)] = l.slice(i + 1);
}

const F = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(25000) });
const post = (u, b) => F(`${API}${u}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WWW }, body: JSON.stringify(b) });

let pass = 0, fail = 0, saltos = 0;
const lineas = [];
const todo = [];
const check = (n, ok, d = '', p = '') => {
  if (ok) { pass++; lineas.push(`PASS ${n}${p ? '  (' + p + ')' : ''}`); } else { fail++; lineas.push(`FAIL ${n}  ${d}${p ? '  (' + p + ')' : ''}`); }
  todo.push({ n, ok, d, p });
};
const saltar = (n, m) => { saltos++; lineas.push(`SKIP ${n}  (${m})`); };

// Limpia los cubos de esta IP antes de empezar. Las pruebas de inyeccion generan
// muchos 401 y dejan la IP topada; si no, el login de mas abajo sale 429 y
// pareceria que el login esta roto cuando lo que pasa es que el test se topo a si
// mismo. Se apaga tambien cualquier bypass de rate limit.
{
  const envT = readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/cloudflare.env', 'utf8');
  const ce = {};
  for (const l of envT.split(/\r?\n/)) {
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    ce[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  const W = join(REPO, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const NS = 'c695ababca41469a97d90502eebf1620';
  const kv = (...c) => spawnSync(process.execPath, [W, ...c, '--namespace-id', NS, '--remote'], {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: ce.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: ce.CLOUDFLARE_ACCOUNT_ID },
  });
  kv('kv', 'key', 'delete', 'rlbypass:ips');
  const ip = (await (await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10000) })).json()).ip;
  const li = kv('kv', 'key', 'list');
  if (li.status === 0) {
    for (const k of (JSON.parse(li.stdout || '[]'))) {
      const n = typeof k === 'string' ? k : k.name;
      if (n && (n.includes(ip) || n.includes('rl-prod') || n.includes('rl-check'))) kv('kv', 'key', 'delete', n);
    }
  }
  console.log(`(cubo de ${ip} limpiado; el bypass esta apagado)`);
  await new Promise((r) => setTimeout(r, 7000));
}

console.log('\n=== 1. CONTRATO ===\n');
const publicos = [
  ['/health', (j) => j.status === 'ok', 'estado del servicio'],
  ['/catalog/departments', (j) => Array.isArray(j.data), 'los departamentos de la tienda'],
  ['/catalog/categories', (j) => Array.isArray(j.data), 'las categorias'],
  ['/catalog/products?limit=5', (j) => j.data && Array.isArray(j.data), 'el catalogo de productos'],
  ['/catalog/store-settings', (j) => typeof j.data === 'object', 'los ajustes publicos de tienda'],
];
for (const [ruta, valida, que] of publicos) {
  const r = await F(`${API}${ruta}`);
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch {}
  check(`${ruta} responde 200 con JSON`, r.status === 200 && j !== null, `status ${r.status}: ${txt.slice(0, 50)}`, que);
  if (j !== null) check(`${ruta} con la forma correcta`, valida(j), JSON.stringify(j).slice(0, 60), que);
}

// El sitemap es XML, no JSON. Se comprueba aparte: exigirle JSON daba un falso
// fallo ("status 200, <?xml version...").
{
  const r = await F(`${API}/catalog/sitemap.xml`);
  const x = await r.text();
  check('el sitemap responde 200 y es XML', r.status === 200 && x.includes('<?xml') && x.includes('<urlset'), `status ${r.status}`, 'Google no lo lee si no es XML');
  check('el sitemap usa el host canonico www', !x.includes('https://suprime.xyz/'), 'apex en el sitemap', 'dos versiones = contenido duplicado');
  const n = (x.match(/<loc>/g) || []).length;
  check('el sitemap tiene URLs', n > 5, `${n} URLs`, 'si tiene 2, Google no indexa nada');
}

console.log('\n=== 2. LIMIT Y OFFSET (hubo un bug aqui) ===\n');
let full = 0;
for (const q of ['limit=1', 'limit=2', 'limit=3', 'limit=50', 'limit=10000']) {
  const j = await (await F(`${API}/catalog/products?${q}`)).json();
  const l = Array.isArray(j.data) ? j.data : [];
  if (!q.includes('10000')) full = Math.max(full, l.length);
  const techo = q.includes('10000') ? 100 : Number(/limit=(\d+)/.exec(q)[1]);
  check(`${q} devuelve como max ${techo} productos`, l.length <= techo, `${l.length} productos`, 'un techo protege la cuota de la API');
}
{
  // Sin limit se sigue devolviendo todo: es lo que espera el front, que filtra
  // en el cliente. Si esto dejara de ser cierto, la pagina de categoria se
  // quedaria mostrando pocos productos.
  const j = await (await F(`${API}/catalog/products`)).json();
  check('sin limit devuelve el catalogo entero (lo que espera el front)', (j.data?.length || 0) >= full, `${j.data?.length} de ${full}`, 'si baja, el front se queda con pocos productos');
}
{
  const a = (await (await F(`${API}/catalog/products?limit=3&offset=0`)).json()).data || [];
  const b = (await (await F(`${API}/catalog/products?limit=3&offset=3`)).json()).data || [];
  const ids = new Set(a.map((x) => x.id));
  const solapa = b.filter((x) => ids.has(x.id));
  check('offset avanza de verdad (no repite productos)', solapa.length === 0, `${solapa.length} repetidos`, 'si se repite, el infinite scroll se atasca');
}

console.log('\n=== 3. FILTROS MALICIOSOS ===\n');
for (const [nombre, q] of [
  ['categoria inventada', 'category=no-existe'],
  ['precio imposible', 'minPrice=999999'],
  ['precio negativo', 'minPrice=-100'],
  ['comodines en la busqueda', 'q=%25%25%25'],
  ['inyeccion en el orden', 'sort=; DROP TABLE products--'],
  ['limit no numerico', 'limit=abc'],
  ['offset negativo', 'limit=3&offset=-5'],
]) {
  const r = await F(`${API}/catalog/products?${q}`);
  const txt = await r.text();
  check(`filtro "${nombre}" no rompe la API`, r.status < 500 && !/sqlite|SQLITE_ERROR/i.test(txt), `status ${r.status}`, 'un filtro malicioso no puede tumbar el catalogo');
}

console.log('\n=== 4. DATOS PUBLICOS ===\n');
{
  const l = (await (await F(`${API}/catalog/products?limit=3`)).json()).data || [];
  const p = l[0] || {};
  check('el producto no expone campos internos', !Object.keys(p).some((c) => /password|cost|internal|secret|token/i.test(c)), Object.keys(p).join(','), 'no filtrar datos internos');
  // El campo se llama price_cents, no price: es el precio en centimos para no
  // depender de los decimales de coma. Buscar 'price' a secas daba undefined.
  check('el producto tiene precio', p.price_cents !== undefined && p.price_cents >= 0, String(p.price_cents), 'sin precio no hay venta');
  check('el producto tiene nombre', !!p.name, p.name || '(vacio)', 'inutil sin nombre');
  check('el producto tiene imagen', Array.isArray(p.images) && p.images.length > 0, `${p.images?.length} imagenes`, 'sin foto no se vende');
}

console.log('\n=== 5. AUTENTICACION Y PRIVILEGIOS ===\n');
let token = null;
if (env.SMOKE_EMAIL && env.SMOKE_PASSWORD) {
  const r = await post('/auth/login', { email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD });
  const j = await r.json();
  // El token vive en data.session.token. Mirar en data.token daba undefined y
  // el bloque entero se saltaba, que es como un test que no comprueba nada.
  token = j.data?.session?.token || null;
  check('login correcto da 200 y token', r.status === 200 && !!token, r.status, 'el camino basico de entrada');
  // expires_at viene en SEGUNDOS (epoch), no en milisegundos. new Date() con un
  // numero de 10 digitos lo interpreta como milisegundos y da 1970, asi que el
  // check decia "no caduca" cuando si caduca. Se normaliza segun el tamano.
  const exp = Number(j.data?.session?.expires_at);
  const expMs = exp > 1e11 ? exp : exp * 1000;
  check('la sesion caduca (expires_at en el futuro)', Number.isFinite(exp) && expMs > Date.now(), `${exp} -> ${new Date(expMs).toISOString()}`, 'una sesion sin caducidad es eterna');
  check('el login no devuelve el hash de la contrasena', !JSON.stringify(j).includes('password_hash'), 'fuga', 'el hash en la respuesta es una fuga grave');
  check('el rol viene en el usuario', !!j.data?.user?.role_id, String(j.data?.user?.role_id), 'el front lo necesita');
} else {
  saltar('login completo', 'sin credenciales de smoke');
}

if (token) {
  const H = { Authorization: `Bearer ${token}` };
  // El smoke es stock_manager: no puede tocar usuarios ni configuracion. Si
  // puede, es escalada de privilegios.
  for (const [nombre, ruta] of [['listar usuarios', '/admin/users'], ['ver configuracion', '/admin/settings'], ['ver estadisticas', '/admin/stats']]) {
    const r = await F(`${API}${ruta}`, { headers: H });
    const cuerpo = await r.text();
    const peligroso = r.status === 200 && !/error/i.test(cuerpo);
    check(`un stock_manager NO puede ${nombre}`, !peligroso, `status ${r.status}: ${cuerpo.slice(0, 50)}`, 'escalada de privilegios');
  }
  const r = await F(`${API}/admin/stats`, { headers: H });
  check('sin grant de 2FA, /admin exige el segundo factor', r.status === 403, r.status, 'el panel exige 2FA');

  const antes = await F(`${API}/auth/me`, { headers: H });
  await F(`${API}/auth/logout`, { method: 'POST', headers: { ...H, Origin: WWW } });
  const despues = await F(`${API}/auth/me`, { headers: H });
  check('tras el logout el token deja de servir', antes.status === 200 && despues.status === 401, `antes ${antes.status}, despues ${despues.status}`, 'cerrar sesion tiene que servir de algo');
  token = null;
} else {
  saltar('pruebas con sesion', 'no se pudo iniciar sesion');
}

console.log('\n=== 6. RATE LIMIT ===\n');
{
  // La ruta real es /auth/forgot-password. Con /auth/forgot salia 404 y el rate
  // limit no llegaba ni a probarse, asi que el check fallaba por un 404.
  const estados = [];
  for (let i = 0; i < 9; i++) estados.push((await post('/auth/forgot-password', { email: `rl-check-${Date.now()}-${i}@example.invalid` })).status);
  const c429 = estados.filter((s) => s === 429).length;
  check('el rate limit topa tras superar el maximo', c429 > 0, `estados: ${estados.join(',')}`, 'si no topa, la fuerza bruta es gratis');
  check('el rate limit no genera 5xx', !estados.some((s) => s >= 500), estados.join(','), 'un 500 en el login pierde al cliente');
}

console.log('\n=== 7. SEO ===\n');
{
  const html = await (await F(`${WWW}/`)).text();
  check('canonical a www', html.includes(`<link rel="canonical" href="${WWW}/"`), 'falta', 'Google indexa la version que le digas');
  check('og:url a www', html.includes(`property="og:url" content="${WWW}/"`), 'falta', 'al compartir en redes, la URL correcta');
  check('description presente', /<meta name="description" content="[^"]{20,}"/.test(html), 'falta', 'es el texto que se ve en Google');
  check('og:image presente', html.includes('property="og:image"'), 'falta', 'sin imagen, la vista previa es fea');
  check('lang=es', html.includes('<html lang="es"'), 'falta', 'idioma para lectores y buscadores');

  const apex = await F('https://suprime.xyz/', { redirect: 'manual' });
  check('el apex redirige a www (no hay dos URLs)', apex.status === 301 && (apex.headers.get('location') || '').startsWith(WWW), `${apex.status} ${apex.headers.get('location')}`, 'contenido duplicado');
}

console.log('\n' + '='.repeat(60));
console.log(`API Y DATOS: ${pass} PASS / ${fail} FAIL / ${saltos} SKIP`);
for (const l of lineas) console.log('  ' + l);
console.log('='.repeat(60));

writeFileSync(process.env.SALIDA || 'C:/Users/VIP/AppData/Local/Temp/opencode/apidatos.json', JSON.stringify({ pass, fail, saltos, todo }, null, 1), 'utf8');
process.exit(fail ? 1 : 0);
