// IP real del cliente: CF-Connecting-IP primero (la pone Cloudflare, no falsificable
// tras el proxy), si no, PRIMER elemento de X-Forwarded-For (el resto lo añaden proxies).
export function getClientIp(req: { header: (name: string) => string | undefined }): string {
  const cf = req.header('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = req.header('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim() || 'unknown';
  return 'unknown';
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
