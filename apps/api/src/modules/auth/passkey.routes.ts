import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';
import { getClientIp } from '../../lib/request';
import { checkRateLimit } from '../../lib/rate-limit';
import {
  toBase64Url, fromBase64Url, randomBytes,
  verifyRegistration, verifyAssertion,
} from '../../lib/webauthn';

// Passkeys (WebAuthn) + dispositivos de confianza.
//
// Reglas de seguridad que no se negocian:
//  · origin y rpId SIEMPRE validados contra la lista blanca de abajo.
//  · desafío de 32 bytes, de un solo uso, 5 minutos, guardado en D1.
//  · el navegador nunca decide el usuario: el user.id es el UUID de la sesión.
//  · la cookie de confianza es httpOnly + Secure + SameSite=Strict y en BD
//    solo vive su SHA-256.
//  · un dispositivo de confianza NO salta el 2FA del panel admin: el
//    middleware de /admin sigue exigiendo step-up.

export const passkeyRoutes = new Hono<{ Bindings: Bindings }>();

const RP_NAME = 'SUPRIME';
const RP_ID = 'suprime.xyz';
const ORIGINS = new Set([
  'https://suprime.xyz',
  'https://www.suprime.xyz',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const CHALLENGE_TTL_SEC = 300;
const TRUSTED_DEVICE_TTL_DAYS = 30;
const TRUSTED_COOKIE = 'trusted_device';

function originOk(origin: string | undefined): boolean {
  return !!origin && ORIGINS.has(origin);
}

function randomToken(): string {
  return toBase64Url(randomBytes(32));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value) as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function requireSession(context: any): Promise<string | null> {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const row = await context.env.DB.prepare(
    `SELECT s.user_id AS user_id FROM sessions s
      WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(token).first() as { user_id: string } | null;
  return row?.user_id ?? null;
}

/**
 * Consume un desafío de un solo uso.
 * OJO: devuelve null si no existe / expiró / es de otro tipo. Un desafío
 * válido de login SIN usuario (login "discoverable", sin correo) es legal:
 * por eso el retorno distingue "no había desafío" de "desafío sin usuario".
 */
async function consumeChallenge(
  env: Bindings,
  challenge: string,
  type: 'register' | 'login',
): Promise<{ userId: string | null } | null> {
  const row = await env.DB.prepare(
    'SELECT user_id, type, expires_at FROM webauthn_challenges WHERE challenge = ?'
  ).bind(challenge).first() as { user_id: string | null; type: string; expires_at: number } | null;
  if (!row || row.type !== type) return null;
  // Un solo uso: se borra aunque la verificación falle después.
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE challenge = ?').bind(challenge).run();
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return { userId: row.user_id };
}

async function createSession(context: any, userId: string, days: number) {
  const token = makeSessionToken();
  const expiresAt = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
  await context.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt).run();
  context.header('Set-Cookie', `session_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${days * 24 * 60 * 60}`);
  return { token, expiresAt };
}

function cookieValue(context: any, name: string): string | null {
  const raw = context.req.header('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// ── Registro: POST /auth/passkey/register/options ─────────────────────────
passkeyRoutes.post('/passkey/register/options', async (context) => {
  const userId = await requireSession(context);
  if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401);
  if (!originOk(context.req.header('Origin'))) return context.json({ error: 'FORBIDDEN', message: 'Origin no permitido' }, 403);

  const challenge = randomToken();
  await context.env.DB.prepare(
    'INSERT INTO webauthn_challenges (challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(challenge, userId, 'register', Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC).run();

  const user = await context.env.DB.prepare('SELECT id, username, display_name FROM users WHERE id = ?')
    .bind(userId).first() as { id: string; username: string; display_name: string } | null;
  if (!user) return context.json({ error: 'NOT_FOUND' }, 404);

  return context.json({
    data: {
      challenge,
      rp: { id: RP_ID, name: RP_NAME },
      // El user.id de WebAuthn son bytes opacos. Aquí son los bytes UTF-8 del
      // UUID de la fila: estable, sin filtrar el id y reversible en el servidor.
      user: { id: toBase64Url(new TextEncoder().encode(user.id)), name: user.username, displayName: user.display_name },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: CHALLENGE_TTL_SEC * 1000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    },
  });
});

// ── Registro: POST /auth/passkey/register/verify ──────────────────────────
passkeyRoutes.post('/passkey/register/verify', async (context) => {
  const userId = await requireSession(context);
  if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401);

  const ip = getClientIp(context.req);
  if (!(await checkRateLimit(context.env, `passkeyReg:${ip}`, 10, 900, ip))) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const body = await context.req.json().catch(() => null);
  const parsed = z.object({
    challenge: z.string().min(10),
    credentialId: z.string().min(10).optional(),
    deviceLabel: z.string().max(80).optional(),
    response: z.object({
      clientDataJSON: z.string().min(10),
      attestationObject: z.string().min(10),
      transports: z.array(z.string()).optional(),
    }),
  }).safeParse(body);
  if (!parsed.success) return context.json({ error: 'INVALID_INPUT' }, 400);

  // El desafío se consume SIEMPRE (éxito o fallo): reintentar con el mismo
  // challenge nunca es válido. Además tiene que pertenecer a QUIEN está
  // autenticado: si no, un usuario podría registrar la credencial de otro.
  const consumed = await consumeChallenge(context.env, parsed.data.challenge, 'register');
  if (!consumed || consumed.userId !== userId) return context.json({ error: 'INVALID_CHALLENGE' }, 400);

  try {
    const result = await verifyRegistration({
      response: parsed.data.response,
      expectedChallenge: parsed.data.challenge,
      expectedOrigin: context.req.header('Origin') || '',
      expectedRpId: RP_ID,
      requireUserVerification: false,
    });

    const existing = await context.env.DB.prepare('SELECT id FROM passkeys WHERE credential_id = ?')
      .bind(result.credentialId).first();
    if (existing) return context.json({ error: 'CREDENTIAL_EXISTS' }, 409);

    const id = crypto.randomUUID();
    await context.env.DB.prepare(
      `INSERT INTO passkeys (id, user_id, credential_id, public_key, alg, sign_count, transports, device_label, backed_up)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, userId, result.credentialId, result.publicKey, result.alg, result.signCount,
      (parsed.data.response.transports || []).join(','),
      parsed.data.deviceLabel || 'Passkey',
      result.backedUp ? 1 : 0,
    ).run();

    return context.json({ data: { id, credentialId: result.credentialId } }, 201);
  } catch (err) {
    return context.json({ error: 'REGISTRATION_FAILED', message: String((err as Error).message).slice(0, 160) }, 400);
  }
});

