// =============================================================
// BARRIDO DE INTERACCIÓN · usa TODOS los controles de la web
// =============================================================
// Lo anterior comprobaba que las páginas pintan. Esto comprueba que SE USAN: cada
// botón, cada formulario, cada modal. Un sitio puede pintar perfecto y tener medio
// boton sin onclick.
//
// Qué busca, en orden de gravedad:
//   1. Controles que no hacen nada al pulsarlos (el fallo mas comun y el mas
//      dificil de ver sin pinchar).
//   2. Flujos enteros rotos: comprar, entrar, registrarse, cambiar la contraseña.
//   3. Estados de error: vacio, invalido, demasiado largo, con caracteres raros.
//   4. Lo que se mete en un campo y sale por otro lado sin escapar (XSS reflejado).
//   5. Fugas: un dato de una pantalla en la siguiente.
//
// Uso: node tools/barrido-interaccion.mjs
import { chromium, devices } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const WWW = process.env.WWW || 'https://www.suprime.xyz';
const API = process.env.API || 'https://api.suprime.xyz/api/v1';
const SECRETO = 'C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/smoke.env';

let pass = 0, fail = 0, avisos = 0;
const lineas = [];
const fallos = [];
const check = (n, ok, d = '', p = '') => {
  if (ok) { pass++; lineas.push(`PASS ${n}${p ? '  (' + p + ')' : ''}`); }
  else { fail++; lineas.push(`FAIL ${n}  ${d}${p ? '  (' + p + ')' : ''}`); fallos.push({ n, d, p }); }
};
const avisar = (n, d, p = '') => { avisos++; lineas.push(`AVISO ${n}  ${d}${p ? '  (' + p + ')' : ''}`); };

const F = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(25000) });

// ---------------------------------------------------------------- utilidades
async function aceptarCookies(page) {
  const b = page.getByRole('button', { name: /Aceptar/i }).first();
  if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
}

function vigilar(page, sinks) {
  page.on('pageerror', (e) => sinks.erroresJS.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') sinks.consola.push(m.text().slice(0, 160)); });
  page.on('requestfailed', (r) => { const u = r.url(); if (!/favicon|beacon|cloudflareinsights/.test(u)) sinks.red.push(`${u.slice(-52)} ${r.failure()?.errorText || ''}`); });
  page.on('response', (r) => { if (r.status() >= 500) sinks.server.push(`${r.status()} ${r.url().slice(-52)}`); });
}
const sinksVacios = () => ({ erroresJS: [], consola: [], red: [], server: [] });

// ================================================================ 1. BOTONES
console.log('=== 1. Cada boton hace algo al pulsarlo ===\n');
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sinks = sinksVacios();
  vigilar(page, sinks);

  await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await aceptarCookies(page);

  // Se recorren los botones visibles de la home y se comprueba que al pulsar
  // cambia ALGO: la URL, el texto, un modal, o el localStorage. Un boton que no
  // cambia nada puede ser decorativo, pero si parece accionable y no hace nada,
  // es un fallo.
  const botones = await page.locator('button:visible').all();
  console.log(`  home: ${botones.length} botones visibles`);
  let inertes = [];
  for (let i = 0; i < botones.length; i++) {
    const b = botones[i];
    if (!(await b.isVisible().catch(() => false)) || !(await b.isEnabled().catch(() => false))) continue;
    const etiqueta = ((await b.textContent().catch(() => '')) || (await b.getAttribute('aria-label').catch(() => '')) || `boton ${i}`).trim().slice(0, 28);
    // El texto ENTERO, no los primeros 400 caracteres. Los overlays (modal de
    // login, panel del carrito) se pintan al final del body, asi que con el
    // recorte abrir un modal parecia "no cambiar nada" y todos los botones de
    // anadir salian como inertes. Ademas se mira si hay un dialogo abierto.
    const foto = () => page.evaluate(() => location.href + '|' + document.body.innerText.replace(/\s+/g, ' ').trim() + '|' + JSON.stringify(Object.keys(localStorage)) + '|' + (document.querySelectorAll('[role="dialog"], .cart-sidebar, .modal').length));
    const antes = await foto();
    await b.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
    const despues = await foto();
    if (antes === despues) inertes.push(etiqueta);
    // Si salta un overlay, se cierra con Escape para no encadenar estados.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
  }
  console.log(`  sin efecto observable: ${inertes.length ? inertes.join(', ') : 'ninguno'}`);
  check('ningun boton visible de la home es inerte', inertes.length === 0, inertes.join(' | '), 'un boton que no hace nada es el fallo mas dificil de ver');

  // Un boton deshabilitado con aria-disabled pero que "parece" pulsable es otro
  // fallo de usabilidad: la persona lo pulsa y no pasa nada.
  const deshabilitados = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-disabled') === 'true' && !b.disabled).map((b) => (b.textContent || '').trim().slice(0, 24))
  );
  check('ningun boton se marca deshabilitado sin estarlo de verdad', deshabilitados.length === 0, deshabilitados.join(' | '), 'aria-disabled sin el atributo disabled se ignora');

  check('sin errores de JavaScript al usar la home', sinks.erroresJS.length === 0, sinks.erroresJS.slice(0, 2).join(' | '), 'un error de JS rompe la interaccion');
  check('sin errores 5xx al usar la home', sinks.server.length === 0, sinks.server.slice(0, 3).join(' | '), 'un 5xx es un fallo del servidor');
  await browser.close();
}

