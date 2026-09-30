// Comprueba los invariantes de secretos en la base de D1 de PRODUCCIÓN.
//
// Por qué esto NO está en el smoke: el smoke habla con la API por HTTP, y esto
// es una propiedad de lo que hay DENTRO de la base, que la API no expone (ni
// debe). Si el secreto TOTP volviera a guardarse en claro, para la API sería
// indetectable: seguiría funcionando igual. Solo se ve mirando la tabla.
//
// Uso:
//   node tools/check-secretos.mjs
//   node tools/check-secretos.mjs --local
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const local = args.includes('--local');
const DB = 'suprime-st-ecc-db';

const sql = (q) => {
  const cmd = `npx wrangler d1 execute ${DB} ${local ? '' : '--remote'} --command "${q.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(out.slice(out.indexOf('['))).flatMap((b) => b.results || []);
};

/** D1 devuelve los enteros como numero, pero se cubre el caso string. */
const esFalso = (v) => v === 0 || v === '0' || v === false;

console.log(`=== secretos en ${DB} (${local ? 'local' : 'PRODUCCION'}) ===\n`);

// --- 1. Secretos TOTP: cifrados, salvo los que esten SIN activar -------------
const totp = sql(
  "SELECT CASE WHEN secret LIKE 'enc1:%' THEN 'cifrado' ELSE 'en_claro' END AS estado, enabled, count(*) AS n FROM user_totp GROUP BY estado, enabled",
);
console.log('secretos TOTP:');
let activosEnClaro = 0;
for (const r of totp) {
  const pendiente = esFalso(r.enabled);
  console.log(`  ${String(r.estado).padEnd(9)} n=${r.n}  (enabled=${r.enabled})${pendiente ? ' -> alta pendiente, se cifra al completarla' : ''}`);
  if (r.estado === 'en_claro' && !pendiente) activosEnClaro += r.n;
}

// --- 2. Hashes de contrasena: formato nuevo con las iteraciones dentro --------
const hashes = sql(
  "SELECT CASE WHEN password_hash LIKE 'pbkdf2-sha256$%' THEN 'nuevo' ELSE 'antiguo' END AS formato, count(*) AS n FROM users WHERE password_hash IS NOT NULL GROUP BY formato",
);
console.log('\nhashes de contrasena:');
let antiguo = 0;
for (const r of hashes) {
  console.log(`  ${String(r.formato).padEnd(9)} n=${r.n}`);
  if (r.formato === 'antiguo') antiguo += r.n;
}

// --- 3. Hashes "nuevos" pero mal formados (falta alguna de las 4 partes) ------
const raro = sql(
  "SELECT count(*) AS n FROM users WHERE password_hash LIKE 'pbkdf2-sha256$%' AND (length(password_hash) - length(replace(password_hash, '$', '')) <> 3)",
);

console.log('\n' + '-'.repeat(62));
const problemas = [];
if (activosEnClaro > 0) problemas.push(`${activosEnClaro} secreto(s) TOTP ACTIVOS sin cifrar`);
if ((raro[0]?.n ?? 0) > 0) problemas.push(`${raro[0].n} hash(es) de contrasena mal formados (faltan partes)`);

if (problemas.length) {
  console.log('HAY QUE MIRAR:');
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('OK: ningun secreto TOTP activo esta en claro.');
console.log(antiguo > 0
  ? `    ${antiguo} hash(es) de contrasena aun en formato antiguo: normal, se migran al iniciar sesion.`
  : '    Todos los hashes de contrasena en formato nuevo.');
