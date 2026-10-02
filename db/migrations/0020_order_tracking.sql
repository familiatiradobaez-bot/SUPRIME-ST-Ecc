-- Seguimiento de paquete (paso previo al dropshipping: el número de
-- seguimiento viene de la web del proveedor y se guarda aquí para poder
-- mostrarlo al cliente y, más adelante, consultarlo en un rastreador).
ALTER TABLE orders ADD COLUMN tracking_number TEXT;
ALTER TABLE orders ADD COLUMN tracking_carrier TEXT;
ALTER TABLE orders ADD COLUMN tracking_updated_at TEXT;

CREATE INDEX IF NOT EXISTS orders_tracking_idx ON orders(tracking_number);