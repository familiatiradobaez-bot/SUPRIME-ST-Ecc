import type { Session } from '../types';

export function getAuthHeaders(session: Session | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  return headers;
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
