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
  const session = await context.env.DB.prepare(
    `SELECT u.role_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  const adminRoles = ['role-admin', 'role-owner', 'role-stock-manager'];
  if (!adminRoles.includes(session.role_id as string)) {
    return context.json({ error: 'FORBIDDEN', message: 'Admin access required' }, 403);
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

// GET /admin/users - List all users
adminRoutes.get('/users', async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT id, username, email, display_name, role_id, is_active, created_at
     FROM users ORDER BY created_at DESC`
  ).all();

  return context.json({ data: result.results });
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

// GET /admin/orders - List all orders
adminRoutes.get('/orders', async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT o.id, o.status, o.total_cents, o.created_at,
            u.username, u.email
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     ORDER BY o.created_at DESC`
  ).all();

  return context.json({ data: result.results });
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