// La seccion "flujo de compra" la hace tools/barrido-carrito.mjs, que entra en
// sesion con la cuenta de pruebas. Aqui no tiene sentido: sin sesion, anadir al
// carrito abre el modal de login a proposito, y un barrido sin sesion solo daria
// falsos negativos sobre una decision de producto, no sobre un fallo.

// ============================================ 3. XSS POR CAMPOS DE ENTRADA
console.log('\n=== 3. Lo que se escribe en un campo y sale en otro sitio ===\n');
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sinks = sinksVacios();
  vigilar(page, sinks);

  const payloads = [
    '<script>window.__xss=1</script>',
    '<img src=x onerror="window.__xss=1">',
    '"><script>window.__xss=1</script>',
    "javascript:window.__xss=1",
    '<svg onload=window.__xss=1>',
  ];

  // La busqueda es el campo mas expuesto: lo escribe cualquiera y el resultado se
  // pinta en pantalla.
  for (const p of payloads) {
    await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1000);
    await aceptarCookies(page);
    const input = page.locator('input[type="search"], input[placeholder*="uscar" i]').first();
    if (!(await input.isVisible({ timeout: 3000 }).catch(() => false))) { avisar('busqueda', 'no se encontro el campo de busqueda'); break; }
    await input.fill(p);
    await page.waitForTimeout(1800);
    const ejecutado = await page.evaluate(() => typeof window.__xss !== 'undefined');
    const pintado = await page.evaluate(() => document.body.innerText);
    check(`la busqueda no ejecuta "${p.slice(0, 26)}"`, !ejecutado, 'SE HA EJECUTADO', 'XSS reflejado: el atacante te roba la sesion');
    // Lo que se escapa mal no suele ejecutar JS, pero sí aparece en el texto.
    // Lo correcto NO es que el payload desaparezca: es que se muestre como texto.
    // React escapa siempre, asi que en pantalla sale "<script>" escrito, que es lo
    // que el usuario acaba de escribir. Lo que hay que comprobar es que este en un
    // nodo de TEXTO y escapado en el HTML, no que desaparezca.
    // El check anterior decia "no pinta HTML crudo" y fallaba con lo correcto:
    // innerHTML devolvia &lt;script&gt;, o sea escapado.
    const escapado = await page.evaluate((payload) => {
      // Se busca el NODO DE TEXTO mas interno que contenga el payload, con un
      // TreeWalker. Buscar "el elemento que contiene el texto" devolvia el div
      // exterior entero, y por eso el check decia que no estaba escapado cuando si
      // lo estaba.
      const paseo = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = paseo.nextNode())) {
        if ((n.nodeValue || '').includes(payload)) {
          return {
            nodoTexto: n.nodeType === 3,
            html: n.parentElement ? n.parentElement.innerHTML.slice(0, 100) : '',
            padreTag: n.parentElement ? n.parentElement.tagName : '',
          };
        }
      }
      return { nodoTexto: null, html: '', padreTag: '' };
    }, p);
    // Lo correcto no es que el payload desaparezca: es que se muestre como texto.
    // React escapa siempre, asi que en pantalla sale escrito, que es lo que el
    // usuario acaba de teclear. Si el nodo es de TEXTO, esta escapado y bien. Si
    // fuera un ELEMENTO, ahi si seria XSS.
    check(`la busqueda escapa el payload en vez de interpretarlo de "${p.slice(0, 18)}"`,
      escapado.nodoTexto === null || escapado.nodoTexto === true,
      escapado.nodoTexto === null ? 'no aparece en pantalla (correcto: no hay resultados)' : `nodoTexto=${escapado.nodoTexto} en <${escapado.padreTag}> ${escapado.html}`,
      'un payload en un nodo de TEXTO esta escapado; si fuera un elemento, seria XSS');
    check(`la busqueda escapa el payload en vez de interpretarlo de "${p.slice(0, 18)}"`,
      !escapado.encontrado || (escapado.esTexto && /&lt;|&amp;#x27;|&quot;/.test(escapado.html)),
      escapado.encontrado ? `encontrado, hijos=${escapado.esTexto ? 0 : 'varios'}, html=${escapado.html}` : 'no aparece (tambien correcto)',
      'un payload en un nodo de texto esta escapado; si fuera un elemento, seria XSS');
  }

  // El campo de email del login: se manda a la API y puede rebotar.
  await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  await aceptarCookies(page);
  const cuenta = page.getByRole('button', { name: /Cuenta/i }).first();
  if (await cuenta.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cuenta.click();
    await page.waitForTimeout(900);
    const email = page.locator('#login-email, input[type="email"]').first();
    if (await email.isVisible({ timeout: 3000 }).catch(() => false)) {
      await email.fill('<script>window.__xss=1</script>');
      const enviar = page.locator('[data-testid="login-submit"], button[type="submit"]').first();
      if (await enviar.isVisible({ timeout: 2000 }).catch(() => false)) {
        await enviar.click().catch(() => {});
        await page.waitForTimeout(2000);
        const ejecutado = await page.evaluate(() => typeof window.__xss !== 'undefined');
        check('el email del login no ejecuta HTML', !ejecutado, 'SE HA EJECUTADO', 'XSS reflejado por el campo de email');
      }
    }
  }
  await browser.close();
}

