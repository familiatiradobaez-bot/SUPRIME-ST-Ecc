-- OAuth pendiente de 2FA (Google): ventana corta para completar el desafío
CREATE TABLE IF NOT EXISTS oauth_pending_2fa (
  email TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_pending_2fa_created ON oauth_pending_2fa(created_at);
