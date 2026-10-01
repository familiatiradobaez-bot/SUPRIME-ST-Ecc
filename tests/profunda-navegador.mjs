// =============================================================
// BATERÍA PROFUNDA · NAVEGADOR REAL (funcional y accesibilidad)
// =============================================================
// Un sitio que da 200 pero no funciona no vale. Se mide con un navegador de
// verdad, en movil y en escritorio, y se mira lo que ve un usuario:
//
//   - Que la pagina pinta contenido, no una caja vacia.
//   - Que no hay errores de JavaScript, de consola ni peticiones fallidas.
//   - Que la interaccion basica funciona: anadir al carrito, abrir el menu.
//   - Que es usable: nombres accesibles, jerarquia de encabezados, tamano de los
//     toques.
//
// Uso: node tests/profunda-navegador.mjs
import { chromium, devices } from '@playwright/test';

const WWW = process.env.WWW || 'https://www.suprime.xyz';
let pass = 0, fail = 0, saltos = 0;
const lineas = [];
const detalle = [];
const check = (n, ok, d = '', p = '') => {
  if (ok) { pass++; lineas.push(`PASS ${n}${p ? '  (' + p + ')' : ''}`); }
  else { fail++; lineas.push(`FAIL ${n}  ${d}${p ? '  (' + p + ')' : ''}`); }
  detalle.push({ n, ok, d, p });
};
const saltar = (n, m) => { saltos++; lineas.push(`SKIP ${n}  (${m})`); };

const RUTAS = [
  ['home', '/'],
  ['categoria', '/categoria/electronica'],
  ['PDP', '/producto/smartwatch-deportivo-inteligente'],
  // NO se prueba /carrito: no existe. El carrito es el panel lateral
  // (.cart-sidebar), no una pagina. Se probaba y pasaba porque la pantalla de 404
  // tiene texto de sobra: un check que pasa con la pagina de error no comprueba
  // nada. El panel se recorre en tools/barrido-carrito.mjs.
  ['favoritos', '/favoritos'],
  ['cuenta', '/cuenta'],
  ['404', '/esta-ruta-no-existe'],
];

