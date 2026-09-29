import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';
import { sendEmail, orderStatusEmailHtml } from '../../lib/email';

function generateId(): string {
  return crypto.randomUUID();
}

// Role hierarchy: owner(40) > admin(30) > stock_manager(20) > customer(10)
// Los role_id en DB llevan prefijo 'role-'; se normaliza antes de comparar.
const roleRank: Record<string, number> = {
  customer: 10,
  stock_manager: 20,
  admin: 30,
  owner: 40,
};

function roleLevel(roleId: string): number {
  return roleRank[roleId.replace(/^role-/, '')] || 0;
}

function canAccess(userRole: string, minimum: string): boolean {
  return roleLevel(userRole) >= roleLevel(minimum);
}

export const adminRoutes = new Hono<{
  Bindings: Bindings;
  Variables: { authUserId: string; authRoleId: string };
}>();

// Admin routes require valid session AND admin role.
// El rol se lee de DB (JOIN users), NUNCA del token sin firmar: un admin
// degradado pierde acceso en cuanto cambia su role_id.
adminRoutes.use('*', async (context, next) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const sessionToken = authHeader.slice(7);

  // Token format: base64(userId:roleId:timestamp) — del token solo se usa userId
  // para localizar la sesión; el rol autoritativo es u.role_id de DB.
  let userId: string | null = null;
  try {
    const parts = atob(sessionToken).split(':');
    if (parts.length >= 2) userId = parts[0];
  } catch {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (!userId) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const sess = await context.env.DB.prepare(
    `SELECT u.role_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(sessionToken, userId).first() as { role_id: string } | null;

  if (!sess) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  // Nivel mínimo admin: stock_manager (usa la jerarquía roleRank/canAccess)
  if (!canAccess(sess.role_id, 'stock_manager')) {
    return context.json({ error: 'FORBIDDEN', message: 'Admin access required' }, 403);
  }

  // Identidad verificada para los handlers (jerarquía, auditoría)
  context.set('authUserId', userId);
  context.set('authRoleId', sess.role_id);

  // Step-up 2FA: entrar al admin exige verificación de ≤1h (no basta la sesión larga).
  // Si el usuario nunca configuró 2FA, se le pide configurarlo primero.
  const totp = await context.env.DB.prepare(
    'SELECT enabled FROM user_totp WHERE user_id = ?'
  ).bind(userId).first() as { enabled: number } | null;

  if (!totp?.enabled) {
    return context.json({ error: 'ADMIN_2FA_SETUP_REQUIRED', message: 'Configura la verificación en dos pasos para entrar al panel' }, 403);
  }

  const grant = await context.env.DB.prepare(
    'SELECT expires_at FROM admin_stepup WHERE user_id = ?'
  ).bind(userId).first() as { expires_at: number } | null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (!grant || grant.expires_at <= nowSec) {
    return context.json({ error: 'ADMIN_2FA_REQUIRED', message: 'Verificación en dos pasos requerida (válida 1 hora)' }, 403);
  }

  await next();
});

// GET /admin/stats - Dashboard statistics
adminRoutes.get('/stats', async (context) => {
  const products = await context.env.DB.prepare(
    'SELECT COUNT(*) as count FROM products WHERE status = ?'
  ).bind('active').first();

  const orders = await context.env.DB.prepare(
    'SELECT COUNT(*) as count FROM orders'
  ).first();

  const users = await context.env.DB.prepare(
    'SELECT COUNT(*) as count FROM users WHERE is_active = 1'
  ).first();

  const revenue = await context.env.DB.prepare(
    'SELECT COALESCE(SUM(total_cents), 0) as total FROM orders'
  ).first();

  return context.json({
    data: {
      products: products?.count || 0,
      orders: orders?.count || 0,
      users: users?.count || 0,
      revenue: revenue?.total || 0,
    },
  });
});

// GET /admin/users - List users (paginado: ?limit=50 por defecto, máx 100)
adminRoutes.get('/users', async (context) => {
  const limit = Math.min(Math.max(parseInt(context.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(context.req.query('offset') || '0', 10) || 0, 0);

  const [result, total] = await context.env.DB.batch([
    context.env.DB.prepare(
      `SELECT id, username, email, display_name, role_id, is_active, created_at
       FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(limit, offset),
    context.env.DB.prepare('SELECT COUNT(*) as count FROM users'),
  ]);

  const totalCount = ((total.results?.[0] as { count?: number } | undefined)?.count) || 0;

  return context.json({
    data: result.results,
    pagination: { limit, offset, total: totalCount },
  });
});

