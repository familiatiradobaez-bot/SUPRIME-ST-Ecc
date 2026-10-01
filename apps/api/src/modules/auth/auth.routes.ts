import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';
import { sendEmail } from '../../lib/email';
import { getClientIp } from '../../lib/request';
import { isSafetyLockOn } from '../../lib/pricing';
import { checkRateLimit, peekRateLimit, clearRateLimit, debeBloquearYAvisar, exentaYLimpia } from '../../lib/rate-limit';
import { cifrarSecreto, descifrarSecreto, estaCifrado } from '../../lib/secrets-box';

// Teléfono: 9-15 dígitos (se ignoran espacios, puntos, guiones y paréntesis).
// Sin SMS de momento: valida formato, no titularidad (ver post-lanzamiento).
function normalizePhone(input: string): string {
  return input.replace(/[\s.\-()]/g, '');
}

const phoneSchema = z.string().min(1).max(20).refine((v) => {
  const n = normalizePhone(v);
  return /^\+?[0-9]{9,15}$/.test(n);
}, { message: 'Invalid phone number (9-15 digits)' });

const postalSchema = z.string().min(1).max(10).refine((v) => {
  const t = v.trim();
  return /^\d{5}$/.test(t);
}, { message: 'Invalid postal code (5 digits)' });

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
  // Aceptación explícita de Términos y Privacidad (RGPD). Sin esto no hay registro.
  terms: z.literal(true, { message: 'Terms must be accepted' }),
});

// Rate limiting: KV (RATE_LIMIT_KV) con fallback en memoria.
// Antes eran Maps en memoria por flujo, y en Workers cada isolate tiene la
// suya: 5 intentos de login no eran 5 intentos, eran 5 por isolate, y un
// atacante podía repartir los repartos. Ahora la cuenta es global.
// Un cubo por flujo (scope): compartir uno bloqueaba el login tras pedir OTPs.
const RL = {
  // Login cuenta FALLOS, y en dos cubos:
  //  - por IP: frena el barrido automatizado (muchas cuentas desde una).
  //  - por cuenta: frena el ataque a una cuenta concreta desde IPs distintas,
  //    que es el caso que el cubo por IP no ve.
  // Antes un solo cubo por IP de 5/15 min contaba también los ACIERTOS: con
  // el smoke y la suite E2E.login saliéndose los dos, se bloqueaban entre
  // ellos y en 15 minutos no se podía ni entrar con la clave correcta.
  loginIp: { max: 30, window: 900 },
  loginAccount: { max: 5, window: 900 },
  forgot: { max: 3, window: 900 },
  otpVerify: { max: 20, window: 900 },
  otpResend: { max: 10, window: 900 },
  // El step-up es una acción legítima y frecuente (el botón "Bloquear panel"
  // revalida en cada bloqueo). Con la ventana ±1 del TOTP solo hay 3 códigos
  // válidos por paso de 30 s, así que 30 intentos en 15 min no alcanzan a
  // fuerza bruta sobre 6 dígitos —el anti-replay y la ventana ya cortan el
  // ataque— y en cambio 10 bloqueaba a un admin que abre y cierra el panel
  // varias veces, que es justo el uso normal.
  twofa: { max: 30, window: 900 },
  register: { max: 5, window: 900 },
} as const;

type RLScope = keyof typeof RL;

/**
 * La IP se propaga al limite porque es lo que decide el bypass del owner: la
 * clave del cubo puede no llevarla (loginAccount usa el hash del email), y sin
 * ella el bypass no se reconoceria en ese scope.
 */
function rlAllowed(env: Bindings, scope: RLScope, subject: string, ip?: string): Promise<boolean> {
  const { max, window } = RL[scope];
  return checkRateLimit(env, `${scope}:${subject}`, max, window, ip);
}

/**
 * ¿Está ya agotado alguno de los dos cubos de login? Solo MIRA: el intento se
 * consume cuando se sabe que falló (consumeLoginFailure), para que entrar con
 * la clave correcta no gastara ninguno de los dos topes.
 */
