import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { ordersRoutes } from './modules/orders/orders.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { googleRoutes } from './modules/auth/google.routes';

export type Bindings = {
  DB: D1Database;
  APP_ENV: string;
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
    'https://suprime-st-ecc.pages.dev',
    'https://anew-straw-goggles.ngrok-free.dev',
  ];

  api.use('*', cors({ origin: (origin) => {
    if (!origin) return null;
    if (allowedOrigins.includes(origin)) return origin;
    // Permitir cualquier subdominio de pages.dev (Cloudflare Pages)
    if (origin.endsWith('.pages.dev')) return origin;
    // Permitir cualquier subdominio de trycloudflare.com
    if (origin.endsWith('.trycloudflare.com')) return origin;
    // Permitir cualquier subdominio de ngrok-free.dev
    if (origin.endsWith('.ngrok-free.dev')) return origin;
    return null;
  }}));
  api.get('/health', (context) => context.json({ status: 'ok', environment: context.env.APP_ENV }));
  api.route('/catalog', catalogRoutes);
  api.route('/auth', authRoutes);
  api.route('/orders', ordersRoutes);
  api.route('/admin', adminRoutes);
  api.route('/auth/google', googleRoutes);
  app.route('/api/v1', api);

  return app;
}