import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createApp } from "./src/app.ts";

// Base de datos D1 simulada con SQLite vía Deno
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const sqlitePath = new URL("../../.wrangler/state/v3/d1/hyperdrive.sqlite", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const db = new DB(sqlitePath);

// Adaptador mínimo de D1 para Deno
const d1Adapter = {
  prepare(query: string) {
    const params: unknown[] = [];
    return {
      bind(...values: unknown[]) {
        params.push(...values);
        return this;
      },
      async first() {
        const rows = [...db.query(query, params)];
        return rows[0] ?? null;
      },
      async all() {
        const rows = [...db.query(query, params)];
        return { results: rows };
      },
      async run() {
        db.query(query, params);
        return { success: true };
      },
    };
  },
};

const app = createApp();

const handler = (request: Request): Response => {
  // @ts-ignore - Deno no tieneBindings de Cloudflare
  return app.fetch(request, {
    DB: d1Adapter,
    APP_ENV: "development",
  });
};

const port = 8789;
console.log(`API corriendo en http://localhost:${port}`);
await serve(handler, { port });
