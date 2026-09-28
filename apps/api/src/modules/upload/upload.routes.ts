import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';

export type UploadBindings = Bindings & {
  IMAGEKIT_PRIVATE_KEY: string;
};

// Allowed image MIME types
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Rate limiting (simple in-memory - use KV in production)
const uploadAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempt = uploadAttempts.get(ip);

  if (!attempt || attempt.resetAt < now) {
    uploadAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }

  if (attempt.count >= 20) {
    return false;
  }

  attempt.count++;
  return true;
}

// Validate image data URL
const imageDataSchema = z.object({
  dataUrl: z.string().refine(
    (val) => val.startsWith('data:image/') && val.includes(';base64,'),
    { message: 'Invalid image data URL' }
  ),
  filename: z.string().min(1).max(255).optional(),
});

// Validate manual URL
const manualUrlSchema = z.object({
  url: z.string().url().refine(
    (val) => /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(val),
    { message: 'Invalid image URL format' }
  ),
});

export const uploadRoutes = new Hono<{ Bindings: UploadBindings }>();

const GALLERY_ADMIN_ROLES = ['role-admin', 'role-owner', 'role-stock-manager'];

// Subir y ver galería requieren sesión admin válida (el token es el id de sesión).
// Sin esto cualquiera consumiría la cuota de ImageKit (solo había rate-limit).
async function requireUploadAdmin(context: any, next: () => Promise<void>) {
  const authHeader = context.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return context.json({ error: 'UNAUTHORIZED', message: 'Inicia sesión como admin para gestionar imágenes' }, 401);
  }
  let roleId: string | null = null;
  try {
    const parts = atob(authHeader.slice(7)).split(':');
    if (parts.length >= 2) roleId = parts[1];
  } catch {
    return context.json({ error: 'UNAUTHORIZED' }, 401);
  }
  if (!roleId || !GALLERY_ADMIN_ROLES.includes(roleId)) {
    return context.json({ error: 'FORBIDDEN', message: 'Admin access required' }, 403);
  }
  const sess = await context.env.DB.prepare(
    'SELECT id FROM sessions WHERE id = ? AND expires_at > strftime(\'%s\', \'now\')'
  ).bind(authHeader.slice(7)).first();
  if (!sess) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }
  await next();
}

uploadRoutes.use('/images', requireUploadAdmin);
uploadRoutes.use('/imagekit', requireUploadAdmin);

