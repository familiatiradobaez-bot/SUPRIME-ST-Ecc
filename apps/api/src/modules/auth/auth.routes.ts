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
  password: z.string().min(6),
  username: z.string().min(3).max(50),
  display_name: z.string().min(1).max(100),
});

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

export const authRoutes = new Hono<{ Bindings: Bindings }>();

// POST /auth/register
authRoutes.post('/register', async (context) => {
  const body = await context.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
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

  await context.env.DB.prepare(
    `INSERT INTO users (id, role_id, username, email, password_hash, display_name)
     VALUES (?, 'role-customer', ?, ?, ?, ?)`
  ).bind(userId, username, email, passwordHash, display_name).run();

  return context.json({ data: { id: userId, email, username, display_name } }, 201);
});

// POST /auth/login
authRoutes.post('/login', async (context) => {
  const body = await context.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  const { email, username, password } = parsed.data;

  const user = await context.env.DB.prepare(
    `SELECT id, username, email, display_name, role_id, password_hash FROM users
     WHERE (email = ? OR username = ?) AND is_active = 1`
  ).bind(email || '', username || '').first();

  if (!user || !(await verifyPassword(password, user.password_hash as string))) {
    return context.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  const sessionId = generateId();
  const token = generateSessionToken();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // Unix timestamp

  await context.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run();

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
    `SELECT id FROM sessions WHERE id = ? AND expires_at > strftime('%s', 'now')`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  await context.env.DB.prepare(
    'DELETE FROM sessions WHERE id = ?'
  ).bind(token).run();

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

// PUT /auth/me/shipping
authRoutes.put('/me/shipping', async (context) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ? AND expires_at > strftime('%s', 'now')`
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
