import type { Session } from '../types';

export function getAuthHeaders(session: Session | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  return headers;
}

export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
  });
}
