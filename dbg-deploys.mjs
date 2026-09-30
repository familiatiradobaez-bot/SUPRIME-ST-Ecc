// Lista los proyectos de Pages de la cuenta: sirve para saber el nombre real
// (el que se suponia en el despliegue anterior no existia) y el estado del
// ultimo despliegue de cada uno.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/cloudflare.env', 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);

const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/suprime-st-ecc/deployments`, {
  headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
});
const j = await r.json();
if (!j.success) { console.log('error', JSON.stringify(j.errors)); process.exit(1); }

for (const d of j.result.slice(0, 6)) {
  const m = d.deployment_trigger?.metadata || {};
  console.log(`${d.id}`);
  console.log(`  fecha  : ${d.created_on}`);
  console.log(`  commit : ${(m.commit_hash || '').slice(0, 8)}  ${(m.commit_message || '').split('\n')[0].slice(0, 64)}`);
  console.log(`  etapas : ${(d.stages || []).map((s) => `${s.name}=${s.status}`).join(' ')}`);
  console.log(`  alias  : ${(d.aliases || []).join(',') || '-'}`);
  console.log('');
}
