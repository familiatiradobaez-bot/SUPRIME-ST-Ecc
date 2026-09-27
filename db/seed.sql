INSERT OR IGNORE INTO roles (id, name, rank) VALUES
  ('role-owner', 'owner', 40),
  ('role-admin', 'admin', 30),
  ('role-stock-manager', 'stock_manager', 20),
  ('role-customer', 'customer', 10);

INSERT OR IGNORE INTO departments (id, name, slug) VALUES
  ('dep-demo', 'Demo', 'demo');

INSERT OR IGNORE INTO subdepartments (id, department_id, name, slug) VALUES
  ('subdep-demo', 'dep-demo', 'Destacados', 'destacados');

INSERT OR IGNORE INTO products (id, subdepartment_id, name, slug, description, image_url, price_cents, stock_quantity, status)
VALUES ('product-demo', 'subdep-demo', 'Producto de demostración', 'producto-de-demostracion', 'Artículo inicial para validar el catálogo.', 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=900', 4990, 12, 'active');