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
