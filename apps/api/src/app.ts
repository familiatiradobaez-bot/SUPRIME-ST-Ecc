import { Hono } from 'hono';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { ordersRoutes } from './modules/orders/orders.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { googleRoutes } from './modules/auth/google.routes';
import { uploadRoutes } from './modules/upload/upload.routes';

export type Bindings = {
  DB: D1Database;
  APP_ENV: string;
  IMGBB_API_KEY?: string;
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
    context.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://api.suprime.xyz https://suprime.xyz https://suprime-st-ecc-api.familia-tirado-baez.workers.dev https://*.trycloudflare.com https://*.ngrok-free.dev https://*.pages.dev http://localhost:* http://127.0.0.1:* http://192.168.*:* https://api.imgbb.com https://api.qrserver.com;");
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

  // CSRF protection middleware - TEMPORARILY DISABLED
  // TODO: Re-enable CSRF protection once CORS issues are resolved
  // api.use('*', async (context, next) => {
  //   const method = context.req.method;
  //   if (method === 'OPTIONS') {
  //     return next();
  //   }
  //   if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
  //     const origin = context.req.header('Origin');
  //     const referer = context.req.header('Referer');
  //     const isAllowedOrigin = (val?: string): boolean => {
  //       if (!val) return false;
  //       try {
  //         const originUrl = val.startsWith('http') ? new URL(val).origin : val;
  //         return allowedOrigins.includes(originUrl) ||
  //                originUrl.endsWith('.pages.dev') ||
  //                originUrl.endsWith('.trycloudflare.com') ||
  //                originUrl.endsWith('.ngrok-free.dev') ||
  //                originUrl.includes('localhost:') ||
  //                originUrl.includes('127.0.0.1:') ||
  //                originUrl.includes('192.168.');
  //       } catch {
  //         return false;
  //       }
  //     };
  //     const isAllowed = isAllowedOrigin(origin) || isAllowedOrigin(referer);
  //     if (!isAllowed && context.env.APP_ENV === 'production') {
  //       return context.json({ error: 'FORBIDDEN', message: 'Invalid origin' }, 403);
  //     }
  //   }
  //   await next();
  // });

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
