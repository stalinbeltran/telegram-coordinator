// Tests de `repetir`: la frase que se le escribe a `c` sola, cada N vueltas.
//
// El esfuerzo va donde duele (R10). Lo que puede costar dinero aquí son DOS
// cosas, y las dos tienen test propio:
//   1. los TOPES (20 vueltas / 10 h): sin ellos, un bot con bypassPermissions
//      escribe para siempre y cada vuelta puede alquilar máquinas;
//   2. que `off` PARE de verdad, incluso si `systemctl stop` no puede correr.
//
// ⚠ EL ARNÉS FIJA `DATA_DIR` A UN DIRECTORIO VACÍO, y es una barrera de
// seguridad, no comodidad: sin ella un test alcanzaría el `data/` real, sacaría
// de ahí el chat del dueño (vía `destino-telegram.mjs`, que `notify.mjs` usa
// como respaldo) e intentaría mandarle mensajes. Un test no puede poder hacer eso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESION = 'test_1';

/** Un cwd de mentira con los módulos reales y los peligrosos falsificados. */
function prepararCwd({ claude, notify } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'repetir-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'data', 'repeticiones'), { recursive: true });
  mkdirSync(join(dir, 'data', 'claude-sessions'), { recursive: true });
  // ⚠ Esta lista es DECLARADA, así que hay que mantenerla: un `import` nuevo en
  // cualquiera de estos scripts hace que el arnés falle con MODULE_NOT_FOUND y el
  // test mide su propio montaje en vez de la regla. Pasó el 2026-09-09 al añadir
  // `mensajes.mjs` — los cuatro tests del motor se pusieron en rojo de golpe. Es
  // el mismo patrón que el fallo de `cwdEnWorkspace` («el repo estaba clonado; lo
  // que faltaba era el FICHERO»), aquí dentro.
  for (const f of ['repetir.mjs', 'repetir-bucle.mjs', 'repetir-estado.mjs',
                   'cargar-secretos.mjs', 'errores.mjs',
                   'mensajes.mjs', 'redactar.mjs']) {
    copyFileSync(join(ROOT, 'scripts', f), join(dir, 'scripts', f));
  }
  // `notify.mjs` de mentira: escribe lo que le mandan en avisos.txt. Sin esto un
  // test podría mandar un mensaje de verdad.
  writeFileSync(join(dir, 'scripts', 'notify.mjs'), notify ?? `
    import { appendFileSync } from 'node:fs';
    let s=''; process.stdin.setEncoding('utf8');
    process.stdin.on('data',d=>s+=d).on('end',()=>{ appendFileSync('avisos.txt', s+'\\n---\\n'); process.exit(0); });
  `);
  if (claude) writeFileSync(join(dir, 'scripts', 'claude-falso.mjs'), claude);
  return dir;
}

function correrEjecutor(dir, entrada, extraEnv = {}) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'repetir.mjs'), '--con', 'true'], {
    cwd: dir, input: entrada, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: dir, COORD_SESSION: SESION,
           DATA_DIR: join(dir, 'data'), ...extraEnv },
  });
  return (r.stdout || '') + (r.stderr || '');
}

