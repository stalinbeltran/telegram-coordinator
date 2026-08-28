// Tests de «un workspace por TEMA de Telegram» (src/workspaces.ts) y de la
// contabilidad de workspaces de la máquina (scripts/workspaces-locales.mjs).
//
// Qué se protege aquí, y por qué justo esto (R10: el esfuerzo de prueba se
// reparte por consecuencia del fallo, no por facilidad):
//
//   · Re-enraizar mal = correr un comando en el árbol EQUIVOCADO. Otra rama,
//     otro prefijo, y ni un error por el camino: es el fallo silencioso caro.
//   · Caer al árbol original cuando el repo no está en el workspace sería
//     «fallar a mitad», que R2 prohíbe explícitamente. Tiene que NEGARSE antes.
//   · `startsWith` en vez de comparar por segmento da por PROPIO lo ajeno
//     (`~/ws/do-v` estando en `~/ws/do`), y lo propio es lo que se mata.
//   · La atadura tiene que sobrevivir a `/end`, o habría que rehacerla a cada rato.
//   · Un workspace que ya no está en disco (máquina rehecha) no puede dejar el
//     tema apuntando a una ruta muerta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config.ts lee DATA_DIR al importarse, así que hay que ponerlo ANTES.
const raiz = mkdtempSync(join(tmpdir(), 'coord-ws-'));
process.env.BOT_TOKEN = 'test-token';
process.env.DATA_DIR = join(raiz, 'casa', 'data');
process.env.COORD_WS_RAIZ = join(raiz, 'ws');

/** Un workspace de mentira: identidad + los repos que se le pidan. */
function workspace(nombre, { prefijo = null, repos = [] } = {}) {
  const d = join(raiz, 'ws', nombre);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'WORKSPACE.json'),
    JSON.stringify({ nombre, prefijo, rama: nombre, creado: '2026-08-28', que: 'test' }));
  for (const r of repos) mkdirSync(join(d, r), { recursive: true });
  return d;
}

const mod = () => import('../src/workspaces.js');

// --------------------------------------------------------------- la frontera
test('dentroDe compara por SEGMENTO: ~/ws/do-v no está dentro de ~/ws/do', async () => {
  const { dentroDe } = await mod();
  assert.equal(dentroDe('/home/x/ws/do/foveal-vision', '/home/x/ws/do'), true);
  assert.equal(dentroDe('/home/x/ws/do', '/home/x/ws/do'), true);
  // el fallo que motivó esto: prefijo de texto, no de ruta
  assert.equal(dentroDe('/home/x/ws/do-v/foveal-vision', '/home/x/ws/do'), false);
  assert.equal(dentroDe('/home/x/src-otro', '/home/x/src'), false);
});

// ------------------------------------------------------- re-enraizar el cwd
test('el cwd de un comando se re-enraíza al repo equivalente del workspace', async () => {
  const { cwdEnWorkspace } = await mod();
  const ws = workspace('dropout', { prefijo: 'do-', repos: ['foveal-vision'] });
  const r = cwdEnWorkspace('/home/x/src/foveal-vision', '/home/x/src/foveal-vision', ws);
  assert.deepEqual(r, { cwd: join(ws, 'foveal-vision') });
});

test('un `cwd` propio del JSON conserva su subdirectorio al re-enraizar', async () => {
  const { cwdEnWorkspace } = await mod();
  const ws = workspace('sub', { repos: ['foveal-vision'] });
  const r = cwdEnWorkspace('/home/x/src/foveal-vision/scripts', '/home/x/src/foveal-vision', ws);
  assert.deepEqual(r, { cwd: join(ws, 'foveal-vision', 'scripts') });
});

test('si el repo NO está en el workspace, se NIEGA: nunca cae al árbol original', async () => {
  const { cwdEnWorkspace } = await mod();
  const ws = workspace('pelado', { repos: [] });
  const r = cwdEnWorkspace('/home/x/src/foveal-vision', '/home/x/src/foveal-vision', ws);
  assert.ok('error' in r, 'tenía que devolver error, no un cwd');
  assert.ok(!('cwd' in r), 'no puede devolver también un cwd: eso se usaría');
  assert.match(r.error, /foveal-vision/);
  assert.match(r.error, /\/ws off/, 'el error tiene que decir cómo salir');
});

