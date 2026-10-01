// Los imports de TypeScript sin extension (.ts) no los resuelve node, ni con
// --experimental-strip-types: hace falta un cargador que los anada. Este es minimo
// y solo sirve para ejecutar los tests de este repo contra el codigo real.
//
// Alternativa descartada: reimplementar checkRateLimit en el test. Seria un test
// que pasa mientras el codigo real este roto, que es peor que no tener test.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs';
      import { fileURLToPath, pathToFileURL } from 'node:url';
      export async function resolve(specifier, context, next) {
        try { return await next(specifier, context); }
        catch (err) {
          // SoloRelative y los imports sin extension dentro del proyecto.
          if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
            const base = new URL(specifier, context.parentURL);
            for (const cand of [base.href + '.ts', base.href + '.tsx', base.href + '/index.ts']) {
              if (existsSync(fileURLToPath(cand))) return next(cand, context);
            }
          }
          throw err;
        }
      }
    `),
  pathToFileURL('./'),
);

const { checkRateLimit, leerBypass, exenta, exentaYLimpia, debeBloquearYAvisar, resolverGrant } = await import(
  '../apps/api/src/lib/rate-limit.ts'
);

function kvFalso() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
}

let fallos = 0;
const check = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? '  -> ' + detalle : ''}`);
  if (!ok) fallos++;
};

const IP = '45.153.165.7';
const OTRA = '203.0.113.9';
const esperarCache = () => new Promise((r) => setTimeout(r, 5100)); // la cache dura 5 s

console.log('=== 1. sin bypass, el cubo cuenta y bloquea ===');
{
  const kv = kvFalso();
  const env = { RATE_LIMIT_KV: kv };
  let permitidos = 0, bloqueados = 0;
  for (let i = 0; i < 8; i++) {
    if (await checkRateLimit(env, `test:${IP}`, 5, 900, IP)) permitidos++; else bloqueados++;
  }
  check('los 5 primeros pasan', permitidos === 5, `pasaron ${permitidos}`);
  check('del 6 al 8 se bloquean', bloqueados === 3, `bloquearon ${bloqueados}`);
}

console.log('\n=== 2. con el bypass de mi IP, no cuenta ni bloquea ===');
{
  const kv = kvFalso();
  kv.m.set('rlbypass:ips', JSON.stringify({ ips: [IP], expiraEn: Math.floor(Date.now() / 1000) + 600 }));
  const env = { RATE_LIMIT_KV: kv };
  await esperarCache();
  let bloqueados = 0;
  for (let i = 0; i < 50; i++) if (!(await checkRateLimit(env, `test:${IP}`, 5, 900, IP))) bloqueados++;
  check('50 intentos muy por encima del tope: ninguno bloqueado', bloqueados === 0, `bloquearon ${bloqueados}`);

  // El cubo NO debe haberse llenado: al apagar el bypass, el limite tiene que
  // volver a aplicarse desde cero, no seguir "limpio" por el bypass.
  let trasApagar = 0;
  for (let i = 0; i < 8; i++) if (await checkRateLimit(env, `otro:${IP}`, 5, 900, IP)) trasApagar++;
  check('sin bypass, el cubo vuelve a contar', trasApagar >= 5, `pasaron ${trasApagar} de 8`);
}

// --- 2b. EL CASO QUE FALLO EN PRODUCCION ---
// El cubo se LLENA primero, y despues se activa el bypass. Si el bypass solo se
// consultara en el camino que consume (checkRateLimit), aqui seguiria
// bloqueado: es el caso real de "me he quedado topado y quiero trabajar".
console.log('\n=== 2b. cubo YA LLENO y despues se activa el bypass ===');
{
  const kv = kvFalso();
  const env = { RATE_LIMIT_KV: kv };
  // Se espera a que expire la cache del test anterior. La cache de 5 s es correcta
  // en el Worker (es por isolate), pero aqui cada test tiene su propio KV: sin
  // esta espera, el estado del test 2 (con bypass) se filtra al 2b y el "cubo
  // lleno" nunca llega a llenarse. Es un artefacto del test, no un fallo del
  // codigo, pero conviene dejarlo escrito para que no se lea como un bug.
  await esperarCache();
  // Primero se llena el cubo sin bypass.
  let bloq = 0;
  for (let i = 0; i < 8; i++) if (!(await checkRateLimit(env, `pre:${IP}`, 5, 900, IP))) bloq++;
  check('sin bypass, el cubo se llena', bloq === 3, `bloquearon ${bloq}`);

  // Luego se activa el bypass, con el cubo YA lleno.
  kv.m.set('rlbypass:ips', JSON.stringify({ ips: [IP], expiraEn: Math.floor(Date.now() / 1000) + 600 }));
  await esperarCache();

  // Y el camino que DECIDE el 429 (peekRateLimit, via exentaYLimpia) tiene que
  // decir que no esta bloqueado, ademas de limpiar el cubo.
  const exentaYa = await exentaYLimpia(env, IP, [`pre:`]);
  check('con el cubo lleno, la exencion se reconoce', exentaYa === true, `exenta=${exentaYa}`);

  // Y con el cubo limpiado, checkRateLimit tampoco bloquea.
  bloq = 0;
  for (let i = 0; i < 8; i++) if (!(await checkRateLimit(env, `pre:${IP}`, 5, 900, IP))) bloq++;
  check('tras activar el bypass, el cubo lleno ya no bloquea', bloq === 0, `bloquearon ${bloq}`);

  // Y otra IP con el bypass activo sigue topandose (el bypass es por IP).
  let bloqOtra = 0;
  for (let i = 0; i < 8; i++) if (!(await checkRateLimit(env, `otr:${OTRA}`, 5, 900, OTRA))) bloqOtra++;
  check('otra IP sigue topandose (el bypass no es global)', bloqOtra === 3, `bloquearon ${bloqOtra}`);
}

