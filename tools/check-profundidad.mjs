// Runner de la bateria profunda. Ejecuta las partes y da el veredicto.
//
//   node tools/check-profundidad.mjs            todas
//   node tools/check-profundidad.mjs seguridad  una sola
//
// Las partes se guardan en el repo (tests/) y no en un temporal, para que se
// puedan volver a ejecutar cuando cambie algo. Seupuestoan ahi.
//
// Cada parte mide una cosa distinta y NO se solapan:
//   seguridad     lo que ataca un atacante: inyeccion, XSS, CSRF, fugas, sesion
//   navegador     lo que ve un usuario: renders, interaccion, accesibilidad
//   api-datos     el contrato de la API, los datos y el SEO
//   rendimiento    peso, peticiones, cache e infraestructura
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const TMP = process.env.TMP_DIR || 'C:/Users/VIP/AppData/Local/Temp/opencode';

const PARTES = {
  seguridad: { script: RAIZ + '/tools/check-profundidad-seguridad.mjs', salida: TMP + '/seguridad.json', nombre: 'SEGURIDAD' },
  navegador: { script: RAIZ + '/tests/profunda-navegador.mjs', salida: TMP + '/navegador.json', nombre: 'NAVEGADOR' },
  api: { script: RAIZ + '/tests/profunda-apidatos.mjs', salida: TMP + '/apidatos.json', nombre: 'API Y DATOS' },
  rendimiento: { script: RAIZ + '/tools/check-profundidad-rendimiento.mjs', salida: TMP + '/rendimiento.json', nombre: 'RENDIMIENTO E INFRA' },
};

const pedidas = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const aEjecutar = pedidas.length ? pedidas : Object.keys(PARTES);

const resumen = {};
for (const clave of aEjecutar) {
  const p = PARTES[clave];
  if (!p) { console.log(`  parte desconocida: ${clave}`); continue; }
  if (!existsSync(p.script)) { console.log(`  ${p.nombre}: no existe ${p.script}`); continue; }
  if (existsSync(p.salida)) unlinkSync(p.salida);

  process.stdout.write(`\n########## ${p.nombre} ##########\n`);
  const r = spawnSync(process.execPath, [p.script], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, SALIDA: p.salida } });
  const out = (r.stdout || '') + (r.stderr || '');

  let n = { pass: 0, fail: 0, skip: 0, fallos: [] };
  if (existsSync(p.salida)) {
    const j = JSON.parse(readFileSync(p.salida, 'utf8'));
    n = { pass: j.pass, fail: j.fail, skip: j.saltos || 0, fallos: (j.detalle || j.todo || []).filter((x) => !x.ok).map((x) => `FAIL ${x.n}  ${x.d || ''}`) };
  } else {
    n.fallos = out.split('\n').filter((l) => /^\s*FAIL/.test(l)).map((l) => l.trim());
    const m = out.match(/(\d+) PASS \/ (\d+) FAIL/);
    if (m) { n.pass = Number(m[1]); n.fail = Number(m[2]); }
    if (r.status !== 0 && n.pass === 0) n.fallos.push(`(la parte no llego a imprimir el resumen, codigo ${r.status})`);
  }
  resumen[p.nombre] = n;
  const total = n.pass + n.fail;
  console.log(`>>> ${p.nombre}: ${n.pass} PASS / ${n.fail} FAIL${n.skip ? ' / ' + n.skip + ' SKIP' : ''}${total ? '  (' + Math.round((n.pass / total) * 100) + '%)' : ''}`);
  for (const x of n.fallos) console.log('    ' + x.slice(0, 118));
}

const totalP = Object.values(resumen).reduce((a, b) => a + b.pass, 0);
const totalF = Object.values(resumen).reduce((a, b) => a + b.fail, 0);
const totalS = Object.values(resumen).reduce((a, b) => a + b.skip, 0);

console.log('\n' + '='.repeat(66));
console.log('TOTAL DE LA BATERIA PROFUNDA');
console.log('='.repeat(66));
for (const [k, v] of Object.entries(resumen)) {
  const t = v.pass + v.fail;
  console.log(`  ${k.padEnd(24)} ${String(v.pass).padStart(3)} OK / ${String(v.fail).padStart(2)} FAIL${v.skip ? ' / ' + v.skip + ' SKIP' : ''}   ${t ? String(Math.round((v.pass / t) * 100)).padStart(3) : '  0'}%`);
}
console.log(`  ${'TOTAL'.padEnd(24)} ${String(totalP).padStart(3)} OK / ${String(totalF).padStart(2)} FAIL${totalS ? ' / ' + totalS + ' SKIP' : ''}   ${totalP + totalF ? String(Math.round((totalP / (totalP + totalF)) * 100)).padStart(3) : '  0'}%`);
console.log('='.repeat(66));

writeFileSync(TMP + '/resultados.json', JSON.stringify({ resumen, totalP, totalF, totalS }, null, 1), 'utf8');
process.exit(totalF ? 1 : 0);
