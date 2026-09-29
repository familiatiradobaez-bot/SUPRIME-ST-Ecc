-- Seguro anti-destructivo (1 = bloquea regenerar/desactivar 2FA y borrar productos)
INSERT OR IGNORE INTO store_settings (key, value, description) VALUES
('safety_lock', '1', 'Modo seguro (1=bloquea operaciones destructivas)');
