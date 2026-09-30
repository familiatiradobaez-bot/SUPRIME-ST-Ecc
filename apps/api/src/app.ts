import { Hono } from 'hono';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { ordersRoutes } from './modules/orders/orders.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { googleRoutes } from './modules/auth/google.routes';
import { uploadRoutes } from './modules/upload/upload.routes';

export type EmailBinding = {
  send(message: {
    from: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
};

export type Bindings = {
  DB: D1Database;
  APP_ENV: string;
  EMAIL?: EmailBinding;
  RATE_LIMIT_KV?: KVNamespace;
  IMAGEKIT_PRIVATE_KEY?: string;
  IMAGEKIT_PUBLIC_KEY?: string;
  IMAGEKIT_URL_ENDPOINT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  RESEND_API_KEY?: string;
};

export function createApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  const api = new Hono<{ Bindings: Bindings }>();

  app.get('/', (context) => context.json({
    name: 'Cerebro E-commerce API',
    status: 'ok',
    health: '/api/v1/health',
  }));

  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://192.168.0.105:5176',
    'http://192.168.0.105:5173',
    'https://suprime.xyz',
    'https://www.suprime.xyz',
    'https://suprime-st-ecc.pages.dev',
    'https://anew-straw-goggles.ngrok-free.dev',
    'https://api.suprime.xyz',
  ];

  // Security headers + CORS middleware (manual CORS to avoid body consumption)
  api.use('*', async (context, next) => {
    const requestOrigin = context.req.header('Origin');

    // CORS headers
    if (requestOrigin) {
      if (allowedOrigins.includes(requestOrigin) ||
          requestOrigin.endsWith('.pages.dev') ||
          requestOrigin.endsWith('.trycloudflare.com') ||
          requestOrigin.endsWith('.ngrok-free.dev')) {
        context.header('Access-Control-Allow-Origin', requestOrigin);
        context.header('Access-Control-Allow-Credentials', 'true');
        context.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        context.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        context.header('Access-Control-Expose-Headers', 'Set-Cookie');
      }
    }

    // Security headers
    context.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://api.suprime.xyz https://suprime.xyz https://suprime-st-ecc-api.familia-tirado-baez.workers.dev https://api.bigdatacloud.net https://*.trycloudflare.com https://*.ngrok-free.dev https://*.pages.dev http://localhost:* http://127.0.0.1:* http://192.168.0.105:8789 https://api.qrserver.com;");
    context.header('X-XSS-Protection', '1; mode=block');
    context.header('X-Frame-Options', 'DENY');
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (context.env.APP_ENV === 'production') {
      context.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    if (context.req.method === 'OPTIONS') {
      return context.body(null, 204);
    }

    await next();
  });

  // ── CSRF ────────────────────────────────────────────────────────────────
  //
  // Se desactivó el 2026-09-28 (commit da4386f) por un "403 Invalid origin" en
  // las peticiones de admin. La causa NO era un problema de CORS: el middleware
  // exigía un Origin válido SIEMPRE, y el propio smoke (node fetch) y cualquier
  // cliente servidor-a-servidor no mandan esa cabecera. O sea, la protección
  // bloqueaba a un cliente legítimo y no a un atacante.
  //
  // Regla correcta: solo se valida el origen cuando la petición parece venir de
  // un NAVEGADOR, que es el único caso en el que el navegador adjunta las
  // credenciales por su cuenta. Si no hay Origin ni Referer, no hay CSRF que
  // explotar.
  //
  // Y en esta API el riesgo es estructuralmente nulo aunque se quite el
  // middleware: la autenticación es `Authorization: Bearer <token>` con el token
  // en localStorage, que un atacante de otro origen no puede leer ni lograr que
  // se envíe. La cookie `session_token` es HttpOnly + SameSite=Strict y además
  // la API no la lee para autenticar (verificado: /admin/* con solo cookie → 401).
  //
  // Se deja igualmente el control: es una barrera gratuita y protege frente a
  // que en el futuro alguien meta un endpoint que sí use la cookie.
  api.use('*', async (context, next) => {
    const method = context.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const origin = context.req.header('Origin');
    const referer = context.req.header('Referer');

    // Cliente no-navegador (smoke, curl, otro backend): sin Origin no hay nada
    // que validar. Va con Bearer token, que no se puede falsificar.
    if (origin === undefined && referer === undefined) {
      return next();
    }

    const isAllowed = (val: string | undefined): boolean => {
      if (!val) return false;
      try {
        const u = val.startsWith('http') ? new URL(val).origin : val;
        return allowedOrigins.includes(u) ||
          u.endsWith('.pages.dev') ||
          u.endsWith('.trycloudflare.com') ||
          u.endsWith('.ngrok-free.dev') ||
          u.includes('localhost:') ||
          u.includes('127.0.0.1:') ||
          u.includes('192.168.');
      } catch {
        return false;
      }
    };

    if (!isAllowed(origin) && !isAllowed(referer)) {
      return context.json({ error: 'FORBIDDEN', message: 'Invalid origin' }, 403);
    }

    await next();
  });

  // CORS handled manually in security headers middleware to avoid body consumption
  api.get('/health', (context) => {
    context.header('X-API-Version', '2.0.1');
    return context.json({ status: 'ok', environment: context.env.APP_ENV, version: '2.0.1' });
  });
  api.route('/catalog', catalogRoutes);
  api.route('/auth', authRoutes);
  api.route('/orders', ordersRoutes);
  api.route('/admin', adminRoutes);
  api.route('/auth/google', googleRoutes);
  api.route('/upload', uploadRoutes);

  app.route('/api/v1', api);
  app.route('/api', api);

  return app;
}
