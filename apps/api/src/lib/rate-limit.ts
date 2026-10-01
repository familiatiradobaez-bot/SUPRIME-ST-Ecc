// Rate-limit distribuido con KV opcional + fallback en memoria.
// En Workers cada isolate tiene su propia memoria: sin KV, un atacante puede
// repartir intentos entre isolates. Si `env.RATE_LIMIT_KV` existe se usa como
// fuente de verdad (ventana fija); si no, se usa el Map en memoria.
// Uso: `await checkRateLimit(env, 'login:' + ip, 5, 900)` → true = permitido.
import { getClientIp } from './request';
import type { Bindings } from '../app';

type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};

type RateLimitEnv = Pick<Bindings, 'RATE_LIMIT_KV'> & Record<string, unknown>;

const memBuckets = new Map<string, { count: number; resetAt: number }>();

// =============================================================================
// INTERRUPTOR DE RATE LIMIT (para el owner, por IP, con caducidad)
// =============================================================================
//
// Que es y que no es:
//   - ES: una lista de IPs en KV con hora de expiracion. Mientras trabaja, la
//     suya no gasta cupos ni recibe 429, y se desactiva sola al caducar.
//   - NO ES: un flag global. Los cubos de las demas IPs siguen contando igual,
//     que es lo que mantiene la proteccion de fuerza bruta durante el trabajo.
//
// El rango 192.168.0.1-0.10 que se pidio no puede funcionar contra produccion:
// 192.168.0.0/24 es direccion PRIVADA (RFC 1918) y el router la traduce por NAT,
// asi que al Worker le llega la IP PUBLICA del router, nunca la privada. Ese
// rango solo sirve para un Worker local (`wrangler dev --ip`), y para eso estan
// los comandos `estado` y `anadir`, que guardan la IP publica detectada sola.

const BYPASS_KEY = 'rlbypass:ips';
const GRANT_KEY = 'rlbypass:grant';
const OWNER_KEY = 'rlbypass:owner';
// Registro de "a esta IP ya le avise hace X segundos". Sin esto, un atacante que
// insista puede usar el bot como altavoz y disparar la cuota de Telegram.
const AVISADO_KEY = 'rlbypass:avisado';
const AVISO_REPETIR_SEG = 300; // 5 min entre avisos de la misma IP

export type EstadoBypass = {
  activo: boolean;
  /** Epoch en segundos. 0 = sin bypass. */
  expiraEn: number;
  ips: string[];
  /** Cuantas IPs owner hay registradas (las que pueden pedir desbloqueo). */
  owners: number;
};

const SIN_BYPASS: EstadoBypass = { activo: false, expiraEn: 0, ips: [], owners: 0 };

/**
 * Cache de 5 s por isolate. Sin ella, cada peticion que pasa por un route
 * limitado pagaria una lectura de KV extra; en una tienda con trafico eso es
 * cuota gastada en nada. 5 s es imperceptible para quien acaba de activarlo.
 */
const bypassCache = new Map<string, { hasta: number; valor: EstadoBypass }>();

