// Comprueba que la autenticación del correo sigue en pie: DMARC, SPF y DKIM.
//
// POR QUÉ EXISTE
//
// El correo de la tienda (pedidos, códigos, reset de clave) sale de
// noreply@suprime.xyz por Resend. Si alguna de estas piezas se cae, los correos
// empiezan a ir a spam o a rebotar, y nadie avisa: no hay error visible en la
// web. Este script es el que lo detecta.
//
// Lo que comprueba, y por qué importa cada cosa:
//   - El TXT de _dmarc existe y tiene sintaxis válida. Sin él no hay política
//     anti-spoofing ni informes: cualquiera puede enviar como la tienda.
//   - La política (p=) es una de las tres válidas. p=none solo observa; si un día
//     se pone quarantine/reject por error sin que todo pase, se pierde correo
//     legítimo, así que el valor se informa siempre.
//   - El dominio del rua tiene MX: si no puede recibir, los informes se pierden
//     y nadie se entera de que algo falla.
//   - El SPF de la raíz existe (cubre el webmail de Spacemail).
//   - El SPF de send.suprime.xyz existe (es el Return-Path que usa Resend; sin
//     él, el SPF del envío no pasa).
//   - El DKIM de resend._domainkey existe y parece una clave RSA (empieza por
//     p=M...). Sin él, la firma que alinea con el dominio no existe.
//
// Se pregunta por DoH a Cloudflare, no al resolver local: el resolver de una
// máquina cualquiera puede tardar o fallar (ya pasó con _dmarc dando timeout),
// y un timeout no es un "no existe".
//
// Uso: node tools/check-dmarc.mjs
// Salida: código 1 si algo falla, 0 si todo correcto.
const DOMINIO = process.env.DOMINIO || 'suprime.xyz';

let pass = 0, fail = 0;
const check = (nombre, cond, detalle = '') => {
  if (cond) { pass++; console.log(`  OK    ${nombre}${detalle ? '  -> ' + detalle : ''}`); }
  else { fail++; console.log(`  FALLA ${nombre}${detalle ? '  -> ' + detalle : ''}`); }
};

async function doh(nombre, tipo) {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${nombre}&type=${tipo}`, {
    headers: { Accept: 'application/dns-json' },
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  return { existe: j.Status === 0 && (j.Answer || []).length > 0, datos: (j.Answer || []).map((a) => a.data) };
}

console.log(`== Autenticación del correo en ${DOMINIO} ==\n`);

// --- 1. DMARC ---
const dmarc = await doh(`_dmarc.${DOMINIO}`, 'TXT');
check('existe el TXT de _dmarc', dmarc.existe, dmarc.existe ? dmarc.datos.join(' ').slice(0, 90) : 'NXDOMAIN: sin DMARC no hay política ni informes');
if (dmarc.existe) {
  const txt = dmarc.datos.join(' ').replace(/"/g, '');
  const tags = Object.fromEntries(txt.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p, ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  check('el registro empieza por v=DMARC1', tags.v === 'DMARC1', `v=${tags.v || '(ausente)'}`);
  check('la política es válida (none/quarantine/reject)', ['none', 'quarantine', 'reject'].includes(tags.p), `p=${tags.p || '(ausente)'}`);
  if (tags.p === 'none') console.log('  -- p=none: solo observa, no bloquea nada (correcto mientras se vigila)');
  if (tags.p === 'reject') console.log('  -- p=reject: bloquea lo no autenticado (solo si los informes ya confirmaron que todo pasa)');
  check('hay rua para recibir informes', !!tags.rua, tags.rua || 'sin rua: nadie se entera de los fallos');
  if (tags.rua) {
    // El rua puede llevar varias direcciones separadas por coma; se comprueba la primera.
    const primera = tags.rua.split(',')[0].trim().replace(/^mailto:/i, '');
    const dominioRua = primera.split('@')[1] || '';
    if (dominioRua === DOMINIO) {
      console.log(`  -- rua del mismo dominio (${primera}): no necesita autorización externa`);
    } else if (dominioRua) {
      // Un rua en OTRO dominio exige un TXT de autorización en ese dominio
      // (_dmarc con "v=DMARC1" que autorice). Sin él, los informes no se envían.
      const aut = await doh(`_dmarc.${dominioRua}`, 'TXT');
      const autoriza = aut.datos.join(' ').includes(DOMINIO);
      check(`el dominio del rua (${dominioRua}) autoriza los informes`, autoriza, autoriza ? 'autorizado' : 'sin autorización, los informes no llegan');
    }
    if (dominioRua) {
      const mx = await doh(dominioRua, 'MX');
      check(`el dominio del rua (${dominioRua}) puede recibir correo (tiene MX)`, mx.existe, mx.existe ? mx.datos.join(', ').slice(0, 60) : 'sin MX: los informes rebotan');
    }
  }
}

// --- 2. SPF de la raíz (webmail de Spacemail) ---
const spf = await doh(DOMINIO, 'TXT');
const spfTxt = spf.datos.join(' ');
check('existe SPF en la raíz', spfTxt.includes('v=spf1'), spfTxt.slice(0, 80) || 'sin SPF');
if (spfTxt.includes('v=spf1')) {
  check('el SPF termina en ~all o -all (sin final abierto)', /[~-]all/.test(spfTxt), spfTxt.slice(-12), 'sin cierre, cualquiera puede enviar');
}

// --- 3. SPF del Return-Path de Resend ---
const retorno = await doh(`send.${DOMINIO}`, 'TXT');
check('existe SPF en send (Return-Path de Resend)', retorno.datos.join(' ').includes('v=spf1'), retorno.datos.join(' ').slice(0, 80) || 'sin SPF: el SPF del envío no pasa');

// --- 4. DKIM de Resend ---
const dkim = await doh(`resend._domainkey.${DOMINIO}`, 'TXT');
const clave = dkim.datos.join(' ').replace(/"/g, '').replace(/\s/g, '');
check('existe el DKIM de Resend', dkim.existe && clave.includes('p='), dkim.existe ? 'clave presente' : 'sin DKIM: la firma alineada no existe');
if (dkim.existe) {
  // La clave va como p=<base64>. Se extrae y se comprueba que parezca una RSA
  // de verdad (empieza por M y tiene longitud de clave, no un texto corto).
  const m = /p=([A-Za-z0-9+/=]+)/.exec(clave);
  const p = m ? m[1] : '';
  check('la clave parece RSA válida', p.startsWith('M') && p.length > 100, `${p.length} chars en base64`);
}

// --- 5. MX (el entrante) ---
const mx = await doh(DOMINIO, 'MX');
check('existe MX para recibir', mx.existe, mx.existe ? mx.datos.join(', ').slice(0, 60) : 'sin MX');

console.log(`\n${fail === 0 ? 'TODO CORRECTO' : fail + ' COMPROBACIONES FALLAN'}: ${pass} OK, ${fail} falla(s)`);
process.exit(fail ? 1 : 0);
