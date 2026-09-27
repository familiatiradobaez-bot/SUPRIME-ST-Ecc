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

// Middleware to check admin access
adminRoutes.use('*', async (context, next) => {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    `SELECT u.role_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  if (!canAccess(session.role_id as string, 'admin')) {
    return context.json({ error: 'FORBIDDEN' }, 403);
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
