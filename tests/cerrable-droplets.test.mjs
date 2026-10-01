// Tests del freno para los droplets de DigitalOcean.
//
// Por qué existe
// --------------
// Hasta el 2026-10-01 `cerrable.mjs` miraba las máquinas de Vast y ni una línea
// de DigitalOcean. Medido ese día: con `prueba-almacen` —lanzado DESDE el dev
// para probar el almacén— vivo y facturando, `--breve` dijo «🟢 CERRABLE — nada
// alquilado». Destruir el dev en ese momento dejaba el hijo vivo, con el llavero
// entero dentro, hasta que alguien corriera `apagar-do`.
//
// El contrato con el lanzador es `do_droplet.py list --json` (hechos crudos) y el
// tag `atendida`, que pone `launch` cuando la máquina corre DE VERDAD un servicio
// que da mando propio. Su otra mitad la fija `tests/test_atendida.py` del
// lanzador.
//
// Lo que fijan estos tests, que es lo que puede volver a romperse:
//   1. un droplet suelto → NO CERRAR, y se dice CUÁL, cuánto cuesta y cómo se
//      apaga (por nombre: el tag `ephemeral` lo lleva también el dev);
//   2. un `bench-control` vivo cuenta: no trae bot, nadie lo atiende;
//   3. un droplet APAGADO cuenta: DigitalOcean lo factura igual;
//   4. un precio que falta no se lee como 0;
//   5. esta máquina y el mini no cuentan;
//   6. desde el MINI, el dev (`atendida`) no cuenta: si no, 🔴 permanente;
//   7. yo me reconozco por ID, aunque me falte `atendida` (el dev de hoy nació
//      antes de que existiera el tag);
//   8-10. si no se puede preguntar —API caída, respuesta rara, o una nube que
//      este freno no sabe mirar— NO SÉ, nunca «cerrable».
// Medido el 2026-10-01 contra el freno anterior: fallan OCHO, todos menos el 6
// y el 7 —el 5 también, porque aquél no decía «miré DigitalOcean y no hay»—. El
// 6 y el 7 fijan que el freno nuevo no estorbe, que es el riesgo de meter uno.
//
// Cada test construye su máquina de mentira, como `cerrable-webapp.test.mjs`: si
// no, mediría el estado sucio de ESTA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFile } from 'node:child_process';
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

/** Un droplet como lo cuenta `do_droplet.py list --json`. */
let siguienteId = 605000000;
const droplet = (name, { tags = ['ephemeral'], status = 'active', precio = 0.03571, min = 7 } = {}) => ({
  id: ++siguienteId, name, status, tags, size_slug: 's-2vcpu-4gb',
  price_hourly: precio, created_at: new Date(Date.now() - min * 60000).toISOString(),
  ip: '203.0.113.7',
});

const DEV = droplet('dev', { tags: ['ephemeral', 'atendida'], min: 30 });
const MINI = droplet('mini', { tags: ['control', 'atendida'], precio: 0.00595, min: 200 });

const NUBES = 'print("DigitalOcean\\nVast.ai")\n';

/**
 * Una máquina de mentira con el coordinador y un lanzador de pega cuyo
 * `do_droplet.py` contesta lo que diga `doDroplet` (código Python).
 */
function maquina(doDroplet, estadoNubes = NUBES) {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-do-'));
  const casa = join(raiz, 'src');
  mkdirSync(casa, { recursive: true });
  // Un `.` sobre un fichero que no existe aborta el `sh -c` entero (ver webapp).
  mkdirSync(join(raiz, '.config'), { recursive: true });
  writeFileSync(join(raiz, '.config', 'dev-secrets.env'), '');

  const scripts = {};
  for (const f of ['cerrable.mjs', 'workspaces-locales.mjs', 'git-pendiente.mjs', 'codigo-vivo.mjs']) {
    scripts[join('scripts', f)] = readFileSync(join(RAIZ, 'scripts', f), 'utf8');
  }
  const coord = repo(casa, 'telegram-coordinator', {
    ...scripts, 'data/fuentes.json': '{"fuentes":[]}\n',
  });
  repo(casa, 'digital-ocean-dropplet-auto-launching', {
    'scripts/vast_instance.py': 'print("No hay ninguna instancia viva")\n',
    'scripts/estado_nubes.py': estadoNubes,
    'scripts/do_droplet.py': doDroplet,
  });
  return { raiz, coord };
}

/** Un `do_droplet.py` de pega que imprime esta cuenta. */
const cuenta = (...droplets) =>
  `import sys\nsys.stdout.write(${JSON.stringify(JSON.stringify(droplets))})\n`;

