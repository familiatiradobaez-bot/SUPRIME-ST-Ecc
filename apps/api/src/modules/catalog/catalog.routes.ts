import { Hono } from 'hono';
import type { Bindings } from '../../app';

export const catalogRoutes = new Hono<{ Bindings: Bindings }>();

// GET /products - List all active products
catalogRoutes.get('/products', async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT id, name, slug, description, image_url, price_cents, stock_quantity
     FROM products WHERE status = ? ORDER BY created_at DESC`,
  ).bind('active').all();

  return context.json({ data: result.results });
});

// GET /products/:slug - Get single product by slug
catalogRoutes.get('/products/:slug', async (context) => {
  const product = await context.env.DB.prepare(
    `SELECT id, name, slug, description, image_url, price_cents, stock_quantity
     FROM products WHERE slug = ? AND status = ?`,
  ).bind(context.req.param('slug'), 'active').first();

  if (!product) return context.json({ error: 'PRODUCT_NOT_FOUND' }, 404);
  return context.json({ data: product });
});

// GET /departments - List all departments with subdepartments
catalogRoutes.get('/departments', async (context) => {
  const departments = await context.env.DB.prepare(
    `SELECT id, name, slug FROM departments WHERE is_active = 1 ORDER BY name`,
  ).all();

  const subdepartments = await context.env.DB.prepare(
    `SELECT id, department_id, name, slug FROM subdepartments ORDER BY name`,
  ).all();

  const result = departments.results.map((dept: any) => ({
    ...dept,
    subdepartments: subdepartments.results.filter((sub: any) => sub.department_id === dept.id),
  }));

  return context.json({ data: result });
});

// GET /categories - List all categories with department info
catalogRoutes.get('/categories', async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT c.id, c.name, c.slug, c.description, c.image_url,
            d.name as department_name, d.slug as department_slug
     FROM categories c
     JOIN departments d ON d.id = c.department_id
     WHERE c.is_active = 1
     ORDER BY c.name`,
  ).all();

  return context.json({ data: result.results });
});

// GET /categories/:slug/products - Get products by category
catalogRoutes.get('/categories/:slug/products', async (context) => {
  const categorySlug = context.req.param('slug');

  const category = await context.env.DB.prepare(
    `SELECT id FROM categories WHERE slug = ? AND is_active = 1`,
  ).bind(categorySlug).first();

  if (!category) return context.json({ error: 'CATEGORY_NOT_FOUND' }, 404);

  const result = await context.env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.description, p.image_url, p.price_cents, p.stock_quantity
     FROM products p
     JOIN subdepartments sd ON sd.id = p.subdepartment_id
     WHERE sd.department_id = (SELECT department_id FROM categories WHERE id = ?)
     AND p.status = ?
     ORDER BY p.created_at DESC`,
  ).bind(category.id, 'active').all();

  return context.json({ data: result.results });
});
