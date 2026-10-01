// Modulo de Telegram para el Worker.
//
// QUE HACE Y QUE NO
//
// Hace: avisar al owner de un evento (por ejemplo, que le han bloqueado una
// peticion por rate limit) y ofrecer un boton para aprobar o rechazar.
//
// NO hace, y esto es lo importante: mantener la peticion esperando. Un Worker no
// puede dejar una peticion colgada 5 minutos esperando a que un humano conteste
// (la peticion muere antes: 30 s de CPU en el plan Free) y ademas mantener
// conexiones abiertas es en si mismo un vector de ataque. Asi que el flujo es
// fail-closed: se bloquea, se avisa, y solo pasa si el owner aprueba. Si no
// aprueba, se queda bloqueado. El resultado de seguridad es el que se pedia.
//
// El token NO esta en el codigo: vive en el secreto TELEGRAM_BOT_TOKEN del
// Worker (wrangler secret put), nunca en wrangler.toml ni en el repo.
const API = 'https://api.telegram.org';

export type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  /** Chat al que se avisa. Si falta, se saca de /getMe + el primer chat conocido. */
  TELEGRAM_CHAT_ID?: string;
};

function token(env: TelegramEnv): string | null {
  const t = (env.TELEGRAM_BOT_TOKEN || '').trim();
  return t || null;
}

export function telegramConfigurado(env: TelegramEnv): boolean {
  return !!token(env) && !!(env.TELEGRAM_CHAT_ID || '').trim();
}

async function call(env: TelegramEnv, metodo: string, cuerpo: unknown): Promise<unknown> {
  const t = token(env);
  if (!t) return null;
  try {
    const r = await fetch(`${API}/bot${t}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      // El Worker no debe quedarse colgado por Telegram. Sin esto, un Telegram
      // lento se convierte en un login lento, que es un Denial of Service
      // gratuito: el atacante no necesita atacar, solo esperar.
      signal: AbortSignal.timeout(5000),
    });
    const j = (await r.json()) as { ok?: boolean; result?: unknown };
    return j.ok ? (j.result ?? true) : null;
  } catch {
    // Si Telegram falla, el rate limit NO se salta. El fallo de la notificacion
    // nunca puede convertirse en un bypass.
    return null;
  }
}

/**
 * Envia un aviso con boton de aprobar/rechazar.
 * `callback` va en el callback_data: vuelve al nosotros cuando el owner pulsa.
 */
export async function avisarConBoton(
  env: TelegramEnv,
  texto: string,
  botones: { texto: string; callback: string }[],
): Promise<boolean> {
  const chat = (env.TELEGRAM_CHAT_ID || '').trim();
  if (!chat) return false;
  const r = await call(env, 'sendMessage', {
    chat_id: chat,
    text: texto,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [botones.map((b) => ({ text: b.texto, callback_data: b.callback }))] },
  });
  return r !== null;
}

/** Aviso simple, sin botones. */
export async function avisar(env: TelegramEnv, texto: string): Promise<boolean> {
  const chat = (env.TELEGRAM_CHAT_ID || '').trim();
  if (!chat) return false;
  const r = await call(env, 'sendMessage', { chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: true });
  return r !== null;
}

/**
 * Actualiza un aviso ya enviado cuando el owner pulsa un boton, para que no se
 * queden veinte mensajes identicos con "Aprobado" colgando.
 */
export async function editarAviso(env: TelegramEnv, chatId: string, messageId: number, texto: string): Promise<boolean> {
  const t = token(env);
  if (!t) return false;
  try {
    const r = await fetch(`${API}/bot${t}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: texto, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }),
      signal: AbortSignal.timeout(5000),
    });
    const j = (await r.json()) as { ok?: boolean };
    return !!j.ok;
  } catch {
    return false;
  }
}
