-- Ciudad/CP/país en pedidos (el checkout los exige desde el front + API)
ALTER TABLE orders ADD COLUMN shipping_city TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_country TEXT NOT NULL DEFAULT 'España';
