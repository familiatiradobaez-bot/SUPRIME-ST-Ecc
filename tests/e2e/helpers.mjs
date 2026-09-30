// tests/e2e/helpers.mjs — Utilidades compartidas por la suite E2E.
//
// La cuenta es la misma del smoke: smoke@suprime.xyz (rol stock-manager, con
// 2FA y secreto conocido). Se leen SMOKE_EMAIL / SMOKE_PASSWORD /
// SMOKE_TOTP_SECRET del entorno, igual que en tests/smoke.mjs.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Mismo cargador que el smoke: entorno primero, `_SECRETS/smoke.env` después.
try {
  for (const line of readFileSync(join(REPO, '..', '_SECRETS', 'smoke.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    if (process.env[t.slice(0, i).trim()] === undefined) {
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
} catch { /* solo entorno */ }

export const creds = {
  email: process.env.SMOKE_EMAIL,
  password: process.env.SMOKE_PASSWORD,
  totp: process.env.SMOKE_TOTP_SECRET,
};

export const API = process.env.E2E_API || 'https://api.suprime.xyz/api/v1';
export const WEB = process.env.E2E_WEB || 'https://suprime.xyz';

export function requireCreds() {
  const missing = [
    !creds.email && 'SMOKE_EMAIL',
    !creds.password && 'SMOKE_PASSWORD',
    !creds.totp && 'SMOKE_TOTP_SECRET',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Faltan ${missing.join(', ')}. Crea la cuenta con "npm run smoke:setup" y ` +
      'pasa las variables al entorno (o deja _SECRETS/smoke.env, que se lee solo).'
    );
  }
}

// TOTP (RFC 6238) con node:crypto: mismo algoritmo que la API.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(input) {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`base32 inválido: "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
export function totp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(bin % 1e6).padStart(6, '0');
}
export const totpNow = () => {
  const step = Math.floor(Date.now() / 1000 / 30);
  return totp(creds.totp, step);
};

/** Login por API: devuelve el token de sesión. */
export async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.session?.token) {
    throw new Error(`login falló (${res.status} ${body?.error || ''})`);
  }
  return body.data.session.token;
}

/** Pide el step-up de admin con el TOTP. Devuelve true si concede. */
export async function apiStepUp(token) {
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const counter of [step, step + 1, step - 1]) {
    const res = await fetch(`${API}/auth/admin-stepup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: totp(creds.totp, counter) }),
    });
    if (res.ok) return true;
  }
  return false;
}

export async function apiLogout(token) {
  await fetch(`${API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

/** Tira el grant de step-up. El grant es por usuario, no por sesión, así que
 *  revocar con una sesión cualquiera lo cierra para todas. */
export async function apiRevokeStepUp(token) {
  const res = await fetch(`${API}/auth/admin-stepup/revoke`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

/**
 * Deja el panel cerrado antes de probar a abrirlo.
 *
 * Sin esto la prueba es intermitente: el grant dura 1 h, así que si hace poco
 * que alguien entró al panel, la pantalla se abre DIRECTO y no aparece el
 * formulario del código — que es justo lo que la prueba quiere comprobar.
 */
export async function lockPanelFromApi() {
  const token = await apiLogin();
  const ok = await apiRevokeStepUp(token);
  await apiLogout(token);
  if (!ok) throw new Error('no se pudo revocar el grant de step-up');
}

/**
 * Espera a que el despliegue esté propagado.
 *
 * Cloudflare Pages sirve la SPA con 200 en CUALQUIER ruta (fallback a
 * index.html), así que un asset que aún no existe en un nodo de borde responde
 * 200 con Content-Type text/html. El navegador lo rechaza con
 * "Expected a JavaScript-or-Wasm module script" y la prueba falla con un error
 * que no tiene nada que ver con el código. Esta comprobación espera a que
 * TODOS los chunks (incluidos los lazy) se sirvan como JS/CSS de verdad.
 */
export async function waitForDeploy(request, { attempts = 12, delayMs = 5000 } = {}) {
  const html = await (await request.get(WEB)).text();

  const refs = new Set(
    [...html.matchAll(/\/assets\/[A-Za-z0-9_.\-]+\.(?:js|css)/g)].map((m) => m[0])
  );
  // Los chunks lazy no están en el HTML: se sacan de los JS ya cargados.
  for (const ref of [...refs]) {
    if (!ref.endsWith('.js')) continue;
    const body = await (await request.get(`${WEB}${ref}`)).text();
    for (const m of body.matchAll(/["']\.\/([A-Za-z0-9_.\-]+\.(?:js|css))["']/g)) {
      refs.add(`/assets/${m[1]}`);
    }
  }
  if (refs.size === 0) throw new Error('el index.html no referencia ningún asset: ¿cambió el nombre de /assets/?');

  let pending = [...refs];
  for (let i = 0; i < attempts && pending.length; i++) {
    const stillMissing = [];
    for (const ref of pending) {
      const res = await request.get(`${WEB}${ref}`, { headers: { 'Cache-Control': 'no-cache' } });
      const type = res.headers()['content-type'] || '';
      if (!/javascript|css/.test(type)) stillMissing.push(ref);
    }
    if (stillMissing.length === 0) return;
    pending = stillMissing;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `despliegue a medias: ${pending.length} asset(s) se sirven como HTML (fallback de la SPA):\n  ${pending.join('\n  ')}\n` +
    'Suele ser que el push se acaba de hacer y la propagación va por detrás. Reintenta en un par de minutos.'
  );
}

/**
 * Login por la interfaz, como lo haría una persona: abrir "Cuenta", rellenar
 * y enviar. Devuelve cuando el modal se cierra (osea, cuando hay sesión).
 */
export async function uiLogin(page) {
  await page.goto('/');
  await acceptCookiesIfPresent(page);
  await page.getByRole('button', { name: /Cuenta/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Acceso a cuenta/i });
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('#login-email').fill(creds.email);
  await dialog.locator('input[type="password"]').fill(creds.password);
  await dialog.locator('[data-testid="login-submit"]').click();
  // El modal se cierra solo cuando `user` está puesto (ver App.tsx).
  await dialog.waitFor({ state: 'hidden', timeout: 20_000 });
}

/** Acepta el banner de cookies si aparece (no bloquea, pero tapa el footer). */
export async function acceptCookiesIfPresent(page) {
  const btn = page.getByRole('button', { name: /Aceptar/i }).first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await btn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
}

/** Cierra el panel de admin y vuelve a la tienda (para no arrastrar estado). */
export async function backToShop(page) {
  const back = page.getByRole('button', { name: /Volver/i }).first();
  if (await back.isVisible({ timeout: 2000 }).catch(() => false)) await back.click();
}
