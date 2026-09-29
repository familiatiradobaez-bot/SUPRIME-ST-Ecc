-- Coste de envío por pedido (céntimos de euro, 0 = gratis)
ALTER TABLE orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0;
