-- Passkeys (WebAuthn), desafíos pendientes y dispositivos de confianza.
-- Ningún secreto en claro: solo claves públicas COSE y hashes.

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_label TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id);

-- Desafíos de un solo uso (register/login). Se consumen al verificarse y
-- se limpian por expiración, para que un challenge robado no sirva nunca.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS webauthn_challenges_exp_idx ON webauthn_challenges(expires_at);

-- Dispositivos de confianza: cookie httpOnly con token aleatorio; en BD solo
-- su SHA-256. Robar la BD no da acceso a ningún dispositivo.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  ua_hash TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON trusted_devices(user_id);