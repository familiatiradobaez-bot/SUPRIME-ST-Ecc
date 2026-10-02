-- Marca los pedidos que son de pruebas automáticas para poder limpiarlos
-- después. El E2E (tests/e2e) hace un checkout REAL contra producción, así
-- que sin esta marca la base se llenaba de pedidos de prueba.
ALTER TABLE orders ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS orders_is_test_idx ON orders(is_test);

-- Marcar lo que ya hay (E2E usa siempre estos datos de envío).
UPDATE orders SET is_test = 1
 WHERE shipping_address = 'Calle E2E 1'
    OR shipping_name = 'Cliente E2E'
    OR shipping_name = 'QA Dropshipping'
    OR shipping_name = 'Test Owner';