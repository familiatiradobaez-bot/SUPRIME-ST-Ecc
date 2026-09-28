import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
  ];

  // Security headers middleware
  api.use('*', async (context, next) => {
    context.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'");
    context.header('X-XSS-Protection', '1; mode=block');
    context.header('X-Frame-Options', 'DENY');
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (context.env.APP_ENV === 'production') {
      context.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    await next();
  });

  // CSRF protection middleware
  api.use('*', async (context, next) => {
    const method = context.req.method;
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      const origin = context.req.header('Origin');
      const referer = context.req.header('Referer');
      const isAllowed = (origin && allowedOrigins.includes(origin)) || 
                        (referer && allowedOrigins.some(o => referer.startsWith(o)));
      if (!isAllowed && context.env.APP_ENV === 'production') {
        return context.json({ error: 'FORBIDDEN', message: 'Invalid origin' }, 403);
      }
    }
    await next();
  });

  api.use('*', cors({
    origin: (origin) => {
      if (!origin) return null;
      if (allowedOrigins.includes(origin)) return origin;
      if (origin.endsWith('.pages.dev')) return origin;
      if (origin.endsWith('.trycloudflare.com')) return origin;
      if (origin.endsWith('.ngrok-free.dev')) return origin;
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['Set-Cookie'],
  }));
  api.get('/health', (context) => context.json({ status: 'ok', environment: context.env.APP_ENV }));
  api.route('/catalog', catalogRoutes);
  api.route('/auth', authRoutes);
  api.route('/orders', ordersRoutes);
  api.route('/admin', adminRoutes);
  api.route('/auth/google', googleRoutes);
  api.route('/upload', uploadRoutes);
  app.route('/api/v1', api);

  return app;
}
