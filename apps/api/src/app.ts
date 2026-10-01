import { Hono } from 'hono';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { ordersRoutes } from './modules/orders/orders.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { googleRoutes } from './modules/auth/google.routes';
import { origenPermitido, SITIO_CANONICO } from './lib/site';
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
  /**
   * Clave de 32 bytes en base64url con la que se cifra el secreto TOTP en D1.
   * Vive en un secreto del Worker, NUNCA en D1 ni en wrangler.toml: si estuviera
   * junto al dato, cifrar no serviría de nada. Ver lib/secrets-box.ts.
   */
  TOTP_ENCRYPTION_KEY?: string;
};

export function createApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  const api = new Hono<{ Bindings: Bindings }>();

  app.get('/', (context) => context.json({
    name: 'Cerebro E-commerce API',
    status: 'ok',
    health: '/api/v1/health',
  }));

  // ── Orígenes permitidos ──────────────────────────────────────────────────
  //
  // Todo esto vive ahora en lib/site.ts, junto con SITIO_CANONICO. Se movió
  // porque el dominio y la lista de orígenes estaban escritos a mano en varios
  // ficheros (este, catalog.routes.ts, google.routes.ts) y eso hace que cambiar
  // el dominio obligue a cazarlos todos, con lo fácil que es dejar alguno con el
  // host viejo.
  //
  // El resumen de por qué la lista está partida en dos, que es lo que no hay que
  // deshacer:
  //
  //  - En PRODUCCIÓN solo entran los dominios de SUPRIME, por nombre exacto.
  //  - Fuera de producción se añaden localhost, 127.0.0.1 y la red local, que es
  //    el flujo documentado (NETWORK_ACCESS.md y `npm run network-info`, que es
  //    abrir la web desde el móvil). Se cubren por patrón y no por puerto porque
  //    Vite va con `strictPort: false`: si el 5173 está ocupado se va al 5174 y
  //    una lista fija de puertos se quedaba corta sola.
  //  - NO hay comodines de túnel (`.trycloudflare.com`, `.ngrok-free.dev`) ni de
  //    `*.pages.dev`. Estaban hasta el 30-sep y sequitaron porque dejaban pasar
  //    a cualquier túnel gratis o a cualquier proyecto de Pages de cualquier
  //    cuenta. Comprobado en producción antes de hacerlo: respondían 401 en vez
  //    de 403, o sea que la petición llegaba al handler, y un pages.dev ajeno
  //    recibía Access-Control-Allow-Origin con credenciales.
  //    Si algún día hace falta un túnel, se añade SU dominio exacto.
  //
  // Severidad de aquel problema: BAJA, no alta. La autenticación no era
  // vulnerable a esto: va por `Authorization: Bearer` en localStorage, que otra
  // origen no puede leer, y la cookie `session_token` es HttpOnly +
  // SameSite=Strict, que el navegador ni manda cross-site (verificado: /admin/*
  // solo con cookie responde 401). Lo que estaba anulada era la barrera de
  // defensa en profundidad del middleware.
  //
  // Nota: los despliegues de vista previa dejan de funcionar contra esta API de
  // producción, que es lo correcto.

  // Security headers + CORS middleware (manual CORS to avoid body consumption)
  api.use('*', async (context, next) => {
    const requestOrigin = context.req.header('Origin');
    const esProduccion = context.env.APP_ENV === 'production';

    // CORS headers
    if (requestOrigin) {
      // Misma lista que el CSRF y por el mismo motivo: con los comodines de
      // túnel, cualquier origen de trycloudflare/ngrok se llevaba un
      // "Access-Control-Allow-Origin" con credenciales. En produccion solo los
      // orígenes exactos de SUPRIME.
      if (origenPermitido(requestOrigin, esProduccion)) {
        context.header('Access-Control-Allow-Origin', requestOrigin);
        context.header('Access-Control-Allow-Credentials', 'true');
        context.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        context.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        context.header('Access-Control-Expose-Headers', 'Set-Cookie');
      }
    }

    // Security headers
    //
    // El CSP se construye con el dominio canonico en vez de escribirlo a mano,
    // que es como se quedaba desactualizado. connect-src es donde puede ir el
    // front a conectarse: el mismo origen (self), la API y los dos hosts de la
    // tienda. Sin comodines de tunel ni IP locales: no hacen falta para que
    // funcione `npm run dev`, que solo necesita la API de destino.
    //
    // QUE ESTA Y QUE NO ESTA, Y POR QUE
    //
    // OJO: una CSP solo se aplica a quien la recibe como DOCUMENTO. Las
    // respuestas de esta API son JSON, asi que en la practica esta cabecera no
    // restringe nada por si sola: la que protege de verdad la web es la que va
    // en el <meta http-equiv> del index.html, y esa es la que lleva
    // script-src SIN 'unsafe-inline'. Aqui se mantiene igual y sin
    // 'unsafe-inline' en script por coherencia, para que si alguna vez esta
    // respuesta se sirviera como documento, la politica sea la restrictiva.
    //
    // 'unsafe-inline' SE QUEDA en style-src, tambien aqui: el front tiene 91
    // atributos style= y sin eso la app no aplica sus estilos. CSS inyectado no
    // ejecuta codigo, que es la diferencia con el caso de script.
    const csp = [
      "default-src 'self'",
      "script-src 'self' https://fonts.googleapis.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      // Refuerzo: object-src y base-uri son los que se suelen olvidar.
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      esProduccion
        ? `connect-src 'self' ${SITIO_CANONICO} https://suprime.xyz https://api.suprime.xyz https://suprime-st-ecc-api.familia-tirado-baez.workers.dev https://api.bigdatacloud.net https://api.qrserver.com`
        // En desarrollo solo hace falta que el front (5173/4173) hable con la
        // API local (8787). El comodin de red local se fue tambien: no hacia
        // falta para nada y permitiria a cualquier IP de la LAN.
        : `connect-src 'self' ${SITIO_CANONICO} https://suprime.xyz https://api.suprime.xyz https://suprime-st-ecc-api.familia-tirado-baez.workers.dev https://api.bigdatacloud.net http://localhost:* http://127.0.0.1:* https://api.qrserver.com`,
    ].join('; ');
    context.header('Content-Security-Policy', csp);
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

    const esProduccion = context.env.APP_ENV === 'production';
    const origin = context.req.header('Origin');
    const referer = context.req.header('Referer');

    // Cliente no-navegador (smoke, curl, otro backend): sin Origin no hay nada
    // que validar. Va con Bearer token, que no se puede falsificar.
    if (origin === undefined && referer === undefined) {
      return next();
    }

    if (!origenPermitido(origin, esProduccion) && !origenPermitido(referer, esProduccion)) {
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
