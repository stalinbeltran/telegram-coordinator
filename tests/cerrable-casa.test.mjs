// Tests de «¿desde DÓNDE se pregunta si se puede apagar el server?»
// (scripts/cerrable.mjs + scripts/workspaces-locales.mjs).
//
// Por qué existe, y por qué es el caso caro (R10)
// ----------------------------------------------
// `cerrable.mjs` se COPIA con el workspace, y desde que un tema de Telegram
// re-enraíza sus comandos, `/use cerrable` ejecuta la copia de
// `~/ws/tema-N/telegram-coordinator/scripts/`. El script deducía dos cosas de su
// propia ubicación en disco —el antipatrón de la R4— y las dos se daban la
// vuelta al correr desde una copia:
//
//   1. QUÉ ÁRBOLES MIRA. `dirname(COORD)` pasaba a ser el workspace, así que el
//      árbol de casa (`~/src`) NO ENTRABA en la lista y su trabajo sin empujar
//      era invisible. Medido el 2026-08-28, mismo instante y con un cambio real
//      sin commitear en `~/src/telegram-coordinator`: desde `~/src` daba 🔴 y
//      desde `~/ws/tema-2` daba 🟢. Un falso verde se lee como permiso para
//      destruir la máquina, que es el único fallo de este script que cuesta
//      dinero de verdad.
//   2. QUÉ IGNORA. El `data/fuentes.json` que reescribe `--nuevo` se ignoraba si
//      el árbol «no era desde donde preguntas», así que desde dentro del
//      workspace dejaba de ignorarse (🔴 permanente por un árbol vacío: el aviso
//      que sale siempre y se deja de leer) y en cambio SÍ se ignoraba el de
//      casa, donde un cambio ahí es un cambio de verdad.
//
// La regla que fijan estos tests, y que es la que no puede volver a romperse:
// **el veredicto no depende de dónde preguntes.** Casa se DECLARA con
// `COORD_HOME` (que el coordinador pasa a todo comando y no re-enraíza), y si el
// script corre desde una copia sin que nadie se lo diga, dice NO SÉ en vez de
// inventárselo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const G = 'git -c user.email=t@test -c user.name=test -c init.defaultBranch=main';
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * Un `telegram-coordinator` clonado de un remoto, como nace cada uno aquí.
 *
 * ⚠ Los scripts van COMMITEADOS en la semilla, como en el repo de verdad. Si se
 * copian al clon después, quedan sin trackear y el propio arnés ensucia los dos
 * árboles: el test dejaba de medir la regla y medía su propio montaje.
 */
function coordEn(padre) {
  const origen = join(padre, 'origen.git');
  const semilla = join(padre, 'semilla');
  const dest = join(padre, 'telegram-coordinator');
  sh(`${G} init --bare -q ${origen}`, padre);
  sh(`${G} clone -q ${origen} ${semilla}`, padre);
  mkdirSync(join(semilla, 'data'), { recursive: true });
  mkdirSync(join(semilla, 'scripts'), { recursive: true });
  writeFileSync(join(semilla, 'data', 'fuentes.json'), '{"fuentes":["~/src/*/telegram"]}\n');
  for (const f of ['cerrable.mjs', 'workspaces-locales.mjs', 'git-pendiente.mjs']) {
    sh(`cp ${join(RAIZ, 'scripts', f)} ${join(semilla, 'scripts', f)}`, padre);
  }
  sh(`${G} add -A`, semilla);
  sh(`${G} commit -qm inicial`, semilla);
  sh(`${G} push -q origin main`, semilla);
  sh(`${G} clone -q ${origen} ${dest}`, padre);
  return dest;
}

/**
 * Una máquina de mentira: el árbol de casa y un workspace montado bajo `~/ws`,
 * cada uno con su `telegram-coordinator`.
 */
function maquina() {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-casa-'));
  const casa = join(raiz, 'src');
  const wsRaiz = join(raiz, 'ws');
  const ws = join(wsRaiz, 'tema-7');
  mkdirSync(casa, { recursive: true });
  mkdirSync(ws, { recursive: true });

  const coordCasa = coordEn(casa);
  const coordWs = coordEn(ws);

  // lo que deja `--nuevo`: identidad del workspace y su fuentes.json reescrito
  writeFileSync(join(ws, 'WORKSPACE.json'),
    JSON.stringify({ nombre: 'tema-7', prefijo: 't7-', rama: 'tema-7' }) + '\n');
  writeFileSync(join(coordWs, 'data', 'fuentes.json'),
    JSON.stringify({ fuentes: [join(ws, '*', 'telegram')] }) + '\n');

  return { raiz, casa, wsRaiz, ws, coordCasa, coordWs };
}

/** Corre la copia de `cerrable.mjs` que vive en `desdeCoord`. */
function correr(m, desdeCoord, env = {}) {
  const base = { ...process.env };
  delete base.COORD_HOME;   // el de esta máquina no puede colarse en la de mentira
  delete base.COORD_WS;
  return execSync(`node ${join(desdeCoord, 'scripts', 'cerrable.mjs')} --exit0`, {
    cwd: desdeCoord, encoding: 'utf8', stdio: 'pipe',
    env: { ...base, COORD_WS_RAIZ: m.wsRaiz, HOME: m.raiz, ...env },
  });
}

