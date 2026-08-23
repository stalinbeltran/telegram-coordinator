// Los secretos de un proceso DESACOPLADO salen de disco, y son DOS ficheros.
//
// Esto se prueba en procesos hijo y no importando el módulo, porque `COORD_HOME`
// se resuelve al importar: dentro de un mismo proceso no se puede cambiar, que
// es justo lo que hay que variar aquí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULO = fileURLToPath(new URL('../scripts/cargar-secretos.mjs', import.meta.url));

/** Corre el cargador en un hijo con el entorno dado y devuelve lo que ve. */
function cargarEn(env) {
  const guion = `
    const { cargarSecretos } = await import(${JSON.stringify(MODULO)});
    const cargados = cargarSecretos();
    process.stdout.write(JSON.stringify({
      cargados,
      DEL_ENV: process.env.DEL_ENV ?? null,
      DEL_SECRETOS: process.env.DEL_SECRETOS ?? null,
      REPETIDA: process.env.REPETIDA ?? null,
    }));
  `;
  return new Promise((res) => {
    const hijo = spawn(process.execPath, ['--input-type=module', '-e', guion], {
      env: { PATH: process.env.PATH, ...env },
    });
    let out = '';
    let err = '';
    hijo.stdout.on('data', (d) => (out += d));
    hijo.stderr.on('data', (d) => (err += d));
    hijo.on('close', (code) => res({ code, err, ...JSON.parse(out || '{}') }));
  });
}

async function montar() {
  const raiz = await mkdtemp(join(tmpdir(), 'coord-secretos-'));
  const coord = join(raiz, 'coord');
  const home = join(raiz, 'home');
  await mkdir(coord, { recursive: true });
  await mkdir(join(home, '.config'), { recursive: true });
  return { raiz, coord, home, env: { COORD_HOME: coord, HOME: home } };
}

test('carga los DOS ficheros: el .env del servicio y los secretos de máquina', async () => {
  const { raiz, coord, home, env } = await montar();
  try {
    await writeFile(join(coord, '.env'), 'DEL_ENV=si\n');
    // Los de máquina llevan `export`, como los escribe provision.
    await writeFile(join(home, '.config', 'dev-secrets.env'), 'export DEL_SECRETOS=si\n');
    const r = await cargarEn(env);
    assert.equal(r.DEL_ENV, 'si');
    assert.equal(r.DEL_SECRETOS, 'si', 'dev-secrets.env es el que se olvidaba');
    assert.equal(r.cargados.length, 2);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('lo heredado del entorno gana: cargar no pisa nada', async () => {
  const { raiz, coord, home, env } = await montar();
  try {
    await writeFile(join(coord, '.env'), 'REPETIDA=del-fichero\n');
    const r = await cargarEn({ ...env, REPETIDA: 'del-entorno' });
    assert.equal(r.REPETIDA, 'del-entorno');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('sin ninguno de los dos ficheros no falla', async () => {
  const { raiz, env } = await montar();
  try {
    const r = await cargarEn(env);
    assert.equal(r.code, 0);
    assert.deepEqual(r.cargados, []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('un fichero ilegible avisa y NO impide cargar el otro', async () => {
  const { raiz, coord, home, env } = await montar();
  try {
    // Un directorio donde se espera un fichero: loadEnvFile lanza.
    await mkdir(join(coord, '.env'), { recursive: true });
    await writeFile(join(home, '.config', 'dev-secrets.env'), 'export DEL_SECRETOS=si\n');
    const r = await cargarEn(env);
    assert.equal(r.code, 0);
    assert.equal(r.DEL_SECRETOS, 'si', 'el token tiene que llegar aunque el otro fichero falle');
    assert.match(r.err, /\[secretos\]/, 'y el fallo se dice, no se traga');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('COORD_HOME manda sobre la raíz deducida del propio fichero', async () => {
  const { raiz, coord, env } = await montar();
  try {
    await writeFile(join(coord, '.env'), 'DEL_ENV=del-coord-home\n');
    const r = await cargarEn(env);
    assert.equal(r.DEL_ENV, 'del-coord-home');
    assert.ok(r.cargados[0].startsWith(coord));
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('la pista de login dice qué mirar y no filtra el token', async () => {
  const guion = `
    const m = await import(${JSON.stringify(MODULO)});
    process.stdout.write(JSON.stringify({
      detecta: m.pareceFalloDeLogin('Not logged in \\u00b7 Please run /login'),
      noDetecta: m.pareceFalloDeLogin('ENOENT: no such file'),
      pista: m.pistaDeLogin(),
    }));
  `;
  const r = await new Promise((res) => {
    const hijo = spawn(process.execPath, ['--input-type=module', '-e', guion], {
      env: { PATH: process.env.PATH, HOME: '/nonexistent', CLAUDE_CODE_OAUTH_TOKEN: 'secreto-123' },
    });
    let out = '';
    hijo.stdout.on('data', (d) => (out += d));
    hijo.on('close', () => res(JSON.parse(out || '{}')));
  });
  assert.equal(r.detecta, true);
  assert.equal(r.noDetecta, false);
  assert.ok(!r.pista.includes('secreto-123'), 'la pista NUNCA puede llevar el valor del token');
  assert.match(r.pista, /presente/);
});