async function loginBlocked(env: Bindings, ip: string, accountKey: string): Promise<boolean> {
  // El bypass se consulta AQUÍ y no solo en checkRateLimit. Este es el camino que
  // DECIDE el 429 del login (con peekRateLimit, que solo mira sin contar), así que
  // si el bypass no se comprobara aquí, un cubo ya lleno seguiría bloqueando
  // aunque la IP estuviera exenta. Ese era el fallo real que se encontró probando
  // en producción: el bypass estaba solo en el camino que consume, no en el que
  // bloquea.
  //
  // exentaYLimpia además borra los cubos de esta IP: sin eso, activar el bypass
  // no serviría justo en el caso para el que se activa, que es cuando ya te has
  // quedado topado.
  if (await exentaYLimpia(env, ip, ['loginIp:'])) return false;

  const byIp = await peekRateLimit(env, `loginIp:${ip}`, RL.loginIp.max);
  if (byIp && byIp.remaining <= 0) return true;
  if (accountKey) {
    const byAccount = await peekRateLimit(env, `loginAccount:${accountKey}`, RL.loginAccount.max);
    if (byAccount && byAccount.remaining <= 0) return true;
  }
  return false;
}

/** Suma un intento fallido a los dos cubos. */
async function consumeLoginFailure(env: Bindings, ip: string, accountKey: string): Promise<void> {
  await rlAllowed(env, 'loginIp', ip, ip);
  if (accountKey) await rlAllowed(env, 'loginAccount', accountKey, ip);
}

// ── Contraseñas ────────────────────────────────────────────────────────────
//
// PBKDF2-HMAC-SHA256 con salt por usuario. El formato del hash lleva el número
// de iteraciones dentro, para poder subirlos sin invalidar las cuentas que ya
// existen:
//
//   pbkdf2-sha256$<iteraciones>$<salt>$<hash>
//
// El formato ANTERIOR era solo "<salt>:<hash>" y usaba 100.000 iteraciones.
// verifyPassword sigue aceptándolo y devuelve `necesitaRehash: true` para que
// el login lo reescriba con el numero actual. Ese rehash al iniciar sesión es lo
// que permite subir a 600.000 sin dejar fuera a nadie: cada usuario queda
// migrado la primera vez que entra.
//
// Por que 600.000: la guia de OWASP para PBKDF2-HMAC-SHA256 pide 600.000. Con
// 100.000 no estaba roto, pero una contraseña robada de una copia antigua se
// craquea bastante mas rapido. Notar que PBKDF2 es intencionadamente lento: por
// eso el numero va DENTRO del hash y no en el codigo, para que subirlo no rompa
// cuentas.
// Por que 100.000 y no los 600.000 que recomienda OWASP, y por que NO es
// un capricho. Medido contra produccion: la implementacion de Web Crypto de
// Cloudflare Workers RECHAZA mas de 100.000 iteraciones, con este error y sin
// dejar configurarlo de otra manera:
//
//   NotSupportedError: Pbkdf2 failed: iteration counts above 100000
//   are not supported (requested 600000).
//
// No es el limite de CPU: la peticion gastaba 14 ms de CPU y lo que falla es la
// propia funcion. Ningun plan lo cambia. Es un tope de la plataforma.
//
// Que pasara si se sube por encima: el registro de usuarios responde 500
// (ocurre justo al hashear) y NADIE PUEDE CREAR UNA CUENTA. Medido.
//
// Por eso el numero va DENTRO del hash y el rehash al iniciar sesion. Asi, si
// algun dia se cambia de plataforma o se mete argon2id en WASM, se sube el
// numero aqui y las cuentas existentes se migran solas al entrar, sin dejar
// fuera a nadie.
//
// ADVERTENCIA: no subir ITERACIONES por encima de 100.000 en este Worker sin
// verificar antes que la plataforma lo acepta. Rompe el registro.
/** Iteraciones actuales. Tope de la plataforma: ver la nota de arriba. */
const ITERACIONES = 100_000;
/** Iteraciones con las que se skipearon las cuentas existentes (mismo valor). */
const ITERACIONES_ANTES = 100_000;