// PUT /admin/users/:id/role - Update user role
// Jerarquía: solo owner puede tocar roles; nadie se cambia a sí mismo;
// no se puede degradar al último owner. Al cambiar rol se invalidan
// sesiones y step-up del afectado.
adminRoutes.put('/users/:id/role', async (context) => {
  const userId = context.req.param('id');
  const body = await context.req.json().catch(() => null);
  if (!body?.role_id) {
    return context.json({ error: 'INVALID_INPUT' }, 400);
  }

  const validRoles = ['role-customer', 'role-stock-manager', 'role-admin', 'role-owner'];
  if (!validRoles.includes(body.role_id)) {
    return context.json({ error: 'INVALID_ROLE' }, 400);
  }

  const callerId = context.get('authUserId');
  const callerRole = context.get('authRoleId');

  if (callerRole !== 'role-owner') {
    return context.json({ error: 'FORBIDDEN', message: 'Solo owner puede cambiar roles' }, 403);
  }
  if (userId === callerId) {
    return context.json({ error: 'FORBIDDEN', message: 'No puedes cambiar tu propio rol' }, 403);
  }

  const target = await context.env.DB.prepare(
    'SELECT role_id FROM users WHERE id = ?'
  ).bind(userId).first() as { role_id: string } | null;

  if (!target) {
    return context.json({ error: 'USER_NOT_FOUND' }, 404);
  }
  if (target.role_id === body.role_id) {
    return context.json({ data: { updated: false, message: 'Sin cambios' } });
  }

  // Proteger al último owner
  if (target.role_id === 'role-owner' && body.role_id !== 'role-owner') {
    const owners = await context.env.DB.prepare(
      "SELECT COUNT(*) as count FROM users WHERE role_id = 'role-owner'"
    ).first() as { count: number } | null;
    if ((owners?.count || 0) <= 1) {
      return context.json({ error: 'FORBIDDEN', message: 'No puedes degradar al último owner' }, 403);
    }
  }

  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE users SET role_id = ? WHERE id = ?').bind(body.role_id, userId),
    context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    context.env.DB.prepare('DELETE FROM admin_stepup WHERE user_id = ?').bind(userId),
  ]);

  // Audit log con autor
  await context.env.DB.prepare(
    'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(generateId(), callerId || null, 'UPDATE_ROLE', 'user', userId, JSON.stringify({ new_role: body.role_id, prev_role: target.role_id })).run();

  return context.json({ data: { updated: true } });
});

