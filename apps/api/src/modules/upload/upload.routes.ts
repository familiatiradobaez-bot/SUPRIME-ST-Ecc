import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';

export type UploadBindings = Bindings & {
  IMGBB_API_KEY: string;
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

// POST /upload/imgbb - Upload image to ImgBB via server
uploadRoutes.post('/imgbb', async (context) => {
  const clientIp = context.req.header('CF-Connecting-IP') || context.req.header('X-Forwarded-For') || 'unknown';
  
  if (!checkRateLimit(clientIp)) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many upload attempts' }, 429);
  }

  // Check API key is configured
  if (!context.env.IMGBB_API_KEY) {
    console.error('IMGBB_API_KEY not configured in server environment');
    return context.json({ error: 'SERVER_CONFIG_ERROR', message: 'Image upload service not configured' }, 500);
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

  // Upload to ImgBB
  try {
    const base64Data = dataUrl.split(';base64,')[1];
    
    const formData = new FormData();
    formData.append('image', base64Data);
    if (filename) {
      formData.append('name', filename.replace(/[^a-zA-Z0-9-_]/g, '_'));
    }

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${context.env.IMGBB_API_KEY}`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json() as {
      data?: {
        url: string;
        display_url: string;
        delete_url: string;
        width: number;
        height: number;
        size: number;
      };
      success?: boolean;
      error?: { message?: string };
    };

    if (!result.success || !result.data) {
      console.error('ImgBB upload failed:', result.error?.message || 'Unknown error');
      return context.json({ error: 'UPLOAD_FAILED', message: 'Failed to upload image' }, 502);
    }

    return context.json({
      data: {
        url: result.data.url,
        display_url: result.data.display_url,
        delete_url: result.data.delete_url,
        width: result.data.width,
        height: result.data.height,
        size: result.data.size,
      },
    });
  } catch (err) {
    console.error('ImgBB upload error:', err);
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
