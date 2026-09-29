-- Anti-replay TOTP: último contador aceptado por usuario
ALTER TABLE user_totp ADD COLUMN last_counter INTEGER NOT NULL DEFAULT -1;
