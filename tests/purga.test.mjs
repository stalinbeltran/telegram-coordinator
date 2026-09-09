// Tests de la purga del log (scripts/mensajes.mjs).
//
// Por qué importa más de lo que parece (R10): el log tiene **todo** lo que Claude
// dijo, incluidas salidas de shell y rutas. La purga no es higiene de disco: es lo
// que acota cuánto hay que perder si alguien entra en la máquina.
//
// Y tiene dos formas de equivocarse, las dos caras:
//   · quedarse corta → el log crece sin techo y guarda cosas de hace meses;
//   · pasarse → borra una conversación que todavía sirve, y no hay copia.
// Por eso se prueban las dos mitades, no sólo que borre.
//
// ⚠⚠ Y la tercera, que es la que puede perder datos sin que nadie lo note:
// reescribir un fichero al que otros procesos hacen `append`. La ventana son
// milisegundos, pero lo que se perdería es justo el aviso de un trabajo largo que
// acaba de terminar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = mkdtempSync(join(tmpdir(), 'coord-purga-'));
process.env.DATA_DIR = raiz;
const M = await import('../scripts/mensajes.mjs');

const AHORA = Date.parse('2026-09-09T21:00:00Z');
const hace = (dias) => new Date(AHORA - dias * 86_400_000).toISOString();

/** Escribe un log con las líneas que se le den. */
function log(sesion, lineas) {
  mkdirSync(join(raiz, 'mensajes'), { recursive: true });
  writeFileSync(M.rutaLog(sesion), lineas.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
const leer = (sesion) => readFileSync(M.rutaLog(sesion), 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const msg = (i, ts) => ({ id: `id${String(i).padStart(4, '0')}`, ts, sesion: 's',
  autor: 'usuario', origen: 'telegram', texto: `m${i}` });

// --------------------------------------------------------- que borre lo viejo

test('recorta al tope de mensajes, conservando los ÚLTIMOS', () => {
  log('-100_1', Array.from({ length: 350 }, (_, i) => msg(i, hace(0))));
  const r = M.purgarSesion('-100_1', AHORA);
  assert.equal(r.purgado, true);
  assert.equal(r.despues, M.TOPE_MENSAJES);
  const quedan = leer('-100_1');
  assert.equal(quedan.at(-1).texto, 'm349', 'lo último es lo que interesa leer');
  assert.equal(quedan[0].texto, 'm50');
});

test('borra lo más viejo que la ventana de días', () => {
  log('-100_2', [msg(1, hace(90)), msg(2, hace(40)), msg(3, hace(2)), msg(4, hace(0))]);
  M.purgarSesion('-100_2', AHORA);
  assert.deepEqual(leer('-100_2').map((m) => m.texto), ['m3', 'm4']);
});

// ------------------------------------------ y que NO se pase, que es la otra mitad

test('lo que está dentro de la ventana NO se toca', () => {
  const dentro = [msg(1, hace(29)), msg(2, hace(1))];
  log('-100_3', dentro);
  const r = M.purgarSesion('-100_3', AHORA);
  assert.equal(r.purgado, false, 'sin nada que quitar, no se reescribe siquiera');
  assert.deepEqual(leer('-100_3').map((m) => m.texto), ['m1', 'm2']);
});

test('una línea sin fecha legible se CONSERVA', () => {
  // Perder un mensaje por no saber cuándo es sería peor que guardar uno de más.
  log('-100_4', [msg(1, hace(99)), { ...msg(2, 'no es una fecha') }, msg(3, hace(0))]);
  M.purgarSesion('-100_4', AHORA);
  assert.deepEqual(leer('-100_4').map((m) => m.texto), ['m2', 'm3']);
});

// ------------------------- ⚠ la carrera: un append mientras se está purgando

test('⚠ si alguien escribe mientras purga, NO se pierde: se deja para la próxima', () => {
  log('-100_5', Array.from({ length: 400 }, (_, i) => msg(i, hace(0))));
  const r = M.purgarSesion('-100_5', AHORA, () => {
    // Esto es un `notify.mjs` avisando de que terminó un trabajo, justo ahora.
    appendFileSync(M.rutaLog('-100_5'), JSON.stringify(msg(999, hace(0))) + '\n');
  });
  assert.equal(r.purgado, false);
  assert.match(r.motivo, /escribió mientras purgaba/);
  const quedan = leer('-100_5');
  assert.equal(quedan.length, 401, 'no se ha tocado nada…');
  assert.equal(quedan.at(-1).texto, 'm999', '…y el aviso de última hora sigue ahí');
  assert.equal(existsSync(M.rutaLog('-100_5') + '.purgando'), false, 'y no queda basura');
});

// -------------------------------------------------------------- que no tumbe nada

test('purgar una sesión que no existe no es un error', () => {
  const r = M.purgarSesion('-100_no_existe', AHORA);
  assert.equal(r.purgado, false);
  assert.equal(r.motivo, 'no existe');
});

test('purgarTodo recorre el log entero y NUNCA lanza', () => {
  log('-100_6', Array.from({ length: 400 }, (_, i) => msg(i, hace(0))));
  log('-100_7', [msg(1, hace(0))]);
  writeFileSync(join(raiz, 'mensajes', 'roto.jsonl'), '{no es json\n');
  let r;
  assert.doesNotThrow(() => { r = M.purgarTodo(AHORA); });
  assert.ok(r.tocadas >= 1);
  assert.ok(r.quitadas >= 100);
  assert.deepEqual(leer('-100_7').map((m) => m.texto), ['m1'], 'lo pequeño se queda igual');
});
