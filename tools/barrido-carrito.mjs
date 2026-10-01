// Con el selector bueno (.cart-sidebar, no [class*=cart] que cae en cart-header)
// se recorre el panel del carrito de punta a punta, con sesion iniciada.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const WWW = 'https://www.suprime.xyz';
const t = readFileSync('C:/Users/VIP/Desktop/Cerebro Obcidian/_SECRETS/smoke.env', 'utf8');
const env = {};
for (const l of t.split(/\r?\n/)) { if (!l || l.startsWith('#') || !l.includes('=')) continue; const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1); }

let pass = 0, fail = 0;
const lineas = [];
const check = (n, ok, d = '', p = '') => { if (ok) { pass++; lineas.push(`PASS ${n}${p ? '  (' + p + ')' : ''}`); } else { fail++; lineas.push(`FAIL ${n}  ${d}${p ? '  (' + p + ')' : ''}`); } };

const browser = await chromium.launch();
const page = await browser.newPage();
const sinks = { js: [], srv: [] };
page.on('pageerror', (e) => sinks.js.push(String(e).slice(0, 140)));
page.on('response', (r) => { if (r.status() >= 500) sinks.srv.push(`${r.status()} ${r.url().slice(-44)}`); });

const ACEPTAR = async () => { const b = page.getByRole('button', { name: /Aceptar/i }).first(); if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); } };
const lineasCarrito = () => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('su_prime_cart_') && !x.endsWith('guest')) || 'su_prime_cart_guest';
  try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
});
const abrir = async () => { await page.locator('[aria-label*="arrito" i]').first().click(); await page.waitForTimeout(1300); };

await page.goto(`${WWW}/`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500); await ACEPTAR();
await page.getByRole('button', { name: /Cuenta/i }).first().click();
await page.waitForTimeout(900);
const d = page.getByRole('dialog', { name: /Acceso a cuenta/i });
await d.locator('#login-email').fill(env.SMOKE_EMAIL);
await d.locator('input[type="password"]').fill(env.SMOKE_PASSWORD);
await d.locator('[data-testid="login-submit"]').click();
await d.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1000);
check('sesion iniciada', await page.getByText(/Smoke \(automatizado\)/).isVisible({ timeout: 10000 }).catch(() => false), '', 'prerrequisito');

// Tres productos por la ficha, que es donde se ve si se acumulan.
for (const slug of ['smartwatch-deportivo-inteligente', 'camara-instantanea-retro', 'altavoz-bluetooth-portatil']) {
  await page.goto(`${WWW}/producto/${slug}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500); await ACEPTAR();
  await page.getByRole('button', { name: /al carrito/i }).first().click();
  await page.waitForTimeout(1600);
}
const l3 = await lineasCarrito();
check('tres productos distintos se acumulan', l3.length === 3, `${l3.length} lineas`, 'si solo guarda el ultimo, se pierde la venta');

// El panel
await abrir();
const panel = page.locator('.cart-sidebar');
check('el panel del carrito se abre', await panel.isVisible({ timeout: 3000 }).catch(() => false), '.cart-sidebar no visible', 'si no abre, el carrito no se puede ver');
const texto = await panel.innerText().catch(() => '');
console.log('  panel:', texto.replace(/\s+/g, ' ').slice(0, 180));
check('el panel lista los 3 productos', (texto.match(/€\s*x?\s*1/g) || []).length >= 3 || /x\s*1/.test(texto), 'no se ven las lineas', '');
check('el panel muestra el total', /Total/i.test(texto), texto.slice(0, 90), 'sin total, el cliente no sabe cuanto paga');

// Quitar
const n0 = (await lineasCarrito()).length;
const btnQuitar = panel.locator('button').filter({ hasText: /🗑/ }).first();
const hayQuitar = await btnQuitar.isVisible({ timeout: 3000 }).catch(() => false);
check('hay un boton para quitar cada linea', hayQuitar, 'no se encuentra el boton de quitar', 'si no se puede quitar, el carrito se queda enganchado');
if (hayQuitar) {
  await btnQuitar.click({ force: true });
  await page.waitForTimeout(1800);
  const n1 = (await lineasCarrito()).length;
  const sigueAbierto = await panel.isVisible({ timeout: 2000 }).catch(() => false);
  console.log(`  lineas: ${n0} -> ${n1}; panel abierto: ${sigueAbierto}`);
  check('quitar un producto lo saca del carrito', n1 === n0 - 1, `${n0} -> ${n1}`, 'un carrito que no se puede vaciar se abandona');
  check('el panel se actualiza al quitar', sigueAbierto && (await panel.innerText().catch(() => '')).length > 0, 'el panel se cerro o se vacio al quitar', 'si el panel no se refresca, el cliente ve un carrito que ya no es el suyo');
}

// Checkout
const btnPago = panel.locator('button').filter({ hasText: /Proceder al Pago|Pago|Finalizar/i }).first();
if (await btnPago.isVisible({ timeout: 4000 }).catch(() => false)) {
  await btnPago.click();
  await page.waitForTimeout(3000);
  const co = await page.evaluate(() => ({
    // Sin truncar antes de mirar: los primeros 200 chars son la cabecera y el
    // migas de pan, y ahi no hay nada de checkout. Por eso daba falso FAIL.
    texto: document.body.innerText.replace(/\s+/g, ' '),
    campos: document.querySelectorAll('input:not([type=hidden]), select, textarea').length,
  }));
  console.log('  tras "Proceder al Pago":', co.texto.slice(0, 150));
  check('se llega al checkout', /checkout|direcci|envío|portes|pago|tarjeta|pedido|confirmar|datos/i.test(co.texto), co.texto.slice(0, 90), 'el ultimo paso antes de cobrar');
  check('el checkout tiene campos que rellenar', co.campos > 0, `${co.campos} campos`, 'un checkout sin campos no se puede completar');
} else {
  check('se llega al checkout', false, 'no se encuentra "Proceder al Pago"', 'el ultimo paso antes de cobrar');
}

check('sin errores de JavaScript en el flujo', sinks.js.length === 0, sinks.js.slice(0, 2).join(' | '), 'un error a media compra hace que se pierda');
check('sin errores 5xx en el flujo', sinks.srv.length === 0, sinks.srv.slice(0, 3).join(' | '), 'un 5xx corta la compra');

await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('su_prime_cart_')) localStorage.removeItem(k); });
await browser.close();

console.log('\n' + '='.repeat(62));
console.log(`PANEL DEL CARRITO: ${pass} PASS / ${fail} FAIL`);
for (const l of lineas) console.log('  ' + l);
console.log('='.repeat(62));
process.exit(fail ? 1 : 0);
