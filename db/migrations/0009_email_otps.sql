-- OTP codes for email verification (15-minute validity)
CREATE TABLE IF NOT EXISTS email_otps (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_email_otps_expires ON email_otps(expires_at);
