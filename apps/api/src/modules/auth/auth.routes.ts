import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';

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

// Rate limiting storage (in-memory - use KV in production)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  
  if (!attempt || attempt.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 }); // 15 min window
    return true;
  }
  
  if (attempt.count >= 5) {
    return false;
  }
  
  attempt.count++;
  return true;
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

// Email verification token storage
const verificationTokens = new Map<string, { email: string; expiresAt: number }>();

function generateVerificationToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// TOTP verification using HMAC-SHA1
function verifyTOTP(code: string, secret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  // Check current and adjacent time steps for clock drift
  for (let i = -1; i <= 1; i++) {
    if (generateTOTP(secret, timeStep + i) === code) return true;
  }
  return false;
}

function generateTOTP(secret: string, timeStep: number): string {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  
  // Convert time step to 8-byte buffer
  const timeBuffer = new ArrayBuffer(8);
  const timeView = new DataView(timeBuffer);
  timeView.setUint32(4, timeStep, false);
  
  // HMAC-SHA1
  const key = crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  // Synchronous HMAC using SubtleCrypto is not possible, so we use a simplified approach
  // In production, use a proper TOTP library
  const hmacResult = hmacSync(keyData, new Uint8Array(timeBuffer));
  
  // Dynamic truncation
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const binary = ((hmacResult[offset] & 0x7f) << 24) |
                 ((hmacResult[offset + 1] & 0xff) << 16) |
                 ((hmacResult[offset + 2] & 0xff) << 8) |
                 (hmacResult[offset + 3] & 0xff);
  
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

// Synchronous HMAC-SHA1 implementation
function hmacSync(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let keyBytes: Uint8Array = new Uint8Array(key);
  
  if (keyBytes.length > blockSize) {
    keyBytes = sha1(keyBytes) as Uint8Array;
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
  
  const inner = sha1(concat(ipad, message));
  return sha1(concat(opad, inner));
}

function sha1(data: Uint8Array): Uint8Array {
  // Simple SHA-1 implementation for TOTP
  // In production, use crypto.subtle.digest('SHA-1', data)
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

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

export const authRoutes = new Hono<{ Bindings: Bindings }>();

// POST /auth/register
authRoutes.post('/register', async (context) => {
  const body = await context.req.text().catch(() => null);
  let parsedBody: unknown = null;
  try {
    parsedBody = body ? JSON.parse(body) : null;
  } catch {
    parsedBody = null;
  }
  const parsed = registerSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  const { email, password, username, display_name } = parsed.data;

  const existing = await context.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? OR username = ?'
  ).bind(email, username).first();

  if (existing) {
    return context.json({ error: 'USER_ALREADY_EXISTS' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const userId = generateId();

  // Generate email verification token
  const verificationToken = generateVerificationToken();
  const verificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  verificationTokens.set(verificationToken, { email, expiresAt: verificationExpires });

  await context.env.DB.prepare(
    `INSERT INTO users (id, role_id, username, email, password_hash, display_name, email_verified)
     VALUES (?, 'role-customer', ?, ?, ?, ?, 0)`
  ).bind(userId, username, email, passwordHash, display_name).run();

  // Send verification email via Resend
  try {
    const verificationLink = `https://suprime.xyz/verify-email?token=${verificationToken}`;
    const resendApiKey = context.env.RESEND_API_KEY;
    
    if (resendApiKey) {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'SUPRIME <noreply@suprime.xyz>',
          to: email,
          subject: 'Verifica tu cuenta en SUPRIME',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #6366f1;">Bienvenido a SUPRIME</h1>
              <p>Gracias por registrarte. Por favor verifica tu correo electrónico haciendo clic en el siguiente botón:</p>
              <a href="${verificationLink}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 16px 0;">
                Verificar mi cuenta
              </a>
              <p>Si no creaste esta cuenta, puedes ignorar este correo.</p>
              <p>Este enlace expira en 24 horas.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="color: #888; font-size: 12px;">SUPRIME - Tu tienda premium</p>
            </div>
          `,
        }),
      });

      if (!emailResponse.ok) {
        console.error('Resend email failed:', await emailResponse.text());
      }
    } else {
      console.warn('RESEND_API_KEY not configured, skipping email send');
    }
  } catch (emailErr) {
    console.error('Failed to send verification email:', emailErr);
  }

  return context.json({ 
    data: { id: userId, email, username, display_name, verificationRequired: true } 
  }, 201);
});

// GET /auth/verify-email - Verify email with token
authRoutes.get('/verify-email', async (context) => {
  const token = context.req.query('token');
  if (!token) {
    return context.json({ error: 'INVALID_TOKEN' }, 400);
  }

  const record = verificationTokens.get(token);
  if (!record || record.expiresAt < Date.now()) {
    return context.json({ error: 'TOKEN_EXPIRED' }, 400);
  }

  // Mark email as verified
  await context.env.DB.prepare(
    'UPDATE users SET email_verified = 1 WHERE email = ?'
  ).bind(record.email).run();

  // Clean up token
  verificationTokens.delete(token);

  return context.redirect('https://suprime.xyz?email=verified');
});

// POST /auth/login
authRoutes.post('/login', async (context) => {
  // Rate limiting check
  const clientIp = context.req.header('CF-Connecting-IP') || context.req.header('X-Forwarded-For') || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts. Please try again later.' }, 429);
  }

  const body = await context.req.text().catch(() => null);
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
    `SELECT id, username, email, display_name, role_id, password_hash, email_verified FROM users
     WHERE (email = ? OR username = ?) AND is_active = 1`
  ).bind(email || '', username || '').first();

  if (!user || !(await verifyPassword(password, user.password_hash as string))) {
    return context.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  // Check if email is verified (only for non-Google users)
  if (!user.email_verified && !user.google_subject) {
    return context.json({ error: 'EMAIL_NOT_VERIFIED', message: 'Debes verificar tu correo electrónico antes de iniciar sesión' }, 403);
  }

  const sessionId = generateId();
  const rememberMe = (parsedBody as Record<string, unknown>)?.rememberMe === true;
  // Token format: base64(userId:role:timestamp) - self-contained, no DB verification needed
  const tokenData = `${user.id}:${user.role_id}:${Date.now()}`;
  const token = btoa(tokenData);
  // 30 days if rememberMe, 7 days otherwise
  const sessionDurationDays = rememberMe ? 30 : 7;
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationDays * 24 * 60 * 60;

  await context.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run();

  // Set HttpOnly cookie with session token
  context.header('Set-Cookie', `session_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${sessionDurationDays * 24 * 60 * 60}`);

  return context.json({
    data: {
      user,
      session: { id: sessionId, token, expires_at: expiresAt },
    },
  });

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
     WHERE s.id = ?`
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

  // Generate TOTP secret (32 bytes hex = 64 chars)
  const secretArray = new Uint8Array(32);
  crypto.getRandomValues(secretArray);
  const secret = Array.from(secretArray, b => b.toString(16).padStart(2, '0')).join('');

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

  // Verify TOTP code
  const isValid = verifyTOTP(body.code as string, totpRecord.secret as string);
  if (!isValid) {
    return context.json({ error: 'INVALID_TOTP_CODE' }, 401);
  }

  // Enable TOTP
  await context.env.DB.prepare(
    'UPDATE user_totp SET enabled = 1 WHERE user_id = ?'
  ).bind(session.user_id).run();

  return context.json({ data: { enabled: true } });
});

// POST /auth/me/totp/disable - Disable TOTP
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
