-- Step-up 2FA para el panel admin (validez 1 hora)
CREATE TABLE IF NOT EXISTS admin_stepup (
  user_id TEXT PRIMARY KEY,
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_stepup_expires ON admin_stepup(expires_at);
