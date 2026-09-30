// Relleno (backfill) de una sola vez: cifra los secretos TOTP que quedaran en
// claro en D1.
//
// POR QUE NO BASTA CON LA MIGRACIÓN PEREZOSA
// La migración perezosa reescribe el secreto la primera vez que su dueño usa el
// 2FA con éxito. Bien para no romper a nadie, pero deja la semilla en claro en la
// base hasta que esa persona entre. Si no entra nunca, sigue ahí. Este script
// la cifra YA, sin esperar.
//
// ES SEGURO
//   - Solo toca filas cuyo secreto NO empieza por 'enc1:'. Es idempotente: se
//     puede volver a ejecutar y no vuelve a cifrar nada.
//   - Lee la clave del fichero local de secretos, no de la API.
//   - NO imprime ningún secreto: ni en claro ni cifrado, ni en los errores.
//
// Uso:  node tools/backfill-totp.mjs [--local]
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const local = process.argv.includes('--local');
const DB = 'suprime-st-ecc-db';

const env = Object.fromEntries(
  readFileSync(join(REPO, '..', '_SECRETS', 'cloudflare.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const CLAVE = env.TOTP_ENCRYPTION_KEY;
if (!CLAVE) { console.error('Falta TOTP_ENCRYPTION_KEY en _SECRETS/cloudflare.env'); process.exit(2); }

const flag = local ? '' : '--remote ';
const sql = (q) => {
  const out = execSync(`npx wrangler d1 execute ${DB} ${flag}--command "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(out.slice(out.indexOf('['))).flatMap((b) => b.results || []);
};

const PREFIJO = 'enc1:';

async function cifrar(claro) {
  const b64 = CLAVE.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64'));
  if (bytes.length !== 32) throw new Error(`la clave no son 32 bytes: ${bytes.length}`);
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cif = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(claro));
  const b = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${PREFIJO}${b(iv.buffer)}:${b(cif)}`;
}

const pendientes = sql("SELECT user_id, secret FROM user_totp WHERE secret NOT LIKE 'enc1:%'");
console.log(`secretos TOTP en claro: ${pendientes.length}`);
if (!pendientes.length) { console.log('nada que hacer (o ya estan todos cifrados)'); process.exit(0); }

let ok = 0, fallos = 0;
for (const fila of pendientes) {
  try {
    const cifrado = await cifrar(fila.secret);
    sql(`UPDATE user_totp SET secret = '${cifrado.replace(/'/g, "''")}' WHERE user_id = '${fila.user_id}'`);
    ok++;
    console.log(`  cifrado 1 secreto (enabled=${fila.enabled ?? '?'}, user ${String(fila.user_id).slice(0, 8)}...)`);
  } catch (e) {
    fallos++;
    console.error(`  NO se pudo cifrar el de ${String(fila.user_id).slice(0, 8)}: ${e.message}`);
  }
}
console.log(`\ncifrados ${ok}, fallos ${fallos}`);

// Comprobacion final, sin imprimir secretos.
const restantes = sql("SELECT count(*) AS n FROM user_totp WHERE secret NOT LIKE 'enc1:%'");
console.log(`en claro despues: ${restantes[0]?.n ?? '?'}`);
process.exit(fallos > 0 || (restantes[0]?.n ?? 0) > 0 ? 1 : 0);
