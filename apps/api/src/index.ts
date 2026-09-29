import { createApp } from './app';
import type { Bindings } from './app';

const app = createApp();

export default {
  fetch: app.fetch,
  // Cron diario: purga sesiones y OTPs caducados (ver [triggers] en wrangler.toml)
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM email_otps WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM admin_stepup WHERE expires_at <= ?').bind(now),
    ]);
  },
};
