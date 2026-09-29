import type { Session } from '../types';

export function getAuthHeaders(session: Session | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  return headers;
}

// Miniatura: en ImageKit aplica transformación de ancho (menos peso en tarjetas);
// otras URLs (Unsplash, etc.) se devuelven tal cual.
export function thumb(url: string, width = 400): string {
  if (!url || !url.includes('ik.imagekit.io')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}tr=w-${width}`;
}
export function formatPrice(cents: number, currency: string = 'EUR'): string {
  const meta = CURRENCIES[currency] || CURRENCIES.EUR;
  const converted = (cents / 100) * meta.rate;
  return converted.toLocaleString(meta.locale, {
    style: 'currency',
    currency,
  });
}

// Monedas soportadas en tienda. Tasas estáticas aproximadas respecto a EUR
// (precio base guardado en céntimos de euro). Para tasas en vivo, sustituir
// por fetch a un API de tipos de cambio.
export const CURRENCIES: Record<string, { rate: number; locale: string; label: string }> = {
  EUR: { rate: 1, locale: 'es-ES', label: 'EUR €' },
  USD: { rate: 1.08, locale: 'en-US', label: 'USD $' },
  GBP: { rate: 0.85, locale: 'en-GB', label: 'GBP £' },
};

// Política de envío (España). Valores por defecto = constantes; el servidor es
// la fuente autoritativa y el front los refresca con loadStoreSettings().
export const SHIPPING_FLAT_CENTS = 490; // 4,90€
export const FREE_SHIPPING_THRESHOLD_CENTS = 6000; // gratis desde 60€

const shippingPolicy = { flat: SHIPPING_FLAT_CENTS, threshold: FREE_SHIPPING_THRESHOLD_CENTS };

export type StoreSettings = {
  store_name: string;
  store_description: string;
  maintenance_mode: boolean;
};

// Ajustes públicos (GET /catalog/store-settings). Nunca lanza.
export async function loadStoreSettings(apiUrl: string): Promise<StoreSettings> {
  const fallback: StoreSettings = { store_name: 'SUPRIME', store_description: '', maintenance_mode: false };
  try {
    const res = await fetch(`${apiUrl}/catalog/store-settings`);
    if (!res.ok) return fallback;
    const payload = await res.json();
    const d = payload.data || {};
    const flat = parseInt(d.shipping_cost ?? '', 10);
    const threshold = parseInt(d.free_shipping_threshold ?? '', 10);
    if (Number.isFinite(flat) && flat >= 0) shippingPolicy.flat = flat;
    if (Number.isFinite(threshold) && threshold >= 0) shippingPolicy.threshold = threshold;
    return {
      store_name: typeof d.store_name === 'string' && d.store_name ? d.store_name : fallback.store_name,
      store_description: typeof d.store_description === 'string' ? d.store_description : '',
      maintenance_mode: d.maintenance_mode === '1',
    };
  } catch {
    return fallback;
  }
}

export function calcShipping(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= shippingPolicy.threshold ? 0 : shippingPolicy.flat;
}
