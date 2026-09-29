-- Aceptación de términos en el registro (prueba legal RGPD)
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
