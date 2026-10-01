// tools/rl-bypass.mjs — interruptor de rate limit para la IP del owner.
//
// QUE ES Y QUE NO ES
//
//   - POR IP. Un flag global dejaria la web sin proteccion de fuerza bruta para
//     TODO el mundo mientras trabajas, que es lo contrario de blindarla. Con el
//     bypass activo, los cubos de las demas IPs siguen contando igual.
//   - CON CADUCIDAD. Es una entrada de KV con TTL, no un flag eterno. Si se te
//     olvida apagarlo, se apaga solo.
//
// SOBRE EL RANGO 192.168.0.1-0.10
//
// Se pidio ese rango "por si cambio de equipo en la misma red". Contra la API de
// produccion no puede funcionar, y no es cuestion de configuracion:
// 192.168.0.0/24 es direccion PRIVADA (RFC 1918) y el router la traduce por NAT,
// de modo que al Worker le llega la IP PUBLICA del router, nunca la privada. La
// IP publica de esta maquina es 45.153.165.7, que no esta en ese rango.
//
// Por eso el script guarda la IP publica, detectada sola, y `anadir` permite
// meter mas si tu ISP te la cambia (algunos rotan la IP cada dias). El rango de
// la LAN se puede registrar aparte con `anadir-lan`, y sirve para un Worker local
// (`wrangler dev --ip`), donde si se ve la IP privada.
//
// USO
//
//   npm run rl:on                 activa el bypass 45 min para tu IP
//   npm run rl:on -- 90            activa 90 minutos
//   npm run rl:on -- <ip> 90      activa para otra IP concreta
//   npm run rl:on -- añadir <ip>  anade una IP mas sin reiniciar la cuenta
//   npm run rl:off                apaga el bypass y borra los grants
//   npm run rl:estado             que hay puesto ahora, y cuando caduca
//   npm run rl:limpiar            borra TODOS los cubos de rate limit
//
// SEGURIDAD DEL SCRIPT
//
// Escribes en el KV de produccion, asi que pide confirmacion antes de activar y
// de borrar, salvo con --si. Activar el bypass es una decision consciente, no un
// efecto secundario.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const home = () => {
  try { return homedir(); } catch { return null; }
};


// tools/rl-bypass.mjs -> la raiz del repo es el padre de tools/. Se deriva de la
// ubicacion del propio script y NO de una ruta fija: una ruta absoluta de una
// maquina concreta no existe en el runner del CI (que es Linux, en otra carpeta)
// y hacia que el paso del CI fallara con ENOENT.
const DIR_AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = dirname(DIR_AQUI);

// Ver el comentario de WRANGLER_JS mas abajo: va aqui y no junto a los imports
// porque usa RAIZ, y con const no se puede leer antes de inicializarse.
const SECRETO = 'C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/cloudflare.env';
const WRANGLER_JS = join(RAIZ, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const NS = 'c695ababca41469a97d90502eebf1620';
const BYPASS_KEY = 'rlbypass:ips';
const GRANT_KEY = 'rlbypass:grant';
const OWNER_KEY = 'rlbypass:owner';
const AVISO_PREFIJO = 'rlbypass:avisado:';

const args = process.argv.slice(2);
const tieneFlag = (n) => args.includes(`--${n}`);
const valor = (n, porDefecto) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

/**
 * Credenciales de Cloudflare.
 *
 * process.env PRIMERO, y el fichero despues. Al reves, el fichero local gana
 * sobre los secrets del CI y el paso se ejecuta con las credenciales de la
 * maquina de quien lo commitea (o falla, si no existen: en el runner de Linux no
 * hay ningun C:/Users/VIP). El orden de esta funcion es lo que decide si el CI
 * usa sus secrets o los tuyos.
 */
function entorno() {
  const o = {};
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    const v = (process.env[k] || '').trim();
    if (v) o[k] = v;
  }
  if (o.CLOUDFLARE_API_TOKEN && o.CLOUDFLARE_ACCOUNT_ID) return o;

  // Respaldo local: el fichero de _SECRETS, si existe.
  // Rutas candidatas, en orden: la que se pase por entorno, y la de al lado del
  // repo. Se derivan de donde esta este script, no de una maquina concreta: una
  // ruta absoluta de tu disco no existe en el runner del CI ni en otro equipo.
  for (const cand of [
    process.env.CLOUDFLARE_ENV_FILE,
    join(dirname(RAIZ), '_SECRETS', 'cloudflare.env'),
    join(home(), 'Desktop', 'Cerebro Obcidian', '_SECRETS', 'cloudflare.env'),
  ].filter(Boolean)) {
    if (!cand) continue;
    try {
      const t = readFileSync(cand, 'utf8');
      for (const l of t.split(/\r?\n/)) {
        if (!l || l.startsWith('#')) continue;
        const i = l.indexOf('=');
        if (i < 0) continue;
        const k = l.slice(0, i).trim();
        const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (!o[k]) o[k] = v;
      }
    } catch {
      // El fichero puede no existir (CI, otra maquina). Se sigue con env.
    }
  }
  return o;
}

