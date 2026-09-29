import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';

function generateId(): string {
  return crypto.randomUUID();
}

// Role hierarchy: owner(40) > admin(30) > stock_manager(20) > customer(10)
const roleRank: Record<string, number> = {
  customer: 10,
  stock_manager: 20,
  admin: 30,
  owner: 40,
};

function canAccess(userRole: string, minimum: string): boolean {
  return (roleRank[userRole] || 0) >= (roleRank[minimum] || 0);
}

export const adminRoutes = new Hono<{ Bindings: Bindings }>();

// Admin routes require valid session AND admin role
adminRoutes.use('*', async (context, next) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);

  // Token format: base64(userId:roleId:timestamp)
  let roleId: string | null = null;
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length >= 2) {
      roleId = parts[1];
    }
  } catch {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (!roleId) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const adminRoles = ['role-admin', 'role-owner', 'role-stock-manager'];
  if (!adminRoles.includes(roleId)) {
    return context.json({ error: 'FORBIDDEN', message: 'Admin access required' }, 403);
  }

  // Verificar que la sesión existe en DB y no expiró (el token es el id de sesión)
  const sessionToken = authHeader.slice(7);
  const sess = await context.env.DB.prepare(
    `SELECT s.user_id FROM sessions s WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(sessionToken).first() as { user_id: string } | null;
  if (!sess) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  // Step-up 2FA: entrar al admin exige verificación de ≤1h (no basta la sesión larga).
  // Si el usuario nunca configuró 2FA, se le pide configurarlo primero.
  const totp = await context.env.DB.prepare(
    'SELECT enabled FROM user_totp WHERE user_id = ?'
  ).bind(sess.user_id).first() as { enabled: number } | null;

  if (!totp?.enabled) {
    return context.json({ error: 'ADMIN_2FA_SETUP_REQUIRED', message: 'Configura la verificación en dos pasos para entrar al panel' }, 403);
  }

  const grant = await context.env.DB.prepare(
    'SELECT expires_at FROM admin_stepup WHERE user_id = ?'
  ).bind(sess.user_id).first() as { expires_at: number } | null;

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

  await context.env.DB.prepare(
    'UPDATE users SET role_id = ? WHERE id = ?'
  ).bind(body.role_id, userId).run();

  // Audit log
  await context.env.DB.prepare(
    'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(generateId(), null, 'UPDATE_ROLE', 'user', userId, JSON.stringify({ new_role: body.role_id })).run();

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

// PUT /admin/settings - Update store settings
adminRoutes.put('/settings', async (context) => {
  const body = await context.req.json().catch(() => null);
  if (!body) {
    return context.json({ error: 'INVALID_INPUT' }, 400);
  }

  for (const [key, value] of Object.entries(body)) {
    await context.env.DB.prepare(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(key, value as string).run();
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

  const productId = generateId();
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

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

  await context.env.DB.prepare(
    `UPDATE products SET name = ?, description = ?, image_url = ?, price_cents = ?, stock_quantity = ?
     WHERE id = ?`
  ).bind(name, description, image_url, price_cents, stock_quantity, productId).run();

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
