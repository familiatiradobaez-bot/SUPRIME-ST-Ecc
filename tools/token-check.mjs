#!/usr/bin/env node
/**
 * token-check.mjs — Estado de tokens de la sesión activa de OpenCode.
 *
 * REGLA (pedida 2026-09-30): antes de empezar cada tarea o bloque, ejecutar
 * este script. Si los tokens NO alcanzan para el bloque, avisar al usuario
 * para que cambie de agente en vez de empezar a media luz.
 *
 * Uso:
 *   node tools/token-check.mjs              # resumen de la sesión más reciente
 *   node tools/token-check.mjs <sessionId>  # sesión concreta
 *   node tools/token-check.mjs --json       # salida JSON
 *
 * LIMITACIÓN CONOCIDA: OpenCode no expone por API ni en su BD local el cupo
 * ni la hora de reset del plan gratuito. Este script mide el CONSUMO de la
 * sesión (lo que sí es observable) y el margen frente a la ventana de
 * contexto. El "tiempo hasta reset" no se puede calcular aquí: hay que
 * consultarlo en el panel de OpenCode Zen.
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, mkdtempSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const sessionId = args.find((a) => !a.startsWith('--'));

// La BD está bloqueada por el proceso de OpenCode en caliente: se copia a temp.
function openDb() {
  const root = join(process.env.USERPROFILE || '', '.local', 'share', 'opencode');
  const src = join(root, 'opencode.db');
  if (!existsSync(src)) {
    console.error(`No se encuentra la BD de OpenCode en ${src}`);
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'oc-tokens-'));
  const dst = join(dir, 'db.sqlite');
  copyFileSync(src, dst);
  // -wal/-shm son opcionales: si faltan, se lee el estado ya checkpointeado.
  for (const ext of ['-wal', '-shm']) {
    const f = join(root, `opencode.db${ext}`);
    if (existsSync(f) && statSync(f).size > 0) {
      try { copyFileSync(f, join(dir, `db.sqlite${ext}`)); } catch {}
    }
  }
  return new DatabaseSync(dst, { readOnly: true });
}

const db = openDb();

const session = sessionId
  ? db.prepare('SELECT * FROM session_v2 WHERE id = ?').get(sessionId)
  : db.prepare('SELECT * FROM session_v2 ORDER BY time_updated DESC LIMIT 1').get();

if (!session) {
  console.error('No se encontró ninguna sesión en la BD de OpenCode.');
  process.exit(2);
}

let model = {};
try { model = JSON.parse(session.model || '{}'); } catch {}

// Último bloque de tokens del mensaje asistente más reciente = tamaño de
// contexto actual (input sin caché + caché leída + salida).
let ctx = 0;
let out = 0;
let reasoning = 0;
try {
  const rows = db
    .prepare('SELECT data FROM session_message WHERE session_id = ? ORDER BY seq')
    .all(session.id);
  for (const r of rows) {
    let d = {};
    try { d = JSON.parse(r.data || '{}'); } catch { continue; }
    const t = d.tokens || d.metadata?.tokens;
    if (!t) continue;
    if (t.cache?.read !== undefined) ctx = t.input + (t.cache.read || 0);
    if (t.output) out = t.output;
    if (t.reasoning) reasoning = t.reasoning;
  }
} catch {}

// Heurística: ventana de contexto típica de los modelos gratuitos de
// OpenCode Zen. Ajustar si el panel muestra otro valor.
const WINDOW = 200_000;
const used = Math.round((ctx / WINDOW) * 100);
const left = WINDOW - ctx;
const over = left < 0;

const modelId = model.modelID || model.id || 'desconocido';

if (asJson) {
  console.log(JSON.stringify({
    sessionId: session.id,
    titulo: session.title,
    model: modelId,
    provider: model.providerID,
    contextoTokens: ctx,
    ventanaEstimada: WINDOW,
    porcentajeUsado: used,
    tokensLibresEstimados: left,
    salidaAcumulada: out,
    razonamiento: reasoning,
    totalInput: session.tokens_input,
    totalOutput: session.tokens_output,
    cacheRead: session.tokens_cache_read,
    coste: session.cost,
    actualizado: new Date(session.time_updated).toISOString(),
    resetCuotaGratis: 'NO DISPONIBLE — consultar panel de OpenCode Zen',
  }, null, 2));
  process.exit(0);
}

const bar = (pct) => {
  // Clamp: si el contexto supera la ventana estimada, el porcentaje pasa de 100
  // y String.repeat() con negativo lanza RangeError (el script se caía).
  const n = Math.max(0, Math.min(20, Math.round(pct / 5)));
  return '█'.repeat(n) + '░'.repeat(20 - n);
};

console.log('');
console.log('  TOKENS — SESIÓN ACTIVA');
console.log('  ─────────────────────────────────────────────');
console.log(`  Sesión    ${session.id}`);
console.log(`  Modelo    ${modelId}  (${model.providerID || '—'})`);
console.log('');
console.log(`  Contexto  ${ctx.toLocaleString('es')} / ${WINDOW.toLocaleString('es')} tokens`);
console.log(`            [${bar(used)}] ${used}%`);
if (over) {
  console.log(`  ⚠ SUPERADO por ${Math.abs(left).toLocaleString('es')} tokens. Sesión bloated:`);
  console.log('    probably se compactó mal o hay contexto muerto acumulado.');
  console.log('    Recomiendo /compact o empezar sesión nueva.');
} else {
  console.log(`  Libres    ~${left.toLocaleString('es')} tokens de contexto`);
}
console.log('');
console.log('  Acumulado sesión');
console.log(`    input   ${(session.tokens_input || 0).toLocaleString('es')}`);
console.log(`    output  ${(session.tokens_output || 0).toLocaleString('es')}`);
console.log(`    cache   ${(session.tokens_cache_read || 0).toLocaleString('es')} (lectura)`);
console.log(`    coste   $${(session.cost || 0).toFixed(4)}`);
console.log('');
console.log(`  Actualizado  ${new Date(session.time_updated).toISOString()}`);
console.log('');
console.log('  ⓘ Cuota del plan gratuito y hora de reset: NO accesible desde');
console.log('    local. Verificar en el panel de OpenCode Zen.');
console.log('');