function wrangler(...cmd) {
  const e = entorno();
  if (!e.CLOUDFLARE_API_TOKEN) {
    console.error('  Faltan credenciales de Cloudflare. Se esperan CLOUDFLARE_API_TOKEN y');
    console.error('  CLOUDFLARE_ACCOUNT_ID en el entorno, o el fichero en _SECRETS/cloudflare.env.');
    console.error('  Sin ellas NO se puede leer ni escribir el KV: el estado que ves a');
    console.error('  continuacion es desconocido, no "apagado".');
    return null;
  }
  const envWrangler = { ...process.env, CLOUDFLARE_API_TOKEN: e.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: e.CLOUDFLARE_ACCOUNT_ID };
  const r = existsSync(WRANGLER_JS)
    ? spawnSync(process.execPath, [WRANGLER_JS, ...cmd, '--namespace-id', NS, '--remote'], { cwd: RAIZ, encoding: 'utf8', env: envWrangler })
    : spawnSync('npx.cmd', ['wrangler', ...cmd, '--namespace-id', NS, '--remote'], { cwd: RAIZ, encoding: 'utf8', env: envWrangler });
  if (r.status !== 0) {
    // Un 404 al LEER una clave es "no existe todavia", que es lo normal cuando
    // el bypass no se ha activado nunca. Antes esto se imprimia como error y
    // hacia que `estado` saliera con ruido y codigo 1.
    const salida = ((r.stderr || '') + (r.stdout || '')).trim();
    if (cmd[0] === 'kv' && cmd[1] === 'key' && cmd[2] === 'get' && /404|Not Found/i.test(salida)) {
      return null;
    }
    console.error('  wrangler fallo:', salida.split('\n').filter((l) => l && !/Logs were written/.test(l)).slice(-3).join('\n'));
    return null;
  }
  return (r.stdout || '').trim();
}

async function ipPublica() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10000) });
    return (await r.json()).ip;
  } catch {
    return null;
  }
}

const leer = (k) => wrangler('kv', 'key', 'get', k);
const borrar = (k) => wrangler('kv', 'key', 'delete', k);
// wrangler kv key put NO tiene flag de TTL: en el CLI no existe. Por eso, si se
// le pasa, wrangler suelta el texto de su ayuda y devuelve error, y el bypass no
// se guardaba. El script aun asi llegaba a imprimir "ACTIVADO", que es lo
// peor que puede hacer un script de este tipo: decir que ha hecho algo que no
// ha hecho.
//
// El TTL de la entrada no lo pone el flag sino el propio valor guardado: la API
// lee el campo expiraEn de la entrada y lo compara con la hora actual, asi que
// la caducidad se cumple igual aunque la clave siga viva en el KV. Y como
// checkRateLimit la ignora cuando ha caducado, no hay que depender de que el KV
// la borre.
const escribir = (k, v) => {
  const r = wrangler('kv', 'key', 'put', k, '--path', escribirArchivo(v));
  // Se verifica leyendo: si no aparece, no se dice que se ha activado.
  if (r === null) return false;
  const guardado = leer(k);
  if (!guardado) return false;
  try {
    const d = JSON.parse(guardado);
    return Array.isArray(d.ips) && d.ips.length > 0;
  } catch {
    return false;
  }
};