// GET /admin/orders - List orders (paginado: ?limit=50 por defecto, máx 100)
adminRoutes.get('/orders', async (context) => {
  const limit = Math.min(Math.max(parseInt(context.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(context.req.query('offset') || '0', 10) || 0, 0);

  const [result, total] = await context.env.DB.batch([
    context.env.DB.prepare(
      `SELECT o.id, o.status, o.total_cents, o.created_at,
              u.username, u.email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    ).bind(limit, offset),
    context.env.DB.prepare('SELECT COUNT(*) as count FROM orders'),
  ]);

  const totalCount = ((total.results?.[0] as { count?: number } | undefined)?.count) || 0;

  return context.json({
    data: result.results,
    pagination: { limit, offset, total: totalCount },
  });
});

// PUT /admin/orders/:id/status - Cambiar estado (pending→paid→shipped→delivered, o cancelled)
const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

adminRoutes.put('/orders/:id/status', async (context) => {
  const orderId = context.req.param('id');
  const body = await context.req.json().catch(() => null);
  const next = typeof body?.status === 'string' ? body.status : '';

  if (!ORDER_TRANSITIONS[next]) {
    return context.json({ error: 'INVALID_STATUS', message: 'Estado no válido' }, 400);
  }

  const order = await context.env.DB.prepare(
    'SELECT status, total_cents, shipping_email FROM orders WHERE id = ?'
  ).bind(orderId).first() as { status: string; total_cents: number; shipping_email: string } | null;

  if (!order) {
    return context.json({ error: 'ORDER_NOT_FOUND' }, 404);
  }

  if (!ORDER_TRANSITIONS[order.status]?.includes(next)) {
    return context.json({ error: 'INVALID_TRANSITION', message: `No se puede pasar de ${order.status} a ${next}` }, 400);
  }

  await context.env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(next, orderId).run();

  // Avisar al cliente (no bloquea la respuesta si falla)
  void sendOrderStatusEmail(context.env, orderId, next, order.total_cents, order.shipping_email);

  return context.json({ data: { id: orderId, prev: order.status, status: next } });
});

async function sendOrderStatusEmail(env: Bindings, orderId: string, status: string, totalCents: number, toEmail: string): Promise<void> {
  try {
    const sent = await sendEmail(env, toEmail, `Tu pedido ${orderId.slice(0, 8)}: ${status}`, orderStatusEmailHtml(orderId, status, totalCents));
    if (!sent) console.warn(`Order status email for order ${orderId} could not be sent`);
  } catch (err) {
    console.error('Order status email failed:', err);
  }
}

// GET /admin/settings - Get store settings
adminRoutes.get('/settings', async (context) => {
  const result = await context.env.DB.prepare(
    'SELECT key, value, description FROM store_settings'
  ).all();

  const settings: Record<string, string> = {};
  result.results.forEach((row: any) => {
    settings[row.key] = row.value;
  });

  return context.json({ data: settings });
});

// PUT /admin/settings - Update store settings (solo owner/admin; stock_manager no)
const SETTABLE_KEYS = ['store_name', 'store_description', 'currency', 'tax_rate', 'shipping_cost', 'free_shipping_threshold', 'maintenance_mode'];

adminRoutes.put('/settings', async (context) => {
  const roleId = context.get('authRoleId') as string;
  if (!canAccess(roleId, 'admin')) {
    return context.json({ error: 'FORBIDDEN', message: 'Solo owner/admin' }, 403);
  }

  const body = await context.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return context.json({ error: 'INVALID_INPUT' }, 400);
  }

  const entries = Object.entries(body).filter(([key, value]) =>
    SETTABLE_KEYS.includes(key) && typeof value === 'string' && value.length <= 200
  );
  if (entries.length === 0) {
    return context.json({ error: 'INVALID_INPUT', message: 'Sin claves válidas' }, 400);
  }

  // Validación por clave: euros (2 decimales) -> céntimos; resto texto acotado
  const toStore: Array<[string, string]> = [];
  for (const [key, value] of entries as Array<[string, string]>) {
    if (key === 'shipping_cost' || key === 'free_shipping_threshold') {
      const cents = Math.round(parseFloat(value.replace(',', '.')) * 100);
      if (!Number.isFinite(cents) || cents < 0 || cents > 100000) {
        return context.json({ error: 'INVALID_INPUT', message: `Valor inválido para ${key}` }, 400);
      }
      toStore.push([key, String(cents)]);
    } else if (key === 'maintenance_mode') {
      if (value !== '0' && value !== '1') {
        return context.json({ error: 'INVALID_INPUT', message: 'maintenance_mode: 0 o 1' }, 400);
      }
      toStore.push([key, value]);
    } else {
      const clean = value.trim();
      if (!clean) {
        return context.json({ error: 'INVALID_INPUT', message: `Valor vacío para ${key}` }, 400);
      }
      toStore.push([key, clean]);
    }
  }

  for (const [key, value] of toStore) {
    await context.env.DB.prepare(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(key, value).run();
  }

  return context.json({ data: { updated: true } });
});

// GET /admin/audit - Get audit logs
adminRoutes.get('/audit', async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
            u.username
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT 100`
  ).all();

  return context.json({ data: result.results });
});

// POST /admin/products - Create new product
adminRoutes.post('/products', async (context) => {
  const body = await context.req.json().catch(() => null);
  if (!body) {
    return context.json({ error: 'INVALID_INPUT' }, 400);
  }

  const { name, description, image_url, price_cents, stock_quantity } = body;

  if (!name || !description || !image_url || price_cents == null || stock_quantity == null) {
    return context.json({ error: 'MISSING_FIELDS' }, 400);
  }
  if (!Number.isInteger(price_cents) || price_cents < 0) {
    return context.json({ error: 'INVALID_PRICE', message: 'price_cents debe ser entero >= 0' }, 400);
  }
  if (!Number.isInteger(stock_quantity) || stock_quantity < 0) {
    return context.json({ error: 'INVALID_STOCK', message: 'stock_quantity debe ser entero >= 0' }, 400);
  }

  const productId = generateId();
  const baseSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80) || 'producto';
  // Slug único (evita 500 por UNIQUE en renombres/duplicados)
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await context.env.DB.prepare('SELECT 1 as ok FROM products WHERE slug = ?').bind(slug).first();
    if (!taken) break;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  await context.env.DB.prepare(
    `INSERT INTO products (id, subdepartment_id, name, slug, description, image_url, price_cents, stock_quantity, status)
     VALUES (?, 'subdep-demo', ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(productId, name, slug, description, image_url, price_cents, stock_quantity).run();

  // Persistir galería en product_images (primera = principal)
  const galleryUrls = Array.isArray(body.images) && body.images.length > 0 ? body.images : [image_url];
  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM product_images WHERE product_id = ?').bind(productId),
    ...galleryUrls.slice(0, 10).map((url: string, i: number) =>
      context.env.DB.prepare(
        'INSERT INTO product_images (id, product_id, url, display_order, is_primary) VALUES (?, ?, ?, ?, ?)'
      ).bind(generateId(), productId, url, i, i === 0 ? 1 : 0)
    ),
  ]);

  return context.json({ data: { id: productId, name, slug } }, 201);
});

// PUT /admin/products/:id - Update product
adminRoutes.put('/products/:id', async (context) => {
  const productId = context.req.param('id');
  const body = await context.req.json().catch(() => null);
  if (!body) {
    return context.json({ error: 'INVALID_INPUT' }, 400);
  }

  const { name, description, image_url, price_cents, stock_quantity } = body;

  if (price_cents != null && (!Number.isInteger(price_cents) || price_cents < 0)) {
    return context.json({ error: 'INVALID_PRICE', message: 'price_cents debe ser entero >= 0' }, 400);
  }
  if (stock_quantity != null && (!Number.isInteger(stock_quantity) || stock_quantity < 0)) {
    return context.json({ error: 'INVALID_STOCK', message: 'stock_quantity debe ser entero >= 0' }, 400);
  }

  const updated = await context.env.DB.prepare(
    `UPDATE products SET name = ?, description = ?, image_url = ?, price_cents = ?, stock_quantity = ?
     WHERE id = ?`
  ).bind(name, description, image_url, price_cents, stock_quantity, productId).run();

  if ((updated.meta as { changes?: number } | undefined)?.changes === 0) {
    return context.json({ error: 'PRODUCT_NOT_FOUND' }, 404);
  }

  // Sincronizar galería si se envía
  if (Array.isArray(body.images)) {
    const galleryUrls = body.images.length > 0 ? body.images : [image_url];
    await context.env.DB.batch([
      context.env.DB.prepare('DELETE FROM product_images WHERE product_id = ?').bind(productId),
      ...galleryUrls.slice(0, 10).map((url: string, i: number) =>
        context.env.DB.prepare(
          'INSERT INTO product_images (id, product_id, url, display_order, is_primary) VALUES (?, ?, ?, ?, ?)'
        ).bind(generateId(), productId, url, i, i === 0 ? 1 : 0)
      ),
    ]);
  }

  return context.json({ data: { updated: true } });
});

// DELETE /admin/products/:id - Delete product
adminRoutes.delete('/products/:id', async (context) => {
  const productId = context.req.param('id');

  await context.env.DB.prepare(
    `UPDATE products SET status = 'archived' WHERE id = ?`
  ).bind(productId).run();

  return context.json({ data: { deleted: true } });
});