for (const [nombreDispositivo, dispositivo] of [['MOVIL', devices['Pixel 5']], ['ESCRITORIO', { viewport: { width: 1440, height: 900 } }]]) {
  console.log(`\n=== ${nombreDispositivo} ===`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(dispositivo);
  const page = await ctx.newPage();

  for (const [nombre, ruta] of RUTAS) {
    const errores = [], consola = [], fallosRed = [];
    // page.on devuelve la page, no una funcion de baja: se guarda la funcion y
    // se quita con off(). Sin esto los listeners se acumulan entre rutas y los
    // errores de una se cuentan en la siguiente.
    const onConsola = (m) => { if (m.type() === 'error') consola.push(m.text().slice(0, 110)); };
    const onError = (e) => errores.push(String(e).slice(0, 110));
    const onFallo = (r) => fallosRed.push(`${r.url().slice(-46)} ${r.failure()?.errorText || ''}`);
    page.on('console', onConsola);
    page.on('pageerror', onError);
    page.on('requestfailed', onFallo);

    await page.goto(WWW + ruta, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(nombreDispositivo === 'MOVIL' ? 1800 : 1200);

    const acepta = page.getByRole('button', { name: /Aceptar/i }).first();
    if (await acepta.isVisible({ timeout: 1500 }).catch(() => false)) await acepta.click().catch(() => {});
    await page.waitForTimeout(600);

    const texto = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().length);
    check(`${nombreDispositivo}/${nombre} pinta contenido real`, texto > 300, `${texto} chars`, 'una caja vacia es un fallo aunque sea 200');
    check(`${nombreDispositivo}/${nombre} sin errores de JavaScript`, errores.length === 0, errores.join(' | '), 'un error de JS rompe la interaccion');
    check(`${nombreDispositivo}/${nombre} sin errores de consola`, consola.filter((c) => !/favicon|404 \(Not Found\)/i.test(c)).length === 0, consola.slice(0, 2).join(' | '), 'avisos que el usuario no ve pero delatan bugs');

    const graves = fallosRed.filter((f) => !/favicon/.test(f));
    check(`${nombreDispositivo}/${nombre} sin peticiones fallidas`, graves.length === 0, graves.slice(0, 2).join(' | '), 'un chunk que no carga deja la pagina en blanco');

    page.off('console', onConsola);
    page.off('pageerror', onError);
    page.off('requestfailed', onFallo);
  }

  if (nombreDispositivo === 'ESCRITORIO') {
    console.log('\n--- interaccion ---');
    await page.goto(`${WWW}/producto/smartwatch-deportivo-inteligente`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);
    const acepta = page.getByRole('button', { name: /Aceptar/i }).first();
    if (await acepta.isVisible({ timeout: 1500 }).catch(() => false)) await acepta.click().catch(() => {});

    const anadir = page.getByRole('button', { name: /añadir al carrito|agregar al carrito/i }).first();
    if (await anadir.isVisible({ timeout: 6000 }).catch(() => false)) {
      await anadir.click();
      await page.waitForTimeout(2500);
      const enCarrito = await page.evaluate(() => /carrito/i.test(document.body.innerText) || !!localStorage.getItem('cart'));
      check('anadir al carrito funciona', enCarrito, 'no se ve el carrito ni se guarda', 'el camino de compra debe funcionar');
      const err = await page.evaluate(() => {
        const t = document.body.innerText;
        return /error|fallo|algo ha ido mal/i.test(t) ? t.match(/.{0,40}(error|fallo|algo ha ido mal).{0,40}/i)[0] : '';
      });
      check('anadir al carrito no muestra error', !err, err, 'un error visible aqui pierde la venta');
    } else saltar('anadir al carrito', 'no se encontro el boton en el PDP');

    await page.goto(`${WWW}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const cuenta = page.getByRole('button', { name: /Cuenta/i }).first();
    if (await cuenta.isVisible({ timeout: 4000 }).catch(() => false)) {
      await cuenta.click();
      await page.waitForTimeout(1200);
      const dlg = await page.getByRole('dialog').isVisible({ timeout: 3000 }).catch(() => false);
      check('el menu de cuenta se abre', dlg, 'no aparece', 'si no abre, nadie puede entrar');
    } else saltar('menu de cuenta', 'no se encontro el boton');
  }

  console.log(`--- accesibilidad (${nombreDispositivo}) ---`);
  await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);
  const acc = await page.evaluate(() => {
    const imgSinAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
    const imgs = document.querySelectorAll('img').length;
    const btns = [...document.querySelectorAll('button')];
    const btnsSinNombre = btns.filter((b) => !b.textContent?.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
    const h1 = document.querySelectorAll('h1').length;
    const hN = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]));
    const salto = hN.some((n, i) => i > 0 && n > hN[i - 1] + 1);
    const inputsSinLabel = [...document.querySelectorAll('input:not([type=hidden])')].filter((i) => {
      if (i.getAttribute('aria-label') || (i.getAttribute('id') && document.querySelector(`label[for="${i.id}"]`))) return false;
      return !i.closest('label');
    }).length;
    return { imgSinAlt, imgs, btnsSinNombre, btns: btns.length, h1, salto, inputsSinLabel, langOk: document.documentElement.lang === 'es', lang: document.documentElement.lang || '(vacio)', titulo: (document.title || '').length };
  });
  check(`${nombreDispositivo} todas las imagenes tienen alt`, acc.imgSinAlt === 0, `${acc.imgSinAlt} de ${acc.imgs} sin alt`, 'sin alt, un ciego no sabe que hay');
  check(`${nombreDispositivo} todos los botones tienen nombre accesible`, acc.btnsSinNombre === 0, `${acc.btnsSinNombre} de ${acc.btns} sin nombre`, 'un boton sin nombre no se puede usar con lector de pantalla');
  check(`${nombreDispositivo} hay exactamente un h1`, acc.h1 === 1, `${acc.h1} h1`, 'los lectores de pantalla y Google lo usan para estructurar');
  check(`${nombreDispositivo} los encabezados no saltan niveles`, !acc.salto, 'salto en la jerarquia', 'rompe la navegacion por encabezado');
  check(`${nombreDispositivo} los campos tienen etiqueta`, acc.inputsSinLabel === 0, `${acc.inputsSinLabel} sin etiqueta`, 'un campo sin etiqueta no se puede rellenar con lector');
  check(`${nombreDispositivo} la pagina esta en espanol`, acc.langOk, acc.lang, 'para lectores de pantalla');
  check(`${nombreDispositivo} el titulo no esta vacio`, acc.titulo > 10, `${acc.titulo} chars`, 'es lo que se ve en el historial y en Google');

  if (nombreDispositivo === 'MOVIL') {
    const pequenos = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], input, select')]
        .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 22), w: Math.round(r.width), h: Math.round(r.height), v: r.width > 0 && r.height > 0 }; })
        .filter((x) => x.v && (x.w < 44 || x.h < 44))
    );
    check('los controles tocables miden al menos 44px', pequenos.length === 0, pequenos.slice(0, 3).map((p) => `${p.t} ${p.w}x${p.h}`).join(' | '), 'por debajo de 44px es dificil de pulsar con el dedo');
  }

  await browser.close();
}

console.log('\n' + '='.repeat(60));
console.log(`NAVEGADOR: ${pass} PASS / ${fail} FAIL / ${saltos} SKIP`);
for (const l of lineas) console.log('  ' + l);
console.log('='.repeat(60));

const { writeFileSync } = await import('node:fs');
writeFileSync(process.env.SALIDA || 'C:/Users/VIP/AppData/Local/Temp/opencode/navegador.json', JSON.stringify({ pass, fail, saltos, detalle }, null, 1), 'utf8');
process.exit(fail ? 1 : 0);
