// Tests del freno para el modo `trabajo` de `vast_instance.py` (2026-10-01).
//
// Por qué existe
// --------------
// El modo `trabajo` alquila N máquinas de Vast, una por trabajo, cada una
// vigilada por una UNIDAD de systemd que corre `vast_instance.py trabajo --uno …`.
// Entró en el mismo commit que estas líneas del freno (R11), y lo que fijan es lo
// que puede volver a romperse:
//   1. un `vast_instance.py trabajo` vivo es un trabajo: NO CERRAR, y se dice cuál;
//   2. una máquina `expc-*` cuenta como de ESTA máquina aunque exista un workspace
//      con otro prefijo: si no, una flota de experimentos lanzada desde casa salía
//      «de otro server» en cuanto se montaba un `~/ws/tema-N` (el falso verde de
//      `docs/freno-prefijos-2026-09-01.md`);
//   3. con su `trabajo` vivo, la máquina NO sale «SIN VIGILANTE»; sin él, sí.
// Medido el 2026-10-01 contra el freno anterior: fallan los TRES (el 1 no veía el
// proceso, el 2 daba 🟢 y el 3 decía «SIN VIGILANTE» con el vigilante vivo).

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

/** El formato real de `vast_instance.py list`, que es lo que cerrable parsea. */
const lista = (etiqueta) =>
  'import sys\n'
  + 'if len(sys.argv) > 1 and sys.argv[1] == "list":\n'
  + '    print("""        ID  ETIQUETA            ESTADO        vCPU       $/H  SSH\n'
  + `  49406152  ${etiqueta.padEnd(18)}  running        5.0    0.0550  ssh1:1\n\n`
  + 'Gastando ahora: 0.0550 $/h""")\n'
  + 'else:\n'
  // el `trabajo --uno` de mentira: se queda vivo como lo haría el de verdad
  + '    import time; time.sleep(30)\n';

/**
 * Una máquina de mentira. `wsPrefijo` monta además un `~/ws/tema-2` con identidad
 * y ese prefijo, que es lo que activa el filtro de prefijos del freno.
 */
function maquina({ etiqueta = null, wsPrefijo = null } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-trabajo-'));
  const casa = join(raiz, 'src');
  mkdirSync(casa, { recursive: true });
  mkdirSync(join(raiz, '.config'), { recursive: true });
  writeFileSync(join(raiz, '.config', 'dev-secrets.env'), '');
  const scripts = {};
  for (const f of ['cerrable.mjs', 'workspaces-locales.mjs', 'git-pendiente.mjs', 'codigo-vivo.mjs']) {
    scripts[join('scripts', f)] = readFileSync(join(RAIZ, 'scripts', f), 'utf8');
  }
  const coord = repo(casa, 'telegram-coordinator', {
    ...scripts, 'data/fuentes.json': '{"fuentes":[]}\n',
  });
  const lanzador = repo(casa, 'digital-ocean-dropplet-auto-launching', {
    'scripts/vast_instance.py': etiqueta ? lista(etiqueta)
      : 'import sys, time\nif sys.argv[1:2] == ["list"]:\n    print("No hay ninguna instancia viva")\nelse:\n    time.sleep(30)\n',
    'scripts/do_droplet.py': 'print("[]")\n',
    'scripts/estado_nubes.py': 'print("DigitalOcean\\nVast.ai")\n',
  });
  if (wsPrefijo) {
    const ws = join(raiz, 'ws', 'tema-2');
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'WORKSPACE.json'),
      JSON.stringify({ nombre: 'tema-2', prefijo: wsPrefijo }) + '\n');
  }
  return { raiz, coord, lanzador };
}

async function esperarEnPs(patron) {
  for (let i = 0; i < 100; i++) {
    if (new RegExp(patron).test(execSync('ps -eo pid,args', { encoding: 'utf8' }))) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error(`'${patron}' no apareció en ps`);
}

/** Un `vast_instance.py trabajo --uno …` vivo, como el que corre cada unidad. */
async function trabajoVivo(m) {
  const p = spawn('python3', [join(m.lanzador, 'scripts', 'vast_instance.py'), 'trabajo',
    '--uno', 'k09', '--prefijo', 'expc-prueba-'], { cwd: m.lanzador, stdio: 'ignore' });
  await esperarEnPs(`${m.lanzador}/scripts/vast_instance.py trabajo --uno k09`);
  return p;
}

async function correr(m) {
  const base = { ...process.env };
  delete base.COORD_WS;
  const { stdout } = await ejecutar(
    'node', [join(m.coord, 'scripts', 'cerrable.mjs'), '--exit0'],
    { cwd: m.coord, encoding: 'utf8',
      env: { ...base, HOME: m.raiz, COORD_HOME: m.coord, COORD_WS_RAIZ: join(m.raiz, 'ws'),
             FV_WEB_PORT: '1', FV_WEB_UNIT: 'no-existe-este-servicio.test',
             CERRABLE_DROPLET_ID: '' } });
  return stdout;
}

test('un `vast_instance.py trabajo` vivo es un trabajo: NO CERRAR, y se dice cuál', async () => {
  const m = maquina();
  const hijo = await trabajoVivo(m);
  try {
    const salida = await correr(m);
    assert.match(salida, /NO CERRAR/, 'una unidad de trabajo vigila una máquina que factura');
    assert.match(salida, /vast_instance\.py trabajo/, 'tiene que decir QUÉ corre');
  } finally { hijo.kill('SIGKILL'); }
});

// ⚠ Con máquinas vivas y un árbol sin `prefijo`, el titular es 🟡 NO SÉ y no 🔴: es el
// comportamiento de siempre (ver la duda «sin `prefijo` en WORKSPACE.json»). Lo que
// fijan estos dos tests no es el color sino que la máquina CUENTA y no es «de otro
// server», y que el vigilante se reconoce. Por eso se mira el informe, no el titular.
const CUENTA = /1 máquina\(s\) alquilada\(s\) en Vast/;
const HUERFANA = /NINGÚN proceso que las recoja/;

test('una máquina `expc-*` cuenta aunque haya un workspace con OTRO prefijo', async () => {
  const salida = await correr(maquina({ etiqueta: 'expc-bork-k09', wsPrefijo: 't2-' }));
  assert.doesNotMatch(salida, /🟢/,
    'la flota de experimentos es de casa: leerla como «de otro server» es el falso verde');
  assert.match(salida, CUENTA);
  assert.doesNotMatch(salida, /de otro server, no cuentan/);
});

test('con su `trabajo` vivo NO sale «SIN VIGILANTE»; sin él, sí', async () => {
  const m = maquina({ etiqueta: 'expc-bork-k09' });
  const sola = await correr(m);
  assert.match(sola, HUERFANA, 'una máquina sin nadie que la recoja tiene que gritar');
  const hijo = await trabajoVivo(m);
  try {
    const vigilada = await correr(m);
    assert.match(vigilada, CUENTA);
    assert.doesNotMatch(vigilada, HUERFANA,
      'el modo trabajo destruye en su finally: es un vigilante');
  } finally { hijo.kill('SIGKILL'); }
});
