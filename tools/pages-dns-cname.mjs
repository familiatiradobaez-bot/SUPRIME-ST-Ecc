// Pone el registro DNS que Pages necesita para un dominio personalizado: un
// CNAME a <proyecto>.pages.dev, proxied.
//
// POR QUE HACE FALTA Y NO VALIA LO QUE HAY: www.suprime.xyz tenia dos registros
// A y dos AAAA apuntando a las IP anycast de Cloudflare (104.21.19.89,
// 172.67.185.179, 2606:4700::). Eso hace que el host resuelva y llegue a
// Cloudflare, pero Pages NO asocia el dominio asi y devolvia 403. El apex
// suprime.xyz si usa CNAME a suprime-st-ecc.pages.dev y por eso funciona.
//
// Uso:
//   node tools/pages-dns-cname.mjs --dry-run
//   node tools/pages-dns-cname.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const dryRun = process.argv.includes('--dry-run');
const ZONE = '76d7164bb1f6a909167e1c1dc6b46b54';
const PROYECTO = 'suprime-st-ecc';
const OBJETIVO = `${PROYECTO}.pages.dev`;

const env = Object.fromEntries(
  readFileSync(join(REPO, '..', '_SECRETS', 'cloudflare.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const H = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
const api = async (m, p, body) => (await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records${p}`, {
  method: m, headers: H, body: body ? JSON.stringify(body) : undefined,
})).json();

const r = await api('GET', `?name=www.suprime.xyz&per_page=100`);
if (!r.success) { console.error(JSON.stringify(r.errors)); process.exit(1); }
const actuales = r.result;
console.log(`registros actuales de www.suprime.xyz: ${actuales.length}`);
for (const d of actuales) console.log(`  ${d.type.padEnd(5)} -> ${d.content}  proxied=${d.proxied}`);

const hayCname = actuales.find((d) => d.type === 'CNAME' && d.content === OBJETIVO);
if (hayCname) { console.log(`\n✓ ya hay el CNAME a ${OBJETIVO}`); process.exit(0); }

if (dryRun) {
  console.log(`\n(dry-run) borraria ${actuales.length} registros A/AAAA y crearia:`);
  console.log(`  CNAME www.suprime.xyz -> ${OBJETIVO}  proxied=true`);
  process.exit(0);
}

// Los A/AAAA a IP anycast se borran: apuntan al mismo sitio que ya sirve el
// apex, no aportan nada y Pages necesita el CNAME para asociar el dominio.
for (const d of actuales) {
  if (d.type === 'CNAME') continue;
  const res = await api('DELETE', `/${d.id}`);
  console.log(res.success ? `  ✓ borrado ${d.type} ${d.content}` : `  ✗ no se pudo borrar ${d.id}: ${JSON.stringify(res.errors).slice(0, 150)}`);
}

const nuevo = await api('POST', '', { type: 'CNAME', name: 'www.suprime.xyz', content: OBJETIVO, proxied: true, ttl: 1 });
if (!nuevo.success) { console.error(`creando CNAME: ${JSON.stringify(nuevo.errors).slice(0, 250)}`); process.exit(1); }
console.log(`  ✓ creado CNAME www.suprime.xyz -> ${OBJETIVO} (proxied)`);

console.log('\n=== estado final ===');
const f = await api('GET', '?name=www.suprime.xyz&per_page=100');
for (const d of f.result) console.log(`  ${d.type.padEnd(5)} ${d.name} -> ${d.content}  proxied=${d.proxied}`);
