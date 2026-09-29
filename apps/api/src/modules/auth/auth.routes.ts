import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';
import { sendEmail } from '../../lib/email';
import { getClientIp } from '../../lib/request';

const loginSchema = z.object({
  email: z.string().optional(),
  username: z.string().optional(),
  password: z.string().min(1),
}).refine((data) => data.email || data.username, {
  message: 'Email or username is required',
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/, {
    message: 'Password must contain uppercase, lowercase, number and special character'
  }),
  username: z.string().min(3).max(50),
  display_name: z.string().min(1).max(100),
});

// Rate limiting storage (in-memory - use KV in production).
// Mapas separados por flujo: compartir uno solo bloqueaba login tras pedir OTPs.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const forgotAttempts = new Map<string, { count: number; resetAt: number }>();

function checkBucket(bucket: Map<string, { count: number; resetAt: number }>, ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const attempt = bucket.get(ip);

  if (!attempt || attempt.resetAt < now) {
    bucket.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (attempt.count >= max) {
    return false;
  }

  attempt.count++;
  return true;
}

function checkRateLimit(ip: string): boolean {
  return checkBucket(loginAttempts, ip, 5, 15 * 60 * 1000); // login: 5 / 15 min
}

function checkForgotRateLimit(ip: string): boolean {
  return checkBucket(forgotAttempts, ip, 3, 15 * 60 * 1000); // forgot: 3 / 15 min
}

const otpVerifyAttempts = new Map<string, { count: number; resetAt: number }>();
const twofaAttempts = new Map<string, { count: number; resetAt: number }>();

function checkOtpVerifyRateLimit(ip: string): boolean {
  return checkBucket(otpVerifyAttempts, ip, 20, 15 * 60 * 1000); // verify/reset: 20 / 15 min por IP (además del límite por email)
}

async function hashPassword(password: string, salt?: string): Promise<string> {
  const useSalt = salt || crypto.randomUUID().replace(/-/g, '');
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(useSalt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${useSalt}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt] = storedHash.split(':');
  const newHash = await hashPassword(password, salt);
  return newHash === storedHash;
}

function generateId(): string {
  return crypto.randomUUID();
}

function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// OTP for email verification (6 digits, 15-minute validity, D1-backed)
const OTP_TTL_SECONDS = 15 * 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

function generateOtpCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function otpEmailHtml(code: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #6366f1;">Verifica tu cuenta en SUPRIME</h1>
      <p>Usa este código para activar tu cuenta. Caduca en 15 minutos:</p>
      <div style="font-size: 2.5rem; font-weight: bold; letter-spacing: 0.5rem; text-align: center; background: #f4f4f8; border-radius: 12px; padding: 16px; margin: 16px 0;">${code}</div>
      <p>Si no creaste esta cuenta, puedes ignorar este correo.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #888; font-size: 12px;">SUPRIME - Tu tienda premium</p>
    </div>
  `;
}

// Crea (o reemplaza) el OTP para un email y lo envía. Respeta cooldown de reenvío.
async function issueOtp(env: Bindings, email: string): Promise<{ sent: boolean; cooldown: number }> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(
    'SELECT last_sent_at FROM email_otps WHERE email = ?'
  ).bind(email).first() as { last_sent_at: number } | null;

  if (existing && now - existing.last_sent_at < OTP_RESEND_COOLDOWN_SECONDS) {
    return { sent: false, cooldown: OTP_RESEND_COOLDOWN_SECONDS - (now - existing.last_sent_at) };
  }

  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  // Reenviar NO resetea attempts (evita eludir el lockout de 5 intentos
  // pidiendo códigos nuevos; solo un registro fresco empieza en 0).
  await env.DB.prepare(
    `INSERT INTO email_otps (email, code_hash, expires_at, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       last_sent_at = excluded.last_sent_at`
  ).bind(email, codeHash, now + OTP_TTL_SECONDS, now).run();

  const sent = await sendEmail(env, email, 'Tu código de verificación SUPRIME', otpEmailHtml(code));
  return { sent, cooldown: 0 };
}

import { verifyTOTP as verifyTotpLib, verifyTOTPWithCounter, generateTotpSecret } from '../../lib/totp';

// Acepta secretos nuevos (base32) y legacy (hex de 64 chars, tratados como UTF-8).
// Los legacy se validan con el algoritmo antiguo inline para no romper 2FA existentes.
function verifyTOTP(code: string, secret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  if (/^[A-Z2-7]+=*$/.test(secret)) {
    return verifyTotpLib(code, secret);
  }
  return verifyTotpLegacy(code, secret);
}

function verifyTotpLegacy(code: string, secret: string): boolean {
  const keyData = new TextEncoder().encode(secret);
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  for (let i = -1; i <= 1; i++) {
    const timeBuffer = new ArrayBuffer(8);
    const timeView = new DataView(timeBuffer);
    timeView.setUint32(4, timeStep + i, false);
    const hmacResult = hmacSyncLegacy(keyData, new Uint8Array(timeBuffer));
    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const binary = ((hmacResult[offset] & 0x7f) << 24) |
                   ((hmacResult[offset + 1] & 0xff) << 16) |
                   ((hmacResult[offset + 2] & 0xff) << 8) |
                   (hmacResult[offset + 3] & 0xff);
    if (String(binary % 1000000).padStart(6, '0') === code) return true;
  }
  return false;
}

function hmacSyncLegacy(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let keyBytes: Uint8Array = new Uint8Array(key);
  if (keyBytes.length > blockSize) {
    keyBytes = sha1Legacy(keyBytes);
  }
  if (keyBytes.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(keyBytes);
    keyBytes = padded;
  }
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = keyBytes[i] ^ 0x36;
    opad[i] = keyBytes[i] ^ 0x5c;
  }
  const inner = sha1Legacy(concatLegacy(ipad, message));
  return sha1Legacy(concatLegacy(opad, inner));
}

function sha1Legacy(data: Uint8Array): Uint8Array {
  // Implementación SHA-1 legacy (conservada para 2FA ya configurados)
  const msgLen = data.length;
  const bitLen = msgLen * 8;
  
  // Padding
  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  
  // Length in bits as 64-bit big-endian
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);
  
  // Initial hash values
  let h0 = 0x67452301;
  let h1 = 0xEFCDAB89;
  let h2 = 0x98BADCFE;
  let h3 = 0x10325476;
  let h4 = 0xC3D2E1F0;
  
  // Process each 64-byte block
  for (let offset = 0; offset < paddedLen; offset += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const val = w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16];
      w[i] = (val << 1) | (val >>> 31);
    }
    
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) {
        f = (b & c) | ((~b) & d);
        k = 0x5A827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }
      
      const temp = ((a << 5) | (a >>> 27)) + f + e + k + w[i];
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  
  const result = new Uint8Array(20);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, h0, false);
  resultView.setUint32(4, h1, false);
  resultView.setUint32(8, h2, false);
  resultView.setUint32(12, h3, false);
  resultView.setUint32(16, h4, false);
  return result;
}

function concatLegacy(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

export const authRoutes = new Hono<{ Bindings: Bindings }>();

// POST /auth/register
authRoutes.post('/register', async (context) => {
  const body = await context.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  const { email: rawEmail, password, username, display_name } = parsed.data;
  const email = rawEmail.trim().toLowerCase();

  const existing = await context.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? OR username = ?'
  ).bind(email, username).first();

  if (existing) {
    return context.json({ error: 'USER_ALREADY_EXISTS' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const userId = generateId();

  await context.env.DB.prepare(
    `INSERT INTO users (id, role_id, username, email, password_hash, display_name, email_verified)
     VALUES (?, 'role-customer', ?, ?, ?, ?, 0)`
  ).bind(userId, username, email, passwordHash, display_name).run();

  // Generar y enviar código OTP de 15 minutos (sin esto no hay acceso)
  const { sent } = await issueOtp(context.env, email);
  if (!sent) {
    console.warn(`OTP email for ${email} could not be sent by any provider`);
  }

  return context.json({
    data: { id: userId, email, username, display_name, verificationRequired: true, otpExpiresIn: OTP_TTL_SECONDS }
  }, 201);
});

// POST /auth/verify-otp - Validar código OTP y activar cuenta (con auto-login)
authRoutes.post('/verify-otp', async (context) => {
  const clientIp = getClientIp(context.req);
  if (!checkOtpVerifyRateLimit(clientIp)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados intentos. Intenta más tarde.' }, 429);
  }

  const body = await context.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';

  if (!email || !/^\d{6}$/.test(code)) {
    return context.json({ error: 'INVALID_INPUT', message: 'Email y código de 6 dígitos requeridos' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const record = await context.env.DB.prepare(
    'SELECT code_hash, expires_at, attempts FROM email_otps WHERE email = ?'
  ).bind(email).first() as { code_hash: string; expires_at: number; attempts: number } | null;

  if (!record) {
    return context.json({ error: 'OTP_NOT_FOUND', message: 'No hay código pendiente. Regístrate o pide uno nuevo.' }, 404);
  }

  if (record.expires_at < now) {
    await context.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
    return context.json({ error: 'OTP_EXPIRED', message: 'Código caducado (15 min). Pide uno nuevo.' }, 410);
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await context.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
    return context.json({ error: 'OTP_LOCKED', message: 'Demasiados intentos. Pide un código nuevo.' }, 429);
  }

  const codeHash = await sha256Hex(code);
  if (codeHash !== record.code_hash) {
    await context.env.DB.prepare(
      'UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?'
    ).bind(email).run();
    const remaining = OTP_MAX_ATTEMPTS - record.attempts - 1;
    return context.json({ error: 'OTP_INVALID', message: `Código incorrecto. Te quedan ${remaining} intentos.`, remaining }, 401);
  }

  // OTP válido: activar cuenta y limpiar
  await context.env.DB.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').bind(email).run();
  await context.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();

  const user = await context.env.DB.prepare(
    'SELECT id, username, email, display_name, role_id FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user) {
    return context.json({ error: 'USER_NOT_FOUND' }, 404);
  }

  // Auto-login tras verificar (7 días)
  const token = btoa(`${user.id}:${user.role_id}:${Date.now()}`);
  const expiresAt = now + 7 * 24 * 60 * 60;
  await context.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, user.id, expiresAt).run();

  return context.json({
    data: { user, session: { id: token, token, expires_at: expiresAt } },
  });
});

// POST /auth/resend-otp - Reenviar código OTP (cooldown 60s por email + bucket por IP).
// Respuesta genérica salvo cooldown: no revela si la cuenta existe ni su estado.
const resendAttempts = new Map<string, { count: number; resetAt: number }>();

authRoutes.post('/resend-otp', async (context) => {
  const clientIp = getClientIp(context.req);
  if (!checkBucket(resendAttempts, clientIp, 10, 15 * 60 * 1000)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados intentos. Intenta más tarde.' }, 429);
  }

  const body = await context.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email) {
    return context.json({ error: 'INVALID_INPUT', message: 'Email requerido' }, 400);
  }

  const user = await context.env.DB.prepare(
    'SELECT email_verified FROM users WHERE email = ?'
  ).bind(email).first() as { email_verified: number } | null;

  // Solo se reenvía a cuentas pendientes; la respuesta es idéntica en el resto
  // de casos para no enumerar cuentas (forgot-password ya hace lo mismo).
  if (user && !user.email_verified) {
    const { cooldown } = await issueOtp(context.env, email);
    if (cooldown > 0) {
      return context.json({ error: 'OTP_COOLDOWN', message: `Espera ${cooldown}s antes de pedir otro código`, retryAfter: cooldown }, 429);
    }
  }

  return context.json({ data: { sent: true, otpExpiresIn: OTP_TTL_SECONDS } });
});

// POST /auth/forgot-password - Enviar OTP para recuperar contraseña (respuesta genérica anti-enumeración)
authRoutes.post('/forgot-password', async (context) => {
  const clientIp = getClientIp(context.req);
  if (!checkForgotRateLimit(clientIp)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados intentos. Intenta más tarde.' }, 429);
  }

  const body = await context.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) {
    return context.json({ error: 'INVALID_INPUT', message: 'Email requerido' }, 400);
  }

  const user = await context.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND is_active = 1'
  ).bind(email).first();

  // Solo se envía si la cuenta existe; la respuesta es idéntica para no revelar cuentas
  if (user) {
    const { sent } = await issueOtp(context.env, email);
    if (!sent) console.warn(`Password-reset OTP for ${email} could not be sent`);
  }

  return context.json({ data: { sent: true, message: 'Si la cuenta existe, recibirás un código (15 min).' } });
});

// POST /auth/reset-password - Restablecer contraseña con OTP
authRoutes.post('/reset-password', async (context) => {
  const clientIp = getClientIp(context.req);
  if (!checkOtpVerifyRateLimit(clientIp)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados intentos. Intenta más tarde.' }, 429);
  }

  const body = await context.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!email || !/^\d{6}$/.test(code)) {
    return context.json({ error: 'INVALID_INPUT', message: 'Email y código de 6 dígitos requeridos' }, 400);
  }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/.test(newPassword)) {
    return context.json({ error: 'WEAK_PASSWORD', message: 'Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const record = await context.env.DB.prepare(
    'SELECT code_hash, expires_at, attempts FROM email_otps WHERE email = ?'
  ).bind(email).first() as { code_hash: string; expires_at: number; attempts: number } | null;

  if (!record) {
    return context.json({ error: 'OTP_NOT_FOUND', message: 'No hay código pendiente. Pide uno nuevo.' }, 404);
  }
  if (record.expires_at < now) {
    await context.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
    return context.json({ error: 'OTP_EXPIRED', message: 'Código caducado (15 min). Pide uno nuevo.' }, 410);
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await context.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
    return context.json({ error: 'OTP_LOCKED', message: 'Demasiados intentos. Pide un código nuevo.' }, 429);
  }

  const codeHash = await sha256Hex(code);
  if (codeHash !== record.code_hash) {
    await context.env.DB.prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    return context.json({ error: 'OTP_INVALID', message: 'Código incorrecto.' }, 401);
  }

  const passwordHash = await hashPassword(newPassword);
  await context.env.DB.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind(passwordHash, email).run();
  await context.env.DB.prepare('DELETE FROM email_otps WHERE email = ?').bind(email).run();
  // Cerrar sesiones activas por seguridad tras el cambio
  const target = await context.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first() as { id: string } | null;
  if (target) {
    await context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  }

  return context.json({ data: { reset: true } });
});

// POST /auth/login
authRoutes.post('/login', async (context) => {
  // Rate limiting check
  const clientIp = getClientIp(context.req);
  if (!checkRateLimit(clientIp)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts. Please try again later.' }, 429);
  }

  const arrayBuffer = await context.req.arrayBuffer().catch(() => null);
  const body = arrayBuffer ? new TextDecoder().decode(arrayBuffer) : null;
  let parsedBody: unknown = null;
  try {
    parsedBody = body ? JSON.parse(body) : null;
  } catch {
    parsedBody = null;
  }
  const parsed = loginSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  const { email, username, password } = parsed.data;

  const user = await context.env.DB.prepare(
    `SELECT id, username, email, display_name, role_id, password_hash, email_verified, google_subject FROM users
     WHERE (email = ? OR username = ?) AND is_active = 1`
  ).bind(email || '', username || '').first() as {
    id: string; username: string; email: string; display_name: string;
    role_id: string; password_hash: string | null; email_verified: number; google_subject: string | null;
  } | null;

  // Sin password (cuenta solo-Google) -> 401, nunca 500
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return context.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  // Check if email is verified (only for non-Google users)
  if (!user.email_verified && !user.google_subject) {
    return context.json({ error: 'EMAIL_NOT_VERIFIED', message: 'Debes verificar tu correo electrónico antes de iniciar sesión' }, 403);
  }

  // NOTA: el 2FA no se pide aquí. El panel admin exige step-up propio
  // (POST /auth/admin-stepup, válido 1 hora) en su middleware.

  const rememberMe = (parsedBody as Record<string, unknown> | null)?.rememberMe === true;
  // Token format: base64(userId:role:timestamp) - usado como Bearer Y como id de sesión en DB.
  // (Antes se guardaba sessionId UUID pero el front enviaba el token -> /auth/me siempre 401.)
  const tokenData = `${user.id}:${user.role_id}:${Date.now()}`;
  const token = btoa(tokenData);
  // 30 days if rememberMe, 7 days otherwise
  const sessionDurationDays = rememberMe ? 30 : 7;
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationDays * 24 * 60 * 60;

  await context.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, user.id, expiresAt).run();

  // Set HttpOnly cookie with session token
  context.header('Set-Cookie', `session_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${sessionDurationDays * 24 * 60 * 60}`);

  return context.json({
    data: {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        role_id: user.role_id,
      },
      session: { id: token, token, expires_at: expiresAt },
    },
  });

});

// POST /auth/admin-stepup - Verificar 2FA para entrar al admin (concesión de 1 hora)
// Requiere sesión Bearer válida. El middleware admin la exige en cada request.
authRoutes.post('/admin-stepup', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const clientIp = getClientIp(context.req);
  if (!checkBucket(twofaAttempts, clientIp, 10, 15 * 60 * 1000)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados intentos. Intenta más tarde.' }, 429);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT s.user_id, u.role_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(token).first() as { user_id: string; role_id: string } | null;

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  const adminRoles = ['role-admin', 'role-owner', 'role-stock-manager'];
  if (!adminRoles.includes(session.role_id)) {
    return context.json({ error: 'FORBIDDEN', message: 'Admin access required' }, 403);
  }

  const body = await context.req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return context.json({ error: 'INVALID_INPUT', message: 'Código de 6 dígitos requerido' }, 400);
  }

  const totpRecord = await context.env.DB.prepare(
    'SELECT secret, last_counter FROM user_totp WHERE user_id = ? AND enabled = 1'
  ).bind(session.user_id).first() as { secret: string; last_counter: number } | null;

  if (!totpRecord) {
    return context.json({ error: 'INVALID_TOTP_CODE', message: 'Código incorrecto. Revisa la hora de tu teléfono y usa el código actual.' }, 401);
  }

  // Anti-replay: rechazar códigos de ventanas ya usadas
  const check = verifyTOTPWithCounter(code, totpRecord.secret as string);
  if (!check.ok || check.counter <= (totpRecord.last_counter ?? -1)) {
    return context.json({ error: 'INVALID_TOTP_CODE', message: 'Código incorrecto o ya usado. Usa el código actual.' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE user_totp SET last_counter = ? WHERE user_id = ?').bind(check.counter, session.user_id),
    context.env.DB.prepare(
      `INSERT INTO admin_stepup (user_id, verified_at, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET verified_at = excluded.verified_at, expires_at = excluded.expires_at`
    ).bind(session.user_id, now, now + 3600),
  ]);

  return context.json({ data: { granted: true, validFor: 3600 } });
});

// POST /auth/logout
authRoutes.post('/logout', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT id FROM sessions WHERE id = ?`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  await context.env.DB.prepare(
    'DELETE FROM sessions WHERE id = ?'
  ).bind(token).run();

  // Clear the session cookie
  context.header('Set-Cookie', 'session_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');

  return context.json({ data: { logged_out: true } });
});

// GET /auth/me
authRoutes.get('/me', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT s.id, s.expires_at, u.id as user_id, u.username, u.email, u.display_name, u.role_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  // Load shipping data
  const shipping = await context.env.DB.prepare(
    `SELECT full_name, phone, address, city, postal_code, country FROM user_shipping WHERE user_id = ?`
  ).bind(session.user_id).first();

  return context.json({
    data: {
      id: session.user_id,
      username: session.username,
      email: session.email,
      display_name: session.display_name,
      role_id: session.role_id,
      shipping: shipping ? {
        full_name: shipping.full_name,
        phone: shipping.phone,
        address: shipping.address,
        city: shipping.city,
        postal_code: shipping.postal_code,
        country: shipping.country,
      } : null,
    },
  });
});

// POST /auth/me/totp/setup - Generate TOTP secret for 2FA
authRoutes.post('/me/totp/setup', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ?`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  // Si ya hay 2FA activo, regenerar el secreto exige step-up vigente
  // (evita que una sesión robada tome el 2FA). Bootstrap libre.
  const current = await context.env.DB.prepare(
    'SELECT enabled FROM user_totp WHERE user_id = ?'
  ).bind(session.user_id).first() as { enabled: number } | null;

  if (current?.enabled === 1) {
    const grant = await context.env.DB.prepare(
      'SELECT expires_at FROM admin_stepup WHERE user_id = ?'
    ).bind(session.user_id).first() as { expires_at: number } | null;
    if (!grant || grant.expires_at <= Math.floor(Date.now() / 1000)) {
      return context.json({ error: 'ADMIN_2FA_REQUIRED', message: 'Verificación en dos pasos requerida para cambiar el secreto' }, 403);
    }
  }

  // Generate TOTP secret (32 bytes hex = 64 chars)
  // Secreto base32 de 160 bits (estándar otpauth, compatible con Authenticator/Authy)
  const secret = generateTotpSecret();

  // Store secret temporarily (not enabled until verified)
  await context.env.DB.prepare(
    `INSERT INTO user_totp (user_id, secret, enabled, created_at)
     VALUES (?, ?, 0, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       secret = excluded.secret,
       enabled = 0,
       created_at = datetime('now')`
  ).bind(session.user_id, secret).run();

  // Generate otpauth URI for QR code
  const user = await context.env.DB.prepare(
    'SELECT email FROM users WHERE id = ?'
  ).bind(session.user_id).first();

  const otpauthUri = `otpauth://totp/SUPRIME:${user?.email}?secret=${secret}&issuer=SUPRIME&period=30&digits=6`;

  return context.json({
    data: {
      secret,
      otpauth_uri: otpauthUri,
    },
  });
});

// POST /auth/me/totp/verify - Verify and enable TOTP
authRoutes.post('/me/totp/verify', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ?`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  const body = await context.req.json().catch(() => null);
  if (!body?.code) {
    return context.json({ error: 'INVALID_INPUT' }, 400);
  }

  const totpRecord = await context.env.DB.prepare(
    'SELECT secret FROM user_totp WHERE user_id = ? AND enabled = 0'
  ).bind(session.user_id).first();

  if (!totpRecord) {
    return context.json({ error: 'NO_TOTP_SETUP' }, 400);
  }

  // Verify TOTP code (con anti-replay)
  const enableCheck = verifyTOTPWithCounter(body.code as string, totpRecord.secret as string);
  if (!enableCheck.ok) {
    return context.json({ error: 'INVALID_TOTP_CODE' }, 401);
  }

  // Enable TOTP
  await context.env.DB.prepare(
    'UPDATE user_totp SET enabled = 1, last_counter = ? WHERE user_id = ?'
  ).bind(enableCheck.counter, session.user_id).run();

  // Al activar, conceder step-up inmediato (1h) para no pedir el código dos veces
  const nowStep = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(
    `INSERT INTO admin_stepup (user_id, verified_at, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET verified_at = excluded.verified_at, expires_at = excluded.expires_at`
  ).bind(session.user_id, nowStep, nowStep + 3600).run();

  return context.json({ data: { enabled: true } });
});

// POST /auth/me/totp/disable - Disable TOTP (exige step-up si había 2FA activo)
authRoutes.post('/me/totp/disable', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ?`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  const enrolled = await context.env.DB.prepare(
    'SELECT enabled FROM user_totp WHERE user_id = ?'
  ).bind(session.user_id).first() as { enabled: number } | null;

  if (enrolled?.enabled === 1) {
    const grant = await context.env.DB.prepare(
      'SELECT expires_at FROM admin_stepup WHERE user_id = ?'
    ).bind(session.user_id).first() as { expires_at: number } | null;
    if (!grant || grant.expires_at <= Math.floor(Date.now() / 1000)) {
      return context.json({ error: 'ADMIN_2FA_REQUIRED', message: 'Verificación en dos pasos requerida para desactivar 2FA' }, 403);
    }
  }

  await context.env.DB.prepare(
    'DELETE FROM user_totp WHERE user_id = ?'
  ).bind(session.user_id).run();

  return context.json({ data: { disabled: true } });
});

// GET /auth/me/totp/status - Check TOTP status
authRoutes.get('/me/totp/status', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ?`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  const totpRecord = await context.env.DB.prepare(
    'SELECT enabled FROM user_totp WHERE user_id = ?'
  ).bind(session.user_id).first();

  return context.json({
    data: {
      enabled: totpRecord?.enabled === 1,
    },
  });
});

// PUT /auth/me/shipping
authRoutes.put('/me/shipping', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ?`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  const body = await context.req.json().catch(() => null);
  if (!body) {
    return context.json({ error: 'INVALID_INPUT' }, 400);
  }

  const { full_name, phone, address, city, postal_code, country } = body;

  await context.env.DB.prepare(
    `INSERT INTO user_shipping (user_id, full_name, phone, address, city, postal_code, country, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       full_name = excluded.full_name,
       phone = excluded.phone,
       address = excluded.address,
       city = excluded.city,
       postal_code = excluded.postal_code,
       country = excluded.country,
       updated_at = datetime('now')`
  ).bind(session.user_id, full_name || '', phone || '', address || '', city || '', postal_code || '', country || 'España').run();

  return context.json({ data: { saved: true } });
});
