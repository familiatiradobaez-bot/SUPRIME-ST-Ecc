import { Hono } from 'hono';
import type { Bindings } from '../../app';
import { checkRateLimit, rateKey } from '../../lib/rate-limit';
import { getClientIp } from '../../lib/request';
import { SITIO_CANONICO } from '../../lib/site';

// Frontend URLs for post-login redirect
// El host canonico es www (ver lib/site.ts). El apex sigue en la lista porque
// alguien puede entrar por ahi y el 301 de Cloudflare no siempre se ve en la
// peticion que hace el backend.
const FRONTEND_URLS = [
  'https://www.suprime.xyz',
  'https://suprime.xyz',
  'https://suprime-st-ecc.pages.dev',
];

// El callback SIEMPRE vive en el Worker (api.suprime.xyz), nunca en el front.
// GOOGLE_REDIRECT_URI (secret/var opcional) lo fija explícitamente; si no,
// canónico de producción; en local se usa el Host de la petición.
function getRedirectUri(context: { req: { header: (name: string) => string | undefined }; env: { GOOGLE_REDIRECT_URI?: string } }): string {
  if (context.env.GOOGLE_REDIRECT_URI) return context.env.GOOGLE_REDIRECT_URI;
  const host = context.req.header('Host') || '';
  if (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('192.168')) {
    return `http://${host}/api/v1/auth/google/callback`;
  }
  return 'https://api.suprime.xyz/api/v1/auth/google/callback';
}

// A donde se manda al usuario tras el login. Siempre al host canonico (www),
// venga el Origin que venga, para no dejar al usuario en el apex: el 301 de
// Cloudflare lo redirigiria, pero es un salto extra y un Origin con www ya es
// el caso normal.
function getFrontendUrl(context: { req: { header: (name: string) => string | undefined } }): string {
  const origin = context.req.header('Origin') || context.req.header('Referer');

  if (origin && origin.includes('pages.dev')) {
    return 'https://suprime-st-ecc.pages.dev';
  }

  return SITIO_CANONICO;
}

/**
 * Token de sesion: 32 bytes aleatorios en hexadecimal (256 bits de entropia).
 *
 * Va duplicada aqui a proposito, en vez de importarla de auth.routes.ts: ese
 * fichero no exporta las suyas y no merece la pena abrirlo solo por esto. Lo que
 * importa es que sea IGUAL en los dos sitios, porque el token se valida contra
 * `sessions` por igual en los dos caminos de login.
 *
 * NO se usa `btoa(user_id:role_id:Date.now())` como antes: eso no tiene entropia
 * (sale de tres datos que el atacante puede conocer, incluido el UUID que la
 * propia API devuelve en la respuesta del login) y base64 no es cifrado. La nota
 * larga esta en auth.routes.ts, junto a generateSessionToken().
 */