// GET /upload/images - Listar imágenes subidas (galería reutilizable, paginada)
uploadRoutes.get('/images', async (context) => {
  if (!context.env.IMAGEKIT_PRIVATE_KEY) {
    return context.json({ error: 'SERVER_CONFIG_ERROR', message: 'Image upload service not configured (missing IMAGEKIT_PRIVATE_KEY on server)' }, 500);
  }

  const limit = Math.min(Math.max(parseInt(context.req.query('limit') || '100', 10) || 100, 1), 100);
  const skip = Math.max(parseInt(context.req.query('skip') || '0', 10) || 0, 0);

  try {
    const credentials = btoa(`${context.env.IMAGEKIT_PRIVATE_KEY}:`);
    const params = new URLSearchParams({ path: '/products', limit: String(limit), skip: String(skip), sort: 'DESC_CREATED' });
    const response = await fetch(`https://api.imagekit.io/v1/files?${params}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!response.ok) {
      console.error('ImageKit list failed:', await response.text());
      return context.json({ error: 'GALLERY_FAILED', message: 'Failed to list images' }, 502);
    }

    const files = await response.json() as Array<{
      fileId: string; name: string; url: string; thumbnailUrl?: string; filePath: string; size?: number;
    }>;

    return context.json({
      data: files.map(f => ({
        fileId: f.fileId,
        name: f.name,
        url: f.url,
        thumbnail: f.thumbnailUrl || f.url,
        filePath: f.filePath,
        size: f.size,
      })),
    });
  } catch (err) {
    console.error('ImageKit list error:', err);
    return context.json({ error: 'GALLERY_ERROR', message: 'Failed to list images' }, 502);
  }
});

// POST /upload/imagekit - Upload image to ImageKit via server (ruta global)
uploadRoutes.post('/imagekit', async (context) => {
  const clientIp = context.req.header('CF-Connecting-IP') || context.req.header('X-Forwarded-For') || 'unknown';

  if (!checkRateLimit(clientIp)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many upload attempts' }, 429);
  }

  // Check private key is configured
  if (!context.env.IMAGEKIT_PRIVATE_KEY) {
    console.error('IMAGEKIT_PRIVATE_KEY not configured in server environment. Fix: run `wrangler secret put IMAGEKIT_PRIVATE_KEY`.');
    return context.json({ error: 'SERVER_CONFIG_ERROR', message: 'Image upload service not configured (missing IMAGEKIT_PRIVATE_KEY on server)' }, 500);
  }

  const body = await context.req.json().catch(() => null);
  const parsed = imageDataSchema.safeParse(body);

  if (!parsed.success) {
    return context.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, 400);
  }

  const { dataUrl, filename } = parsed.data;

  // Validate file size (approximate from base64 length)
  const base64Length = dataUrl.split(';base64,')[1]?.length || 0;
  const approximateSize = Math.ceil((base64Length * 3) / 4);
  if (approximateSize > MAX_FILE_SIZE) {
    return context.json({ error: 'FILE_TOO_LARGE', message: 'Image must be smaller than 5MB' }, 400);
  }

  // Extract MIME type
  const mimeMatch = dataUrl.match(/^data:(image\/[a-z]+);base64,/);
  if (!mimeMatch || !ALLOWED_TYPES.includes(mimeMatch[1])) {
    return context.json({ error: 'INVALID_TYPE', message: 'Only JPEG, PNG, GIF and WebP images are allowed' }, 400);
  }

  // Upload to ImageKit (server-side, private key nunca sale del Worker)
  try {
    const base64Data = dataUrl.split(';base64,')[1];
    const ext = mimeMatch[1].split('/')[1] === 'jpeg' ? 'jpg' : mimeMatch[1].split('/')[1];
    const safeName = (filename || `upload-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, '_');

    const formData = new FormData();
    formData.append('file', base64Data);
    formData.append('fileName', `${safeName}.${ext}`);
    formData.append('folder', '/products');

    const credentials = btoa(`${context.env.IMAGEKIT_PRIVATE_KEY}:`);
    const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
      body: formData,
    });

    const result = await response.json() as {
      fileId?: string;
      name?: string;
      url?: string;
      thumbnailUrl?: string;
      filePath?: string;
      error?: { message?: string };
      message?: string;
    };

    if (!response.ok || !result.url) {
      console.error('ImageKit upload failed:', result.error?.message || result.message || 'Unknown error');
      return context.json({ error: 'UPLOAD_FAILED', message: 'Failed to upload image' }, 502);
    }

    return context.json({
      data: {
        url: result.url,
        display_url: result.thumbnailUrl || result.url,
        fileId: result.fileId,
        name: result.name,
        filePath: result.filePath,
      },
    });
  } catch (err) {
    console.error('ImageKit upload error:', err);
    return context.json({ error: 'UPLOAD_ERROR', message: 'Failed to upload image' }, 502);
  }
});

// POST /upload/validate-url - Validate manual image URL
uploadRoutes.post('/validate-url', async (context) => {
  const body = await context.req.json().catch(() => null);
  const parsed = manualUrlSchema.safeParse(body);

  if (!parsed.success) {
    return context.json({ error: 'INVALID_URL', details: parsed.error.flatten() }, 400);
  }

  return context.json({ data: { valid: true, url: parsed.data.url } });
});

// GET /upload/rate-limit-status - Check rate limit status
uploadRoutes.get('/rate-limit-status', async (context) => {
  const clientIp = context.req.header('CF-Connecting-IP') || context.req.header('X-Forwarded-For') || 'unknown';
  const attempt = uploadAttempts.get(clientIp);

  if (!attempt || attempt.resetAt < Date.now()) {
    return context.json({ data: { remaining: 20, resetIn: 0 } });
  }

  return context.json({
    data: {
      remaining: Math.max(0, 20 - attempt.count),
      resetIn: Math.max(0, attempt.resetAt - Date.now()),
    },
  });
});