// ── Login: POST /auth/passkey/login/options ───────────────────────────────
passkeyRoutes.post('/passkey/login/options', async (context) => {
  if (!originOk(context.req.header('Origin'))) return context.json({ error: 'FORBIDDEN', message: 'Origin no permitido' }, 403);
  const ip = getClientIp(context.req);
  if (!(await checkRateLimit(context.env, `passkeyLogin:${ip}`, 30, 900, ip))) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const body = await context.req.json().catch(() => ({})) as { email?: string; username?: string };
  const identifier = (body?.email || body?.username || '').trim().toLowerCase();

  let userId: string | null = null;
  if (identifier) {
    const row = await context.env.DB.prepare(
      'SELECT id FROM users WHERE (email = ? OR username = ?) AND is_active = 1'
    ).bind(body?.email || '', body?.username || '').first() as { id: string } | null;
    userId = row?.id ?? null;
  }

  const challenge = randomToken();
  await context.env.DB.prepare(
    'INSERT INTO webauthn_challenges (challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(challenge, userId, 'login', Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC).run();

  return context.json({
    data: {
      challenge,
      rpId: RP_ID,
      timeout: CHALLENGE_TTL_SEC * 1000,
      userVerification: 'preferred',
      // Con `allowCredentials` vacío el navegador ofrece todos los passkeys
      // guardados para este dominio (autofill condicional).
      allowCredentials: [],
    },
  });
});

// ── Login: POST /auth/passkey/login/verify ────────────────────────────────
passkeyRoutes.post('/passkey/login/verify', async (context) => {
  if (!originOk(context.req.header('Origin'))) return context.json({ error: 'FORBIDDEN', message: 'Origin no permitido' }, 403);
  const ip = getClientIp(context.req);
  if (!(await checkRateLimit(context.env, `passkeyLogin:${ip}`, 30, 900, ip))) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const body = await context.req.json().catch(() => null);
  const parsed = z.object({
    challenge: z.string().min(10),
    credentialId: z.string().min(10),
    clientDataJSON: z.string().min(10),
    authenticatorData: z.string().min(10),
    signature: z.string().min(10),
    userHandle: z.string().nullish(),
    trustDevice: z.boolean().optional(),
  }).safeParse(body);
  if (!parsed.success) return context.json({ error: 'INVALID_INPUT' }, 400);

  const passkey = await context.env.DB.prepare(
    `SELECT p.id, p.user_id, p.public_key, p.alg, p.sign_count, u.email, u.username, u.display_name, u.role_id, u.is_active, u.email_verified, u.google_subject
       FROM passkeys p JOIN users u ON u.id = p.user_id
      WHERE p.credential_id = ?`
  ).bind(parsed.data.credentialId).first() as any;
  if (!passkey || !passkey.is_active) return context.json({ error: 'INVALID_CREDENTIALS' }, 401);

  const consumed = await consumeChallenge(context.env, parsed.data.challenge, 'login');
  if (!consumed) return context.json({ error: 'INVALID_CHALLENGE' }, 400);

  try {
    const signCount = await verifyAssertion({
      credentialId: parsed.data.credentialId,
      storedPublicKey: passkey.public_key,
      storedAlg: passkey.alg,
      storedSignCount: passkey.sign_count,
      clientDataJSON: parsed.data.clientDataJSON,
      authenticatorData: parsed.data.authenticatorData,
      signature: parsed.data.signature,
      userHandle: parsed.data.userHandle ?? null,
      // El userHandle viaja en base64url de los bytes UTF-8 del id (igual que
      // en el registro). Comparar contra el UUID en crudo nunca casaría.
      expectedUserId: toBase64Url(new TextEncoder().encode(passkey.user_id)),
      expectedChallenge: parsed.data.challenge,
      expectedOrigin: context.req.header('Origin') || '',
      expectedRpId: RP_ID,
      requireUserVerification: false,
    });

    await context.env.DB.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(signCount, passkey.id).run();

    if (!passkey.email_verified && !passkey.google_subject) {
      return context.json({ error: 'EMAIL_NOT_VERIFIED', message: 'Debes verificar tu correo electrónico antes de iniciar sesión' }, 403);
    }

    const session = await createSession(context, passkey.user_id, 7);

    if (parsed.data.trustDevice) {
      await issueTrustedDevice(context, passkey.user_id, 'Passkey');
    }

    return context.json({
      data: {
        user: {
          id: passkey.user_id, username: passkey.username, email: passkey.email,
          display_name: passkey.display_name, role_id: passkey.role_id,
        },
        session: { id: session.token, token: session.token, expires_at: session.expiresAt },
      },
    });
  } catch (err) {
    return context.json({ error: 'INVALID_CREDENTIALS', message: String((err as Error).message).slice(0, 160) }, 401);
  }
});

// ── Dispositivos de confianza ─────────────────────────────────────────────
async function issueTrustedDevice(context: any, userId: string, label: string): Promise<void> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const ua = context.req.header('User-Agent') || '';
  const uaHash = await sha256Hex(ua);
  const ip = getClientIp(context.req);
  const expiresAt = Math.floor(Date.now() / 1000) + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60;

  // Un máximo por usuario: si se supera, se caducan los más antiguos para que
  // la cookie no crezca sin control ni se acumulen sesiones eternas.
  await context.env.DB.prepare(
    `DELETE FROM trusted_devices WHERE user_id = ? AND id NOT IN (
       SELECT id FROM trusted_devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 9)`
  ).bind(userId, userId).run();

  await context.env.DB.prepare(
    `INSERT INTO trusted_devices (id, user_id, token_hash, device_label, ua_hash, ip, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), userId, hash, label, uaHash, ip, expiresAt).run();

  context.header('Set-Cookie',
    `${TRUSTED_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60}`);
}

// POST /auth/passkey/trust-device - marca este dispositivo como de confianza
passkeyRoutes.post('/passkey/trust-device', async (context) => {
  const userId = await requireSession(context);
  if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401);
  if (!originOk(context.req.header('Origin'))) return context.json({ error: 'FORBIDDEN' }, 403);

  const body = await context.req.json().catch(() => ({})) as { label?: string };
  await issueTrustedDevice(context, userId, (body?.label || 'Este dispositivo').slice(0, 80));
  return context.json({ data: { trusted: true, days: TRUSTED_DEVICE_TTL_DAYS } });
});

// POST /auth/trusted-device/login - entra solo con la cookie de confianza.
passkeyRoutes.post('/trusted-device/login', async (context) => {
  if (!originOk(context.req.header('Origin'))) return context.json({ error: 'FORBIDDEN' }, 403);
  const ip = getClientIp(context.req);
  if (!(await checkRateLimit(context.env, `trustedLogin:${ip}`, 30, 900, ip))) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const token = cookieValue(context, TRUSTED_COOKIE);
  // Sin cookie NO es un error de autenticación: es simplemente que este
  // navegador no está en la lista de confianza. Se responde 200 con
  // authenticated:false para no ensuciar la consola del visitante con 401 en
  // cada carga de la web (era un 401 por visita en el panorama móvil).
  if (!token) return context.json({ data: { authenticated: false } });

  const hash = await sha256Hex(token);
  const row = await context.env.DB.prepare(
    `SELECT d.id AS device_id, d.user_id, d.ua_hash, u.username, u.email, u.display_name, u.role_id, u.is_active
       FROM trusted_devices d JOIN users u ON u.id = d.user_id
      WHERE d.token_hash = ? AND d.expires_at > strftime('%s', 'now')`
  ).bind(hash).first() as any;
  if (!row || !row.is_active) return context.json({ data: { authenticated: false } });

  // Vinculada al navegador que la creó: si el token vuela a otra UA, no vale.
  const uaHash = await sha256Hex(context.req.header('User-Agent') || '');
  if (row.ua_hash && row.ua_hash !== uaHash) {
    await context.env.DB.prepare('DELETE FROM trusted_devices WHERE id = ?').bind(row.device_id).run();
    return context.json({ data: { authenticated: false } });
  }

  await context.env.DB.prepare('UPDATE trusted_devices SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.device_id).run();
  const session = await createSession(context, row.user_id, TRUSTED_DEVICE_TTL_DAYS);

  return context.json({
    data: {
      authenticated: true,
      user: { id: row.user_id, username: row.username, email: row.email, display_name: row.display_name, role_id: row.role_id },
      session: { id: session.token, token: session.token, expires_at: session.expiresAt },
    },
  });
});

// ── Huella como segundo factor del panel ─────────────────────────────────
// El 2FA del admin se puede cumplir con el CÓDIGO TOTP o con la HUELLA del
// passkey ya registrado. El panel pide "algo que solo sabe quien está delante":
// esto no lo debilita: cambia el factor por otro igual de fuerte.
//
// Reglas que no se tocan:
//  · sigue haciendo falta una SESIÓN válida (usuario y clave, Google o passkey),
//    la huella solo sustituye al segundo factor;
//  · solo passkeys del PROPIO usuario, y la firma se verifica igual que al
//    iniciar sesión;
//  · el grant que se concede es el mismo de 1 hora que da el TOTP.

const ADMIN_ROLE_RANK: Record<string, number> = {
  customer: 10, 'role-customer': 10,
  stock_manager: 20, 'role-stock_manager': 20, 'role-stock-manager': 20,
  admin: 30, 'role-admin': 30,
  owner: 40, 'role-owner': 40,
};

async function sessionUser(context: any): Promise<{ id: string; role_id: string } | null> {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const row = await context.env.DB.prepare(
    `SELECT s.user_id AS id, u.role_id AS role_id FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(authHeader.slice(7)).first() as { id: string; role_id: string } | null;
  return row;
}

passkeyRoutes.post('/passkey/stepup/options', async (context) => {
  if (!originOk(context.req.header('Origin'))) return context.json({ error: 'FORBIDDEN', message: 'Origin no permitido' }, 403);
  const session = await sessionUser(context);
  if (!session) return context.json({ error: 'UNAUTHORIZED' }, 401);
  // Solo quien puede entrar al panel puede usar la huella para entrar en él.
  if ((ADMIN_ROLE_RANK[session.role_id] || 0) < ADMIN_ROLE_RANK['stock_manager']) {
    return context.json({ error: 'FORBIDDEN', message: 'Solo para el panel de administración' }, 403);
  }

  const keys = await context.env.DB.prepare(
    'SELECT credential_id FROM passkeys WHERE user_id = ?'
  ).bind(session.id).all();
  const credentials = keys.results as Array<{ credential_id: string }>;
  if (credentials.length === 0) {
    return context.json({ error: 'NO_PASSKEY', message: 'No tienes ningún passkey registrado' }, 404);
  }

  const challenge = randomToken();
  await context.env.DB.prepare(
    'INSERT INTO webauthn_challenges (challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(challenge, session.id, 'login', Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC).run();

  return context.json({
    data: {
      challenge,
      rpId: RP_ID,
      timeout: CHALLENGE_TTL_SEC * 1000,
      userVerification: 'preferred',
      // allowCredentials con las SUyas: aquí no vale el passkey de otro usuario.
      allowCredentials: credentials.map((c) => ({ id: c.credential_id, type: 'public-key' })),
    },
  });
});

passkeyRoutes.post('/passkey/stepup/verify', async (context) => {
  if (!originOk(context.req.header('Origin'))) return context.json({ error: 'FORBIDDEN', message: 'Origin no permitido' }, 403);
  const ip = getClientIp(context.req);
  if (!(await checkRateLimit(context.env, `pkStepup:${ip}`, 20, 900, ip))) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED' }, 429);
  }
  const session = await sessionUser(context);
  if (!session) return context.json({ error: 'UNAUTHORIZED' }, 401);

  const body = await context.req.json().catch(() => null);
  const parsed = z.object({
    challenge: z.string().min(10),
    credentialId: z.string().min(10),
    clientDataJSON: z.string().min(10),
    authenticatorData: z.string().min(10),
    signature: z.string().min(10),
    userHandle: z.string().nullish(),
  }).safeParse(body);
  if (!parsed.success) return context.json({ error: 'INVALID_INPUT' }, 400);

  const passkey = await context.env.DB.prepare(
    `SELECT id, user_id, public_key, alg, sign_count FROM passkeys
      WHERE credential_id = ? AND user_id = ?`
  ).bind(parsed.data.credentialId, session.id).first() as any;
  // La credencial TIENE que ser de este usuario: sin esta condición, el
  // passkey de otro usuario serviría como segundo factor.
  if (!passkey) return context.json({ error: 'INVALID_CREDENTIALS' }, 401);

  const consumed = await consumeChallenge(context.env, parsed.data.challenge, 'login');
  if (!consumed || consumed.userId !== session.id) return context.json({ error: 'INVALID_CHALLENGE' }, 400);

  try {
    const signCount = await verifyAssertion({
      credentialId: parsed.data.credentialId,
      storedPublicKey: passkey.public_key,
      storedAlg: passkey.alg,
      storedSignCount: passkey.sign_count,
      clientDataJSON: parsed.data.clientDataJSON,
      authenticatorData: parsed.data.authenticatorData,
      signature: parsed.data.signature,
      userHandle: parsed.data.userHandle ?? null,
      expectedUserId: toBase64Url(new TextEncoder().encode(passkey.user_id)),
      expectedChallenge: parsed.data.challenge,
      expectedOrigin: context.req.header('Origin') || '',
      expectedRpId: RP_ID,
      requireUserVerification: false,
    });

    await context.env.DB.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(signCount, passkey.id).run();

    // Mismo grant que concede el TOTP: 1 hora de acceso al panel.
    const now = Math.floor(Date.now() / 1000);
    await context.env.DB.prepare(
      `INSERT INTO admin_stepup (user_id, verified_at, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET verified_at = excluded.verified_at, expires_at = excluded.expires_at`
    ).bind(session.id, now, now + 3600).run();

    return context.json({ data: { granted: true, validFor: 3600, factor: 'passkey' } });
  } catch (err) {
    return context.json({ error: 'INVALID_CREDENTIALS', message: String((err as Error).message).slice(0, 160) }, 401);
  }
});

// GET /auth/passkey/devices - passkeys + dispositivos de confianza del usuario
passkeyRoutes.get('/passkey/devices', async (context) => {
  const userId = await requireSession(context);
  if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401);

  const passkeys = await context.env.DB.prepare(
    'SELECT id, credential_id, device_label, created_at, last_used_at, backed_up FROM passkeys WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  const devices = await context.env.DB.prepare(
    'SELECT id, device_label, created_at, last_used_at, expires_at, ip FROM trusted_devices WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  return context.json({ data: { passkeys: passkeys.results, devices: devices.results } });
});

// DELETE /auth/passkey/:id - revocar un passkey
passkeyRoutes.delete('/passkey/:id', async (context) => {
  const userId = await requireSession(context);
  if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401);
  const res = await context.env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?')
    .bind(context.req.param('id'), userId).run();
  return context.json({ data: { deleted: (res.meta as any)?.changes > 0 } });
});

// DELETE /auth/trusted-device/:id - revocar un dispositivo de confianza
passkeyRoutes.delete('/trusted-device/:id', async (context) => {
  const userId = await requireSession(context);
  if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401);
  const res = await context.env.DB.prepare('DELETE FROM trusted_devices WHERE id = ? AND user_id = ?')
    .bind(context.req.param('id'), userId).run();
  return context.json({ data: { deleted: (res.meta as any)?.changes > 0 } });
});

// GET /auth/passkey/status - ¿hay passkey y hay dispositivo de confianza?
passkeyRoutes.get('/passkey/status', async (context) => {
  const userId = await requireSession(context);
  if (!userId) return context.json({ data: { passkeys: 0, trusted: false } });
  const pk = await context.env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(userId).first() as any;
  const token = cookieValue(context, TRUSTED_COOKIE);
  let trusted = false;
  if (token) {
    const hash = await sha256Hex(token);
    const row = await context.env.DB.prepare(
      `SELECT id FROM trusted_devices
        WHERE token_hash = ? AND user_id = ? AND expires_at > strftime('%s', 'now')`
    ).bind(hash, userId).first();
    trusted = !!row;
  }
  return context.json({ data: { passkeys: pk?.n || 0, trusted } });
});