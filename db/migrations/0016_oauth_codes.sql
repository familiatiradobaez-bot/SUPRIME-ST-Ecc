-- Códigos de un solo uso para handoff OAuth (evita token de sesión en URL).
-- El callback crea la sesión y emite un code de 5 min; el front lo canjea por POST.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_created ON oauth_codes(created_at);