/** Cada árbol ejecuta SU copia del script, que es lo que pasa de verdad cuando
 *  el bot re-enraíza los comandos de un tema con workspace. */
const prepara = () => maquina();

/**
 * Las razones del informe, normalizadas.
 *
 * ⚠ Se compara la razón ENTERA, con su etiqueta de árbol (`[src]`, `[tema-7]`),
 * y no un `/sin commitear/` suelto. Con el código roto los dos fallos se tapaban
 * el uno al otro —el falso aviso del workspace hacía que el informe dijera «sin
 * commitear» aunque el trabajo de casa fuera invisible— así que un match laxo
 * pasaba con el bug delante. Le pasó a la primera versión de este fichero.
 */
const razones = (salida) => salida.split('\n')
  .filter((l) => l.trim().startsWith('·'))
  .map((l) => l.replace(/\s+/g, ' ').trim()).sort();

// ------------------------------------------------ el caso caro: el falso verde

test('el trabajo sin empujar de CASA se ve también preguntando desde el workspace', () => {
  const m = prepara();
  writeFileSync(join(m.coordCasa, 'trabajo-de-verdad.md'), 'algo que se perdería\n');

  const esperado = 'telegram-coordinator [src]: 1 fichero(s) sin commitear';

  assert.ok(razones(correr(m, m.coordCasa, { COORD_HOME: m.coordCasa })).includes(`· ${esperado}`),
    'preguntando desde casa tiene que avisar del fichero sin commitear');
  assert.ok(razones(correr(m, m.coordWs, { COORD_HOME: m.coordCasa })).includes(`· ${esperado}`),
    'preguntando desde el workspace TAMBIÉN, y NOMBRANDO el árbol de casa: si no, ' +
    'su trabajo es invisible y el veredicto sale verde con trabajo real pendiente');
});

test('el veredicto no depende de desde dónde preguntes', () => {
  const m = prepara();
  writeFileSync(join(m.coordCasa, 'trabajo-de-verdad.md'), 'algo\n');
  const norm = (s) => s.split('\n').filter((l) => l.includes('·')).map((l) => l.replace(/\s+/g, ' ').trim()).sort();

  assert.deepEqual(
    norm(correr(m, m.coordWs, { COORD_HOME: m.coordCasa })),
    norm(correr(m, m.coordCasa, { COORD_HOME: m.coordCasa })),
    'las razones tienen que ser las mismas desde casa y desde el workspace',
  );
});

// ------------------------------- el otro lado: el 🔴 permanente por un montaje

test('el fuentes.json que reescribe --nuevo se ignora TAMBIÉN desde dentro del workspace', () => {
  const m = prepara();   // nadie ha trabajado: lo único sucio es el del montaje
  const desdeWs = correr(m, m.coordWs, { COORD_HOME: m.coordCasa });
  assert.doesNotMatch(desdeWs, /sin commitear/,
    'el fuentes.json del propio montaje no es trabajo: si avisa, el freno se queda ' +
    'en 🔴 para siempre y se deja de leer');
});

test('pero el fuentes.json de CASA sigue avisando: ahí un cambio es un cambio', () => {
  const m = prepara();
  writeFileSync(join(m.coordCasa, 'data', 'fuentes.json'), '{"fuentes":["/otro/sitio/*/telegram"]}\n');
  assert.ok(
    razones(correr(m, m.coordWs, { COORD_HOME: m.coordCasa }))
      .includes('· telegram-coordinator [src]: 1 fichero(s) sin commitear'),
    'ignorar el artefacto del montaje no puede extenderse al árbol de casa');
});

// --------------------------------------------------- y si no se puede saber...

test('desde una copia y SIN COORD_HOME dice NO SÉ, nunca «cerrable»', () => {
  const m = prepara();
  writeFileSync(join(m.coordCasa, 'trabajo-de-verdad.md'), 'algo\n');
  const r = correr(m, m.coordWs);   // sin COORD_HOME: nadie le dice dónde está casa
  // ⚠ La duda CONCRETA, no un `/NO SÉ/` suelto: en esta máquina de mentira no hay
  // repo del lanzador, así que el informe dice NO SÉ por otro motivo y la
  // aserción laxa pasaba con el bug delante.
  assert.match(r, /no sé dónde está el árbol de casa/i,
    'sin saber dónde está casa no se puede afirmar que no se pierde nada: ' +
    'un fallo silencioso que se lee como permiso es el que cuesta dinero');
  assert.match(r, /NO SÉ/, 'y eso tiene que arrastrar el veredicto a NO SÉ');
});

test('desde el árbol de casa y sin COORD_HOME NO duda: ahí sí se puede deducir', () => {
  const m = prepara();
  const r = correr(m, m.coordCasa);   // sin COORD_HOME, pero fuera de un workspace
  assert.doesNotMatch(r, /no sé dónde está el árbol de casa/,
    'la consola normal no tiene por qué declarar nada: fuera de un workspace, ' +
    'deducir casa del disco es correcto');
});
