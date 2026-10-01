// Conecta el bot de Telegram con el boton de Aprobar/Rechazar del rate limit.
//
// El flujo: el Worker avisa por su cuenta (lib/telegram.ts). Cuando el owner
// pulsa un boton, Telegram entrega un callback_query a getUpdates. Nadie lo
// recoge, asi que el bot queda muerto: hay que leerlos y actuar. Eso es lo que
// hace este script, y solo lo hace con su propio token.
//
// El offset se guarda en un fichero para no procesar dos veces el mismo boton
// (un Aprobar repetido no debe reescribir el grant en bucle).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = 'C:/Users/VIP/Desktop/Cerebro Obcidian/C proyectos Web';
const WRANGLER_JS = join(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const NS = 'c695ababca41469a97d90502eebf1620';
const OFFSET_FILE = 'C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/.telegram-tl-offset';
const BOT = join(process.env.USERPROFILE || '', 'Desktop', 'Cerebro Obcidian', 'telegram-bot.js');

const args = process.argv.slice(2);
const modo = args[0] || 'once';

function entorno() {
  const t = readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/cloudflare.env', 'utf8');
  const o = {};
  for (const l of t.split(/\r?\n/)) {
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 0) continue;
    o[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return o;
}

const tokenDe = () => {
  const t = readFileSync(BOT, 'utf8');
  const m = t.match(/API_TOKEN\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
};

const leerOffset = () => (existsSync(OFFSET_FILE) ? Number(readFileSync(OFFSET_FILE, 'utf8').trim()) || 0 : 0);
const guardarOffset = (o) => writeFileSync(OFFSET_FILE, String(o), 'utf8');

async function procesar() {
  const tk = tokenDe();
  if (!tk) { console.log('  no se encontro el token en telegram-bot.js'); return 0; }
  const offset = leerOffset();
  const url = `https://api.telegram.org/bot${tk}/getUpdates?timeout=0&allowed_updates=${encodeURIComponent('["callback_query"]')}&offset=${offset}`;

  let j;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    j = await r.json();
  } catch (e) {
    console.log('  no se pudo leer Telegram:', String(e).slice(0, 80));
    return 0;
  }
  if (!j.ok || !Array.isArray(j.result) || j.result.length === 0) {
    console.log('  sin botones pendientes');
    return 0;
  }

  const e = entorno();
  const { spawnSync } = await import('node:child_process');
  let atendidos = 0;
  for (const u of j.result) {
    guardarOffset(u.update_id + 1);
    const cq = u.callback_query;
    const data = cq?.data || '';
    if (!data.startsWith('rl:')) continue;
    const partes = data.split(':');
    const decision = partes[1];
    const ip = partes[2];
    if (!ip) continue;

    // Se responde YA al boton, para que Telegram quite el "cargando" y no deje
    // el mensaje en un estado ambiguo aunque el KV tarde.
    try {
      await fetch(`https://api.telegram.org/bot${tk}/answerCallbackQuery?callback_query_id=${cq.id}&text=${encodeURIComponent(decision === 'ok' ? 'Aprobado' : 'Rechazado')}&show_alert=false`, { method: 'POST', signal: AbortSignal.timeout(8000) });
    } catch {}

    // Se escribe el grant en el KV de produccion.
    const TEMP = 'C:/Users/VIP/AppData/Local/Temp/opencode/grant.json';
    let cuerpo;
    if (decision === 'ok') {
      const expiraEn = Math.floor(Date.now() / 1000) + 300;
      cuerpo = JSON.stringify({ ips: [ip], expiraEn });
    } else {
      // Rechazar: solo se limpia el aviso, para que la proxima vez vuelva a
      // preguntar. No se escribe ninguna exencion.
      cuerpo = null;
    }

    if (cuerpo) {
      writeFileSync(TEMP, cuerpo, 'utf8');
      spawnSync(process.execPath, [WRANGLER_JS, 'kv', 'key', 'put', 'rlbypass:grant', '--path', TEMP, '--namespace-id', NS, '--remote'], {
        cwd: RAIZ, encoding: 'utf8',
        env: { ...process.env, CLOUDFLARE_API_TOKEN: e.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: e.CLOUDFLARE_ACCOUNT_ID },
      });
      console.log(`  APROBADO: ${ip} pasa los siguientes 5 min`);
    } else {
      spawnSync(process.execPath, [WRANGLER_JS, 'kv', 'key', 'delete', `rlbypass:avisado:${ip}`, '--namespace-id', NS, '--remote'], {
        cwd: RAIZ, encoding: 'utf8',
        env: { ...process.env, CLOUDFLARE_API_TOKEN: e.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: e.CLOUDFLARE_ACCOUNT_ID },
      });
      console.log(`  RECHAZADO: ${ip} sigue bloqueada`);
    }
    atendidos++;
  }
  return atendidos;
}

if (modo === 'once') {
  const n = await procesar();
  console.log(n ? `  ${n} boton(es) atendidos` : '  nada que hacer');
  process.exit(0);
}

if (modo === 'escuchar') {
  console.log('  Atendiendo botones de Telegram. Ctrl+C para parar.\n');
  const t0 = Date.now();
  // getUpdates con long polling: 30 s por consulta, como mucho uno cada 30 s, que
  // es lo que permite la API de Telegram sin pagar.
  while (Date.now() - t0 < (Number(args[1]) || 3600) * 1000) {
    await procesar();
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('  Tiempo agotado, se para.');
  process.exit(0);
}

console.log('  Uso: node telegram-rl.js [once|escuchar [segundos]]');
process.exit(1);
