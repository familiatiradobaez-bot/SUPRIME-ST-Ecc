// Política de envío (España). MANTENER SINCRONIZADO con apps/web/src/lib/api.ts
// (el front la usa solo para mostrar; el total autoritativo lo calcula el servidor).
export const SHIPPING_FLAT_CENTS = 490; // 4,90€
export const FREE_SHIPPING_THRESHOLD_CENTS = 6000; // gratis desde 60€

export function calcShipping(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FLAT_CENTS;
}