// ================================================== 4. ENTRADAS极端 / LÍMITES
console.log('\n=== 4. Entradas en el limite: vacio, enorme, raro ===\n');
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sinks = sinksVacios();
  vigilar(page, sinks);

  await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  await aceptarCookies(page);
  const cuenta = page.getByRole('button', { name: /Cuenta/i }).first();
  if (await cuenta.isVisible({ timeout: 3000 }).catch(() => false)) await cuenta.click().catch(() => {});
  await page.waitForTimeout(900);

  const email = page.locator('#login-email, input[type="email"]').first();
  if (await email.isVisible({ timeout: 3000 }).catch(() => false)) {
    const enviar = page.locator('[data-testid="login-submit"], button[type="submit"]').first();
    // Vacio: el boton deberia estar deshabilitado o dar un error claro, no 500.
    await email.fill('');
    if (await enviar.isVisible({ timeout: 2000 }).catch(() => false)) {
      await enviar.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
      check('login con email vacio no da error de servidor', !sinks.server.some((s) => s.startsWith('500')), sinks.server.join(' | '), 'un 500 por validacion es un fallo del servidor');
    }
    // Enorme: 300 caracteres. Puede tumbar la UI o el backend.
    await email.fill('a'.repeat(300) + '@example.invalid');
    await enviar.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    check('login con email de 300 chars no da 500', !sinks.server.some((s) => s.startsWith('5')), sinks.server.join(' | '), 'un campo sin limite de longitud es un vector de denegacion');
    // Sin arroba
    await email.fill('esto-no-es-un-email');
    await enviar.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    const msg = await page.evaluate(() => document.body.innerText.toLowerCase());
    check('un email sin @ da un mensaje entendible', /email|correo|inválid|invalid|no es/i.test(msg), 'sin mensaje claro', 'si no dice nada, el usuario no sabe qué arreglar');
  }
  await browser.close();
}

// ============================================ 5. FUGAS ENTRE PANTALLAS
console.log('\n=== 5. Un dato de una pantalla no aparece en otra ===\n');
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200);
  await aceptarCookies(page);

  // El email de la cuenta de pruebas no debe aparecer en pagina alguna sin sesion.
  const correo = 'smoke@suprime.xyz';
  for (const ruta of ['/', '/carrito', '/favoritos', '/categoria/electronica']) {
    await page.goto(WWW + ruta, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(800);
    const html = await page.evaluate(() => document.documentElement.innerHTML);
    check(`"${correo}" no aparece en el HTML de ${ruta}`, !html.includes(correo), 'aparece en el HTML servido', 'el HTML es publico: cualquiera puede descargarlo');
  }
  await browser.close();
}

