// Test de INTEGRACIÓN del enganche del log: `processIncoming` → data/mensajes/.
//
// Qué se prueba aquí que no se ve desde `tests/mensajes.test.mjs`: aquél mide el
// módulo; esto mide su ENCAJE con el orquestador, que es donde están las dos
// decisiones que se pueden romper sin que nadie lo note:
//
//   1. QUE SÓLO SE REGISTRE LO QUE PIDE REGISTRO. El dueño decidió «sólo `c`»
//      (P4), y se implementó como DATO (`registrar: true` en su JSON) y no
//      cableando el nombre en el núcleo. Si alguien «simplifica» eso, `shell`
//      empieza a volcar sus salidas al log —megabytes por mensaje— y nadie se
//      entera hasta que el disco se queja.
//   2. QUE UN ERROR NO SE ANOTE COMO SI LO HUBIERA DICHO CLAUDE. Un lector que
//      enseña «❌ Error del ejecutor» como turno del modelo miente sobre lo que
//      pasó.
//
// ⚠ `DATA_DIR` va a un temporal, como en todo arnés de aquí: sin eso, un test
// escribiría mensajes inventados en el `data/` real, mezclados con la
// conversación de verdad del dueño.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = mkdtempSync(join(tmpdir(), 'coord-msgorq-'));
const datos = join(raiz, 'casa', 'data');
process.env.BOT_TOKEN = '123456:TEST-token';
process.env.ALLOWED_USER_IDS = '4242';
process.env.DATA_DIR = datos;
process.env.COORD_HOME = join(raiz, 'casa');

mkdirSync(join(datos, 'executors'), { recursive: true });
// Sin fuentes, el registry cae a `~/src/*/telegram` y se traería los ejecutores
// REALES de esta máquina: el test dejaría de estar aislado.
writeFileSync(join(datos, 'fuentes.json'), JSON.stringify({ fuentes: [] }));

const exec = (nombre, extra) => writeFileSync(
  join(datos, 'executors', `${nombre}.json`),
  JSON.stringify({ name: nombre, command: 'cat', encargados: [], ...extra }));

exec('anotado', { registrar: true });     // como `c`
exec('mudo', {});                         // como `shell`: sin el campo
exec('roto', { registrar: true, command: 'exit 7' });

const { processIncoming } = await import('../src/orchestrator.js');

function lineas(sesion) {
  const f = join(datos, 'mensajes', `${sesion.replace(/[^\w.-]/g, '_')}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('un ejecutor con registrar:true deja la entrada Y la respuesta', async () => {
  await processIncoming('anotado', 'hola claude', '-100_7');
  const l = lineas('-100_7');
  assert.equal(l.length, 2, 'una línea de entrada y una de salida');
  assert.equal(l[0].autor, 'usuario');
  assert.equal(l[0].texto, 'hola claude');
  assert.equal(l[1].autor, 'claude');
  assert.equal(l[1].texto, 'hola claude');           // `cat` devuelve lo que recibe
  assert.ok(l[0].id < l[1].id, 'y en orden: la entrada antes que la respuesta');
});

test('un ejecutor SIN el campo no deja NADA: es lo que decide «sólo c»', async () => {
  await processIncoming('mudo', 'ls -la /', '-100_8');
  assert.deepEqual(lineas('-100_8'), [],
    'si esto falla, `shell` empieza a volcar sus salidas al log y el coordinador ' +
    'ha aprendido a registrar por su cuenta en vez de por el dato del ejecutor');
});

test('un fallo del ejecutor se anota como `sistema`, no como si lo dijera claude', async () => {
  await processIncoming('roto', 'lo que sea', '-100_9');
  const l = lineas('-100_9');
  assert.equal(l.length, 2);
  assert.equal(l[1].autor, 'sistema');
  assert.match(l[1].texto, /Error del ejecutor "roto"/);
});

test('el `origen` viaja entero: es POR DÓNDE entró el turno', async () => {
  await processIncoming('anotado', 'desde la app', '-100_10', 'web');
  assert.deepEqual(lineas('-100_10').map((x) => x.origen), ['web', 'web'],
    'cuando la web pueda escribir, todo su turno queda marcado sin tocar el orquestador');
});

test('cada tema tiene su fichero: dos sesiones no se mezclan', () => {
  assert.equal(lineas('-100_7').length, 2);
  assert.equal(lineas('-100_9').length, 2);
});

// ------------------------------------------------- el turno en curso (latido)

const L = await import('../src/latido.js');
const turnos = () => {
  const f = join(datos, 'coordinador.json');
  return existsSync(f) ? Object.keys(JSON.parse(readFileSync(f, 'utf8')).turnos) : [];
};

test('el turno se SUELTA aunque el ejecutor falle', async () => {
  await processIncoming('roto', 'x', '-100_20');
  assert.deepEqual(turnos(), [],
    'si un fallo dejara el turno puesto, la web diría «esperando respuesta» para ' +
    'siempre en ese tema — y sólo se arreglaría reiniciando el bot');
});

test('el turno se suelta también cuando el ejecutor va bien', async () => {
  await processIncoming('anotado', 'hola', '-100_21');
  assert.deepEqual(turnos(), []);
});

test('mientras el ejecutor corre, el turno ESTÁ puesto', async () => {
  // Un ejecutor que tarda lo justo para poder mirar el latido a mitad.
  exec('lento', { registrar: true, command: 'sleep 1' });
  const enMarcha = processIncoming('lento', 'x', '-100_22');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(turnos(), ['-100_22'],
    'sin esto la web parece colgada mientras claude piensa, que con `c` ' +
    '(timeoutMs: 0) pueden ser minutos');
  await enMarcha;
  assert.deepEqual(turnos(), []);
  L.pararLatido();
});

// -------------------------------------------- el cerrojo, por el camino real

test('dos turnos del mismo tema NO se solapan al pasar por el orquestador', async () => {
  exec('lento2', { registrar: true, command: 'sleep 0.6' });
  const t0 = Date.now();
  await Promise.all([
    processIncoming('lento2', 'uno', '-100_30'),
    processIncoming('lento2', 'dos', '-100_30'),
  ]);
  assert.ok(Date.now() - t0 >= 1100,
    'si tardara ~600 ms es que corrieron a la vez: dos `claude --resume` del ' +
    'mismo uuid, que es lo que este cerrojo existe para impedir');
  // Y el log tiene los cuatro mensajes, en orden y sin mezclarse.
  assert.deepEqual(lineas('-100_30').map((m) => m.autor),
    ['usuario', 'claude', 'usuario', 'claude']);
});

test('al segundo se le AVISA de que espera', async () => {
  const avisos = [];
  await Promise.all([
    processIncoming('lento2', 'uno', '-100_31', 'telegram', (d) => avisos.push(d)),
    processIncoming('lento2', 'dos', '-100_31', 'telegram', (d) => avisos.push(d)),
  ]);
  assert.deepEqual(avisos, [1], 'sólo al que de verdad tuvo que esperar');
});
