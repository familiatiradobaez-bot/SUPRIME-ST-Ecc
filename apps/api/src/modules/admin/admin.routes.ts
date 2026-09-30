import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';
import { sendEmail, orderStatusEmailHtml } from '../../lib/email';
import { isSafetyLockOn } from '../../lib/pricing';

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

// OJO: el id en DB es 'role-stock-manager' (GUION), no 'stock_manager'
// (subrayado). Normalizar solo quitando el prefijo dejaba la clave
// 'stock-manager', que no está en roleRank → nivel 0 → TODO /admin/* devolvía
// 403 FORBIDDEN a un stock manager que sí se autenticaba y pasaba el 2FA.
// Aquí se unifican guion y subrayado para que las dos grafías valgan.
function roleLevel(roleId: string): number {
  const key = roleId.replace(/^role-/, '').replace(/-/g, '_').toLowerCase();
  return roleRank[key] || 0;
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

  // El token ES la clave de la fila en sessions (s.id), asi que no hace falta
  // descodificarlo para nada. Antes se hacia `atob(token).split(':')` para sacar
  // el userId del token, y el resto de la API NO lo hacia: solo el admin. Con el
  // token ahora aleatorio (32 bytes, sin nada que descodificar) eso devolvia
  // basura y todo /admin/* responds 401.
  //
  // La consulta ya exige que s.id coincida con el token, y de ahi sale el
  // user_id. Ademas se sigue exigiendo s.user_id = token, o sea que una fila de
  // sesion no puede belongs a otro usuario.
  const sess = await context.env.DB.prepare(
    `SELECT s.user_id AS user_id, u.role_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > strftime('%s', 'now')`
  ).bind(sessionToken).first() as { user_id: string; role_id: string } | null;

  if (!sess) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  const userId = sess.user_id;

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

// Columnas por las que se puede ordenar la tabla de usuarios. Allowlist:
// el valor llega del query y no se puede interpolar en el ORDER BY.
const USER_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  username: 'username COLLATE NOCASE',
  email: 'email COLLATE NOCASE',
  role: 'role_id',
};