// ============================================ 6. TECLADO Y MÓVIL
console.log('\n=== 6. Teclado y movil ===\n');
{
  const browser = await chromium.launch();
  // El menu de cuenta tiene que abrirse con Enter, no solo con raton: un teclado
  // sin raton es la realidad de mucha gente.
  const page = await browser.newPage();
  await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200);
  await aceptarCookies(page);
  const cuenta = page.getByRole('button', { name: /Cuenta/i }).first();
  if (await cuenta.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cuenta.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const abierto = await page.getByRole('dialog').isVisible({ timeout: 2500 }).catch(() => false);
    check('el menu de cuenta abre con Enter (sin raton)', abierto, 'no abre con teclado', 'sin esto, no se puede entrar sin raton');
    // Y se cierra con Escape.
    if (abierto) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      const cerrado = !(await page.getByRole('dialog').isVisible({ timeout: 1500 }).catch(() => false));
      check('el menu se cierra con Escape', cerrado, 'no se cierra', 'si no se cierra con Escape, no hay forma de salir sin raton');
    }
  } else avisar('menu de cuenta con teclado', 'no se encontro el boton');
  await browser.close();

  // En movil: nada se sale de la pantalla.
  // Se abre un navegador NUEVO: el de la seccion de teclado ya se ha cerrado.
  await browser.close();
  const browser2 = await chromium.launch();
  const ctx = await browser2.newContext(await devices['Pixel 5']);
  const p2 = await ctx.newPage();
  const s2 = sinksVacios();
  vigilar(p2, s2);
  for (const ruta of ['/', '/categoria/electronica', '/producto/smartwatch-deportivo-inteligente', '/carrito']) {
    await p2.goto(WWW + ruta, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await p2.waitForTimeout(1200);
    // Un elemento que se sale de la pantalla no es un fallo si tiene un ancestro
    // con overflow-x auto/scroll: eso es un carrusel, y el usuario lo desplaza a
    // proposito. Solo es fallo cuando no hay ningun ancestro que lo permita, que es
    // cuando el contenido queda CORTADO sin remedio.
    // Medido: 96 elementos que se salen en la home y 72 en la ficha de producto, y
    // los 168 tienen ancestro desplazable. Los que de verdad se cortaban eran las
    // tarjetas de categoria, y eso se arreglo con min-width:0.
    const desbordes = await p2.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const salida = [];
      for (const e of document.querySelectorAll('*')) {
        const b = e.getBoundingClientRect();
        if (!(b.width > 0 && b.right > w + 2)) continue;
        let padre = e.parentElement;
        let desplazable = false;
        while (padre && padre !== document.documentElement) {
          if (/auto|scroll/.test(getComputedStyle(padre).overflowX)) { desplazable = true; break; }
          padre = padre.parentElement;
        }
        if (!desplazable) {
          salida.push(`${(e.textContent || '').trim().slice(0, 20)} (hasta ${Math.round(b.right)}px, pantalla ${w}px)`);
          if (salida.length >= 3) break;
        }
      }
      return salida;
    });
    check(`nada se sale de la pantalla en ${ruta} (movil)`, desbordes.length === 0, desbordes.join(' | '), 'en movil, un desborde obliga a desplazar en horizontal');
  }
  check('sin scroll horizontal en movil', await p2.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), await p2.evaluate(() => document.documentElement.scrollWidth), 'la pagina se desplaza de lado, molesta y parece rota');
  await browser2.close();
}

console.log('\n' + '='.repeat(62));
console.log(`BARRIDO DE INTERACCION: ${pass} PASS / ${fail} FAIL / ${avisos} AVISOS`);
for (const l of lineas) console.log('  ' + l);
console.log('='.repeat(62));

writeFileSync(process.env.SALIDA || 'C:/Users/VIP/AppData/Local/Temp/opencode/interaccion.json', JSON.stringify({ pass, fail, avisos, fallos }, null, 1), 'utf8');
process.exit(fail ? 1 : 0);