const estadoDe = (dir) => {
  const f = join(dir, 'data', 'repeticiones', SESION + '.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

// ------------------------------------------------------------------ los topes
test('el tope de vueltas rechaza, y dice cuántas son el máximo', () => {
  const dir = prepararCwd();
  const out = correrEjecutor(dir, 'cada 10m x21 lo que sea');
  assert.match(out, /20 vueltas como máximo/);
  assert.match(out, /pediste 21/);
  assert.equal(estadoDe(dir), null, 'no puede quedar nada armado');
});

test('el tope de 10 h rechaza aunque las vueltas quepan, y dice cuántas caben', () => {
  const dir = prepararCwd();
  // 20 vueltas están dentro del tope de vueltas; 20 x 1 h = 20 h no lo está.
  const out = correrEjecutor(dir, 'cada 1h x20 lo que sea');
  assert.match(out, /10 h como máximo/);
  assert.match(out, /caben 10 vueltas/, 'tiene que decir qué SÍ cabe, no sólo que no');
  assert.equal(estadoDe(dir), null);
});

test('manda el tope que se alcanza PRIMERO: 20 x 30m sí entra, 20 x 1h no', () => {
  const dir = prepararCwd();
  assert.doesNotMatch(correrEjecutor(dir, 'seco 30m x20 x'), /Tope/);   // 10 h justas
  assert.match(correrEjecutor(dir, 'seco 31m x20 x'), /Tope/);          // 10 h y pico
});

test('la cadencia mínima protege del martilleo', () => {
  const dir = prepararCwd();
  assert.match(correrEjecutor(dir, 'cada 30s x5 x'), /Cadencia mínima/);
});

// -------------------------------------------------------------------- el seco
test('`seco` enseña el plan y NO arranca ni deja estado', () => {
  const dir = prepararCwd();
  const out = correrEjecutor(dir, 'seco 30m x8 revisa el barrido');
  assert.match(out, /SECO/);
  assert.match(out, /no he llamado a claude/i);
  assert.match(out, /revisa el barrido/);
  assert.match(out, /Disparos:.*·.*·/, 'tiene que listar las horas de los disparos');
  assert.equal(estadoDe(dir), null, '`seco` no puede dejar nada armado');
});

// ---------------------------------------------------------------------- `off`
test('`off` borra el estado aunque no haya unidad que parar', () => {
  const dir = prepararCwd();
  writeFileSync(join(dir, 'data', 'repeticiones', SESION + '.json'),
    JSON.stringify({ sesion: SESION, frase: 'x', cadenciaMs: 60000, vueltas: 8, hechas: 3, unidad: 'no-existe-jamas' }));
  const out = correrEjecutor(dir, 'off');
  assert.match(out, /vuelta 3 de 8/, 'dice dónde se cortó');
  assert.equal(estadoDe(dir), null, 'el estado tiene que quedar borrado');
});

test('`ver` sin nada armado no inventa que hay algo', () => {
  const dir = prepararCwd();
  assert.match(correrEjecutor(dir, 'ver'), /Nada armado/);
});

// ------------------------------------------------------- el motor (repetir-bucle)
function correrBucle(dir, env = {}) {
  return new Promise((res) => {
    const c = spawn(process.execPath, [join(dir, 'scripts', 'repetir-bucle.mjs'),
                                       '--con', `${process.execPath} scripts/claude-falso.mjs`], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, COORD_SESSION: SESION,
             DATA_DIR: join(dir, 'data'), REPETIR_TROZO_MS: '20', ...env },
    });
    let err = '';
    c.stderr.on('data', (d) => (err += d.toString()));
    c.on('close', (code) => res({ code, err }));
  });
}

function armar(dir, extra = {}) {
  writeFileSync(join(dir, 'data', 'repeticiones', SESION + '.json'), JSON.stringify({
    sesion: SESION, frase: 'sigue', cadenciaMs: 100, vueltas: 2, hechas: 0,
    saltadas: 0, fallos: 0, arrancado: new Date().toISOString(),
    unidad: 'no-existe-jamas', marcaMarker: 0, ...extra,
  }));
}

const avisos = (dir) => (existsSync(join(dir, 'avisos.txt')) ? readFileSync(join(dir, 'avisos.txt'), 'utf8') : '');

test('el motor da las vueltas pedidas, avisa de cada una y se borra al terminar', async () => {
  const dir = prepararCwd({ claude: 'process.stdout.write("respuesta de claude");' });
  armar(dir);
  const { code } = await correrBucle(dir);
  assert.equal(code, 0);
  const a = avisos(dir);
  assert.match(a, /vuelta 1\/2/);
  assert.match(a, /vuelta 2\/2/);
  assert.match(a, /respuesta de claude/);
  assert.match(a, /Repetición terminada/);
  assert.equal(estadoDe(dir), null, 'al terminar no queda estado que confunda a `ver`');
});

test('el motor PARA si el estado desaparece durante la espera (eso es `off`)', async () => {
  const dir = prepararCwd({ claude: 'process.stdout.write("no deberia llegar aqui");' });
  armar(dir, { cadenciaMs: 3000 });
  const p = correrBucle(dir);
  await new Promise((r) => setTimeout(r, 300));
  spawnSync('rm', [join(dir, 'data', 'repeticiones', SESION + '.json')]);
  const { code } = await p;
  assert.equal(code, 0);
  assert.doesNotMatch(avisos(dir), /no deberia llegar aqui/, 'no puede escribir tras un off');
});

test('una vuelta se SALTA si el tema tuvo actividad ajena hace nada', async () => {
  const dir = prepararCwd({ claude: 'process.stdout.write("escribio igual");' });
  // Marker recién tocado y una marca distinta a la nuestra = alguien habló.
  writeFileSync(join(dir, 'data', 'claude-sessions', SESION + '.json'),
    JSON.stringify({ session: SESION, uuid: 'uuid-que-nadie-corre-jamas-0000' }));
  armar(dir, { vueltas: 1, marcaMarker: 1 });
  await correrBucle(dir);
  const a = avisos(dir);
  assert.match(a, /saltada/, 'tiene que decir que la saltó, no callarse');
  assert.doesNotMatch(a, /escribio igual/, 'no puede haber un segundo claude en el mismo hilo');
});

test('tres fallos seguidos paran la repetición en vez de insistir 20 veces', async () => {
  const dir = prepararCwd({ claude: 'process.stderr.write("claude roto"); process.exit(1);' });
  armar(dir, { vueltas: 10 });
  await correrBucle(dir);
  const a = avisos(dir);
  assert.match(a, /3\/3/);
  assert.match(a, /Paro/);
  assert.equal(estadoDe(dir), null);
});
