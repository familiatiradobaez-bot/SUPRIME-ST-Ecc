-- Roles base (antes solo en seed local; sin esto un D1 limpio rompe el registro por FK)
INSERT OR IGNORE INTO roles (id, name, rank) VALUES
  ('role-owner', 'owner', 40),
  ('role-admin', 'admin', 30),
  ('role-stock-manager', 'stock_manager', 20),
  ('role-customer', 'customer', 10);
