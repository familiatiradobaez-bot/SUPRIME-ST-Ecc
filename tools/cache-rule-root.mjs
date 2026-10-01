// Crea (o actualiza) la Cache Rule que fija el TTL de los ficheros estaticos de
// la raiz. Sin ella, cambiar un icono no llega nunca a quien ya visito la web.
//
// POR QUE HACE FALTA, MEDIDO:
// Cloudflare SOBREESCRIBE el Cache-Control de Pages. Se comprobo con una sonda:
// una cabecera X-H-Probe declarada en _headers SI aparecia en la respuesta (o
// sea que la regla se aplicaba), pero el Cache-Control seguia siendo
// "public, max-age=31536000, must-revalidate" en vez del declarado. Pages sirve
// un ano por defecto y ese valor gana.
//
// Que cubre: los ficheros de la raiz sin hash en el nombre. Los bundles de
// /assets/* si llevan hash, asi que un ano no les afecta.
//
// Uso:
//   node tools/cache-rule-root.mjs --dry-run
//   node tools/cache-rule-root.mjs --delete
//   node tools/cache-rule-root.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const borrar = args.includes('--delete');

const ZONE = process.env.CLOUDFLARE_ZONE_ID || '76d7164bb1f6a909167e1c1dc6b46b54';
const REF = 'root-static-short-cache';

function readToken() {
  const i = args.indexOf('--token');
  if (i !== -1 && args[i + 1]) return args[i + 1];
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    const s = readFileSync(join(REPO, '..', '_SECRETS', 'cloudflare.env'), 'utf8');
    const m = s.match(/^CLOUDFLARE_API_TOKEN=(\S+)/m);
    return m ? m[1] : null;
  } catch { return null; }
}
const token = readToken();
if (!token) { console.error('Falta CLOUDFLARE_API_TOKEN'); process.exit(2); }

const RUTAS = [
  '/favicon-16.png', '/favicon-32.png', '/favicon-48.png',
  '/apple-touch-icon.png', '/apple-touch-icon-152.png', '/apple-touch-icon-167.png',
  '/icon-192.png', '/icon-512.png', '/rayo-128.png', '/rayo-256.png',
  '/og-cover.svg', '/config.js', '/manifest.webmanifest',
];

// 1 hora de TTL en el navegador: suficiente para no pedirlo en cada pagina, y lo
// bastante corto para que un cambio de marca llegue en una hora en vez de en un
// ano. En el edge 1 dia: el edge lo limpia la purga del despliegue.
const REGLA = {
  ref: REF,
  // Se encadena con `or` en vez de usar `in { ... }`. El conjunto daba dos
  // errores de Cloudflare seguidos: sin comas ("expected literal )") y con
  // comas ("invalid digit found in string while parsing with radix 16", que
  // pointing al "16" de favicon-16.png). La cadena de or es mas larga pero no
  // depende de como acepte el parser ese literal.
  // www.suprime.xyz es el host canonico. Con solo el apex la regla no llegaba a
  // coincidir con nada: el apex devuelve un 301 y ya ahi muere la peticion. Se
  // cubren los dos por si un visitante entra por el apex.
  expression: `(http.host in {"www.suprime.xyz" "suprime.xyz"} and (${RUTAS.map((r) => `http.request.uri.path eq "${r}"`).join(' or ')}))`,
  action: 'set_cache_settings',
  action_parameters: {
    cache: true,
    // Esquema verificado contra la documentacion de Cache Rules: browser_ttl y
    // edge_ttl son objetos con "mode" y "default", no numeros sueltos.
    browser_ttl: { mode: 'override_origin', default: 3600 },
    edge_ttl: { mode: 'override_origin', default: 86400 },
  },
  description: 'Los ficheros de la raiz no llevan hash en el nombre: sin esto, cambiar un icono tarda un ano en llegar (Cloudflare sobrescribe el Cache-Control de Pages).',
};

const api = async (m, p, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}${p}`, {
    method: m,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
};

// Localizar (o crear) el ruleset de cache de la zona.
const rs = await api('GET', '/rulesets/phases/http_request_cache_settings/entrypoint');
let rulesetId = rs.json?.result?.id;
if (!rulesetId) {
  console.log('no hay ruleset de cache en la zona; se crea uno');
  if (dryRun) process.exit(0);
  const nuevo = await api('POST', '/rulesets', {
    name: 'SUPRIME cache settings', kind: 'zone', phase: 'http_request_cache_settings',
    rules: [REGLA],
  });
  if (!nuevo.ok) { console.error('crear ruleset:', JSON.stringify(nuevo.json.errors)); process.exit(1); }
  rulesetId = nuevo.json.result.id;
  console.log(`✓ ruleset creado con la regla ${REF} (id ${rulesetId})`);
  process.exit(0);
}

const detalle = await api('GET', `/rulesets/${rulesetId}`);
const reglas = detalle.json?.result?.rules || [];
const existente = reglas.find((r) => r.ref === REF);

if (borrar) {
  if (!existente) { console.log('no existe'); process.exit(0); }
  if (dryRun) { console.log(`(dry-run) borraria la regla ${REF}`); process.exit(0); }
  const r = await api('DELETE', `/rulesets/${rulesetId}/rules/${existente.id}`);
  console.log(r.ok ? `✓ borrada la regla ${REF}` : `error: ${JSON.stringify(r.json.errors)}`);
  process.exit(r.ok ? 0 : 1);
}

if (dryRun) {
  console.log(`(dry-run) pondria en el ruleset ${rulesetId}:`);
  console.log(JSON.stringify(REGLA, null, 2));
  process.exit(0);
}

if (existente) {
  const r = await api('PATCH', `/rulesets/${rulesetId}/rules/${existente.id}`, REGLA);
  console.log(r.ok ? `✓ actualizada la regla ${REF}` : `error: ${JSON.stringify(r.json.errors)}`);
  process.exit(r.ok ? 0 : 1);
}

const r = await api('POST', `/rulesets/${rulesetId}/rules`, REGLA);
console.log(r.ok ? `✓ creada la regla ${REF} en el ruleset ${rulesetId}` : `error: ${JSON.stringify(r.json.errors)}`);
process.exit(r.ok ? 0 : 1);
