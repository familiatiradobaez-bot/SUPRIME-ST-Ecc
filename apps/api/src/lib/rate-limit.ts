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
