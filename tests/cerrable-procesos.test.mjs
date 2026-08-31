// Tests del freno para el trabajo con PROCESO PROPIO: el que se lanza a mano.
//
// Por qué existe
// --------------
// `cerrable.mjs` decide si hay trabajo en curso casando la línea de comando
// contra `TRABAJOS`, una lista DECLARADA de nombres. Esa lista tenía sólo los
// scripts de la flota y del benchmark, así que un entrenamiento lanzado por
// consola —que es la forma documentada de entrenar— no salía: el 2026-08-30 un
// `fv-train` llevaba 1 h 17 min vivo y el veredicto decía «nada de trabajo
// corriendo en esta máquina». El falso verde otra vez, y sobre lo único que
// estaba corriendo.
//
// Lo que fijan estos tests, que es lo que puede volver a romperse:
//   1. un `fv-*` vivo en un árbol de esta máquina → NO CERRAR, y se dice cuál;
//   2. el SERVICIO (`fv-api`) no cuenta: está vivo siempre, y un 🔴 permanente
//      es el aviso que se deja de leer;
//   3. un trabajo envuelto en `sh -c` es UN trabajo, no tres;
//   4. lo de OTRA máquina (fuera de estos árboles) no es asunto de este server.
//
// Cada test construye su mundo: una máquina de mentira entera, porque si no
// mediría el estado sucio de ESTA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFile, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);
const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const G = 'git -c user.email=t@test -c user.name=test -c init.defaultBranch=main';
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Un repo limpio y empujado: por sí solo no da ninguna razón para no cerrar. */
function repo(padre, nombre, ficheros = {}) {
  const origen = join(padre, `${nombre}.git`);
  const semilla = join(padre, `_semilla-${nombre}`);
  const dest = join(padre, nombre);
  sh(`${G} init --bare -q ${origen}`, padre);
  sh(`${G} clone -q ${origen} ${semilla}`, padre);
  for (const [ruta, contenido] of Object.entries(ficheros)) {
    mkdirSync(dirname(join(semilla, ruta)), { recursive: true });
    writeFileSync(join(semilla, ruta), contenido);
  }
  writeFileSync(join(semilla, '.gitkeep'), '');
  sh(`${G} add -A`, semilla);
  sh(`${G} commit -qm inicial`, semilla);
  sh(`${G} push -q origin main`, semilla);
  sh(`${G} clone -q ${origen} ${dest}`, padre);
  return dest;
}

/**
 * Una máquina de mentira con el coordinador, el lanzador y `foveal-vision`.
 *
 * ⚠ El programa que hace de trabajo va COMMITEADO en el repo: si se escribiera
 * después, el árbol quedaría sucio y el 🔴 saldría por «sin commitear» — o sea
 * que el test pasaría sin comprobar nada de lo suyo.
 */
function maquina(programas = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-proc-'));
  const casa = join(raiz, 'src');
  mkdirSync(casa, { recursive: true });
  mkdirSync(join(raiz, '.config'), { recursive: true });
  writeFileSync(join(raiz, '.config', 'dev-secrets.env'), '');

  const scripts = {};
  for (const f of ['cerrable.mjs', 'workspaces-locales.mjs', 'git-pendiente.mjs']) {
    scripts[join('scripts', f)] = readFileSync(join(RAIZ, 'scripts', f), 'utf8');
  }
  const coord = repo(casa, 'telegram-coordinator', {
    ...scripts, 'data/fuentes.json': '{"fuentes":[]}\n',
  });
  repo(casa, 'digital-ocean-dropplet-auto-launching', {
    'scripts/vast_instance.py': 'print("No hay ninguna instancia viva")\n',
  });
  const fv = repo(casa, 'foveal-vision', programas);
  return { raiz, coord, fv, casa };
}

/** Un proceso que se llama como el de verdad y no hace nada. */
const DORMIR = 'setTimeout(() => {}, 30000);\n';

function lanzar(cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, stdio: 'ignore' });
  return p;
}

