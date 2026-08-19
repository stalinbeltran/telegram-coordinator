// Tests del estado por tema de la conversación de claude (scripts/claude-marker.mjs)
// y del ejecutor que la reinicia (scripts/claude-reset.mjs).
//
// Lo que se protege aquí es lo que rompe EN SILENCIO: si la época 0 dejara de
// derivarse del tema a secas, todas las conversaciones vivas se cortarían de golpe
// y sin error; y si `creset` derivara el uuid distinto que `claude-session.mjs`,
// el reset diría que reinició sin haber reiniciado nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESET = join('scripts', 'claude-reset.mjs');
const TEMA = '-100123_4';

function nuevoDataDir() {
  return mkdtempSync(join(tmpdir(), 'coord-reset-'));
}

function markerPath(dataDir, tema = TEMA) {
  return join(dataDir, 'claude-sessions', tema.replace(/[^\w.-]/g, '_') + '.json');
}

function leerMarker(dataDir, tema = TEMA) {
  const p = markerPath(dataDir, tema);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function escribirMarker(dataDir, data, tema = TEMA) {
  mkdirSync(join(dataDir, 'claude-sessions'), { recursive: true });
  writeFileSync(markerPath(dataDir, tema), JSON.stringify(data, null, 2) + '\n');
}

/** Corre `creset` como subproceso real, igual que lo haría el coordinador. */
function correrReset(dataDir, tema = TEMA) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RESET], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, DATA_DIR: dataDir, COORD_SESSION: tema },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', (code) => resolve({ out, code }));
    child.stdin.write('cualquier cosa');
    child.stdin.end();
  });
}

/** El módulo lee DATA_DIR al importarse, así que se importa DESPUÉS de fijarlo. */
async function cargarMarker(dataDir) {
  process.env.DATA_DIR = dataDir;
  return import(`../scripts/claude-marker.mjs?${dataDir}`);
}

test('época 0 deriva del tema a secas: las conversaciones vivas no se cortan', async () => {
  const m = await cargarMarker(nuevoDataDir());
  // Valor CONGELADO: es lo que producía la implementación anterior a las épocas
  // (sha1 del tema pelado). Si este assert se cae, el cambio que lo tumbó corta
  // en silencio TODAS las conversaciones vivas al desplegarse. No lo actualices:
  // arregla la derivación.
  assert.equal(m.uuidFor(TEMA, 0), 'ebde8a51-3649-41c5-8ce7-b9c685cbe4d4');
  assert.notEqual(m.uuidFor(TEMA, 1), m.uuidFor(TEMA, 0), 'la época 1 debe dar otro uuid');
  assert.match(m.uuidFor(TEMA, 3), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('marker viejo (sin `started`) se REANUDA, no se recrea', async () => {
  const dir = nuevoDataDir();
  const m = await cargarMarker(dir);
  const viejo = { session: TEMA, uuid: m.uuidFor(TEMA, 0), updated: '2026-01-01T00:00:00.000Z' };
  assert.equal(m.epochOf(viejo), 0, 'sin campo epoch es la época 0');
  assert.equal(m.isStarted(viejo), true, 'sin campo started, la conversación ya existe');
});

test('sin marker se CREA (tema virgen)', async () => {
  const m = await cargarMarker(nuevoDataDir());
  assert.equal(m.isStarted(null), false);
  assert.equal(m.epochOf(null), 0);
});

test('marker corrupto no revienta: se trata como tema virgen', async () => {
  const dir = nuevoDataDir();
  mkdirSync(join(dir, 'claude-sessions'), { recursive: true });
  writeFileSync(markerPath(dir), '{ esto no es json');
  const m = await cargarMarker(dir);
  assert.equal(m.readMarker(TEMA), null);
});

test('creset sube la época, cambia el uuid y deja la conversación por crear', async () => {
  const dir = nuevoDataDir();
  const m = await cargarMarker(dir);
  escribirMarker(dir, { session: TEMA, epoch: 0, uuid: m.uuidFor(TEMA, 0), started: true });

  const { code, out } = await correrReset(dir);
  assert.equal(code, 0);
  assert.match(out, /época 0 → 1/);

  const nuevo = leerMarker(dir);
  assert.equal(nuevo.epoch, 1);
  assert.equal(nuevo.started, false, 'started:false es lo que fuerza --session-id en vez de --resume');
  assert.equal(nuevo.uuid, m.uuidFor(TEMA, 1), 'el uuid del marker debe ser el que derivará claude-session');
  assert.notEqual(nuevo.uuid, m.uuidFor(TEMA, 0), 'debe ser una conversación distinta');
});

test('creset sobre un tema virgen también funciona (época 0 → 1)', async () => {
  const dir = nuevoDataDir();
  const { code, out } = await correrReset(dir);
  assert.equal(code, 0);
  assert.match(out, /época 0 → 1/);
  assert.equal(leerMarker(dir).epoch, 1);
});

test('resetear dos veces acumula: 1 → 2', async () => {
  const dir = nuevoDataDir();
  await correrReset(dir);
  const { out } = await correrReset(dir);
  assert.match(out, /época 1 → 2/);
  assert.equal(leerMarker(dir).epoch, 2);
});

test('el reset es POR TEMA: no toca los demás', async () => {
  const dir = nuevoDataDir();
  const otro = '-100123_9';
  const m = await cargarMarker(dir);
  escribirMarker(dir, { session: otro, epoch: 0, uuid: m.uuidFor(otro, 0), started: true }, otro);

  await correrReset(dir, TEMA);

  const intacto = leerMarker(dir, otro);
  assert.equal(intacto.epoch, 0, 'el otro tema sigue en su época');
  assert.equal(intacto.started, true, 'y su conversación sigue viva');
});
