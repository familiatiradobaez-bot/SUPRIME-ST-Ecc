import { Hono } from 'hono';
import type { Bindings } from '../../app';

export const catalogRoutes = new Hono<{ Bindings: Bindings }>();

catalogRoutes.get('/products', async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT id, name, slug, description, image_url, price_cents, stock_quantity
     FROM products WHERE status = ? ORDER BY created_at DESC`,
  ).bind('active').all();

  return context.json({ data: result.results });
});

catalogRoutes.get('/products/:slug', async (context) => {
  const product = await context.env.DB.prepare(
    `SELECT id, name, slug, description, image_url, price_cents, stock_quantity
     FROM products WHERE slug = ? AND status = ?`,
  ).bind(context.req.param('slug'), 'active').first();

  if (!product) return context.json({ error: 'PRODUCT_NOT_FOUND' }, 404);
  return context.json({ data: product });
});