/** `yo` es el droplet que hace de esta máquina: su ID, como lo da la API de metadatos. */
async function correr(m, yo, ...extra) {
  const base = { ...process.env };
  delete base.COORD_WS;
  const { stdout } = await ejecutar(
    'node', [join(m.coord, 'scripts', 'cerrable.mjs'), '--exit0', ...extra],
    { cwd: m.coord, encoding: 'utf8',
      env: { ...base, HOME: m.raiz, COORD_HOME: m.coord,
             // quién soy lo fija el test: los metadatos de ESTA máquina no
             // pueden decidir el veredicto
             CERRABLE_DROPLET_ID: yo ? String(yo.id) : '',
             FV_WEB_PORT: '1', FV_WEB_UNIT: 'no-existe-este-servicio.test' } });
  return stdout;
}

test('un droplet suelto lanzado desde aquí impide cerrar, y se dice cuál', async () => {
  const m = maquina(cuenta(DEV, MINI, droplet('prueba-almacen')));
  const breve = await correr(m, DEV, '--breve');
  assert.match(breve, /NO CERRAR/,
    'si el dev muere, el hijo sigue facturando sin nadie que lo apague');
  assert.match(breve, /prueba-almacen/, 'tiene que decir QUÉ droplet, no sólo que hay uno');
  assert.match(breve, /0\.0357 \$\/h/, 'y cuánto cuesta tenerlo así');
  const largo = await correr(m, DEV);
  assert.match(largo, /do_droplet\.py destroy prueba-almacen --yes/,
    'el informe da el comando que lo apaga, por NOMBRE');
  assert.doesNotMatch(largo, /destroy --tag/,
    'nunca por tag: `ephemeral` lo lleva también el propio dev');
});

test('un bench-control vivo cuenta: no trae bot, nadie lo atiende', async () => {
  const breve = await correr(maquina(cuenta(DEV, MINI, droplet('bench-control'))), DEV, '--breve');
  assert.match(breve, /NO CERRAR/);
  assert.match(breve, /bench-control/);
});

test('un droplet APAGADO también cuenta: DigitalOcean lo factura igual', async () => {
  const m = maquina(cuenta(DEV, MINI, droplet('apagado', { status: 'off' })));
  const breve = await correr(m, DEV, '--breve');
  assert.match(breve, /NO CERRAR/);
  assert.match(breve, /apagado/);
});

test('un precio que falta no se lee como cero', async () => {
  const m = maquina(cuenta(DEV, MINI, droplet('sin-precio', { precio: null })));
  const breve = await correr(m, DEV, '--breve');
  assert.match(breve, /NO CERRAR/);
  assert.match(breve, /\+\? \$\/h/, 'tiene que decir que falta, no sumar un 0');
});

test('sólo esta máquina y el mini: no estorba', async () => {
  const salida = await correr(maquina(cuenta(DEV, MINI)), DEV);
  assert.match(salida, /CERRABLE/, 'ni yo ni el mini (control) son droplets sueltos');
  assert.match(salida, /DigitalOcean: ningún droplet suelto/,
    '«miré y no hay» se dice: no puede leerse como «no lo miré»');
});

test('desde el MINI, el dev no cuenta: se atiende solo', async () => {
  const salida = await correr(maquina(cuenta(MINI, DEV)), MINI);
  assert.match(salida, /CERRABLE/,
    'el dev trae su propio bot: contarlo dejaría el freno del mini en 🔴 para siempre');
});

test('yo me reconozco por ID aunque me falte `atendida`', async () => {
  // El dev vivo el 2026-10-01 nació antes de que existiera el tag.
  const viejo = droplet('dev', { tags: ['ephemeral'] });
  const salida = await correr(maquina(cuenta(viejo, MINI)), viejo);
  assert.match(salida, /CERRABLE/, 'una máquina no puede ser «suelta» para sí misma');
});

test('si no se puede preguntar a DigitalOcean, NO SÉ — nunca «cerrable»', async () => {
  const m = maquina('import sys\nsys.stderr.write("Falta el token\\n")\nsys.exit(1)\n');
  const salida = await correr(m, DEV, '--breve');
  assert.match(salida, /NO SÉ/);
  assert.match(salida, /do_droplet\.py list --json/, 'y dice qué no pudo comprobar');
});

test('una respuesta que no es JSON también es NO SÉ', async () => {
  const salida = await correr(maquina('print("No hay droplets.")\n'), DEV, '--breve');
  assert.match(salida, /NO SÉ/,
    'un formato que no se entiende no puede leerse como «no hay nada»');
});

test('una nube que este freno no sabe mirar es NO SÉ, no silencio', async () => {
  const m = maquina(cuenta(DEV, MINI), 'print("DigitalOcean\\nVast.ai\\nHetzner")\n');
  const salida = await correr(m, DEV, '--breve');
  assert.match(salida, /NO SÉ/,
    'el freno sabía de una sola nube y por eso no vio la otra: la tercera no puede repetirlo');
  assert.match(salida, /Hetzner/);
});