test('sin workspace atado, el cwd se queda como estaba', async () => {
  const { cwdEnWorkspace } = await mod();
  const r = cwdEnWorkspace('/home/x/src/foveal-vision', '/home/x/src/foveal-vision', undefined);
  assert.deepEqual(r, { cwd: '/home/x/src/foveal-vision' });
});

test('un comando declarado DENTRO del workspace no se toca', async () => {
  const { cwdEnWorkspace } = await mod();
  const ws = workspace('propio', { repos: ['foveal-vision'] });
  const dentro = join(ws, 'foveal-vision');
  assert.deepEqual(cwdEnWorkspace(dentro, dentro, ws), { cwd: dentro });
});

// --------------------------------------------------------------- la atadura
test('la atadura sobrevive a /end: cerrar la sesión no te muda de árbol', async () => {
  const { setWorkspace, getWorkspace } = await mod();
  const { setSession, endSession, getSession } = await import('../src/sessions.js');
  const ws = workspace('persistente', { repos: ['foveal-vision'] });
  const sid = '-100123_7';

  await setSession(sid, 'shell');
  await setWorkspace(sid, ws);
  await endSession(sid);

  assert.equal(getSession(sid), undefined, '/end suelta el ejecutor');
  assert.equal(getWorkspace(sid), ws, '...pero NO el workspace');
});

test('una atadura a un workspace que ya no está en disco no se carga', async () => {
  const { setWorkspace, loadWorkspaces, getWorkspace } = await mod();
  const ws = workspace('efimero', { repos: ['foveal-vision'] });
  const sid = '-100123_9';
  await setWorkspace(sid, ws);

  rmSync(ws, { recursive: true, force: true });   // la máquina se rehizo
  await loadWorkspaces();

  assert.equal(getWorkspace(sid), undefined,
    'mejor "sin workspace" (que degrada al árbol del coordinador) que una ruta muerta');
});

// ------------------------------------------------------------- resolver /ws
test('/ws <nombre> resuelve contra la raíz de workspaces', async () => {
  const { resolverWorkspace } = await mod();
  const ws = workspace('porNombre', { repos: ['foveal-vision'] });
  assert.deepEqual(await resolverWorkspace('porNombre'), { ws });
});

test('/ws se niega ante un directorio sin WORKSPACE.json', async () => {
  const { resolverWorkspace } = await mod();
  const d = join(raiz, 'ws', 'sin-identidad');
  mkdirSync(d, { recursive: true });
  const r = await resolverWorkspace('sin-identidad');
  assert.ok('error' in r);
  assert.match(r.error, /WORKSPACE\.json/);
  assert.match(r.error, /prefijo/, 'tiene que decir POR QUÉ importa: sin prefijo se paga a ciegas');
});

test('/ws se niega ante un workspace que no existe, y lista los que sí', async () => {
  const { resolverWorkspace } = await mod();
  workspace('visible', { repos: [] });
  const r = await resolverWorkspace('no-existe-jamas');
  assert.ok('error' in r);
  assert.match(r.error, /visible/, 'un error que no dice las alternativas obliga a adivinar');
});

// --------------------------------- el freno: TODOS los workspaces del server
test('workspacesLocales ve los workspaces de OTROS temas, con su prefijo', async () => {
  const { workspacesLocales } = await import('../scripts/workspaces-locales.mjs');
  workspace('uno', { prefijo: 'un-' });
  workspace('dos', { prefijo: 'ds-' });
  const l = workspacesLocales();
  const nombres = l.map((x) => x.nombre);
  assert.ok(nombres.includes('uno') && nombres.includes('dos'),
    'si cerrable sólo viera el mío, diría CERRABLE con la flota de otro tema facturando');
  assert.equal(l.find((x) => x.nombre === 'dos').prefijo, 'ds-');
});

test('workspacesLocales incluye los árboles extra aunque no tengan identidad', async () => {
  const { workspacesLocales } = await import('../scripts/workspaces-locales.mjs');
  const suelto = join(raiz, 'suelto');
  mkdirSync(suelto, { recursive: true });
  const l = workspacesLocales([suelto]);
  const s = l.find((x) => x.raiz === suelto);
  assert.ok(s, 'el árbol del coordinador cuenta aunque no sea un workspace formal');
  assert.equal(s.prefijo, null, 'y sin prefijo, para que cerrable lo declare como duda');
});
