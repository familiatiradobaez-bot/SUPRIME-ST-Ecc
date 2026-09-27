CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS categories_department_idx ON categories(department_id);

-- Insertar categorías de ejemplo
INSERT OR IGNORE INTO categories (id, department_id, name, slug, description, image_url) VALUES
('cat-electronica', 'dep-demo', 'Electrónica', 'electronica', 'Dispositivos electrónicos y accesorios', 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=900'),
('cat-audio', 'dep-demo', 'Audio', 'audio', 'Auriculares, altavoces y equipos de sonido', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=900'),
('cat-computacion', 'dep-demo', 'Computación', 'computacion', 'Teclados, ratones y accesorios de computadora', 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=900'),
('cat-monitores', 'dep-demo', 'Monitores', 'monitores', 'Monitores y pantallas de alta resolución', 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=900'),
('cat-video', 'dep-demo', 'Video', 'video', 'Cámaras y equipos de video', 'https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=900');
