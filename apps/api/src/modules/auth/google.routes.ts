import { Hono } from 'hono';
import type { Bindings } from '../../app';

// Frontend URLs for post-login redirect
const FRONTEND_URLS = [
  'https://suprime.xyz',
  'https://suprime-st-ecc.pages.dev',
];

// El callback SIEMPRE vive en el Worker (api.suprime.xyz), nunca en el front.
// El front solo recibe el redirect final. En local se usa el Host de la petición.
function getRedirectUri(context: { req: { header: (name: string) => string | undefined } }): string {
  const host = context.req.header('Host') || '';
  if (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('192.168')) {
    const proto = host.includes('localhost') ? 'http' : 'http';
    return `${proto}://${host}/api/v1/auth/google/callback`;
  }
  return 'https://api.suprime.xyz/api/v1/auth/google/callback';
}

function getFrontendUrl(context: { req: { header: (name: string) => string | undefined } }): string {
  const origin = context.req.header('Origin') || context.req.header('Referer');
  
  if (origin && origin.includes('suprime.xyz')) {
    return 'https://suprime.xyz';
  }
  if (origin && origin.includes('pages.dev')) {
    return 'https://suprime-st-ecc.pages.dev';
  }
  
  return 'https://suprime.xyz';
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

  // Validar state contra la cookie (anti-CSRF). Sin match se rechaza el login.
  const cookieHeader = context.req.header('Cookie') || '';
  const stateCookie = cookieHeader.split(';').map((p) => p.trim()).find((p) => p.startsWith('oauth_state='));
  const expectedState = stateCookie ? stateCookie.slice('oauth_state='.length) : '';
  if (!state || !expectedState || state !== expectedState) {
    return context.json({ error: 'GOOGLE_AUTH_FAILED', message: 'Invalid OAuth state' }, 403);
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
      name: string;
      picture: string;
      error?: string;
    };

    if (!googleUser.email) {
      return context.json({ error: 'GOOGLE_AUTH_FAILED', message: 'Failed to get user info' }, 502);
    }

    // Find or create user
    let user = await context.env.DB.prepare(
      'SELECT id, username, email, display_name, role_id FROM users WHERE google_subject = ? OR email = ?'
    ).bind(googleUser.id, googleUser.email).first();

    if (!user) {
      const userId = crypto.randomUUID();
      const username = googleUser.email.split('@')[0] + '_' + Math.random().toString(36).substring(2, 8);

      await context.env.DB.prepare(
        `INSERT INTO users (id, role_id, username, email, google_subject, display_name)
         VALUES (?, 'role-customer', ?, ?, ?, ?)`
      ).bind(userId, username, googleUser.email, googleUser.id, googleUser.name).run();

      user = { id: userId, username, email: googleUser.email, display_name: googleUser.name, role_id: 'role-customer' };
    }

    // Create session (el token es el id de sesión, igual que en login)
    const tokenData = `${user.id}:${user.role_id}:${Date.now()}`;
    const token = btoa(tokenData);
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

    await context.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(token, user.id, expiresAt).run();

    // Limpiar cookie de state + fijar sesión (append: dos Set-Cookie)
    context.header('Set-Cookie', 'oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax', { append: true });
    context.header('Set-Cookie', `session_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 60 * 60}`, { append: true });

    // Redirect al front con el token (la cookie HttpOnly no es legible cross-subdominio,
    // el front lo guarda y limpia la URL inmediatamente)
    const frontendUrl = getFrontendUrl(context);
    return context.redirect(`${frontendUrl}?login=success&provider=google&token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return context.json({ error: 'GOOGLE_AUTH_FAILED' }, 500);
  }
});
