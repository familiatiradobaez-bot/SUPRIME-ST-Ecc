import type { Bindings } from '../app';

// Política de envío (España). Fuente de verdad: store_settings (panel admin);
// constantes como fallback si la tabla no responde. MANTENER SINCRONIZADO
// con apps/web/src/lib/api.ts (el front la usa solo para mostrar; el total
// autoritativo lo calcula el servidor).
export const SHIPPING_FLAT_CENTS = 490; // 4,90€
export const FREE_SHIPPING_THRESHOLD_CENTS = 6000; // gratis desde 60€

function toCents(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && (n as number) >= 0 ? (n as number) : fallback;
}

export async function getShippingPolicy(env: Bindings): Promise<{ flat: number; threshold: number }> {
  try {
    const rows = await env.DB.prepare(
      "SELECT key, value FROM store_settings WHERE key IN ('shipping_cost','free_shipping_threshold')"
    ).all();
    let flat = SHIPPING_FLAT_CENTS;
    let threshold = FREE_SHIPPING_THRESHOLD_CENTS;
    for (const row of ((rows.results || []) as Array<{ key: string; value: string }>)) {
      if (row.key === 'shipping_cost') flat = toCents(row.value, flat);
      if (row.key === 'free_shipping_threshold') threshold = toCents(row.value, threshold);
    }
    return { flat, threshold };
  } catch {
    return { flat: SHIPPING_FLAT_CENTS, threshold: FREE_SHIPPING_THRESHOLD_CENTS };
  }
}

export async function calcShipping(env: Bindings, subtotalCents: number): Promise<number> {
  if (subtotalCents <= 0) return 0;
  const { flat, threshold } = await getShippingPolicy(env);
  return subtotalCents >= threshold ? 0 : flat;
}

// Mantenimiento: '1' = tienda cerrada (el checkout se rechaza con 503).
export async function isMaintenanceMode(env: Bindings): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM store_settings WHERE key = 'maintenance_mode'"
    ).first() as { value: string } | null;
    return row?.value === '1';
  } catch {
    return false;
  }
}

// Modo seguro: '1' = bloquea operaciones destructivas (regenerar/desactivar
// 2FA, borrar productos). Se apaga desde Configuración cuando haga falta.
export async function isSafetyLockOn(env: Bindings): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM store_settings WHERE key = 'safety_lock'"
    ).first() as { value: string } | null;
    return row?.value !== '0';
  } catch {
    return true;
  }
}