/** Espera a que `ps` vea la línea: sin esto el test mide una carrera. */
async function esperarEnPs(patron) {
  for (let i = 0; i < 100; i++) {
    if (new RegExp(patron).test(execSync('ps -eo pid,args', { encoding: 'utf8' }))) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error(`'${patron}' no apareció en ps`);
}

async function correr(m, ...extra) {
  const base = { ...process.env };
  delete base.COORD_WS;
  const { stdout } = await ejecutar(
    'node', [join(m.coord, 'scripts', 'cerrable.mjs'), '--exit0', ...extra],
    { cwd: m.coord, encoding: 'utf8',
      env: { ...base, HOME: m.raiz, COORD_HOME: m.coord,
             // puerto libre + servicio inexistente: esta rama no puede depender
             // de si la máquina donde corre el test tiene la web app
             FV_WEB_PORT: '1', FV_WEB_UNIT: 'no-existe-este-servicio.test' } });
  return stdout;
}

test('un entrenamiento por consola impide cerrar', async () => {
  const m = maquina({ 'fv-train': DORMIR });
  const hijo = lanzar('node', [join(m.fv, 'fv-train')], m.fv);
  try {
    await esperarEnPs(`${m.fv}/fv-train`);
    const salida = await correr(m);
    assert.match(salida, /NO CERRAR/,
      'un fv-train vivo se pierde con la máquina igual que una flota');
    assert.match(salida, /1 trabajo\(s\) vivo\(s\)/);
    assert.match(salida, /fv-train/, 'tiene que decir QUÉ corre, no sólo que algo corre');
  } finally { hijo.kill('SIGKILL'); }
});

test('un entrenamiento en VAST impide cerrar: quien destruye la instancia es ESTE proceso',
  async () => {
    // El caso más caro de los que cuenta esta lista. `entrenar_vast.py` alquila
    // UNA máquina y la destruye en un `finally` de sí mismo, así que apagar el
    // server mientras corre deja la instancia facturando sin nadie que la
    // recoja. La máquina sí se veía por la API de Vast; el proceso que la
    // recoge NO se contaba — así que el veredicto podía decir «nada corriendo»
    // con un entrenamiento de horas vivo. Añadido a TRABAJOS el 2026-08-31.
    const m = maquina({ 'entrenar_vast.py': DORMIR });
    const hijo = lanzar('node', [join(m.fv, 'entrenar_vast.py')], m.fv);
    try {
      await esperarEnPs(`${m.fv}/entrenar_vast.py`);
      const salida = await correr(m);
      assert.match(salida, /NO CERRAR/,
        'un entrenamiento en Vast vivo se pierde con la máquina Y deja la instancia facturando');
      assert.match(salida, /entrenar_vast/,
        'la línea breve tiene que NOMBRARLO: es lo único que se lee desde el móvil');
    } finally { hijo.kill('SIGKILL'); }
  });

test('el vigilante de RESCATE también cuenta: si él no se ve, no queda nadie mirando',
  async () => {
    // `adoptar_vast.py` existe PRECISAMENTE para recoger una instancia cuyo
    // vigilante ya murió una vez (pasó el 2026-08-31: el proceso local
    // desapareció con la sesión que lo lanzó y la máquina siguió facturando con
    // el entrenamiento dentro). Que él tampoco se cuente sería el mismo fallo
    // dos veces, y la segunda sin nadie detrás.
    const m = maquina({ 'adoptar_vast.py': DORMIR });
    const hijo = lanzar('node', [join(m.fv, 'adoptar_vast.py')], m.fv);
    try {
      await esperarEnPs(`${m.fv}/adoptar_vast.py`);
      const salida = await correr(m);
      assert.match(salida, /NO CERRAR/);
      assert.match(salida, /adoptar_vast/,
        'la línea breve tiene que nombrarlo: es el único que puede destruir la instancia');
    } finally { hijo.kill('SIGKILL'); }
  });

test('el SERVICIO no cuenta: un 🔴 permanente se deja de leer', async () => {
  const m = maquina({ 'fv-api': DORMIR });
  const hijo = lanzar('node', [join(m.fv, 'fv-api')], m.fv);
  try {
    await esperarEnPs(`${m.fv}/fv-api`);
    const salida = await correr(m);
    assert.match(salida, /CERRABLE/,
      'fv-api está vivo desde que arranca la máquina: contarlo sería 🔴 para siempre');
    assert.match(salida, /nada de trabajo corriendo/,
      '«miré y no hay» tiene que distinguirse de «no lo miré»');
  } finally { hijo.kill('SIGKILL'); }
});

test('un trabajo envuelto en sh -c es UN trabajo, no tres', async () => {
  // Es como lo lanza `desacoplar.sh`: cada envoltorio lleva la línea entera del
  // hijo, así que casa igual. Contando procesos salía «3 vivos» de un solo
  // entrenamiento, y un número que no cuadra con lo que hay se deja de creer.
  const m = maquina({ 'fv-train': DORMIR });
  const hijo = lanzar('sh', ['-c', `node ${join(m.fv, 'fv-train')}; true`], m.fv);
  try {
    await esperarEnPs(`sh -c node ${m.fv}/fv-train`);
    const salida = await correr(m);
    assert.match(salida, /NO CERRAR/);
    assert.match(salida, /1 trabajo\(s\) vivo\(s\)/,
      'el sh -c y su hijo son el mismo trabajo');
  } finally { hijo.kill('SIGKILL'); }
});

test('lo que corre FUERA de estos árboles no es de este server', async () => {
  const m = maquina({ 'fv-train': DORMIR });
  const ajeno = mkdtempSync(join(tmpdir(), 'otra-maquina-'));
  writeFileSync(join(ajeno, 'fv-train'), DORMIR);
  const hijo = lanzar('node', [join(ajeno, 'fv-train')], ajeno);
  try {
    await esperarEnPs(`${ajeno}/fv-train`);
    const salida = await correr(m);
    assert.match(salida, /CERRABLE/,
      'de quién es un proceso lo dice su CWD: éste no cuelga de ningún árbol local');
  } finally { hijo.kill('SIGKILL'); }
});

test('la línea BREVE dice QUÉ corre, no sólo que corre algo', async () => {
  // Es la que se pega al final de cada mensaje y la única que se lee desde el
  // móvil. Decía «1 trabajo(s) vivo(s)» a secas, así que el dueño veía un 🔴 sin
  // poder contrastarlo: miró la cuenta de Vast, la encontró vacía, y concluyó
  // que el freno estaba roto (2026-08-30). Un freno que no se puede contrastar
  // se acaba ignorando, que es lo único que no puede pasarle a un freno.
  const m = maquina({ 'fv-train': DORMIR });
  const hijo = lanzar('node', [join(m.fv, 'fv-train')], m.fv);
  try {
    await esperarEnPs(`${m.fv}/fv-train`);
    const salida = await correr(m, '--breve');
    assert.equal(salida.trim().split('\n').length, 1, 'breve es UNA línea');
    assert.match(salida, /fv-train/,
      'sin el nombre, el 🔴 no se puede comprobar desde el móvil');
  } finally { hijo.kill('SIGKILL'); }
});

test('preguntar por un trabajo no lo inventa: el freno no se cuenta a sí mismo', async () => {
  // Un shell cuya línea MENCIONA el nombre casa igual que el trabajo. Preguntar
  // desde la consola («¿está corriendo fv-train?») sumaba un trabajo que no
  // existe, y el veredicto pasaba de 1 a 2 vivos sin que la máquina cambiara.
  // Visto el 2026-08-30 depurando esto mismo. Un número que baila se deja de
  // creer, y este número ES el freno.
  const m = maquina();          // ⚠ sin ningún trabajo de verdad
  const { stdout } = await ejecutar('sh', ['-c',
    `# esta línea habla de fv-train\n` +
    `node ${join(m.coord, 'scripts', 'cerrable.mjs')} --exit0 --breve`],
    { cwd: m.coord, encoding: 'utf8',
      env: { ...process.env, COORD_WS: undefined, HOME: m.raiz, COORD_HOME: m.coord,
             FV_WEB_PORT: '1', FV_WEB_UNIT: 'no-existe-este-servicio.test' } });
  assert.match(stdout, /CERRABLE/,
    'el shell que pregunta no es el trabajo, y su padre tampoco');
  assert.doesNotMatch(stdout, /trabajo\(s\) vivo/);
});