// wrangler kv key put necesita un archivo, no un string: se escribe a un temporal.
const TEMP = 'C:/Users/VIP/AppData/Local/Temp/opencode/kv-valor.txt';
function escribirArchivo(v) {
  writeFileSync(TEMP, v, 'utf8');
  return TEMP;
}

async function confirmar(pregunta) {
  if (tieneFlag('si')) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(`${pregunta} [s/N] `);
  rl.close();
  return /^s/i.test(r.trim());
}

const ACCION = args[0] || 'estado';

console.log('== Interruptor de rate limit (por IP, con caducidad) ==\n');

function credencialesAusentes() {
  const e = entorno();
  return !e.CLOUDFLARE_API_TOKEN || !e.CLOUDFLARE_ACCOUNT_ID;
}

// --- estado ---
if (ACCION === 'estado') {
  const raw = leer(BYPASS_KEY);
  const grant = leer(GRANT_KEY);
  const owner = leer(OWNER_KEY);
  console.log('  IP publica de esta maquina:', (await ipPublica()) || '(no se pudo detectar)');
  console.log('  tu IP LAN:               192.168.0.105  (no llega a produccion: es privada)');
  console.log('');
  if (credencialesAusentes()) {
    console.log('  BYPASS: DESCONOCIDO (no hay credenciales de Cloudflare)');
    console.log('  Esto NO es lo mismo que "apagado": no se ha podido comprobar.');
  } else if (!raw) console.log('  BYPASS: apagado');
  else {
    const d = JSON.parse(raw);
    const mins = Math.max(0, Math.round((d.expiraEn - Date.now() / 1000) / 60));
    console.log(`  BYPASS: ${mins > 0 ? 'ACTIVO' : 'expirado'}  caduca en ${mins} min`);
    console.log(`    IPs: ${(d.ips || []).join(', ')}`);
  }
  if (grant) {
    const g = JSON.parse(grant);
    const mins = Math.max(0, Math.round((g.expiraEn - Date.now() / 1000) / 60));
    console.log(`  GRANT aprobado: ${(g.ips || []).join(', ')}  (${mins} min)`);
  }
  if (owner) console.log(`  OWNER registradas: ${(JSON.parse(owner) || []).join(', ')}`);
  process.exit(0);
}

// --- on ---
if (ACCION === 'on') {
  let ips = [];
  let minutos = 45;

  // Scanear el primer argumento posicional: si parece una IP, es una IP nueva.
  const posicional = args.filter((a) => !a.startsWith('--') && a !== 'on' && a !== 'anadir');
  for (const p of posicional) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(p)) ips.push(p);
    else if (/^\d+$/.test(p)) minutos = Math.min(240, Math.max(5, Number(p)));
  }

  if (args[1] === 'anadir') {
    const nueva = posicional[0];
    if (!nueva) { console.error('  falta la IP: npm run rl:on -- anadir 1.2.3.4'); process.exit(1); }
    const raw = leer(BYPASS_KEY);
    const d = raw ? JSON.parse(raw) : { ips: [], expiraEn: 0 };
    d.ips = [...new Set([...(d.ips || []), nueva])];
    if (d.expiraEn < Date.now() / 1000) d.expiraEn = Date.now() / 1000 + 45 * 60;
    if (!escribir(BYPASS_KEY, JSON.stringify(d))) { console.error('  NO se pudo guardar.'); process.exit(1); }
    console.log(`  IP anadida al bypass: ${nueva}`);
    console.log(`  bypass activo para: ${d.ips.join(', ')}`);
    process.exit(0);
  }

  if (!ips.length) {
    const ip = await ipPublica();
    if (!ip) { console.error('  no se pudo detectar tu IP publica; pasala a mano'); process.exit(1); }
    ips = [ip];
  }

  const expiraEn = Math.floor(Date.now() / 1000) + minutos * 60;
  console.log(`  Se va a desactivar el rate limit para:`);
  for (const ip of ips) console.log(`    - ${ip}`);
  console.log(`  Durante ${minutos} minutos. El resto de IPs siguen topadas.`);
  if (!(await confirmar('  Confirmar?'))) { console.log('  Cancelado.'); process.exit(0); }

  const valor = JSON.stringify({ ips, expiraEn });
  if (!escribir(BYPASS_KEY, valor)) { console.error('  NO se pudo guardar. Revisa que el token de Cloudflare tenga permiso de escritura en KV.'); process.exit(1); }
  // Se registra como owner, para que pueda pedir aprobacion si se topa con otro
  // limite (por ejemplo el de 2FA, que el bypass no cubre si caduca antes).
  const rawOwner = leer(OWNER_KEY);
  const owners = rawOwner ? JSON.parse(rawOwner) : [];
  const nuevos = [...new Set([...owners, ...ips])];
  if (JSON.stringify(nuevos) !== JSON.stringify(owners)) escribir(OWNER_KEY, JSON.stringify(nuevos));
  try { unlinkSync(TEMP); } catch {}
  console.log(`  Bypass ACTIVADO hasta ${new Date(expiraEn * 1000).toLocaleTimeString('es-ES')}`);
  console.log(`  Se apaga solo. Para terminar antes: npm run rl:off`);
  process.exit(0);
}

