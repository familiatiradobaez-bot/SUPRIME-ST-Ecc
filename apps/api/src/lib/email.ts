import type { Bindings } from '../app';

// Envío con fallback: 1) Cloudflare Email Service (nativo, sin keys),
// 2) Resend. Devuelve true si alguno lo aceptó. Nunca lanza.
export async function sendEmail(env: Bindings, toEmail: string, subject: string, html: string): Promise<boolean> {
  // 1. Cloudflare Email Service (requiere dominio onboarded en Email Sending)
  if (env.EMAIL) {
    try {
      await env.EMAIL.send({
        from: 'SUPRIME <noreply@suprime.xyz>',
        to: toEmail,
        subject,
        html,
      });
      return true;
    } catch (emailErr) {
      console.error('Cloudflare Email Service failed, falling back to Resend:', emailErr);
    }
  }

  // 2. Resend (fallback)
  try {
    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.warn('RESEND_API_KEY not configured, skipping email send');
      return false;
    }
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SUPRIME <noreply@suprime.xyz>',
        to: toEmail,
        subject,
        html,
      }),
    });

    if (!emailResponse.ok) {
      console.error('Resend email failed:', await emailResponse.text());
      return false;
    }
    return true;
  } catch (emailErr) {
    console.error('Failed to send email:', emailErr);
    return false;
  }
}

export function orderEmailHtml(orderId: string, items: Array<{ name: string; quantity: number; price_cents: number }>, totalCents: number, shippingName: string): string {
  const rows = items.map((i) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${i.name} × ${i.quantity}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${((i.price_cents * i.quantity) / 100).toFixed(2)}€</td>
    </tr>`).join('');
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #6366f1;">¡Gracias por tu compra, ${shippingName}!</h1>
      <p>Tu pedido <strong>${orderId}</strong> está en preparación.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">${rows}
        <tr>
          <td style="padding: 8px; font-weight: bold;">Total</td>
          <td style="padding: 8px; text-align: right; font-weight: bold;">${(totalCents / 100).toFixed(2)}€</td>
        </tr>
      </table>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #888; font-size: 12px;">SUPRIME - Tu tienda premium</p>
    </div>
  `;
}
