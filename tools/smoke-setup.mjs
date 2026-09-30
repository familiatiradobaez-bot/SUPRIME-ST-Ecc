#!/usr/bin/env node
/**
 * smoke-setup.mjs — Crea (o repara) la cuenta que usa `npm run smoke` para
 * hacer el step-up de 2FA real, y deja sus credenciales en `_SECRETS/smoke.env`.
 *
 * CONTEXTO (spec "Smoke con TOTP", 2026-09-30):
 *   `tests/smoke.mjs` se saltaba 5 checks porque no sabía hacer TOTP. Para que
 *   se ejecuten de verdad hace falta una cuenta admin con 2FA cuyo secreto se
 *   pueda calcular. Decisiones acordadas con el owner:
 *     - cuenta propia `smoke@suprime.xyz` (el 2FA del owner nunca se automatiza)
 *     - rol `role-stock-manager`, NO owner: es el rol mínimo que el propio código
 *       ya acepta para la galería (`GALLERY_ADMIN_ROLES`). Sin settings, sin
 *       usuarios, sin facturación.
 *     - permiso mínimo y permanente. En la apertura se puede desactivar o borrar.
 *     - credenciales y secreto SOLO en `_SECRETS/smoke.env`, fuera del repo.
 *
 * Este script es idempotente: se puede volver a lanzar para rotar la contraseña
 * o el secreto TOTP. Cada corrida deja la sesión y el grant de step-up limpios.
 *
 * Uso:
 *   node tools/smoke-setup.mjs            # crea/repara en la D1 remota
 *   node tools/smoke-setup.mjs --local    # idem contra la D1 local
 *   node tools/smoke-setup.mjs --print    # solo imprime el SQL, no ejecuta
 *   node tools/smoke-setup.mjs --role role-admin
 */

import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SECRETS_DIR = join(REPO, '..', '_SECRETS');
const ENV_PATH = join(SECRETS_DIR, 'smoke.env');

const args = process.argv.slice(2);
const local = args.includes('--local');
const onlyPrint = args.includes('--print');
const roleArg = args.indexOf('--role');
const ROLE = (roleArg !== -1 && args[roleArg + 1]) || 'role-stock-manager';

// --- Generadores -------------------------------------------------------------
// Base32 sin padding: es lo que espera el URI otpauth:// y lo que devuelve
// `generateTotpSecret()` en apps/api/src/lib/totp.ts.
function base32Secret(bytes = 20) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const b of randomBytes(bytes)) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

