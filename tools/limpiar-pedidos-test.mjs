// Limpia los pedidos de prueba que deja el E2E.
//
// El E2E (tests/e2e/tienda.spec.mjs) hace un checkout REAL contra producción
// para comprobar que el carrito llega hasta "Gracias por tu compra". Cada
// corrida dejaba un pedido en la tabla `orders`, y en pocos días había más de
// cien pedidos falsos mezclados con los de verdad.
//
// Los pedidos de prueba se marcan con orders.is_test = 1 (migración 0021) y
// aquí se borran junto con sus líneas. Solo toca los marcados: un pedido real
// no se puede perder por pasar este script.
//
//   npm run orders:limpiar-test            (limpia)
//   npm run orders:limpiar-test -- --dry   (solo cuenta)

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');

function d1(sql, label) {
  // Se llama al binario de wrangler con el mismo Node que ejecuta el script.
  // Probar con 'npx' a secas no funciona en Windows: es un shim .cmd y
  // spawnSync lo rechaza con EINVAL.
  const wrangler = path.join(REPO, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const out = execFileSync(
    process.execPath,
    [wrangler, 'd1', 'execute', 'DB', '--remote', '--command', sql],
    { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const jsonStart = out.indexOf('[');
  let parsed = null;
  try { parsed = JSON.parse(out.slice(jsonStart)); } catch { /* wrangler no siempre devuelve JSON limpio */ }
  const res = parsed?.[0]?.results || [];
  const changes = parsed?.[0]?.meta?.changes ?? 0;
  // En un SELECT `changes` siempre es 0: el dato útil está en la primera fila.
  const first = res[0] ? Object.values(res[0])[0] : changes;
  console.log(`${label}: ${first}`);
  return first;
}

// Marcar antes de contar: los pedidos que crea el E2E en CADA corrida entran
// con is_test = 0 (el default de la columna). Se reconocen por los datos de
// envío que el propio test escribe siempre, así que el script se auto-cura sin
// que el E2E tenga que saber nada del esquema.
d1(
  `UPDATE orders SET is_test = 1
    WHERE shipping_address = 'Calle E2E 1'
       OR shipping_name = 'Cliente E2E'
       OR shipping_name = 'QA Dropshipping'
       OR shipping_name = 'QA Ganancias'
       OR shipping_name = 'Test Owner';`,
  'Pedidos marcados como de prueba',
);

const contados = d1(
  `SELECT COUNT(*) AS total FROM orders WHERE is_test = 1;`,
  'Pedidos de prueba detectados',
);

if (dry) {
  console.log('Modo --dry: no se borra nada.');
  process.exit(0);
}

if (!contados) {
  console.log('No hay pedidos de prueba. Base limpia.');
  process.exit(0);
}

// Primero las líneas, luego los pedidos: si se borrara al revés dejarían
// filas huérfanas.
d1(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE is_test = 1);`, 'Líneas borradas');
d1(`DELETE FROM orders WHERE is_test = 1;`, 'Pedidos borrados');
console.log('Listo. Los pedidos reales no se han tocado.');