/** Deriva el hash en hexadecimal. Es el nucleo, sin formato alrededor. */
async function derivar(password: string, salt: string, iterations: number): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const buf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, salt?: string, iterations: number = ITERACIONES): Promise<string> {
  const useSalt = salt || crypto.randomUUID().replace(/-/g, '');
  const hex = await derivar(password, useSalt, iterations);
  return `pbkdf2-sha256$${iterations}$${useSalt}$${hex}`;
}

type Verificacion = { ok: boolean; necesitaRehash: boolean };

/**
 * Compara contra el hash guardado y dice si hay que rehashear.
 *
 * Se compara SIEMPRE sobre el hexadecimal derivado, nunca sobre la cadena
 * completa: si se comparara la cadena y el formato hubiera cambiado, el
 * resultado seria "no coincide" para todos y nadie podria entrar. Eso ya paso
 * una vez al subir esto (login 401 en todo el smoke) y por eso derivar() esta
 * separado de hashPassword().
 */
async function verifyPassword(password: string, storedHash: string): Promise<Verificacion> {
  if (storedHash.startsWith('pbkdf2-sha256$')) {
    const [, iterStr, salt, esperado] = storedHash.split('$');
    const iterations = Number(iterStr) || ITERACIONES;
    const hex = await derivar(password, salt, iterations);
    return { ok: hex === esperado, necesitaRehash: iterations < ITERACIONES };
  }
  // Formato antiguo "<salt>:<hashHex>" con 100.000 iteraciones. El salt es un
  // UUID sin guiones, asi que no contiene ':' y el corte es seguro.
  const [salt, esperadoHex] = storedHash.split(':');
  if (!salt || !esperadoHex) return { ok: false, necesitaRehash: false };
  const hex = await derivar(password, salt, ITERACIONES_ANTES);
  const ok = hex === esperadoHex;
  return { ok, necesitaRehash: ok };
}

function generateId(): string {
  return crypto.randomUUID();
}

function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/*
 * COMO ES EL TOKEN DE SESION, Y POR QUE SE GENERA ASI
 *
 * El token NO es un JWT: no lleva cabecera, ni payload, ni firma. Tampoco va
 * cifrado. Es una cadena aleatoria de 32 bytes (256 bits) en hexadecimal, que se
 * guarda tal cual en `sessions.id` y se usa como Bearer.
 *
 * Antes era `btoa(user_id + ":" + role_id + ":" + Date.now())`, y eso era un
 * fallo de dos formas:
 *
 *  1. NO TENIA ENTROPIA. Salia por completo de tres datos que el atacante puede
 *     conocer: el id de usuario (un UUID que la propia API devuelve en la
 *     respuesta del login), el rol (una de las pocas cadenas conocidas, tipo
 *     "role-stock-manager") y el instante del login. Solo falta acertar el
 *     instante, y Date.now() va en milisegundos: si se sabe que el login fue en
 *     la ultima hora, son 3.600.000 candidatos. No hay rate-limit en la
 *     validacion de sesion, asi que se pueden probar, y la sesion vive hasta 30
 *     dias si el usuario marco "recuerdame". Medido sobre un token real: 92
 *     caracteres que se decodifican a
 *     "c05dad1f-...:role-stock-manager:1790797986759".
 *
 *  2. NO ERA SEGRETO. Base64 es codificacion, no cifrado: cualquiera con el
 *     token ve el id de usuario, su rol y la hora de login.
 *
 * Lo que SUSTITUYE a eso: la sesion sigue siendo del lado del servidor (el token
 * se busca en `sessions` y se comprueba `expires_at > now`), asi que un token
 * inventado no vale por si solo. Lo que cambia es que ya no es adivinable, que
 * es justo lo que un token de sesion tiene que ser.
 *
 * Esta funcion ya existia en el fichero y NO se usaba en ningun sitio: los cuatro
 * puntos que creaban token hacian el btoa a mano. Verificado que nada decodifica
 * el token (nadie hace atob ni split(':')), asi que cambiar el formato no rompe
 * nada. Las sesiones ya abiertas siguen validas hasta que caducan.
 */

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

