// Adjunta un dominio personalizado al proyecto de Pages. Se usa para anadir
// www.suprime.xyz, que ya resuelve por DNS pero no estaba adjunto al proyecto (por
// eso devolvia 403).
//
// Uso: node tools/pages-add-domain.mjs www.suprime.xyz [--quitar]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const args = process.argv.slice(2);
const quitar = args.includes('--quitar');
const nombre = args.find((a) => a !== '--quitar' && a.includes('.'));
if (!nombre) { console.error('uso: node tools/pages-add-domain.mjs <dominio> [--quitar]'); process.exit(2); }

const env = Object.fromEntries(
  readFileSync(join(REPO, '..', '_SECRETS', 'cloudflare.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const H = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/suprime-st-ecc/domains`;

const listar = async () => {
  const r = await (await fetch(base, { headers: H })).json();
  return r.success ? r.result : [];
};

if (quitar) {
  const r = await (await fetch(`${base}/${nombre}`, { method: 'DELETE', headers: H })).json();
  console.log(r.success ? `✓ quitado ${nombre}` : `error: ${JSON.stringify(r.errors).slice(0, 200)}`);
  process.exit(r.success ? 0 : 1);
}

const yaEsta = (await listar()).some((d) => d.name === nombre);
if (yaEsta) {
  console.log(`${nombre} ya estaba adjunto; se refresca el estado`);
} else {
  const r = await (await fetch(base, {
    method: 'POST', headers: H, body: JSON.stringify({ name: nombre }),
  })).json();
  if (!r.success) { console.error(`error añadiendo: ${JSON.stringify(r.errors).slice(0, 300)}`); process.exit(1); }
  console.log(`✓ añadido ${nombre} (id ${r.result.id}, status inicial ${r.result.status})`);
}

console.log('\n=== dominios del proyecto ahora ===');
for (const d of await listar()) {
  console.log(`  ${d.name.padEnd(34)} status=${d.status}`);
  if (d.verification_data && Object.keys(d.verification_data).length) {
    console.log(`      verificacion: ${JSON.stringify(d.verification_data).slice(0, 200)}`);
  }
}
