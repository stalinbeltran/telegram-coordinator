// El registry con varias fuentes: descubrir ejecutores donde están, en vez de
// que se los copien. Lo que se fija aquí es lo que puede romper en silencio:
// el orden de prioridad, las colisiones, el cwd heredado de cada repo y que un
// repo ajeno con un JSON roto no deje al bot sin ejecutores.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config.ts lee DATA_DIR al importarse, así que hay que ponerlo ANTES.
const raiz = await mkdtemp(join(tmpdir(), 'coord-registry-'));
process.env.BOT_TOKEN = 'test-token';
process.env.DATA_DIR = join(raiz, 'casa', 'data');

const repos = join(raiz, 'repos');
const repoA = join(repos, 'repo-a');
const repoB = join(repos, 'repo-b');

const escribir = async (dir, nombre, obj) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, nombre), JSON.stringify(obj, null, 2));
};

before(async () => {
  // Fuente 0 (implícita y siempre primera): DATA_DIR.
  await escribir(join(process.env.DATA_DIR, 'executors'), 'shell.json', {
    name: 'shell',
    command: 'node scripts/shell-cwd.mjs',
    encargados: ['echo'],
  });
  await escribir(join(process.env.DATA_DIR, 'executors'), 'comun.json', {
    name: 'comun',
    command: 'echo de-casa',
    encargados: [],
  });
  await escribir(join(process.env.DATA_DIR, 'encargados'), 'echo.json', {
    name: 'echo',
    command: 'cat',
  });

  // repo-a: aporta uno propio y otro que choca con el de casa.
  await escribir(join(repoA, 'telegram', 'executors'), 'a.json', {
    name: 'a',
    descripcion: 'el de repo-a',
    ejemplos: ['x'],
    command: 'echo a',
    encargados: [],
  });
  await escribir(join(repoA, 'telegram', 'executors'), 'comun.json', {
    name: 'comun',
    command: 'echo de-repo-a',
    encargados: [],
  });

  // repo-b: uno con cwd explícito, un JSON roto y uno sin `name`.
  await escribir(join(repoB, 'telegram', 'executors'), 'b.json', {
    name: 'b',
    command: 'echo b',
    encargados: [],
    cwd: 'scripts',
  });
  await mkdir(join(repoB, 'scripts'), { recursive: true });
  await writeFile(join(repoB, 'telegram', 'executors', 'roto.json'), '{ esto no es json');
  await escribir(join(repoB, 'telegram', 'executors'), 'sin-nombre.json', { command: 'echo x' });
  await escribir(join(repoB, 'telegram', 'encargados'), 'propio.json', {
    name: 'propio',
    command: 'cat',
  });

  // Un repo sin telegram/ no debe estorbar.
  await mkdir(join(repos, 'repo-sin-telegram', 'scripts'), { recursive: true });

  process.env.COORD_FUENTES = join(repos, '*', 'telegram');
});

after(async () => {
  await rm(raiz, { recursive: true, force: true });
});

const reg = () => import('../src/registry.js');

test('las fuentes van en orden: DATA_DIR primero, luego el glob alfabético', async () => {
  const { fuentes } = await reg();
  const dirs = (await fuentes()).map((f) => f.dir);
  assert.deepEqual(dirs, [
    process.env.DATA_DIR,
    join(repoA, 'telegram'),
    join(repoB, 'telegram'),
  ]);
});

test('un repo sin telegram/ no aparece como fuente', async () => {
  const { fuentes } = await reg();
  const dirs = (await fuentes()).map((f) => f.dir);
  assert.ok(!dirs.some((d) => d.includes('repo-sin-telegram')));
});

test('se descubren los ejecutores de todos los repos', async () => {
  const { listExecutors } = await reg();
  const nombres = (await listExecutors()).map((e) => e.name).sort();
  assert.deepEqual(nombres, ['a', 'b', 'comun', 'shell']);
});

test('ante una colisión gana DATA_DIR, y la pisada queda anotada', async () => {
  const { getExecutor } = await reg();
  const comun = await getExecutor('comun');
  assert.equal(comun.command, 'echo de-casa');
  assert.deepEqual(comun.origen.pisados, [join(repoA, 'telegram', 'executors', 'comun.json')]);
});

test('el cwd por defecto es la raíz del repo que declara el ejecutor', async () => {
  const { getExecutor } = await reg();
  const { COORD_HOME } = await import('../src/config.js');
  assert.equal((await getExecutor('a')).cwd, repoA);
  // Los de casa siguen corriendo en la raíz del coordinador, que es donde
  // corría TODO antes: es lo que hace que la migración no cambie nada.
  assert.equal((await getExecutor('shell')).cwd, COORD_HOME);
});

test('un cwd declarado se resuelve contra la raíz de su fuente', async () => {
  const { getExecutor } = await reg();
  assert.equal((await getExecutor('b')).cwd, join(repoB, 'scripts'));
});

test('un JSON roto o sin name se salta, y no tumba la lista', async () => {
  const { listExecutors } = await reg();
  const nombres = (await listExecutors()).map((e) => e.name);
  assert.ok(nombres.includes('b'), 'el vecino del JSON roto debe cargarse igual');
  assert.ok(!nombres.includes(undefined));
});

test('los encargados se descubren igual que los ejecutores', async () => {
  const { getEncargado, listEncargados } = await reg();
  assert.equal((await listEncargados()).length, 2);
  assert.equal((await getEncargado('propio')).cwd, repoB);
});

test('descripcion y ejemplos llegan tal cual del JSON', async () => {
  const { getExecutor, repoDe } = await reg();
  const a = await getExecutor('a');
  assert.equal(a.descripcion, 'el de repo-a');
  assert.deepEqual(a.ejemplos, ['x']);
  assert.equal(repoDe(a), 'repo-a');
});

test('sin fuentes extra, el comportamiento es el de siempre: sólo DATA_DIR', async () => {
  const previo = process.env.COORD_FUENTES;
  process.env.COORD_FUENTES = ' ';
  try {
    const { fuentes, listExecutors } = await reg();
    assert.deepEqual((await fuentes()).map((f) => f.dir), [process.env.DATA_DIR]);
    assert.deepEqual((await listExecutors()).map((e) => e.name).sort(), ['comun', 'shell']);
  } finally {
    process.env.COORD_FUENTES = previo;
  }
});
