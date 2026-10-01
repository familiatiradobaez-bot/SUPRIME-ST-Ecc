import { Hono } from 'hono';
import type { Bindings } from '../../app';
import { SITIO_CANONICO } from '../../lib/site';

export const catalogRoutes = new Hono<{ Bindings: Bindings }>();

// GET /store-settings - Ajustes públicos de la tienda (solo claves seguras).
// El front los usa para mostrar portes y el modo mantenimiento.
catalogRoutes.get('/store-settings', async (context) => {
  const rows = await context.env.DB.prepare(
    'SELECT key, value FROM store_settings WHERE key IN (\'store_name\',\'store_description\',\'shipping_cost\',\'free_shipping_threshold\',\'maintenance_mode\')'
  ).all();
  const settings: Record<string, string> = {
    store_name: 'SUPRIME',
    store_description: '',
    shipping_cost: '490',
    free_shipping_threshold: '6000',
    maintenance_mode: '0',
  };
  for (const row of (rows.results || []) as Array<{ key: string; value: string }>) {
    settings[row.key] = row.value;
  }
  return context.json({ data: settings });
});

const PRODUCT_SELECT = `p.id, p.name, p.slug, p.description, p.image_url, p.price_cents,
  p.stock_quantity, p.subdepartment_id, sd.name as subdepartment_name, sd.slug as subdepartment_slug,
  d.slug as department_slug, d.name as department_name`;
const PRODUCT_JOINS = `FROM products p
  JOIN subdepartments sd ON sd.id = p.subdepartment_id
  JOIN departments d ON d.id = sd.department_id`;

async function getProductImages(env: Bindings, productId: string, fallback: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT url FROM product_images WHERE product_id = ? ORDER BY display_order ASC'
  ).bind(productId).all();
  const urls = (rows.results || []).map((r: any) => r.url).filter(Boolean);
  return urls.length > 0 ? urls : (fallback ? [fallback] : []);
}

async function withImages(env: Bindings, products: any[]): Promise<any[]> {
  return Promise.all(products.map(async (p) => ({
    ...p,
    images: await getProductImages(env, p.id, p.image_url),
  })));
}

// Techo de lo que se puede pedir en una pagina. Sin el, un limit=10000 se lleva
// el catalogo entero y se paga en cuota de Workers (100.000 peticiones/dia).
const MAX_LIMIT = 100;

/**
 * Lee limit y offset de la query.
 *
 * Sin limit devuelve null, y eso significa "todos". Es justo lo que hace el
 * front: pide /catalog/products sin limit y filtra en el cliente, asi que poner
 * un limite por defecto dejaria la pagina de categoria y la busqueda mostrando
 * solo unos pocos productos. Por eso el limite solo se aplica si se pide.
 *
 * Con limit, pagina de verdad. Antes se ignoraba: medido en produccion,
 * ?limit=1 devolvia los 11 productos, y offset no hacia nada. Sin eso no hay
 * paginacion posible y cualquiera se lleva el catalogo entero.
 *
 * Se validan como enteros antes de usarlos: un 'abc' no puede llegar a la
 * consulta, y LIMIT/OFFSET van atados como parametros, nunca concatenados.
 */
function leerPaginacion(url: string): { limit: number | null; offset: number } {
  const u = new URL(url);
  const rawLimit = u.searchParams.get('limit');
  const rawOffset = u.searchParams.get('offset') ?? u.searchParams.get('skip') ?? '0';

  let limit: number | null = null;
  if (rawLimit !== null && rawLimit !== '') {
    const n = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(n)) limit = Math.max(1, Math.min(n, MAX_LIMIT));
  }

  const o = Number.parseInt(rawOffset, 10);
  const offset = Number.isFinite(o) ? Math.max(0, o) : 0;
  return { limit, offset };
}

// GET /products - List all active products (con imágenes y departamento)
catalogRoutes.get('/products', async (context) => {
  const { limit, offset } = leerPaginacion(context.req.url);

  const base = `SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS} WHERE p.status = ? ORDER BY p.created_at DESC`;
  const result = limit !== null
    ? await context.env.DB.prepare(`${base} LIMIT ? OFFSET ?`).bind('active', limit, offset).all()
    : await context.env.DB.prepare(base).bind('active').all();

  return context.json({ data: await withImages(context.env, result.results) });
});

// GET /products/:slug - Get single product by slug (con imágenes)
catalogRoutes.get('/products/:slug', async (context) => {
  const slug = context.req.param('slug');

  // Validar slug para prevenir inyección SQL
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return context.json({ error: 'INVALID_SLUG' }, 400);
  }

  const product = await context.env.DB.prepare(
    `SELECT ${PRODUCT_SELECT}
     ${PRODUCT_JOINS} WHERE p.slug = ? AND p.status = ?`,
  ).bind(slug, 'active').first();

  if (!product) return context.json({ error: 'PRODUCT_NOT_FOUND' }, 404);
  const full = await withImages(context.env, [product]);
  return context.json({ data: full[0] });
});