export async function leerBypass(env: RateLimitEnv): Promise<EstadoBypass> {
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  if (!kv) return SIN_BYPASS;

  const ahora = Date.now();
  const c = bypassCache.get('bypass');
  if (c && c.hasta > ahora) return c.valor;

  let valor = SIN_BYPASS;
  try {
    const [raw, rawOwner, rawGrant] = await Promise.all([
      kv.get(BYPASS_KEY),
      kv.get(OWNER_KEY),
      kv.get(GRANT_KEY),
    ]);
    // Se parsea UNA vez. Antes se hacia JSON.parse(raw) dos veces sobre la misma
    // entrada, y el patron `Number(raw) ? ... : ...` no estrecha el tipo de raw
    // (string | null) para TypeScript porque Number() no es un type guard.
    const principal = ((): { ips?: unknown; expiraEn?: unknown } | null => {
      if (!raw) return null;
      try { return JSON.parse(raw) as { ips?: unknown; expiraEn?: unknown }; } catch { return null; }
    })();
    const expiraEn = Number(principal?.expiraEn) || 0;
    const lista = Array.isArray(principal?.ips)
      ? (principal.ips as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    // Un grant puntual (desbloqueo aprobado a mano) se une a la lista mientras
    // siga vivo, para que no haga falta reescribir la entrada principal.
    let extra: string[] = [];
    if (rawGrant) {
      let g: { ips?: unknown; expiraEn?: unknown } | null = null;
      try { g = JSON.parse(rawGrant) as { ips?: unknown; expiraEn?: unknown }; } catch { g = null; }
      const gips = Array.isArray(g?.ips) ? (g.ips as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      if (gips.length > 0 && (Number(g?.expiraEn) || 0) > Math.floor(ahora / 1000)) extra = gips;
    }

    const todas = [...new Set([...lista, ...extra])];
    const sigueVivo = expiraEn > Math.floor(ahora / 1000);

    valor = {
      // activo exige lista no vacia y expiracion futura: los dos, no solo uno.
      activo: todas.length > 0 && (sigueVivo || extra.length > 0),
      expiraEn: extra.length > 0 && !sigueVivo ? Math.floor(ahora / 1000) + 300 : expiraEn,
      ips: sigueVivo || extra.length > 0 ? todas : [],
      owners: contarPropietarios(rawOwner),
    };
  } catch {
    // LADO SEGURO: si el KV no responde, se aplica el limite.
    valor = SIN_BYPASS;
  }

  bypassCache.set('bypass', { hasta: ahora + 5000, valor });
  return valor;
}

/** Cuenta las IPs owner registradas. Si el valor esta corrupto, cuenta 0 en vez
 *  de lanzar: un JSON roto en una clave de KV no puede tumbar el login. */
function contarPropietarios(raw: string | null): number {
  if (!raw) return 0;
  try {
    const l = JSON.parse(raw) as unknown;
    return Array.isArray(l) ? l.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Avisa al owner de que se le ha bloqueado una peticion, UNA vez por IP cada
 * 5 minutos, y devuelve si hay que bloquear.
 *
 * FLUJO FAIL-CLOSED, que es lo unico posible en un Worker:
 *   bloqueada -> aviso a Telegram con Aprobar/Rechazar -> si el owner pulsa
 *   Aprobar, hay un grant de 5 min y el siguiente intento pasa.
 *   Si el owner no pulsa nada, se queda bloqueada. NUNCA se desbloquea sola.
 *
 * Lo que NO hace, y no se puede hacer: dejar la peticion esperando 5 minutos a
 * que el owner conteste. La peticion muere antes (30 s de CPU en plan Free) y
 * mantener conexiones abiertas es en si mismo un vector de ataque. El resultado
 * de seguridad pedido se consigue igual, sin colgar nada.
 *
 * Si el KV falla, BLOQUEA y no avisa: un fallo del sistema de avisos nunca
 * puede convertirse en un bypass.
 */
export async function debeBloquearYAvisar(
  env: RateLimitEnv & { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string },
  ip: string | undefined,
  scope: string,
): Promise<boolean> {
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  if (!kv) return true; // sin KV no hay por donde avisar: se bloquea
  if (!ip) return true; // sin IP no se puede ni avisar ni rastrear

  try {
    // 1) Grant vivo de esta IP: el owner ya aprobo, se deja pasar.
    const rawGrant = await kv.get(GRANT_KEY);
    if (rawGrant) {
      const g = JSON.parse(rawGrant) as { ips?: unknown; expiraEn?: unknown };
      const gips = Array.isArray(g.ips) ? (g.ips as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      if (gips.includes(ip) && (Number(g.expiraEn) || 0) > Math.floor(Date.now() / 1000)) {
        return false;
      }
    }

    // 2) Ya avisado hace poco: bloquea sin repetir el aviso. Sin esto, un
    //    atacante que insista puede usar el bot como altavoz.
    const rawAviso = await kv.get(`${AVISADO_KEY}:${ip}`);
    if (rawAviso && Number(rawAviso) > Math.floor(Date.now() / 1000)) return true;

    // 3) Se marca como avisado ANTES de enviar, para que un fallo de Telegram no
    //    provoque un reintento en bucle.
    await kv.put(`${AVISADO_KEY}:${ip}`, String(Math.floor(Date.now() / 1000) + AVISO_REPETIR_SEG), {
      expirationTtl: AVISO_REPETIR_SEG + 60,
    });

    const { avisarConBoton } = await import('./telegram');
    await avisarConBoton(
      env,
      [
        'Bloqueada una peticion por limite de intentos.',
        '',
        `Ambito: <b>${scope}</b>`,
        `IP: <code>${ip}</code>`,
        '',
        'Si eras tu, pulsa Aprobar y se le deja pasar los siguientes 5 min.',
        'Si no eras tu, no hagas nada: se queda bloqueada.',
      ].join('\n'),
      [
        { texto: 'Aprobar 5 min', callback: `rl:ok:${ip}` },
        { texto: 'Rechazar', callback: `rl:no:${ip}` },
      ],
    );
    return true;
  } catch {
    return true; // cualquier fallo: bloquea y no avisa
  }
}

/**
 * Devuelve true si esta IP esta exenta AHORA MISMO, y de paso limpia sus cubos.
 *
 * Por qué limpia, y no solo mira: un cubo que ya estaba lleno cuando se activa
 * el bypass seguiría bloqueando aunque el código consultara la exención, porque
 * `loginBlocked` lee el cubo con peekRateLimit. Sin limpiar, activar el bypass
 * no serviría de nada justo en el caso para el que se activa: cuando ya te has
 * quedadoado. Con la limpieza, activar el bypass significa de verdad "no me
 * topes desde ahora".
 *
 * EL BORRADO SE ESPERA, Y NO ES UN DETALLE ESTILISTICO.
 *
 * La primera versión hacía `kv.delete(...).catch(() => {})` sin await, pensando
 * que era una mejora y no una condición. En un Worker eso NO FUNCIONA: cuando la
 * petición termina, el isolate cancela las promesas que siguen pendientes, así
 * que el borrado se quedaba a medias o no se ejecutaba nunca. Se comprobó en
 * producción: con el bypass activo los intentos pasaban (esa lectura sí está
 * esperada), pero al apagar el bypass el cubo viejo seguía lleno y volvía el
 * 429. Un borrado que a veces no ocurre es peor que no borrar nada, porque
 * aparenta que sí.
 *
 * El await solo se paga mientras el bypass está activo, que es un rato.
 */
export async function exentaYLimpia(
  env: RateLimitEnv,
  ip: string | undefined,
  prefijos: string[],
): Promise<boolean> {
  if (!ip) return false;
  const estado = await leerBypass(env);
  if (!exenta(estado, ip)) return false;
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  if (kv) {
    for (const p of prefijos) {
      try {
        // await + catch: se espera, y si falla se sigue. La exención ya está
        // decidida antes de aquí, así que un fallo de borrado no la revierte.
        await kv.delete(`rl:${p}${ip}`);
      } catch {
        // El cubo se rellenará solo, pero la exención sigue valiendo.
      }
    }
  }
  return true;
}

/**
 * ¿Esta exenta del rate limit esta IP ahora mismo?
 * Sin IP no se puede decidir, y sin decision se aplica el limite.
 */
export function exenta(estado: EstadoBypass, ip: string | undefined): boolean {
  if (!ip || !estado.activo) return false;
  return estado.ips.includes(ip);
}

/**
 * Aplica la decision del owner sobre un grant. Lo llama el endpoint de
 * Telegram cuando el owner pulsa Aprobar o Rechazar.
 *
 * Rechazar NO desbloquea nada: solo limpia el aviso para que la proxima vez
 * pregunte de nuevo. Aprobar escribe un grant de 5 min para esa IP.
 */
export async function resolverGrant(
  env: RateLimitEnv,
  ip: string,
  aprobar: boolean,
  segundos = 300,
): Promise<{ ok: boolean; expiraEn: number }> {
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  if (!kv) return { ok: false, expiraEn: 0 };
  try {
    // Se borra el registro de "ya avise" para que la proxima vez que se tope
    // vuelva a preguntar en vez de callarse.
    await kv.delete(`${AVISADO_KEY}:${ip}`);

    // Rechazar TIENE que quitar el grant si habia uno. Antes solo borraba el
    // aviso y devolvia: si habia un grant vivo de antes, la IP seguia pasando
    // 5 min despues de un "Rechazar", que es justo lo contrario de lo que dice
    // el boton. Se quito el grant viejo siempre, tanto al aprobar como al
    // rechazar, y luego se escribe el nuevo si toca.
    const rawViejo = await kv.get(GRANT_KEY);
    await kv.delete(GRANT_KEY);
    invalidarCacheBypass();
    if (!aprobar) return { ok: true, expiraEn: 0 };

    const expiraEn = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(segundos, 900));
    // El grant REEMPLAZA la lista, no se suma: un grant son 5 minutos de una IP
    // concreta, no un permiso que se acumula para siempre.
    await kv.put(GRANT_KEY, JSON.stringify({ ips: [ip], expiraEn }), {
      expirationTtl: Math.max(60, expiraEn - Math.floor(Date.now() / 1000)),
    });
    invalidarCacheBypass();
    return { ok: true, expiraEn };
  } catch {
    return { ok: false, expiraEn: 0 };
  }
}

/**
 * Lee los updates de Telegram y atiende los botones de rate limit.
 *
 * Lo llama el bot local (tools/telegram-bot.js) con el token, no el publico.
 * Consume el update con offset para no procesar dos veces el mismo mensaje.
 */
export async function procesarCallbacksTelegram(
  env: RateLimitEnv & { TELEGRAM_BOT_TOKEN?: string },
  offset: number,
): Promise<{ atendidos: number; nuevoOffset: number }> {
  const tk = (env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!tk) return { atendidos: 0, nuevoOffset: offset };

  const { editarAviso } = await import('./telegram');
  let atendidos = 0;
  let nuevo = offset;
  try {
    const url = `https://api.telegram.org/bot${tk}/getUpdates?timeout=0&allowed_updates=["callback_query"]&offset=${offset}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { ok?: boolean; result?: { update_id: number; callback_query?: { data?: string; message?: { chat?: { id?: number }; message_id?: number } } }[] };
    if (!j.ok || !Array.isArray(j.result)) return { atendidos: 0, nuevoOffset: offset };

    for (const u of j.result) {
      nuevo = u.update_id + 1;
      const cq = u.callback_query;
      const data = cq?.data || '';
      if (!data.startsWith('rl:')) continue;
      const decision = data.split(':')[1]; // 'ok' | 'no'
      const ip = data.split(':')[2] || '';
      if (!ip) continue;

      const res = await resolverGrant(env, ip, decision === 'ok');
      atendidos++;

      const chatId = String(cq?.message?.chat?.id ?? '');
      const msgId = cq?.message?.message_id;
      if (chatId && typeof msgId === 'number') {
        await editarAviso(
          env,
          chatId,
          msgId,
          res.ok && decision === 'ok'
            ? `Aprobado. La IP <code>${ip}</code> pasa los siguientes 5 min.`
            : decision === 'ok'
              ? `No se pudo aprobar (el KV no respondio). ${ip} sigue bloqueada.`
              : `Rechazado. <code>${ip}</code> sigue bloqueada.`,
        );
      }
    }
    return { atendidos, nuevoOffset: nuevo };
  } catch {
    return { atendidos: 0, nuevoOffset: offset };
  }
}

/** Limpia la cache del isolate, para que un cambio se vea de inmediato. */
export function invalidarCacheBypass(): void {
  bypassCache.clear();
}

export async function checkRateLimit(
  env: RateLimitEnv,
  key: string,
  max: number,
  windowSeconds: number,
  /**
   * IP real del cliente. OBLIGATORIA para que el bypass del owner funcione: la
   * clave del cubo no siempre la lleva (`loginAccount:<hash del email>` no la
   * tiene), asi que sin este parametro el bypass no se reconoceria.
   */
  ip?: string,
): Promise<boolean> {
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  const fullKey = `rl:${key}`;

  // El bypass se consulta ANTES de tocar el cubo: asi el trabajo del owner no
  // gasta cupos ni produce 429, y los cubos de los demas no se tocan.
  const bypass = await leerBypass(env);
  if (exenta(bypass, ip)) return true;

  if (!kv) {
    const now = Date.now();
    const cur = memBuckets.get(fullKey);
    if (!cur || cur.resetAt < now) {
      memBuckets.set(fullKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    if (cur.count >= max) return false;
    cur.count++;
    return true;
  }

  try {
    const raw = await kv.get(fullKey);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!raw) {
      await kv.put(fullKey, JSON.stringify({ count: 1, resetAt: nowSec + windowSeconds }), {
        expirationTtl: windowSeconds,
      });
      return true;
    }
    const cur = JSON.parse(raw) as { count: number; resetAt: number };
    if (cur.resetAt <= nowSec) {
      await kv.put(fullKey, JSON.stringify({ count: 1, resetAt: nowSec + windowSeconds }), {
        expirationTtl: windowSeconds,
      });
      return true;
    }
    if (cur.count >= max) return false;
    const ttl = Math.max(1, cur.resetAt - nowSec);
    await kv.put(fullKey, JSON.stringify({ count: cur.count + 1, resetAt: cur.resetAt }), {
      expirationTtl: ttl,
    });
    return true;
  } catch {
    // Si KV falla, no bloquear tráfico legítimo: fallback a memoria.
    const now = Date.now();
    const cur = memBuckets.get(fullKey);
    if (!cur || cur.resetAt < now) {
      memBuckets.set(fullKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    if (cur.count >= max) return false;
    cur.count++;
    return true;
  }
}

export function rateKey(req: { header: (name: string) => string | undefined }, scope: string): string {
  return `${scope}:${getClientIp(req)}`;
}

/**
 * Lee el estado de un cubo SIN consumir intentos (para poder mostrarlo en la UI).
 * Devuelve null si no hay cubo, si expiró o si KV falla: quien llama decide.
 */
export async function peekRateLimit(
  env: RateLimitEnv,
  key: string,
  max: number,
): Promise<{ count: number; remaining: number; resetIn: number } | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;

  if (!kv) {
    const cur = memBuckets.get(`rl:${key}`);
    if (!cur || cur.resetAt / 1000 <= nowSec) return null;
    return { count: cur.count, remaining: Math.max(0, max - cur.count), resetIn: Math.round(cur.resetAt / 1000 - nowSec) };
  }

  try {
    const raw = await kv.get(`rl:${key}`);
    if (!raw) return null;
    const cur = JSON.parse(raw) as { count: number; resetAt: number };
    if (cur.resetAt <= nowSec) return null;
    return { count: cur.count, remaining: Math.max(0, max - cur.count), resetIn: cur.resetAt - nowSec };
  } catch {
    return null;
  }
}

/**
 * Vacía un cubo. Se usa tras un login correcto: así los 5 intentos del cubo de
 * cuenta cuentan FALLOS, no tecleos, y una persona que se equivoca tres veces y
 * luego entra bien no arrastra el contador. El cubo por IP no se vacía: ese sí
 * mide el ritmo de intentos,-good o no.
 */
export async function clearRateLimit(env: RateLimitEnv, key: string): Promise<void> {
  const kv = (env as { RATE_LIMIT_KV?: KVLike }).RATE_LIMIT_KV;
  memBuckets.delete(`rl:${key}`);
  if (!kv) return;
  try {
    await kv.delete(`rl:${key}`);
  } catch {
    // Si no se puede borrar, el cubo caduca solo por TTL. No es crítico:
    // solo puede dejar el contador un poco alto hasta que venza.
  }
}
