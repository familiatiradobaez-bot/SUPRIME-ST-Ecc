import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../../app';

export const googleRoutes = new Hono<{ Bindings: Bindings }>();

// Google OAuth configuration
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET';
const GOOGLE_REDIRECT_URI = 'https://suprime-st-ecc-api.familia-tirado-baez.workers.dev/api/v1/auth/google/callback';

// GET /auth/google/login - Redirect to Google OAuth
googleRoutes.get('/login', (context) => {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });

  return context.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/google/callback - Handle Google OAuth callback
googleRoutes.get('/callback', async (context) => {
  const code = context.req.query('code');
  const state = context.req.query('state');

  if (!code) {
    return context.json({ error: 'GOOGLE_AUTH_FAILED' }, 400);
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json() as { access_token: string };

    // Get user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser = await userResponse.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

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

    // Create session
    const sessionId = crypto.randomUUID();
    const tokenData = `${user.id}:${user.role_id}:${Date.now()}`;
    const token = btoa(tokenData);
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

    await context.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(sessionId, user.id, expiresAt).run();

    // Redirect to frontend with token
    return context.redirect(`https://suprime-st-ecc.pages.dev?token=${token}&login=success`);
  } catch (error) {
    return context.json({ error: 'GOOGLE_AUTH_FAILED' }, 500);
  }
});