// GET /products/:slug/related - Productos relacionados (mismo subdepartamento)
catalogRoutes.get('/products/:slug/related', async (context) => {
  const slug = context.req.param('slug');
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return context.json({ error: 'INVALID_SLUG' }, 400);
  }

  const limit = Math.min(Math.max(parseInt(context.req.query('limit') || '8', 10) || 8, 1), 20);

  const current = await context.env.DB.prepare(
    'SELECT subdepartment_id FROM products WHERE slug = ? AND status = ?'
  ).bind(slug, 'active').first() as { subdepartment_id: string } | null;

  if (!current) return context.json({ error: 'PRODUCT_NOT_FOUND' }, 404);

  const result = await context.env.DB.prepare(
    `SELECT ${PRODUCT_SELECT}
     ${PRODUCT_JOINS}
     WHERE p.subdepartment_id = ? AND p.slug != ? AND p.status = ?
     ORDER BY p.created_at DESC LIMIT ?`
  ).bind(current.subdepartment_id, slug, 'active', limit).all();

  return context.json({ data: await withImages(context.env, result.results) });
});

// GET /subdepartments/:slug/products - Productos por subdepartamento
catalogRoutes.get('/subdepartments/:slug/products', async (context) => {
  const slug = context.req.param('slug');
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return context.json({ error: 'INVALID_SLUG' }, 400);
  }

  const sub = await context.env.DB.prepare(
    `SELECT sd.id, sd.name, sd.slug, d.name as department_name, d.slug as department_slug
     FROM subdepartments sd JOIN departments d ON d.id = sd.department_id
     WHERE sd.slug = ?`
  ).bind(slug).first();

  if (!sub) return context.json({ error: 'SUBDEPARTMENT_NOT_FOUND' }, 404);

  const result = await context.env.DB.prepare(
    `SELECT ${PRODUCT_SELECT}
     ${PRODUCT_JOINS}
     WHERE p.subdepartment_id = ? AND p.status = ?
     ORDER BY p.created_at DESC`
  ).bind((sub as any).id, 'active').all();

  return context.json({ data: { subdepartment: sub, products: await withImages(context.env, result.results) } });
});

// GET /departments/:slug/products - Productos por departamento
catalogRoutes.get('/departments/:slug/products', async (context) => {
  const slug = context.req.param('slug');
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return context.json({ error: 'INVALID_SLUG' }, 400);
  }

  const dept = await context.env.DB.prepare(
    'SELECT id, name, slug FROM departments WHERE slug = ? AND is_active = 1'
  ).bind(slug).first();

  if (!dept) return context.json({ error: 'DEPARTMENT_NOT_FOUND' }, 404);

  const result = await context.env.DB.prepare(
    `SELECT ${PRODUCT_SELECT}
     ${PRODUCT_JOINS}
     WHERE d.id = ? AND p.status = ?
     ORDER BY p.created_at DESC`
  ).bind((dept as any).id, 'active').all();

  return context.json({ data: { department: dept, products: await withImages(context.env, result.results) } });
});

// GET /sitemap.xml - Sitemap para buscadores (home + secciones + productos)
catalogRoutes.get('/sitemap.xml', async (context) => {
  // Host canonico, desde lib/site.ts. El sitemap tiene que emitir SIEMPRE el
  // host canonico: si mezcla los dos, Google indexa la misma pagina dos veces
  // con dos URLs distintas.
  const base = SITIO_CANONICO;
  const urls: string[] = [
    `${base}/`,
    `${base}/favoritos`,
    `${base}/privacidad`,
    `${base}/terminos`,
    `${base}/envios`,
    `${base}/contacto`,
    `${base}/faq`,
  ];

  const departments = await context.env.DB.prepare(
    'SELECT slug FROM departments WHERE is_active = 1'
  ).all();
  for (const d of (departments.results || []) as Array<{ slug: string }>) {
    urls.push(`${base}/departamento/${d.slug}`);
  }

  const categories = await context.env.DB.prepare(
    'SELECT slug FROM categories WHERE is_active = 1'
  ).all();
  for (const c of (categories.results || []) as Array<{ slug: string }>) {
    urls.push(`${base}/categoria/${c.slug}`);
  }

  const products = await context.env.DB.prepare(
    "SELECT slug, image_url FROM products WHERE status = 'active' ORDER BY created_at DESC LIMIT 5000"
  ).all();
  const items = (products.results || []) as Array<{ slug: string; image_url: string }>;
  for (const p of items) {
    urls.push(`${base}/producto/${p.slug}`);
  }

  const firstImage = items[0]?.image_url || '';
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
    (firstImage ? `\n  <!-- image sample: ${firstImage} -->` : '') +
    `\n</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
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
    `SELECT ${PRODUCT_SELECT}
     ${PRODUCT_JOINS}
     WHERE d.id = (SELECT department_id FROM categories WHERE id = ?)
     AND p.status = ?
     ORDER BY p.created_at DESC`,
  ).bind(category.id, 'active').all();

  return context.json({ data: await withImages(context.env, result.results) });
});