/**
 * Si el secreto TOTP de este usuario todavia esta en claro, lo reescribe
 * cifrado. Se llama solo DESPUES de verificar un codigo con exito, o sea que si
 * algo falla al cifrar no se rompe el 2FA de nadie: se traga el error y sigue.
 */
async function migrarSecretoSiHaceFalta(
  env: Bindings,
  userId: string,
  secretEnColumna: string,
  secretoClaro: string,
): Promise<void> {
  if (estaCifrado(secretEnColumna)) return;
  try {
    const cifrado = await cifrarSecreto(secretoClaro, env.TOTP_ENCRYPTION_KEY);
    await env.DB.prepare('UPDATE user_totp SET secret = ? WHERE user_id = ?').bind(cifrado, userId).run();
  } catch {
    // Sin clave, o lo que sea. No es motivo para tumbar el login: el secreto
    // sigue funcionando en claro y se reintentara en el proximo uso.
  }
}

export const authRoutes = new Hono<{ Bindings: Bindings }>();

// POST /auth/register
authRoutes.post('/register', async (context) => {
  // El registro manda correo (verificación) y crea filas: sin tope, un
  // Disposable-email puede usarla para spamear la bandeja de otra gente.
  if (!(await rlAllowed(context.env, 'register', getClientIp(context.req), getClientIp(context.req)))) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Demasiados intentos. Intenta más tarde.' }, 429);
  }

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
    `INSERT INTO users (id, role_id, username, email, password_hash, display_name, email_verified, terms_accepted_at)
     VALUES (?, 'role-customer', ?, ?, ?, ?, 0, ?)`
  ).bind(userId, username, email, passwordHash, display_name, Math.floor(Date.now() / 1000)).run();

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
  if (!(await rlAllowed(context.env, 'otpVerify', clientIp, clientIp))) {
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
  const token = generateSessionToken();
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
authRoutes.post('/resend-otp', async (context) => {
  const clientIp = getClientIp(context.req);
  if (!(await rlAllowed(context.env, 'otpResend', clientIp, clientIp))) {
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
  if (!(await rlAllowed(context.env, 'forgot', clientIp, clientIp))) {
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
  if (!(await rlAllowed(context.env, 'otpVerify', clientIp, clientIp))) {
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
  const clientIp = getClientIp(context.req);

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
  // Clave de los cubos de fallo. Se normaliza a minúsculas para que
  // "Jose@x.com" y "jose@x.com" compartan cubo (y no eludan el tope).
  const accountKey = (email || username || '').trim().toLowerCase();

  // Dos topes, los dos con cuenta de FALLOS:
  //  - por IP: corta el barrido con muchas cuentas desde una misma máquina.
  //  - por cuenta: corta el ataque a una cuenta desde IPs distintas, que es
  //    justo lo que el cubo por IP no ve.
  // Se Mira antes de tocar la contraseña, así el 429 no filtra si la cuenta
  // existe (mismo criterio que el resto de la ruta).
  if (await loginBlocked(context.env, clientIp, accountKey)) {
    // Aqui es donde mas duele toparse (login es lo que se repite al trabajar), y
    // el aviso con boton de aprobacion tiene sentido justo en este punto. Se
    // llama AUNQUE el cubo ya este bloqueado: la funcion decide si de verdad hay
    // que bloquear, y avisa una sola vez por IP cada 5 min. Si hay un grant
    // aprobado, devuelve false y el login sigue.
    const bloqueado = await debeBloquearYAvisar(context.env, clientIp, 'login');
    if (bloqueado) {
      return context.json(
        { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts. Please try again later.' },
        429,
        { 'X-RateLimit-Blocked': 'login', 'X-RateLimit-Hint': 'approve-in-telegram' },
      );
    }
  }

  const user = await context.env.DB.prepare(
    `SELECT id, username, email, display_name, role_id, password_hash, email_verified, google_subject FROM users
     WHERE (email = ? OR username = ?) AND is_active = 1`
  ).bind(email || '', username || '').first() as {
    id: string; username: string; email: string; display_name: string;
    role_id: string; password_hash: string | null; email_verified: number; google_subject: string | null;
  } | null;

  // Sin password (cuenta solo-Google) -> 401, nunca 500
  if (!user || !user.password_hash) {
    await consumeLoginFailure(context.env, clientIp, accountKey);
    return context.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  const verif = await verifyPassword(password, user.password_hash);
  if (!verif.ok) {
    // Fallo: se consumen los dos contadores. Un atacante con una lista de
    // correos agota el de la cuenta objetivo; uno con una lista de claves
    // desde una IP agota el de la IP.
    await consumeLoginFailure(context.env, clientIp, accountKey);
    return context.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  // Rehash al iniciar sesión: si la contraseña venía del formato antiguo o con
  // menos iteraciones, se reescribe con las actuales. Es lo que permite haber
  // subido de 100.000 a 600.000 sin dejar fuera a nadie: cada cuenta queda
  // migrada la primera vez que su dueño entra. Si falla, no se tumba el login.
  if (verif.necesitaRehash) {
    try {
      const nuevo = await hashPassword(password);
      await context.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(nuevo, user.id).run();
    } catch {
      // El login sigue siendo válido; solo no se ha migrado el hash.
    }
  }

  // Acierto: el cubo de la cuenta se vacía. Tres tecleos y luego entrar bien
  // no debe dejar a la persona con 2 de 5 gastados para siempre, y el de la
  // IP se conserva (mide el ritmo, no el acierto).
  if (accountKey) await clearRateLimit(context.env, `loginAccount:${accountKey}`);

  // Check if email is verified (only for non-Google users)
  if (!user.email_verified && !user.google_subject) {
    return context.json({ error: 'EMAIL_NOT_VERIFIED', message: 'Debes verificar tu correo electrónico antes de iniciar sesión' }, 403);
  }

  // NOTA: el 2FA no se pide aquí. El panel admin exige step-up propio
  // (POST /auth/admin-stepup, válido 1 hora) en su middleware.

  const rememberMe = (parsedBody as Record<string, unknown> | null)?.rememberMe === true;
  // El token va como Bearer Y es la clave de la fila en sessions. Antes se
  // guardaba un sessionId distinto del token y el front mandaba el token, con
  // lo que /auth/me daba 401 siempre: tienen que ser la misma cosa.
  const token = generateSessionToken();
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
  if (!(await rlAllowed(context.env, 'twofa', clientIp, clientIp))) {
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

  // El secreto puede venir cifrado (formato enc1:...) o en claro si la cuenta
  // es anterior al cifrado. descifrarSecreto devuelve el texto tal cual cuando no
  // lleva prefijo, asi que ambos casos pasan por aqui igual.
  const totpRecord = await context.env.DB.prepare(
    'SELECT secret, last_counter FROM user_totp WHERE user_id = ? AND enabled = 1'
  ).bind(session.user_id).first() as { secret: string; last_counter: number } | null;

  if (!totpRecord) {
    return context.json({ error: 'INVALID_TOTP_CODE', message: 'Código incorrecto. Revisa la hora de tu teléfono y usa el código actual.' }, 401);
  }

  const totpSecret = await descifrarSecreto(totpRecord.secret, context.env.TOTP_ENCRYPTION_KEY);

  // Anti-replay: rechazar códigos de ventanas ya usadas
  const check = verifyTOTPWithCounter(code, totpSecret);
  if (!check.ok || check.counter <= (totpRecord.last_counter ?? -1)) {
    return context.json({ error: 'INVALID_TOTP_CODE', message: 'Código incorrecto o ya usado. Usa el código actual.' }, 401);
  }

  // Migración perezosa a cifrado: la primera vez que este usuario usa su 2FA con
  // éxito, su secreto deja de estar en claro. Nadie tiene que reconfigurar nada.
  await migrarSecretoSiHaceFalta(context.env, session.user_id, totpRecord.secret, totpSecret);

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

// POST /auth/admin-stepup/revoke - Tirar el grant de admin sin cerrar sesión.
// "Salir del panel" al cerrar sesión no era posible: el grant vivia 1 h en
// admin_stepup aunque la sesión ya no existiera, así que volver a entrar con
// la misma sesión (p. ej. otra pestaña, o un logout que no lo revocó) saltaba
// el 2FA. Aquí se puede bloquear el panel al instante, que es lo que espera
// quien lo deja abierto en un ordenador compartido.
authRoutes.post('/admin-stepup/revoke', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const session = await context.env.DB.prepare(
    `SELECT s.user_id FROM sessions s WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(authHeader.slice(7)).first() as { user_id: string } | null;

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  await context.env.DB.prepare('DELETE FROM admin_stepup WHERE user_id = ?').bind(session.user_id).run();

  return context.json({ data: { revoked: true } });
});

// POST /auth/logout
authRoutes.post('/logout', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT s.user_id FROM sessions s WHERE s.id = ?`
  ).bind(token).first() as { user_id: string } | null;

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  // Cerrar sesión también cierra el panel: sin grant, el 2FA se vuelve a pedir
  // al entrar. Si no, "salir" dejaba el admin abierto hasta una hora.
  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token),
    context.env.DB.prepare('DELETE FROM admin_stepup WHERE user_id = ?').bind(session.user_id),
  ]);

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
    // Modo seguro: con 2FA activo no se regenera (apágalo en Configuración si toca rotar)
    if (await isSafetyLockOn(context.env)) {
      return context.json({ error: 'SAFETY_LOCKED', message: 'Modo seguro activo: desactívalo en Configuración para regenerar el 2FA' }, 403);
    }
  }

  // Secreto base32 de 160 bits (estándar otpauth, compatible con Authenticator/Authy)
  const secret = generateTotpSecret();

  // Se guarda CIFRADO (ver lib/secrets-box.ts). Se devuelve en claro al cliente
  // porque lo necesita para el QR, pero en la base no puede quedar en texto
  // plano: quien se lleve D1 se llevaría la semilla del 2FA de todo el mundo.
  const secretGuardado = await cifrarSecreto(secret, context.env.TOTP_ENCRYPTION_KEY);

  // Store secret temporarily (not enabled until verified)
  await context.env.DB.prepare(
    `INSERT INTO user_totp (user_id, secret, enabled, created_at)
     VALUES (?, ?, 0, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       secret = excluded.secret,
       enabled = 0,
       created_at = datetime('now')`
  ).bind(session.user_id, secretGuardado).run();

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
  ).bind(session.user_id).first() as { secret: string } | null;

  if (!totpRecord) {
    return context.json({ error: 'NO_TOTP_SETUP' }, 400);
  }

  // Ver TOTP code (con anti-replay). El secreto se descifra si viene cifrado.
  const enableCheck = verifyTOTPWithCounter(body.code as string, await descifrarSecreto(totpRecord.secret, context.env.TOTP_ENCRYPTION_KEY));
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
    // Modo seguro: con 2FA activo no se desactiva (apágalo en Configuración si toca)
    if (await isSafetyLockOn(context.env)) {
      return context.json({ error: 'SAFETY_LOCKED', message: 'Modo seguro activo: desactívalo en Configuración para tocar el 2FA' }, 403);
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

// PUT /auth/me - Editar perfil (display_name). El username es inmutable:
// es la identidad interna en BD (pedidos, auditoría) aunque el nombre cambie.
authRoutes.put('/me', async (context) => {
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
  const parsed = z.object({
    display_name: z.string().trim().min(1).max(100),
  }).safeParse(body);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  await context.env.DB.prepare(
    'UPDATE users SET display_name = ? WHERE id = ?'
  ).bind(parsed.data.display_name, session.user_id).run();

  const user = await context.env.DB.prepare(
    'SELECT id, username, email, display_name, role_id FROM users WHERE id = ?'
  ).bind(session.user_id).first();

  return context.json({ data: user });
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
  // Checkout bloqueado sin estos campos: se validan aquí también (el front
  // los exige, pero la API es la que manda).
  const parsed = z.object({
    full_name: z.string().trim().min(1).max(100),
    phone: phoneSchema,
    address: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    postal_code: postalSchema,
    country: z.string().trim().min(1).max(60).optional(),
  }).safeParse(body);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  const { full_name, phone, address, city, postal_code, country } = parsed.data;

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
  ).bind(session.user_id, full_name, normalizePhone(phone), address, city, postal_code.trim(), country?.trim() || 'España').run();

  return context.json({ data: { saved: true } });
});
// POST /auth/google-2fa - Completar login Google con 2FA (ventana 10 min tras OAuth)
authRoutes.post('/google-2fa', async (context) => {
  const body = await context.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';

  if (!email || !/^\d{6}$/.test(code)) {
    return context.json({ error: 'INVALID_INPUT', message: 'Email y código de 6 dígitos requeridos' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const pending = await context.env.DB.prepare(
    'SELECT created_at FROM oauth_pending_2fa WHERE email = ?'
  ).bind(email).first() as { created_at: number } | null;

  // Ventana de 10 minutos desde el callback; sin pendiente no hay desafío que completar
  if (!pending || now - pending.created_at > 10 * 60) {
    if (pending) {
      await context.env.DB.prepare('DELETE FROM oauth_pending_2fa WHERE email = ?').bind(email).run();
    }
    return context.json({ error: 'GOOGLE_2FA_EXPIRED', message: 'Sesión OAuth caducada. Inicia con Google de nuevo.' }, 410);
  }

  const user = await context.env.DB.prepare(
    'SELECT id, username, email, display_name, role_id FROM users WHERE email = ? AND is_active = 1'
  ).bind(email).first() as {
    id: string; username: string; email: string; display_name: string; role_id: string;
  } | null;

  if (!user) {
    return context.json({ error: 'INVALID_TOTP_CODE', message: 'Código incorrecto' }, 401);
  }

  const totpRecord = await context.env.DB.prepare(
    'SELECT secret, last_counter FROM user_totp WHERE user_id = ? AND enabled = 1'
  ).bind(user.id).first() as { secret: string; last_counter: number } | null;

  if (!totpRecord) {
    return context.json({ error: 'INVALID_TOTP_CODE', message: 'Código incorrecto' }, 401);
  }

  // El secreto se descifra si viene cifrado; si es anterior al cifrado, se usa
  // tal cual y de paso se migra (ver migrarSecretoSiHaceFalta).
  const { last_counter } = totpRecord;
  const secretClaro = await descifrarSecreto(totpRecord.secret, context.env.TOTP_ENCRYPTION_KEY);
  const check = verifyTOTPWithCounter(code, secretClaro);
  if (!check.ok || check.counter <= (last_counter ?? -1)) {
    return context.json({ error: 'INVALID_TOTP_CODE', message: 'Código incorrecto o ya usado. Usa el código actual.' }, 401);
  }

  await migrarSecretoSiHaceFalta(context.env, user.id, totpRecord.secret, secretClaro);

  const token = generateSessionToken();
  const expiresAt = now + 7 * 24 * 60 * 60;

  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE user_totp SET last_counter = ? WHERE user_id = ?').bind(check.counter, user.id),
    context.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expiresAt),
    context.env.DB.prepare('DELETE FROM oauth_pending_2fa WHERE email = ?').bind(email),
  ]);

  return context.json({
    data: {
      user,
      session: { id: token, token, expires_at: expiresAt },
    },
  });
});
