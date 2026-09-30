// Redirige el apex al host canonico con 301 permanente.
//
// POR QUE EN CLOUDFLARE Y NO EN _redirects: el archivo _redirects de Pages
// matches por RUTA, no puede mirar el Host de la peticion. Y esta redireccion es
// justo "misma ruta, distinto host". En el edge ademas ocurre antes de llegar a
// Pages, que es lo que se busca.
//
// 301 y no 302: el 301 es permanente y consolida la autoridad del dominio en una
// sola URL, que es lo que evita que Google indexe la misma pagina dos veces.
//
// www.suprime.xyz queda como canonico (ver lib/site.ts y SITE_URL del front):
// canonical, og:url, sitemap, robots.txt y JSON-LD apuntan alli.
//
// Uso:
//   node tools/pages-www-redirect.mjs --dry-run
//   node tools/pages-www-redirect.mjs
//   node tools/pages-www-redirect.mjs --quitar
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const quitar = args.includes('--quitar');

const env = Object.fromEntries(
  readFileSync(join(REPO, '..', '_SECRETS', 'cloudflare.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const ZONE = env.CLOUDFLARE_ZONE_ID || '76d7164bb1f6a909167e1c1dc6b46b54';
const H = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
const api = async (m, p, body) => (await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}${p}`, {
  method: m, headers: H, body: body ? JSON.stringify(body) : undefined,
})).json();

const REF = 'apex-a-www';
const APEX = 'suprime.xyz';
const WWW = 'www.suprime.xyz';

const REGLA = {
  ref: REF,
  // Solo el host apex, cualquier esquema y cualquier ruta.
  expression: `(http.host eq "${APEX}")`,
  action: 'redirect',
  // Esquema verificado contra la documentacion de Single Redirects: la clave es
  // `from_value` (en singular) y el destino va en `target_url`. Con `value` es
  // estatico; para conservar la ruta se usa `expression` con concat(). Antes se
  // puso `from_values.url` con un "/$1", que es de la API antigua y daba
  // "unknown field from_values".
  // La query se conserva con preserve_query_string, para que /carrito?x=1 no
  // pierda el parametro al saltar a www.
  action_parameters: {
    from_value: {
      target_url: { expression: `concat("https://${WWW}", http.request.uri.path)` },
      status_code: 301,
      preserve_query_string: true,
    },
  },
  description: 'El host canonico es www. El apex se redirige con 301 para que haya una sola URL por pagina.',
};

const actual = await api('GET', '/rulesets/phases/http_request_dynamic_redirect/entrypoint');
const ruleset = actual.result;

if (quitar) {
  const r = ruleset?.rules?.find((x) => x.ref === REF);
  if (!r) { console.log('no hay regla que quitar'); process.exit(0); }
  if (dryRun) { console.log(`(dry-run) borraria ${REF}`); process.exit(0); }
  const res = await api('DELETE', `/rulesets/${ruleset.id}/rules/${r.id}`);
  console.log(res.success ? `✓ quitada ${REF}` : `error: ${JSON.stringify(res.errors).slice(0, 200)}`);
  process.exit(res.success ? 0 : 1);
}

if (dryRun) {
  console.log(`(dry-run) pondria en el ruleset ${ruleset?.id ?? '(se crearia)'}:`);
  console.log(JSON.stringify(REGLA, null, 2));
  process.exit(0);
}

if (!ruleset) {
  // La zona no tenia ruleset de redireccion (igual que el de cache, que tambien
  // faltaba). Se crea con la regla dentro.
  if (dryRun) { console.log('(se crearia el ruleset de redireccion con la regla dentro)'); process.exit(0); }
  const nuevo = await api('POST', '/rulesets', {
    name: 'SUPRIME redirecciones', kind: 'zone', phase: 'http_request_dynamic_redirect',
    rules: [REGLA],
  });
  if (!nuevo.success) { console.error(`creando ruleset: ${JSON.stringify(nuevo.errors).slice(0, 250)}`); process.exit(1); }
  console.log(`✓ creado el ruleset de redireccion con ${REF}: ${APEX} -> 301 https://${WWW}/ (id ${nuevo.result.id})`);
  process.exit(0);
}
const existente = ruleset.rules?.find((x) => x.ref === REF);

if (existente) {
  const res = await api('PATCH', `/rulesets/${ruleset.id}/rules/${existente.id}`, REGLA);
  console.log(res.success ? `✓ actualizada ${REF}` : `error: ${JSON.stringify(res.errors).slice(0, 250)}`);
  process.exit(res.success ? 0 : 1);
}

const res = await api('POST', `/rulesets/${ruleset.id}/rules`, REGLA);
console.log(res.success ? `✓ creada ${REF}: ${APEX} -> 301 https://${WWW}/` : `error: ${JSON.stringify(res.errors).slice(0, 250)}`);
process.exit(res.success ? 0 : 1);
