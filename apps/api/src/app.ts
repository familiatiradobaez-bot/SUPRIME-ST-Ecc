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

  // ── Orígenes permitidos ──────────────────────────────────────────────────
  //
  // Se separan los de producción de los de desarrollo porque hasta ahora todo
  // estaba mezclado y en un solo array, con lo que los comodines de desarrollo
  // seguían activos EN PRODUCCIÓN.
  //
  // Lo que se quita de producción, y por qué importa:
  //   *.trycloudflare.com y *.ngrok-free.dev  -> túneles gratis, se crean en
  //     segundos y sin cuenta. Cualquiera podía poner su origen ahí y pasar
  //     la validación igual que suprime.xyz. COMODÍN ELIMINADO: si hace falta un
  //     túnel se añade SU dominio exacto.
  //   localhost / 127.0.0.1 / 192.168.*       -> una página servida desde el
  //     propio ordenador del visitante pasaba el control. Se mantienen FUERA de
  //     producción (que es lo que se arregla aquí) porque son el flujo de
  //     desarrollo documentado: `npm run dev` y abrir la web desde el móvil.
  //   *.pages.dev                             -> cualquier proyecto de Pages de
  //     cualquier cuenta de Cloudflare. COMODÍN ELIMINADO también: el dominio de
  //     SUPRIME sigue entrando por su nombre exacto, arriba.
  //
  // Severidad: BAJA, no alta, y conviene decirlo claro para no inflarlo. Esta
  // API autentica con `Authorization: Bearer <token>` guardado en localStorage,
  // que una página de otro origen no puede leer, y la cookie `session_token` es
  // HttpOnly + SameSite=Strict, que el navegador ni siquiera manda cross-site
  // (verificado: /admin/* solo con cookie responde 401). O sea que la
  // autenticación no era vulnerable a esto. Lo que estaba anulada es la barrera
  // de defensa en profundidad que este middleware pone, y que existe para
  // proteger si algún día se mete un endpoint que sí use la cookie.
  //
  // Comprobado contra la producción ANTES de este cambio, con el smoke: un
  // origen `*.ngrok-free.dev`, `*.pages.dev` y `http://localhost:5173` pasaban
  // la validación (respondían 401 INVALID_CREDENTIALS, o sea que la petición
  // llegaba al handler) y un `pages.dev` ajeno recibía Access-Control-Allow-Origin
  // con credenciales.
  //
  // Nota para despliegues de vista previa: dejan de funcionar contra la API de
  // producción, que es lo correcto. Si hacen falta, hay que añadir su dominio
  // exacto arriba o apuntarlos a una API que no sea de producción.
  const ORIGENES_PRODUCCION = [
    'https://suprime.xyz',
    'https://www.suprime.xyz',
    'https://suprime-st-ecc.pages.dev',
    'https://api.suprime.xyz',
  ];

  // Solo se usan con APP_ENV distinto de "production".
  //
  // No se listan puertos: se acepta cualquier puerto de localhost, 127.0.0.1 y
  // de la red local. Vite va con `strictPort: false`, o sea que si el 5173 esta
  // ocupado se va al 5174, 5175... y una lista fija se quedaba corta sola. Y la
  // red local es el flujo documentado en NETWORK_ACCESS.md y en el script
  // `npm run network-info`, que es abrir http://192.168.0.105:5173 desde el
  // movil.
  //
  // Lo que se ha quitado de aqui, por muerto o por innecesario:
  //   https://anew-straw-goggles.ngrok-free.dev   -> un tunel de una sesion
  //     antigua, ese subdominio ya no existe.
  //   http://192.168.0.105:5176                   -> solo se documenta el 5173.
  //   *.trycloudflare.com y *.ngrok-free.dev       -> tuneles de una vez, se
  //     abren a mano cuando hacen falta. Estaban como comodin permanente, lo
  //     que hacia que CUALQUIER tunel de cualquiera pasara la validacion. Si
  //     vuelve a hacer falta uno, se abre el tunel y se anade SU dominio exacto
  //     arriba; no un comodin.
  const ORIGENES_DESARROLLO: string[] = [];

  /**
   * Patrones que solo valen FUERA de producción.
   *
   * Quedan localhost, 127.0.0.1 y la red local, que son el flujo de desarrollo
   * documentado (NETWORK_ACCESS.md y `npm run network-info`, que es abrir la
   * web desde el móvil). Se cubren por patrón y no por puerto porque Vite usa
   * `strictPort: false`: si el 5173 está ocupado se va al 5174, 5175...
   *
   * Ya NO están aquí los comodines de túnel (`.trycloudflare.com`,
   * `.ngrok-free.dev`) ni el de `.pages.dev`. Eran el agujero: los tres dejaban
   * pasar a cualquier túnel gratis o a cualquier proyecto de Pages de cualquier
   * cuenta. Si algún día hace falta un túnel, se abre y se añade SU dominio
   * exacto a ORIGENES_DESARROLLO.
   */
  const comodinesDesarrollo = (u: string): boolean =>
    u.includes('localhost:') ||
    u.includes('127.0.0.1:') ||
    u.includes('192.168.');

  /**
   * Origen permitido, según el entorno. Se evalúa por petición porque APP_ENV
   * vive en context.env y no se puede resolver una sola vez al arrancar.
   */
  const origenPermitido = (valor: string | undefined, esProduccion: boolean): boolean => {
    if (!valor) return false;
    let u: string;
    try {
      u = valor.startsWith('http') ? new URL(valor).origin : valor;
    } catch {
      return false;
    }
    if (ORIGENES_PRODUCCION.includes(u)) return true;
    if (esProduccion) return false;
    return ORIGENES_DESARROLLO.includes(u) || comodinesDesarrollo(u);
  };

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
    // El CSP tambien llevaba los origenes de desarrollo, incluidos los
    // comodines de tunel. Se quitan tambien en la variante de desarrollo: un
    // un CSP no necesita abrir la conexion a un tunel cualquiera para que
    // funcione `npm run dev`, solo a la API de destino (8789 en local, la de
    // produccion cuando se prueba contra ella).
    const csp = esProduccion
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://api.suprime.xyz https://suprime.xyz https://suprime-st-ecc-api.familia-tirado-baez.workers.dev https://api.bigdatacloud.net https://api.qrserver.com;"
      : "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://api.suprime.xyz https://suprime.xyz https://suprime-st-ecc-api.familia-tirado-baez.workers.dev https://api.bigdatacloud.net http://localhost:* http://127.0.0.1:* http://192.168.*:8789 https://api.qrserver.com;";
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
