-- Tabla de auditoría para el panel de administración
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);

-- Tabla de configuración de la tienda
CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Configuración inicial
INSERT OR IGNORE INTO store_settings (key, value, description) VALUES
('store_name', 'SUPRIME', 'Nombre de la tienda'),
('store_description', 'La mejor selección de productos premium', 'Descripción de la tienda'),
('currency', 'EUR', 'Moneda de la tienda'),
('tax_rate', '21', 'Tipo de IVA (%)'),
('free_shipping_threshold', '5000', 'Umbral de envío gratis (céntimos)'),
('shipping_cost', '499', 'Coste de envío (céntimos)'),
('maintenance_mode', '0', 'Modo mantencción (0=activo, 1=mantenimiento)');
