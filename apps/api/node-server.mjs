import { createServer } from 'http';
import { createApp } from './src/app.ts';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Leer el archivo SQLite directamente
const sqlitePath = join(__dirname, '../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/2b35d4d42e3c9f6b5ad5b5579a7b1470c66e69f6b33a31e3f5a0095cc6d18656.sqlite');

// Adaptador D1 mínimo usando better-sqlite3
import Database from 'better-sqlite3';
const db = new Database(sqlitePath, { readonly: false });

const d1Adapter = {
  prepare(query) {
    const params = [];
    return {
      bind(...values) {
        params.push(...values);
        return this;
      },
      async first() {
        const row = db.prepare(query).get(...params);
        return row ?? null;
      },
      async all() {
        const rows = db.prepare(query).all(...params);
        return { results: rows };
      },
      async run() {
        db.prepare(query).run(...params);
        return { success: true };
      },
    };
  },
};

const app = createApp();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // Collect body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(url.toString(), {
    method: req.method,
    headers: new Headers(req.headers),
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });

  // @ts-ignore - Node.js no tiene Bindings de Cloudflare
  const response = await app.fetch(request, {
    DB: d1Adapter,
    APP_ENV: 'development',
  });

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

const PORT = 8789;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`API corriendo en http://localhost:${PORT}`);
});