// Cumple el regex de contraseña del registro: min 8, minúscula, mayúscula, dígito y símbolo.
function strongPassword() {
  const low = 'abcdefghijkmnpqrstuvwxyz';
  const up = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const dig = '23456789';
  const sym = '!@#$%^&*';
  const all = low + up + dig + sym;
  const pick = (set, n) => Array.from({ length: n }, () => set[randomBytes(1)[0] % set.length]).join('');
  // Se baraja para que el resultado no sea siempre "AAAAa1!aaaa".
  const chars = (pick(low, 6) + pick(up, 4) + pick(dig, 4) + pick(sym, 3)).split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Mismo hash que `hashPassword()` en auth.routes.ts: PBKDF2-SHA256, 100k iter.
// Formato `<saltsin-guiones>:<hex>`. Hay que generarlo aquí porque el hash se
// guarda en la D1 y no se puede calcular desde SQL.
function hashPassword(password, salt = randomUUID().replace(/-/g, '')) {
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

const EMAIL = 'smoke@suprime.xyz';
const PASSWORD = process.env.SMOKE_PASSWORD || strongPassword();
const SECRET = (process.env.SMOKE_TOTP_SECRET || base32Secret()).replace(/=+$/, '').toUpperCase();
const USER_ID = randomUUID();

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

const SQL = `
-- smoke-setup.mjs · cuenta de smoke (${ROLE}) · ${new Date().toISOString()}
-- Idempotente: se puede relanzar para rotar la contraseña o el secreto TOTP.

-- Sesiones y grant de step-up previos: fuera, para no dejar sesiones vivas.
DELETE FROM sessions      WHERE user_id IN (SELECT id FROM users WHERE email = ${q(EMAIL)});
DELETE FROM admin_stepup  WHERE user_id IN (SELECT id FROM users WHERE email = ${q(EMAIL)});
DELETE FROM user_totp     WHERE user_id IN (SELECT id FROM users WHERE email = ${q(EMAIL)});

-- upsert del usuario. email_verified=1 es obligatorio: /auth/login devuelve
-- 403 EMAIL_NOT_VERIFIED sin él, así que el smoke nunca llegaría al 2FA.
INSERT INTO users (id, role_id, username, email, password_hash, display_name, is_active, email_verified)
VALUES (${q(USER_ID)}, ${q(ROLE)}, 'smoke', ${q(EMAIL)}, ${q(hashPassword(PASSWORD))}, 'Smoke (automatizado)', 1, 1)
ON CONFLICT(email) DO UPDATE SET
  role_id       = excluded.role_id,
  password_hash = excluded.password_hash,
  display_name  = excluded.display_name,
  is_active     = 1,
  email_verified= 1,
  updated_at    = CURRENT_TIMESTAMP;

-- 2FA listo: enabled=1 y last_counter=-1 para que el primer código no choque
-- con el anti-replay (el endpoint rechaza contadores ya usados).
INSERT INTO user_totp (user_id, secret, enabled, last_counter)
SELECT id, ${q(SECRET)}, 1, -1 FROM users WHERE email = ${q(EMAIL)};
`.trim();

if (onlyPrint) {
  console.log(SQL);
  process.exit(0);
}

// --- Escritura de las credenciales (fuera del repo) -------------------------
function writeEnvFile() {
  mkdirSync(SECRETS_DIR, { recursive: true });
  const header = [
    '# SUPRIME · Credenciales de la cuenta de smoke (NO COMMITEAR)',
    '#',
    '# ⛔ Archivo privado. Lo lee `tests/smoke.mjs` al arrancar (o ponlo en el',
    '#    entorno: SMOKE_EMAIL / SMOKE_PASSWORD / SMOKE_TOTP_SECRET).',
    '# Generado por tools/smoke-setup.mjs. Para rotar: vuelve a lanzarlo.',
    `# Contraseña: cumple el registro (8+, minúscula, mayúscula, dígito, símbolo).`,
    '# La cuenta NO es owner: es role-stock-manager, el mínimo que el panel acepta.',
    '',
  ].join('\n');
  const body = [
    `SMOKE_EMAIL=${EMAIL}`,
    `SMOKE_PASSWORD=${PASSWORD}`,
    `SMOKE_TOTP_SECRET=${SECRET}`,
    `SMOKE_ROLE=${ROLE}`,
    '',
  ].join('\n');
  writeFileSync(ENV_PATH, header + body, 'utf8');
  return ENV_PATH;
}

// --- Aplicación en D1 --------------------------------------------------------
// El fichero va a un directorio SIN espacios: `execFileSync` con `shell: true`
// concatena los argumentos y una ruta con espacios (el repo tiene "C proyectos
// Web") se partiría en dos y wrangler no vería --file.
const sqlFile = join(tmpdir(), 'suprime-smoke-setup.sql');
mkdirSync(dirname(sqlFile), { recursive: true });
writeFileSync(sqlFile, SQL, 'utf8');

const cmdArgs = ['wrangler', 'd1', 'execute', 'DB', ...(local ? [] : ['--remote']), '--file', sqlFile];
console.log(`→ aplicando en D1 ${local ? 'LOCAL' : 'REMOTA'}...`);
execFileSync('npx', cmdArgs, { stdio: 'inherit', cwd: REPO, shell: true });

// --- Verificación: el login y el 2FA tienen que funcionar de verdad ----------
const API = process.env.SMOKE_API || 'https://api.suprime.xyz/api/v1';
if (!local) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const lj = await login.json().catch(() => ({}));
  const token = lj?.data?.session?.token;
  if (!token) {
    console.error(`\n✗ login falló (${login.status} ${lj?.error || ''}). Revisa el SQL / la fila.`);
    process.exit(1);
  }
  const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  console.log(`\n✓ login OK · rol=${me?.data?.role_id} · 2FA pendiente de verificar`);

  // El grant se pide con un código real: valida el secreto de una vez y deja
  // la cuenta lista para el `npm run smoke` que venga detrás.
  const step = await fetch(`${API}/auth/me/totp/status`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  console.log(`✓ 2FA enabled=${step?.data?.enabled}`);
  await fetch(`${API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

const envPath = writeEnvFile();
console.log(`\n✓ credenciales en ${envPath}`);
console.log(`  ${EMAIL} · ${ROLE}`);
console.log('  Ya puedes lanzar:  npm run smoke');