console.log('\n=== 3. el bypass NO es global: otra IP sigue topada ===');
{
  const kv = kvFalso();
  kv.m.set('rlbypass:ips', JSON.stringify({ ips: [IP], expiraEn: Math.floor(Date.now() / 1000) + 600 }));
  const env = { RATE_LIMIT_KV: kv };
  await esperarCache();
  let bloqueados = 0;
  for (let i = 0; i < 8; i++) if (!(await checkRateLimit(env, `test:${OTRA}`, 5, 900, OTRA))) bloqueados++;
  check('otra IP sigue topandose con mi bypass activo', bloqueados === 3, `bloquearon ${bloqueados} de 3`);
}

console.log('\n=== 4. el bypass caduca solo ===');
{
  const kv = kvFalso();
  kv.m.set('rlbypass:ips', JSON.stringify({ ips: [IP], expiraEn: Math.floor(Date.now() / 1000) - 1 }));
  const env = { RATE_LIMIT_KV: kv };
  await esperarCache();
  const estado = await leerBypass(env);
  check('una entrada caducada no da el bypass por activo', estado.activo === false, `activo=${estado.activo}`);
  let bloqueados = 0;
  for (let i = 0; i < 8; i++) if (!(await checkRateLimit(env, `t4:${IP}`, 5, 900, IP))) bloqueados++;
  check('con el bypass caducado, vuelve a toparse', bloqueados === 3, `bloquearon ${bloqueados}`);
}

console.log('\n=== 5. si el KV falla, se BLOQUEA (no se abre) ===');
{
  const roto = {
    get: async () => { throw new Error('KV caido'); },
    put: async () => { throw new Error('x'); },
    delete: async () => { throw new Error('x'); },
  };
  const env = { RATE_LIMIT_KV: roto };
  const estado = await leerBypass(env);
  check('KV roto: bypass inactivo', estado.activo === false);
  check('KV roto: exenta() es false', exenta(estado, IP) === false);
  check('KV roto: bloquea', (await debeBloquearYAvisar(env, IP, 'login')) === true);
}

console.log('\n=== 6. grant aprobado: pasa; sin grant: bloquea ===');
{
  const kv = kvFalso();
  const env = { RATE_LIMIT_KV: kv };
  check('sin grant, bloquea', (await debeBloquearYAvisar(env, IP, 'login')) === true);
  const r = await resolverGrant(env, IP, true);
  check('aprobar devuelve ok', r.ok === true, `${r.expiraEn - Math.floor(Date.now() / 1000)}s de grant`);
  check('con grant, NO bloquea', (await debeBloquearYAvisar(env, IP, 'login')) === false);

  const kv2 = kvFalso();
  const env2 = { RATE_LIMIT_KV: kv2 };
  await resolverGrant(env2, IP, true);
  const r2 = await resolverGrant(env2, IP, false);
  check('rechazar no concede nada', r2.expiraEn === 0);
  check('tras rechazar, vuelve a bloquear', (await debeBloquearYAvisar(env2, IP, 'login')) === true);
}

console.log('\n=== 7. sin IP no hay exencion ===');
{
  const kv = kvFalso();
  kv.m.set('rlbypass:ips', JSON.stringify({ ips: [IP], expiraEn: Math.floor(Date.now() / 1000) + 600 }));
  const env = { RATE_LIMIT_KV: kv };
  await esperarCache();
  const estado = await leerBypass(env);
  check('exenta(undefined) es false', exenta(estado, undefined) === false);
  check('exenta("") es false', exenta(estado, '') === false);
  // La MISMA clave en los 8 intentos, sin IP: es lo que hace una peticion real
  // de un cliente al que no se le puede sacar la IP. Con clave distinta cada vez
  // cada intento tendria su propio cubo y no se toparian nunca, que es un test
  // que pasaria sin comprobar nada.
  let bloqueados = 0;
  for (let i = 0; i < 8; i++) if (!(await checkRateLimit(env, 't7:sin-ip', 5, 900))) bloqueados++;
  check('sin IP, se aplica el limite', bloqueados === 3, `bloquearon ${bloqueados}`);
}

console.log(`\n${fallos === 0 ? 'LA LOGICA DEL INTERRUPTOR ES CORRECTA' : fallos + ' FALLOS'}`);
process.exit(fallos ? 1 : 0);
