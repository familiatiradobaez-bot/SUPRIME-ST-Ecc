import type { Session } from '../types';

export function getAuthHeaders(session: Session | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  return headers;
}

// Las transformaciones de imagen (ImageKit + Unsplash) viven en `lib/images.ts`.

// Moneda por defecto: la tienda es de República Dominicana (rep.dom), así que
// se muestra en pesos dominicanos. El resto sigue disponible para el cliente.
export const DEFAULT_CURRENCY = 'DOP';

export function formatPrice(cents: number, currency: string = DEFAULT_CURRENCY): string {
  const meta = CURRENCIES[currency] || CURRENCIES[DEFAULT_CURRENCY];
  const converted = (cents / 100) * meta.rate;
  return converted.toLocaleString(meta.locale, {
    style: 'currency',
    currency,
  });
}

// Monedas soportadas en tienda. Tasas ESTÁTICAS aproximadas: el precio base
// sigue guardándose en céntimos de euro y aquí se convierte solo para mostrar.
// OJO: la tasa del DOP hay que revisarla cada cierto tiempo (está en
// tools/actualizar-tasas.mjs con la media oficial) o los precios se
// descuadrarán del cambio real.
export const CURRENCIES: Record<string, { rate: number; locale: string; label: string }> = {
  DOP: { rate: 62, locale: 'es-DO', label: 'RD$' },
  EUR: { rate: 1, locale: 'es-ES', label: '€' },
  USD: { rate: 1.08, locale: 'en-US', label: '$' },
  GBP: { rate: 0.85, locale: 'en-GB', label: '£' },
};

// exchange rate actual para convertir de céntimos de euro a pesos
export const DOP_RATE = CURRENCIES.DOP.rate;

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