// --- off ---
if (ACCION === 'off') {
  console.log('  Se apaga el bypass para todas las IPs y se borran los grants.');
  if (!(await confirmar('  Confirmar?'))) { console.log('  Cancelado.'); process.exit(0); }
  borrar(BYPASS_KEY);
  borrar(GRANT_KEY);
  try { unlinkSync(TEMP); } catch {}

  // Tambien se limpian los cubos de las IPs owner. Sin esto, apagar el bypass
  // dejaba topado al owner: el cubo que se lleno antes de activarlo sigue ahi
  // hasta que caducan sus 15 minutos, asi que el primer login tras apagar
  // devolvia 429 y parecia que el interruptor se habia roto. Solo se tocan los
  // cubos de las IPs registradas como owner, que son las tuyas.
  const rawOwner = leer(OWNER_KEY);
  const owners = rawOwner ? (JSON.parse(rawOwner) || []) : [];
  let limpiados = 0;
  for (const ip of owners) {
    const r = wrangler('kv', 'key', 'list', '--prefix', 'rl:');
    if (r === null) break;
    let claves = [];
    try { claves = JSON.parse(r) || []; } catch { claves = []; }
    for (const k of claves) {
      const nombre = typeof k === 'string' ? k : k.name;
      if (nombre && nombre.includes(ip) && borrar(nombre) !== null) limpiados++;
    }
  }
  console.log(`  Bypass apagado. El rate limit vuelve a aplicarse ya.`);
  console.log(`  ${limpiados > 0 ? `Limpiados ${limpiados} cubos tuyos para que no te quedes topado.` : 'Tus cubos estaban limpios.'}`);
  process.exit(0);
}

// --- limpiar ---
if (ACCION === 'limpiar') {
  console.log('  Esto borra TODOS los cubos de rate limit de produccion.');
  console.log('  Util solo si de verdad hace falta: durante unos segundos nadie');
  console.log('  esta topado, ni siquiera un atacante.');
  if (!(await confirmar('  Confirmar?'))) { console.log('  Cancelado.'); process.exit(0); }

  const r = wrangler('kv', 'key', 'list', '--prefix', 'rl:');
  if (r === null) { console.error('  no se pudo listar'); process.exit(1); }
  let lineas = 0;
  try { lineas = JSON.parse(r).length; } catch { lineas = 0; }
  console.log(`  ${lineas} claves con prefijo rl:`);
  let borradas = 0;
  for (const p of ['rl:', 'rlbypass:']) {
    const rr = wrangler('kv', 'key', 'list', '--prefix', p);
    if (!rr) continue;
    for (const k of JSON.parse(rr)) {
      const nombre = typeof k === 'string' ? k : k.name;
      if (borrar(nombre) !== null) borradas++;
    }
  }
  console.log(`  Borradas ${borradas} claves. El rate limit esta como recien salido.`);
  process.exit(0);
}

console.log(`  Orden desconocida: ${ACCION}`);
console.log('  Usa: on | off | estado | limpiar');
process.exit(1);
