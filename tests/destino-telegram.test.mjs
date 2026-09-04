// Tests de `scripts/destino-telegram.mjs`: a qué tema avisar cuando nadie lo dijo.
//
// Se prueban sobre un `data/` de mentira con mtimes puestos a mano, porque lo
// que se decide --quién es el principal y quién sigue vivo-- depende justo de
// eso, y con el `data/` real el test diría cosas distintas cada día.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { elegirDestino, temasConocidos, partirSesion, haceCuanto, CADUCIDAD_MS }
  from '../scripts/destino-telegram.mjs';

const AHORA = Date.UTC(2026, 8, 4, 12, 0, 0);
const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;

/** Un `data/` de mentira. `temas` = { sesion: { dirs, edadMs, ws } } */
function datos(temas) {
  const raiz = mkdtempSync(join(tmpdir(), 'data-'));
  for (const [sesion, t] of Object.entries(temas)) {
    for (const d of t.dirs) {
      mkdirSync(join(raiz, d), { recursive: true });
      const f = join(raiz, d, `${sesion}.json`);
      writeFileSync(f, JSON.stringify(d === 'ws' ? { ws: t.ws ?? null } : { id: sesion }));
      const cuando = new Date(AHORA - t.edadMs) / 1000;
      utimesSync(f, cuando, cuando);
    }
  }
  return raiz;
}

test('el chat es NEGATIVO: se parte por el último _, no por el primero', () => {
  assert.deepEqual(partirSesion('-1004383895505_main'),
    { chat: '-1004383895505', thread: undefined });
  assert.deepEqual(partirSesion('-1004383895505_2'),
    { chat: '-1004383895505', thread: '2' });
  assert.equal(partirSesion('singuionbajo'), null);
  assert.equal(partirSesion('_2'), null, 'sin chat no hay destino');
});

test('gana el PRINCIPAL aunque otro tema sea más reciente', () => {
  const raiz = datos({
    '-100_main': { dirs: ['ws', 'claude-sessions'], edadMs: 30 * MIN, ws: null },
    '-100_2': { dirs: ['ws', 'claude-sessions'], edadMs: 1 * MIN, ws: '/home/x/ws/tema-2' },
  });
  try {
    const d = elegirDestino({ raiz, ahora: AHORA });
    assert.equal(d.sesion, '-100_main');
    assert.equal(d.thread, undefined, 'el tema general no lleva message_thread_id');
    assert.match(d.porque, /principal/);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('sin principal distinguible, gana el de actividad MÁS RECIENTE', () => {
  const raiz = datos({
    '-100_2': { dirs: ['ws'], edadMs: 60 * MIN, ws: '/home/x/ws/a' },
    '-100_9': { dirs: ['ws'], edadMs: 5 * MIN, ws: '/home/x/ws/b' },
  });
  try {
    const d = elegirDestino({ raiz, ahora: AHORA });
    assert.equal(d.sesion, '-100_9');
    assert.match(d.porque, /más reciente/);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('un tema CADUCADO no es un destino, aunque sea el principal', () => {
  const raiz = datos({
    '-100_main': { dirs: ['ws'], edadMs: 30 * DIA, ws: null },
    '-100_2': { dirs: ['ws'], edadMs: 10 * MIN, ws: '/home/x/ws/a' },
  });
  try {
    const d = elegirDestino({ raiz, ahora: AHORA });
    assert.equal(d.sesion, '-100_2',
      'el principal lleva un mes muerto: no se avisa ahí');
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('si NO queda ninguno vivo devuelve null: nunca se inventa un destino', () => {
  const raiz = datos({ '-100_main': { dirs: ['ws'], edadMs: 400 * DIA, ws: null } });
  try {
    assert.equal(elegirDestino({ raiz, ahora: AHORA }), null,
      'un aviso en el sitio equivocado es peor que no avisar');
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('el "visto" sale del dir MÁS reciente, no sólo de sessions/', () => {
  // `sessions/` sólo existe entre /use y /end: mirar sólo ahí daría por muerto
  // un tema donde se acaba de hablar sin sesión abierta.
  const raiz = datos({
    '-100_main': { dirs: ['ws'], edadMs: 20 * DIA, ws: null },
  });
  mkdirSync(join(raiz, 'claude-sessions'), { recursive: true });
  const f = join(raiz, 'claude-sessions', '-100_main.json');
  writeFileSync(f, '{}');
  const reciente = new Date(AHORA - 2 * MIN) / 1000;
  utimesSync(f, reciente, reciente);
  try {
    const d = elegirDestino({ raiz, ahora: AHORA });
    assert.equal(d.sesion, '-100_main', 'el ws/ viejo no puede matar un tema vivo');
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('un buffer APARTADO por caducar no es un tema', () => {
  const raiz = datos({ '-100_main': { dirs: ['ws'], edadMs: 5 * MIN, ws: null } });
  mkdirSync(join(raiz, 'buffer'), { recursive: true });
  writeFileSync(join(raiz, 'buffer', '-100_7.caducado-1234.json'), '{}');
  try {
    const temas = temasConocidos(raiz).map((t) => t.sesion);
    assert.deepEqual(temas, ['-100_main']);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('un ws.json ROTO no decide: el tema sigue contando, pero no como principal', () => {
  const raiz = datos({ '-100_2': { dirs: ['claude-sessions'], edadMs: 5 * MIN } });
  mkdirSync(join(raiz, 'ws'), { recursive: true });
  writeFileSync(join(raiz, 'ws', '-100_2.json'), '{ esto no es json');
  try {
    const [t] = temasConocidos(raiz);
    assert.equal(t.atado, null, 'roto = no se sabe, no "es principal"');
    assert.equal(elegirDestino({ raiz, ahora: AHORA }).sesion, '-100_2',
      'sigue siendo un destino por recencia');
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('la caducidad es de 7 días y está declarada', () => {
  assert.equal(CADUCIDAD_MS, 7 * DIA);
});

test('haceCuanto habla en la unidad que se lee de un vistazo', () => {
  assert.equal(haceCuanto(45 * 1000), '45 s');
  assert.equal(haceCuanto(30 * MIN), '30 min');
  assert.equal(haceCuanto(5 * 60 * MIN), '5 h');
  assert.equal(haceCuanto(5 * DIA), '5 d');
});
