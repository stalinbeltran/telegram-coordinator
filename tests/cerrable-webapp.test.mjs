// Tests del freno para la web app: lo que corre DENTRO de un proceso.
//
// Por qué existe, y por qué es el caso caro (R10)
// ----------------------------------------------
// `cerrable.mjs` decide si hay trabajo en curso mirando PROCESOS (`TRABAJOS`,
// una lista de nombres de script). Desde que la web app de `foveal-vision` corre
// como servicio (2026-08-29), un entrenamiento o un recorrido se lanzan desde el
// navegador y viven en un HILO de `fv.api` — no hay proceso nuevo que casar, así
// que la comprobación de siempre NO PUEDE verlo. Sin esto, un barrido lanzado
// desde el móvil se pierde con el veredicto en 🟢: el falso verde, que es el
// único fallo de este script que se lee como permiso para destruir la máquina.
//
// Lo que fijan estos tests:
//   1. con trabajo dentro → NO CERRAR, y se dice cuánto;
//   2. sin trabajo dentro → no estorba (un aviso que sale siempre se deja de leer);
//   3. algo desconocido en el puerto → NO SÉ, nunca «cerrable» por no saber;
//   4. sin web app → silencio: no está instalada, no hay nada que perder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

const G = 'git -c user.email=t@test -c user.name=test -c init.defaultBranch=main';
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Una web app de mentira en un puerto libre. Devuelve [puerto, cerrar]. */
async function webApp(responder) {
  const server = createServer((req, res) => {
    const cuerpo = responder(req.url.split('?')[0]);
    if (cuerpo === null) { res.writeHead(404).end('{"detail":"Not Found"}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(cuerpo);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return [server.address().port, () => new Promise((ok) => server.close(ok))];
}

/** Un repo limpio y empujado, que es lo que no da ninguna razón por sí solo. */
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
 * Una máquina de mentira COMPLETA: su propio `~/src` con el coordinador (que
 * ejecuta SU copia del script, como pasa de verdad) y un lanzador de pega que
 * contesta «no hay nada alquilado».
 *
 * ⚠ Hace falta entera, y no basta un directorio vacío: `cerrable.mjs` mira los
 * repos de `dirname(COORD)` — o sea que corriendo el script del repo de verdad,
 * el test medía el estado sucio de ESTA máquina en vez de lo que quiere probar.
 * Le pasó a la primera versión de este fichero.
 */
function maquina() {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-web-'));
  const casa = join(raiz, 'src');
  mkdirSync(casa, { recursive: true });
  // `cerrable.mjs` pregunta por Vast con `sh -c '. ~/.config/dev-secrets.env; ...'`,
  // y un `.` sobre un fichero que no existe ABORTA el shell entero -- con lo que
  // el lanzador de pega no llegaba a correr y todo salia NO SE.
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
  return { raiz, coord };
}

/**
 * ⚠ ASINCRONO a proposito. Con `execSync` el bucle de eventos de ESTE proceso se
 * queda bloqueado, y como la web app de mentira vive aqui dentro, no puede
 * contestar: `curl` se lo encuentra mudo y el test medía «no hay web app» en los
 * seis casos. Le pasó a la primera versión de este fichero.
 */
async function correr(m, puerto) {
  const base = { ...process.env };
  delete base.COORD_WS;
  const { stdout } = await ejecutar('node', [join(m.coord, 'scripts', 'cerrable.mjs'), '--exit0'], {
    cwd: m.coord, encoding: 'utf8',
    env: {
      ...base, HOME: m.raiz, COORD_HOME: m.coord,
      FV_WEB_PORT: String(puerto),
      // Un servicio que no existe: si no, esta rama dependería de si ESTA
      // máquina tiene la web app instalada, y el test sería distinto según dónde
      // corra -- justo lo que `cerrable-casa.test.mjs` existe para no permitir.
      FV_WEB_UNIT: 'no-existe-este-servicio.test',
    },
  });
  return stdout;
}

const JOBS = (...estados) => JSON.stringify({
  jobs: estados.map((status, i) => ({ id: `j${i}`, kind: 'train', status })),
});

test('un entrenamiento DENTRO de la web app impide cerrar', async () => {
  const [puerto, cerrar] = await webApp((ruta) =>
    ruta === '/api/jobs' ? JOBS('running') : null);
  try {
    const salida = await correr(maquina(), puerto);
    assert.match(salida, /NO CERRAR/,
      'un trabajo vivo dentro del proceso se pierde igual que uno con proceso propio');
    assert.match(salida, /1 trabajo\(s\) corriendo DENTRO de la web app/);
    assert.match(salida, /train/, 'tiene que decir de qué es, no sólo que hay algo');
  } finally { await cerrar(); }
});

test('cuenta también los encolados, que también se pierden', async () => {
  const [puerto, cerrar] = await webApp((ruta) =>
    ruta === '/api/jobs' ? JOBS('queued', 'done', 'running', 'error') : null);
  try {
    assert.match(await correr(maquina(), puerto), /2 trabajo\(s\) corriendo DENTRO/);
  } finally { await cerrar(); }
});

test('la web app sin trabajo dentro NO estorba', async () => {
  const [puerto, cerrar] = await webApp((ruta) =>
    ruta === '/api/jobs' ? JOBS('done', 'cancelled') : null);
  try {
    const salida = await correr(maquina(), puerto);
    assert.match(salida, /CERRABLE/,
      'un aviso que sale siempre se deja de leer en una semana');
    assert.match(salida, /web app: sin trabajo dentro/,
      '«miré y no hay» tiene que distinguirse de «no lo miré»');
  } finally { await cerrar(); }
});

test('también se le pregunta al API servido en la raíz (sin front)', async () => {
  // A mano se levanta `fv.api` sin `--web`, y entonces el API no cuelga de /api.
  const [puerto, cerrar] = await webApp((ruta) =>
    ruta === '/jobs' ? JOBS('running') : null);
  try {
    assert.match(await correr(maquina(), puerto), /NO CERRAR/);
  } finally { await cerrar(); }
});

test('algo desconocido en el puerto es NO SÉ, nunca cerrable', async () => {
  const [puerto, cerrar] = await webApp(() => '{"otra":"cosa"}');
  try {
    const salida = await correr(maquina(), puerto);
    assert.match(salida, /NO SÉ/,
      'entre un fallo ruidoso y uno silencioso, el ruidoso');
    assert.doesNotMatch(salida, /🟢/);
  } finally { await cerrar(); }
});

test('sin web app instalada no dice nada: no hay nada que perder', async () => {
  // Puerto libre garantizado: nadie escucha ahí y el servicio no existe.
  const salida = await correr(maquina(), 1);
  assert.doesNotMatch(salida, /web app/,
    'una máquina sin la app no tiene por qué leer una línea sobre ella');
  assert.match(salida, /CERRABLE/);
});
