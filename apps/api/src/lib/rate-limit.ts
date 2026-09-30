// Rate-limit distribuido con KV opcional + fallback en memoria.
// En Workers cada isolate tiene su propia memoria: sin KV, un atacante puede
// repartir intentos entre isolates. Si `env.RATE_LIMIT_KV` existe se usa como
// fuente de verdad (ventana fija); si no, se usa el Map en memoria.
// Uso: `await checkRateLimit(env, 'login:' + ip, 5, 900)` → true = permitido.
import { getClientIp } from './request';
import type { Bindings } from '../app';

type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};

type RateLimitEnv = Pick<Bindings, 'RATE_LIMIT_KV'> & Record<string, unknown>;

const memBuckets = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(
  env: RateLimitEnv,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  const fullKey = `rl:${key}`;

  if (!kv) {
    const now = Date.now();
    const cur = memBuckets.get(fullKey);
    if (!cur || cur.resetAt < now) {
      memBuckets.set(fullKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    if (cur.count >= max) return false;
    cur.count++;
    return true;
  }

  try {
    const raw = await kv.get(fullKey);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!raw) {
      await kv.put(fullKey, JSON.stringify({ count: 1, resetAt: nowSec + windowSeconds }), {
        expirationTtl: windowSeconds,
      });
      return true;
    }
    const cur = JSON.parse(raw) as { count: number; resetAt: number };
    if (cur.resetAt <= nowSec) {
      await kv.put(fullKey, JSON.stringify({ count: 1, resetAt: nowSec + windowSeconds }), {
        expirationTtl: windowSeconds,
      });
      return true;
    }
    if (cur.count >= max) return false;
    const ttl = Math.max(1, cur.resetAt - nowSec);
    await kv.put(fullKey, JSON.stringify({ count: cur.count + 1, resetAt: cur.resetAt }), {
      expirationTtl: ttl,
    });
    return true;
  } catch {
    // Si KV falla, no bloquear tráfico legítimo: fallback a memoria.
    const now = Date.now();
    const cur = memBuckets.get(fullKey);
    if (!cur || cur.resetAt < now) {
      memBuckets.set(fullKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    if (cur.count >= max) return false;
    cur.count++;
    return true;
  }
}

export function rateKey(req: { header: (name: string) => string | undefined }, scope: string): string {
  return `${scope}:${getClientIp(req)}`;
}

/**
 * Lee el estado de un cubo SIN consumir intentos (para poder mostrarlo en la UI).
 * Devuelve null si no hay cubo, si expiró o si KV falla: quien llama decide.
 */
export async function peekRateLimit(
  env: RateLimitEnv,
  key: string,
  max: number,
): Promise<{ count: number; remaining: number; resetIn: number } | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;

  if (!kv) {
    const cur = memBuckets.get(`rl:${key}`);
    if (!cur || cur.resetAt / 1000 <= nowSec) return null;
    return { count: cur.count, remaining: Math.max(0, max - cur.count), resetIn: Math.round(cur.resetAt / 1000 - nowSec) };
  }

  try {
    const raw = await kv.get(`rl:${key}`);
    if (!raw) return null;
    const cur = JSON.parse(raw) as { count: number; resetAt: number };
    if (cur.resetAt <= nowSec) return null;
    return { count: cur.count, remaining: Math.max(0, max - cur.count), resetIn: cur.resetAt - nowSec };
  } catch {
    return null;
  }
}

/**
 * Vacía un cubo. Se usa tras un login correcto: así los 5 intentos del cubo de
 * cuenta cuentan FALLOS, no tecleos, y una persona que se equivoca tres veces y
 * luego entra bien no arrastra el contador. El cubo por IP no se vacía: ese sí
 * mide el ritmo de intentos,-good o no.
 */
export async function clearRateLimit(env: RateLimitEnv, key: string): Promise<void> {
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  memBuckets.delete(`rl:${key}`);
  if (!kv) return;
  try {
    await kv.delete(`rl:${key}`);
  } catch {
    // Si no se puede borrar, el cubo caduca solo por TTL. No es crítico:
    // solo puede dejar el contador un poco alto hasta que venza.
  }
}
