import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';
import { sendEmail, orderEmailHtml, orderStatusEmailHtml } from '../../lib/email';

const checkoutSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().min(1),
    quantity: z.number().int().positive().max(99),
  })).min(1).max(50),
  shipping_name: z.string().min(1).max(100),
  shipping_email: z.string().email(),
  shipping_phone: z.string().min(1).max(20),
  shipping_address: z.string().min(1).max(200),
  payment_method: z.enum(['card', 'paypal', 'bank']),
  card_number: z.string().optional(),
  card_expiry: z.string().optional(),
  card_cvv: z.string().optional(),
}).refine((data) => {
  if (data.payment_method !== 'card') return true;
  return !!(data.card_number && data.card_expiry && data.card_cvv);
}, {
  message: 'Card details are required when payment method is card',
  path: ['card_number'],
});

function generateId(): string {
  return crypto.randomUUID();
}

export const ordersRoutes = new Hono<{ Bindings: Bindings }>();

// POST /orders
ordersRoutes.post('/', async (context) => {
  const body = await context.req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  const { items, shipping_name, shipping_email, shipping_phone, shipping_address, payment_method } = parsed.data;

  // La compra exige sesión válida (el front la pide antes del checkout).
  // Sin esto, user_id sería null y viola el NOT NULL de orders.user_id.
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED', message: 'Inicia sesión para comprar' }, 401);
  }

  const token = authHeader.slice(7);
  const session = await context.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id = ? AND expires_at > strftime(\'%s\', \'now\')'
  ).bind(token).first();

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED', message: 'Sesión expirada. Inicia sesión de nuevo.' }, 401);
  }

  const userId = session.user_id as string;

  // Validate products and calculate total.
  // D1 no soporta BEGIN/COMMIT raw: se valida con SELECTs y se escribe con
  // db.batch() (atómico). El UPDATE de stock es condicional (>= qty) y se
  // verifica por changes; si falla, se compensa borrando orden + restaurando stock.
  let totalCents = 0;
  const orderItems: Array<{ product_id: string; name: string; quantity: number; price_cents: number }> = [];

  const orderId = generateId();

  for (const item of items) {
    const product = await context.env.DB.prepare(
      'SELECT id, name, price_cents, stock_quantity FROM products WHERE id = ? AND status = ?'
    ).bind(item.product_id, 'active').first();

    if (!product) {
      return context.json({ error: 'PRODUCT_NOT_FOUND', product_id: item.product_id }, 404);
    }

    if ((product.stock_quantity as number) < item.quantity) {
      return context.json({ error: 'INSUFFICIENT_STOCK', product_id: item.product_id }, 400);
    }

    const priceCents = product.price_cents as number;
    totalCents += priceCents * item.quantity;
    orderItems.push({
      product_id: item.product_id,
      name: (product.name as string) || item.product_id,
      quantity: item.quantity,
      price_cents: priceCents,
    });
  }

  // Escritura atómica: orden + items + decremento condicional de stock
  const statements = [
    context.env.DB.prepare(
      `INSERT INTO orders (id, user_id, status, total_cents, shipping_name, shipping_email, shipping_phone, shipping_address, payment_method)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    ).bind(orderId, userId, totalCents, shipping_name, shipping_email, shipping_phone, shipping_address, payment_method),
    ...orderItems.map((item) =>
      context.env.DB.prepare(
        'INSERT INTO order_items (id, order_id, product_id, quantity, price_cents) VALUES (?, ?, ?, ?, ?)'
      ).bind(generateId(), orderId, item.product_id, item.quantity, item.price_cents)
    ),
    ...orderItems.map((item) =>
      context.env.DB.prepare(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND status = ? AND stock_quantity >= ?'
      ).bind(item.quantity, item.product_id, 'active', item.quantity)
    ),
  ];

  const batchResults = await context.env.DB.batch(statements);
  const stockResults = batchResults.slice(1 + orderItems.length);
  const raceFailed = stockResults.some((res) => ((res.meta as { changes?: number } | undefined)?.changes ?? 0) === 0);

  if (raceFailed) {
    // Otro checkout ganó la carrera: compensar (restaurar lo decrementado + borrar orden)
    const compensation = [
      ...orderItems.map((item, i) => {
        const changed = ((stockResults[i].meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
        return changed
          ? context.env.DB.prepare(
              'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?'
            ).bind(item.quantity, item.product_id)
          : null;
      }).filter((s): s is D1PreparedStatement => s !== null),
      context.env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(orderId),
      context.env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(orderId),
    ];
    await context.env.DB.batch(compensation);
    return context.json({ error: 'INSUFFICIENT_STOCK', message: 'Stock insuficiente (otro comprador fue más rápido)' }, 400);
  }

  // Confirmación por email (no bloquea ni tumba la orden si falla)
  sendOrderConfirmation(context.env, orderId, orderItems, totalCents, shipping_name, shipping_email);

  return context.json({
    data: {
      id: orderId,
      status: 'pending',
      total_cents: totalCents,
      items: orderItems,
    },
  }, 201);
});

function sendOrderConfirmation(env: Bindings, orderId: string, items: Array<{ name: string; quantity: number; price_cents: number }>, totalCents: number, shippingName: string, shippingEmail: string): void {
  // Fire-and-forget: el email nunca debe tumbar la orden (sendEmail no lanza)
  void sendEmail(
    env,
    shippingEmail,
    `Tu pedido SUPRIME ${orderId.slice(0, 8)}`,
    orderEmailHtml(orderId, items, totalCents, shippingName)
  ).then((sent) => {
    if (!sent) console.warn(`Order confirmation email for order ${orderId} could not be sent`);
  });
}

// GET /orders (user's orders)
ordersRoutes.get('/', async (context) => {
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

  const orders = await context.env.DB.prepare(
    `SELECT id, status, total_cents, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(session.user_id).all();

  return context.json({ data: orders.results });
});

// GET /orders/:id
ordersRoutes.get('/:id', async (context) => {
  const orderId = context.req.param('id');

  // Verificar autenticación
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

  const order = await context.env.DB.prepare(
    `SELECT o.id, o.status, o.total_cents, o.shipping_name, o.shipping_email,
            o.shipping_phone, o.shipping_address, o.payment_method, o.created_at, o.user_id,
            oi.product_id, oi.quantity, oi.price_cents, p.name as product_name
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.id = ?`
  ).bind(orderId).all();

  if (order.results.length === 0) {
    return context.json({ error: 'ORDER_NOT_FOUND' }, 404);
  }

  // Verificar que el usuario es dueño de la orden
  const first = order.results[0] as Record<string, unknown>;
  if (first.user_id !== session.user_id) {
    return context.json({ error: 'FORBIDDEN' }, 403);
  }

  const items = order.results.map(r => {
    const row = r as Record<string, unknown>;
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      quantity: row.quantity,
      price_cents: row.price_cents,
    };
  });

  return context.json({
    data: {
      id: first.id,
      status: first.status,
      total_cents: first.total_cents,
      shipping_name: first.shipping_name,
      shipping_email: first.shipping_email,
      shipping_phone: first.shipping_phone,
      shipping_address: first.shipping_address,
      payment_method: first.payment_method,
      created_at: first.created_at,
      items,
    },
  });
});