function generarTokenSesion(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

export const googleRoutes = new Hono<{ Bindings: Bindings }>();

// GET /auth/google/login - Redirect to Google OAuth
googleRoutes.get('/login', (context) => {
  const clientId = context.env.GOOGLE_CLIENT_ID;
  
  if (!clientId) {
    return context.json({ error: 'GOOGLE_AUTH_NOT_CONFIGURED', message: 'Google Client ID not configured' }, 500);
  }

  const state = crypto.randomUUID();
  const redirectUri = getRedirectUri(context);

  // Guardar state en cookie HttpOnly para validarlo en el callback (anti-CSRF).
  // SameSite=Lax permite el regreso top-level desde accounts.google.com.
  // Sin Secure en local (http), con Secure en producción (https).
  const host = context.req.header('Host') || '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('192.168');
  const stateCookie = `oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax${isLocal ? '' : '; Secure'}`;
  context.header('Set-Cookie', stateCookie);
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });

  return context.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/google/callback - Handle Google OAuth callback
googleRoutes.get('/callback', async (context) => {
  const clientId = context.env.GOOGLE_CLIENT_ID;
  const clientSecret = context.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return context.json({ error: 'GOOGLE_AUTH_NOT_CONFIGURED', message: 'Google OAuth not configured' }, 500);
  }

  const code = context.req.query('code');
  const state = context.req.query('state');

  if (!code) {
    return context.json({ error: 'GOOGLE_AUTH_FAILED' }, 400);
  }

  // Validar state contra la cookie (anti-CSRF). Sin match se rechaza el login
  // redirigiendo al front con error legible (no JSON crudo).
  const cookieHeader = context.req.header('Cookie') || '';
  const stateCookie = cookieHeader.split(';').map((p) => p.trim()).find((p) => p.startsWith('oauth_state='));
  const expectedState = stateCookie ? stateCookie.slice('oauth_state='.length) : '';
  if (!state || !expectedState || state !== expectedState) {
    const frontendUrl = getFrontendUrl(context);
    return context.redirect(`${frontendUrl}?login=error&provider=google&reason=invalid_state`);
  }

  try {
    const redirectUri = getRedirectUri(context);

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json() as { access_token?: string; error?: string };

    if (!tokens.access_token) {
      return context.json({ error: 'GOOGLE_AUTH_FAILED', message: 'Failed to obtain access token' }, 502);
    }

    // Get user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser = await userResponse.json() as {
      id: string;
      email: string;
      verified_email?: boolean;
      name: string;
      picture: string;
      error?: string;
    };

    if (!googleUser.email) {
      return context.json({ error: 'GOOGLE_AUTH_FAILED', message: 'Failed to get user info' }, 502);
    }

    // Solo emails verificados por Google (evita takeover por re-link)
    if (googleUser.verified_email === false) {
      return context.json({ error: 'GOOGLE_AUTH_FAILED', message: 'Google email not verified' }, 403);
    }

    // Find or create user
    let user = await context.env.DB.prepare(
      'SELECT id, username, email, display_name, role_id FROM users WHERE google_subject = ? OR email = ?'
    ).bind(googleUser.id, googleUser.email).first() as {
      id: string; username: string; email: string; display_name: string; role_id: string;
    } | null;

    if (!user) {
      const userId = crypto.randomUUID();
      const username = googleUser.email.split('@')[0] + '_' + Math.random().toString(36).substring(2, 8);

      await context.env.DB.prepare(
        `INSERT INTO users (id, role_id, username, email, google_subject, display_name, email_verified)
         VALUES (?, 'role-customer', ?, ?, ?, ?, 1)`
      ).bind(userId, username, googleUser.email, googleUser.id, googleUser.name).run();

      user = { id: userId, username, email: googleUser.email, display_name: googleUser.name, role_id: 'role-customer' };
    } else {
      // Fijar el link Google en el primer login (anti take-over por email)
      await context.env.DB.prepare(
        'UPDATE users SET google_subject = COALESCE(google_subject, ?), email_verified = 1 WHERE id = ?'
      ).bind(googleUser.id, user.id).run();
    }

    // Create session (el token es el id de sesión, igual que en login)
    // Si el usuario tiene 2FA activo, NO se crea sesión: se deja pendiente
    // (ventana 10 min) y el front pide el código vía POST /auth/google-2fa.
    const totpRow = await context.env.DB.prepare(
      'SELECT 1 as ok FROM user_totp WHERE user_id = ? AND enabled = 1'
    ).bind((user as any).id).first();

    const frontendUrl = getFrontendUrl(context);

    if (totpRow) {
      const nowPend = Math.floor(Date.now() / 1000);
      await context.env.DB.prepare(
        `INSERT INTO oauth_pending_2fa (email, created_at) VALUES (?, ?)
         ON CONFLICT(email) DO UPDATE SET created_at = excluded.created_at`
      ).bind(googleUser.email.toLowerCase(), nowPend).run();
      return context.redirect(`${frontendUrl}?login=2fa-required&provider=google&email=${encodeURIComponent(googleUser.email)}`);
    }

    // Token de sesion: 32 bytes aleatorios, no un JWT. Ver la nota larga de
    // generateSessionToken() en auth.routes.ts, que explica por que el formato
    // viejo (base64 de user_id:role_id:Date.now()) no servia.
    const token = generarTokenSesion();
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

    await context.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(token, (user as any).id, expiresAt).run();

    // Código de un solo uso (5 min) para el handoff al front.
    // Evita exponer el token de sesión en la URL (historial/logs).
    const codeBytes = new Uint8Array(32);
    crypto.getRandomValues(codeBytes);
    const singleUseCode = Array.from(codeBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const nowCode = Math.floor(Date.now() / 1000);
    await context.env.DB.prepare(
      'INSERT INTO oauth_codes (code, token, user_id, created_at) VALUES (?, ?, ?, ?)'
    ).bind(singleUseCode, token, (user as any).id, nowCode).run();
    // Purga oportunista de códigos caducados (>10 min)
    await context.env.DB.prepare('DELETE FROM oauth_codes WHERE created_at < ?').bind(nowCode - 600).run().catch(() => {});

    // Limpiar cookie de state (la sesión viaja vía code -> POST /exchange,
    // no en URL ni en cookie cross-subdominio)
    context.header('Set-Cookie', 'oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax', { append: true });

    return context.redirect(`${frontendUrl}?login=success&provider=google&code=${encodeURIComponent(singleUseCode)}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return context.json({ error: 'GOOGLE_AUTH_FAILED' }, 500);
  }
});

// POST /auth/google/exchange - Canjear code de un solo uso por la sesión.
// El front llama aquí tras el redirect con ?code=... (nunca viaja el token en URL).

googleRoutes.post('/exchange', async (context) => {
  const allowed = await checkRateLimit(context.env, rateKey(context.req, 'google-exchange'), 20, 900, getClientIp(context.req));
  if (!allowed) {
    return context.json({ error: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const body = await context.req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^[0-9a-f]{32,128}$/i.test(code)) {
    return context.json({ error: 'INVALID_CODE' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const row = await context.env.DB.prepare(
    'SELECT code, token, user_id, created_at FROM oauth_codes WHERE code = ?'
  ).bind(code).first() as { code: string; token: string; user_id: string; created_at: number } | null;

  // Single-use: borrar siempre que exista, aunque esté caducado
  if (row) {
    await context.env.DB.prepare('DELETE FROM oauth_codes WHERE code = ?').bind(code).run();
  }
  if (!row || now - row.created_at > 5 * 60) {
    return context.json({ error: 'INVALID_OR_EXPIRED_CODE' }, 410);
  }

  const session = await context.env.DB.prepare(
    `SELECT s.expires_at, u.id, u.username, u.email, u.display_name, u.role_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ?`
  ).bind(row.token, row.user_id).first() as {
    expires_at: number; id: string; username: string; email: string; display_name: string; role_id: string;
  } | null;

  if (!session) {
    return context.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  return context.json({
    data: {
      user: {
        id: session.id,
        username: session.username,
        email: session.email,
        display_name: session.display_name,
        role_id: session.role_id,
      },
      session: { id: row.token, token: row.token, expires_at: session.expires_at },
    },
  });
});