// GET /admin/users - List users (paginado: ?limit=50 por defecto, máx 100)
// ?sort=username|email|role|created_at & dir=asc|desc
adminRoutes.get('/users', async (context) => {
  const limit = Math.min(Math.max(parseInt(context.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(context.req.query('offset') || '0', 10) || 0, 0);
  const sortKey = context.req.query('sort') || 'created_at';
  const sortCol = USER_SORT_COLUMNS[sortKey] || USER_SORT_COLUMNS.created_at;
  const dir = (context.req.query('dir') || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // Desempate por id: sin él, dos filas con el mismo valor cambian de sitio
  // entre páginas y el paginado parece saltarse o repetir usuarios.
  const orderBy = `${sortCol} ${dir}, id ASC`;

  const [result, total] = await context.env.DB.batch([
    context.env.DB.prepare(
      `SELECT id, username, email, display_name, role_id, is_active, created_at
       FROM users ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).bind(limit, offset),
    context.env.DB.prepare('SELECT COUNT(*) as count FROM users'),
  ]);

  const totalCount = ((total.results?.[0] as { count?: number } | undefined)?.count) || 0;

  return context.json({
    data: result.results,
    pagination: {
      limit,
      offset,
      total: totalCount,
      sort: Object.keys(USER_SORT_COLUMNS).find((k) => USER_SORT_COLUMNS[k] === sortCol) || 'created_at',
      dir: dir.toLowerCase(),
    },
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
const SETTABLE_KEYS = ['store_name', 'store_description', 'currency', 'tax_rate', 'shipping_cost', 'free_shipping_threshold', 'maintenance_mode', 'safety_lock'];

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
    } else if (key === 'maintenance_mode' || key === 'safety_lock') {
      if (value !== '0' && value !== '1') {
        return context.json({ error: 'INVALID_INPUT', message: `${key}: 0 o 1` }, 400);
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

  // El subdepartamento es obligatorio: antes caía siempre en 'subdep-demo',
  // lo que metía todo el catálogo nuevo en el mismo subdepartamento demo.
  const subdepartmentId = typeof body.subdepartment_id === 'string' ? body.subdepartment_id : '';
  if (!subdepartmentId) {
    return context.json({ error: 'MISSING_FIELDS', message: 'subdepartment_id requerido' }, 400);
  }
  const sub = await context.env.DB.prepare(
    'SELECT id FROM subdepartments WHERE id = ?'
  ).bind(subdepartmentId).first() as { id: string } | null;
  if (!sub) {
    return context.json({ error: 'SUBDEPARTMENT_NOT_FOUND', message: 'El subdepartamento no existe' }, 404);
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(productId, subdepartmentId, name, slug, description, image_url, price_cents, stock_quantity).run();

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

  // Reubicar el producto: solo si viene informado, y validando que existe.
  let subdepartmentId: string | null = null;
  if (body.subdepartment_id !== undefined && body.subdepartment_id !== null && body.subdepartment_id !== '') {
    if (typeof body.subdepartment_id !== 'string') {
      return context.json({ error: 'INVALID_INPUT', message: 'subdepartment_id inválido' }, 400);
    }
    const sub = await context.env.DB.prepare(
      'SELECT id FROM subdepartments WHERE id = ?'
    ).bind(body.subdepartment_id).first() as { id: string } | null;
    if (!sub) {
      return context.json({ error: 'SUBDEPARTMENT_NOT_FOUND', message: 'El subdepartamento no existe' }, 404);
    }
    subdepartmentId = sub.id;
  }

  const updated = subdepartmentId
    ? await context.env.DB.prepare(
        `UPDATE products SET name = ?, description = ?, image_url = ?, price_cents = ?, stock_quantity = ?, subdepartment_id = ?
         WHERE id = ?`
      ).bind(name, description, image_url, price_cents, stock_quantity, subdepartmentId, productId).run()
    : await context.env.DB.prepare(
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

// DELETE /admin/products/:id - Delete product (archiva; bloqueado con modo seguro)
adminRoutes.delete('/products/:id', async (context) => {
  if (await isSafetyLockOn(context.env)) {
    return context.json({ error: 'SAFETY_LOCKED', message: 'Modo seguro activo: desactívalo en Configuración para borrar' }, 403);
  }
  const productId = context.req.param('id');

  await context.env.DB.prepare(
    `UPDATE products SET status = 'archived' WHERE id = ?`
  ).bind(productId).run();

  return context.json({ data: { deleted: true } });
});

// ─────────────────────────────────────────────────────────────
// CATÁLOGO: departamentos y subdepartamentos (tarea #25)
//
// Jerarquía: departments 1─* subdepartments 1─* products.
// Solo lectura en el catálogo público; aquí se gestiona (crear/editar/borrar).
// Mismo guard que el resto del admin (stock_manager+), con step-up 2FA.
// ─────────────────────────────────────────────────────────────

// Normaliza a slug: minúsculas, sin tildes, guiones. Patrón equivalente al
// que ya usa POST /products para no tener dos implementaciones distintas.
function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Nombre legible para el error cuando choca un UNIQUE.
function isUniqueViolation(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || '');
  return /UNIQUE constraint failed/i.test(msg);
}

// Busca un slug libre entre name, name-2, name-3... (mismo patrón que productos).
// `extraWhere`/`extraParams` acotan la búsqueda (p.ej. excluding the row itself).
async function uniqueSlug(
  env: Bindings,
  table: 'departments' | 'subdepartments',
  base: string,
  extraWhere?: string,
  extraParams: unknown[] = []
): Promise<string> {
  const root = base || 'item';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`;
    const sql = extraWhere
      ? `SELECT 1 as ok FROM ${table} WHERE slug = ? AND ${extraWhere}`
      : `SELECT 1 as ok FROM ${table} WHERE slug = ?`;
    const stmt = env.DB.prepare(sql).bind(candidate, ...extraParams);
    const taken = await stmt.first();
    if (!taken) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function logAudit(
  env: Bindings,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>
) {
  return env.DB.prepare(
    'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(generateId(), userId || null, action, entityType, entityId, JSON.stringify(details)).run();
}

// GET /admin/catalog - Departamentos + subdepartamentos con conteo de productos
adminRoutes.get('/catalog', async (context) => {
  const departments = await context.env.DB.prepare(
    `SELECT d.id, d.name, d.slug, d.is_active,
            (SELECT COUNT(*) FROM subdepartments sd WHERE sd.department_id = d.id) AS subdepartment_count,
            (SELECT COUNT(*) FROM products p
               JOIN subdepartments sd2 ON sd2.id = p.subdepartment_id
              WHERE sd2.department_id = d.id) AS product_count
       FROM departments d
       ORDER BY d.name COLLATE NOCASE`
  ).all();

  const subdepartments = await context.env.DB.prepare(
    `SELECT sd.id, sd.department_id, sd.name, sd.slug,
            (SELECT COUNT(*) FROM products p WHERE p.subdepartment_id = sd.id) AS product_count
       FROM subdepartments sd
       ORDER BY sd.name COLLATE NOCASE`
  ).all();

  const subs = subdepartments.results as Array<{ department_id: string }>;
  const data = (departments.results as Array<{ id: string }>).map((dept) => ({
    ...dept,
    subdepartments: subs.filter((s) => s.department_id === dept.id),
  }));

  return context.json({ data });
});

// POST /admin/departments - Crear departamento
adminRoutes.post('/departments', async (context) => {
  const body = await context.req.json().catch(() => null);
  if (!body) return context.json({ error: 'INVALID_INPUT' }, 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return context.json({ error: 'INVALID_NAME', message: 'name requerido (1-80 chars)' }, 400);
  }

  const isActive = body.is_active === 0 || body.is_active === '0' ? 0 : 1;
  const slug = await uniqueSlug(context.env, 'departments', slugify(body.slug || name));

  const id = generateId();
  try {
    await context.env.DB.prepare(
      `INSERT INTO departments (id, name, slug, is_active) VALUES (?, ?, ?, ?)`
    ).bind(id, name, slug, isActive).run();
  } catch (err) {
    // departments.name es UNIQUE global: homónimos darían 500.
    if (isUniqueViolation(err)) {
      return context.json({ error: 'DUPLICATE_NAME', message: `Ya existe un departamento llamado "${name}"` }, 409);
    }
    throw err;
  }

  await logAudit(context.env, context.get('authUserId'), 'CREATE_DEPARTMENT', 'department', id, { name, slug });

  return context.json({ data: { id, name, slug, is_active: isActive } }, 201);
});

// PUT /admin/departments/:id - Editar departamento
adminRoutes.put('/departments/:id', async (context) => {
  const id = context.req.param('id');
  const body = await context.req.json().catch(() => null);
  if (!body) return context.json({ error: 'INVALID_INPUT' }, 400);

  const current = await context.env.DB.prepare(
    'SELECT id, name, slug, is_active FROM departments WHERE id = ?'
  ).bind(id).first() as { id: string; name: string; slug: string; is_active: number } | null;
  if (!current) return context.json({ error: 'DEPARTMENT_NOT_FOUND' }, 404);

  const name = body.name === undefined
    ? current.name
    : (typeof body.name === 'string' ? body.name.trim() : '');
  if (!name || name.length > 80) {
    return context.json({ error: 'INVALID_NAME', message: 'name requerido (1-80 chars)' }, 400);
  }

  const isActive = body.is_active === undefined
    ? current.is_active
    : (body.is_active === 0 || body.is_active === '0' ? 0 : 1);

  // El slug solo se recalcula si viene explícito o si cambió el nombre.
  let slug = current.slug;
  if (typeof body.slug === 'string' && body.slug.trim()) {
    slug = await uniqueSlug(context.env, 'departments', slugify(body.slug), 'id != ?', [id]);
  } else if (name !== current.name) {
    slug = await uniqueSlug(context.env, 'departments', slugify(name), 'id != ?', [id]);
  }

  try {
    await context.env.DB.prepare(
      'UPDATE departments SET name = ?, slug = ?, is_active = ? WHERE id = ?'
    ).bind(name, slug, isActive, id).run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return context.json({ error: 'DUPLICATE_NAME', message: `Ya existe un departamento llamado "${name}"` }, 409);
    }
    throw err;
  }

  await logAudit(context.env, context.get('authUserId'), 'UPDATE_DEPARTMENT', 'department', id, {
    prev: { name: current.name, slug: current.slug, is_active: current.is_active },
    next: { name, slug, is_active: isActive },
  });

  return context.json({ data: { id, name, slug, is_active: isActive } });
});

// DELETE /admin/departments/:id - Borrar departamento (CASCADE a subdepartamentos)
adminRoutes.delete('/departments/:id', async (context) => {
  if (await isSafetyLockOn(context.env)) {
    return context.json({ error: 'SAFETY_LOCKED', message: 'Modo seguro activo: desactívalo en Configuración para borrar' }, 403);
  }
  const id = context.req.param('id');

  const current = await context.env.DB.prepare(
    'SELECT name FROM departments WHERE id = ?'
  ).bind(id).first() as { name: string } | null;
  if (!current) return context.json({ error: 'DEPARTMENT_NOT_FOUND' }, 404);

  // Los productos cuelgan de subdepartments, y products.subdepartment_id no
  // tiene ON DELETE: borrar en cascada dejaría productos huérfanos. Se bloquea
  // si hay productos vivos en vez de destruirlos en silencio.
  const used = await context.env.DB.prepare(
    `SELECT COUNT(*) as count FROM products p
       JOIN subdepartments sd ON sd.id = p.subdepartment_id
      WHERE sd.department_id = ? AND p.status != 'archived'`
  ).bind(id).first() as { count: number } | null;

  if ((used?.count || 0) > 0) {
    return context.json({
      error: 'DEPARTMENT_NOT_EMPTY',
      message: `Tiene ${used?.count} producto(s) activo(s). Muévelos o archívalos antes de borrarlo`,
    }, 409);
  }

  await context.env.DB.prepare('DELETE FROM departments WHERE id = ?').bind(id).run();
  await logAudit(context.env, context.get('authUserId'), 'DELETE_DEPARTMENT', 'department', id, { name: current.name });

  return context.json({ data: { deleted: true } });
});

// POST /admin/subdepartments - Crear subdepartamento
adminRoutes.post('/subdepartments', async (context) => {
  const body = await context.req.json().catch(() => null);
  if (!body) return context.json({ error: 'INVALID_INPUT' }, 400);

  const departmentId = typeof body.department_id === 'string' ? body.department_id : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!departmentId) return context.json({ error: 'MISSING_FIELDS', message: 'department_id requerido' }, 400);
  if (!name || name.length > 80) {
    return context.json({ error: 'INVALID_NAME', message: 'name requerido (1-80 chars)' }, 400);
  }

  const parent = await context.env.DB.prepare(
    'SELECT id, name FROM departments WHERE id = ?'
  ).bind(departmentId).first() as { id: string; name: string } | null;
  if (!parent) {
    return context.json({ error: 'DEPARTMENT_NOT_FOUND', message: 'El departamento no existe' }, 404);
  }

  // UNIQUE (department_id, slug): el slug solo debe ser único dentro del depto.
  const slug = await uniqueSlug(
    context.env, 'subdepartments', slugify(body.slug || name), 'department_id = ?', [departmentId]
  );

  const id = generateId();
  try {
    await context.env.DB.prepare(
      `INSERT INTO subdepartments (id, department_id, name, slug) VALUES (?, ?, ?, ?)`
    ).bind(id, departmentId, name, slug).run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return context.json({ error: 'DUPLICATE_NAME', message: `"${name}" ya existe en ${parent.name}` }, 409);
    }
    throw err;
  }

  await logAudit(context.env, context.get('authUserId'), 'CREATE_SUBDEPARTMENT', 'subdepartment', id, {
    name, slug, department_id: departmentId,
  });

  return context.json({ data: { id, department_id: departmentId, name, slug } }, 201);
});

// PUT /admin/subdepartments/:id - Editar subdepartamento
adminRoutes.put('/subdepartments/:id', async (context) => {
  const id = context.req.param('id');
  const body = await context.req.json().catch(() => null);
  if (!body) return context.json({ error: 'INVALID_INPUT' }, 400);

  const current = await context.env.DB.prepare(
    'SELECT id, department_id, name, slug FROM subdepartments WHERE id = ?'
  ).bind(id).first() as { id: string; department_id: string; name: string; slug: string } | null;
  if (!current) return context.json({ error: 'SUBDEPARTMENT_NOT_FOUND' }, 404);

  const name = body.name === undefined
    ? current.name
    : (typeof body.name === 'string' ? body.name.trim() : '');
  if (!name || name.length > 80) {
    return context.json({ error: 'INVALID_NAME', message: 'name requerido (1-80 chars)' }, 400);
  }

  // Reasignar a otro departamento: comprobar que el destino existe.
  let departmentId = current.department_id;
  if (body.department_id !== undefined && body.department_id !== current.department_id) {
    if (typeof body.department_id !== 'string' || !body.department_id) {
      return context.json({ error: 'INVALID_INPUT', message: 'department_id inválido' }, 400);
    }
    const target = await context.env.DB.prepare(
      'SELECT id FROM departments WHERE id = ?'
    ).bind(body.department_id).first();
    if (!target) return context.json({ error: 'DEPARTMENT_NOT_FOUND' }, 404);
    departmentId = body.department_id;
  }

  let slug = current.slug;
  const wantSlug = typeof body.slug === 'string' && body.slug.trim() ? slugify(body.slug) : null;
  if (wantSlug || name !== current.name || departmentId !== current.department_id) {
    // La unicidad del slug es por (department_id, slug): hay que excluirse a
    // uno mismo y acotar al departamento destino (puede haber cambiado).
    slug = await uniqueSlug(
      context.env, 'subdepartments',
      wantSlug || slugify(name),
      'id != ? AND department_id = ?',
      [id, departmentId]
    );
  }

  try {
    await context.env.DB.prepare(
      'UPDATE subdepartments SET department_id = ?, name = ?, slug = ? WHERE id = ?'
    ).bind(departmentId, name, slug, id).run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return context.json({ error: 'DUPLICATE_NAME', message: `"${name}" ya existe en ese departamento` }, 409);
    }
    throw err;
  }

  await logAudit(context.env, context.get('authUserId'), 'UPDATE_SUBDEPARTMENT', 'subdepartment', id, {
    prev: current, next: { department_id: departmentId, name, slug },
  });

  return context.json({ data: { id, department_id: departmentId, name, slug } });
});

// DELETE /admin/subdepartments/:id - Borrar subdepartamento
adminRoutes.delete('/subdepartments/:id', async (context) => {
  if (await isSafetyLockOn(context.env)) {
    return context.json({ error: 'SAFETY_LOCKED', message: 'Modo seguro activo: desactívalo en Configuración para borrar' }, 403);
  }
  const id = context.req.param('id');

  const current = await context.env.DB.prepare(
    'SELECT name FROM subdepartments WHERE id = ?'
  ).bind(id).first() as { name: string } | null;
  if (!current) return context.json({ error: 'SUBDEPARTMENT_NOT_FOUND' }, 404);

  // products.subdepartment_id es NOT NULL sin CASCADE: borrar con productos
  // vivos dejaría filas huérfanas o un 500 por FK.
  const used = await context.env.DB.prepare(
    "SELECT COUNT(*) as count FROM products WHERE subdepartment_id = ? AND status != 'archived'"
  ).bind(id).first() as { count: number } | null;

  if ((used?.count || 0) > 0) {
    return context.json({
      error: 'SUBDEPARTMENT_NOT_EMPTY',
      message: `Tiene ${used?.count} producto(s) activo(s). Muévelos o archívalos antes de borrarlo`,
    }, 409);
  }

  await context.env.DB.prepare('DELETE FROM subdepartments WHERE id = ?').bind(id).run();
  await logAudit(context.env, context.get('authUserId'), 'DELETE_SUBDEPARTMENT', 'subdepartment', id, { name: current.name });

  return context.json({ data: { deleted: true } });
});
