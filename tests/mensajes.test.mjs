// Tests del LOG DE MENSAJES (scripts/mensajes.mjs).
//
// Por qué estos casos y no otros (R10: el esfuerzo se reparte por consecuencia
// del fallo, no por facilidad de prueba). Ordenados por lo que cuesta cada uno:
//
//   1. QUE NO LANCE. Si `publicar()` lanza, un fallo de escritura se convierte en
//      una caída del coordinador — la regla 3 de su CLAUDE.md al revés. Es el
//      único fallo de este módulo que rompe algo que hoy funciona.
//   2. QUE ESCRIBA DONDE TOCA. Un fallback relativo al cwd parte el log en dos
//      —el del árbol de casa y el de la copia del workspace— SIN un solo error.
//      Es la forma exacta del fallo de `notify.mjs` con `.env` del 2026-09-04,
//      que fue intermitente durante días porque dependía de qué ejecutor lanzaras.
//   3. QUE REDACTE. Aquí ya se filtró un token una vez por esta misma vía.
//   4. LA FORMA DE LA LÍNEA, que es el contrato con el lector: vive en otro repo,
//      así que un cambio de forma aquí se descubre allí.
//
// ⚠ El arnés fija `DATA_DIR` a un directorio temporal SIEMPRE. No es comodidad:
// sin eso, un test escribiría en el `data/` real del coordinador, mezclando
// mensajes inventados con la conversación de verdad del dueño.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const nuevoDir = () => mkdtempSync(join(tmpdir(), 'coord-msg-'));

/** Importa el módulo con `DATA_DIR` puesto ANTES de la primera llamada. */
async function mod(dataDir) {
  process.env.DATA_DIR = dataDir;
  return import('../scripts/mensajes.mjs');
}

/** Las líneas del log de una sesión, ya parseadas. */
function lineas(dataDir, sesion = '-100_7') {
  const f = join(dataDir, 'mensajes', `${sesion.replace(/[^\w.-]/g, '_')}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Corre un trozo de código en OTRO proceso, con su propio entorno. Hace falta
 *  para lo que se decide al importar (`COORD_HOME`), que no se puede cambiar
 *  dos veces en el mismo proceso. */
function enProcesoAparte(codigo, env) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', codigo],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

// ------------------------------------------- 1. lo que rompería el coordinador

test('publicar() NUNCA lanza, ni con el directorio sin permisos de escritura', async () => {
  const dir = nuevoDir();
  const { publicar } = await mod(dir);
  mkdirSync(join(dir, 'mensajes'), { recursive: true });
  chmodSync(join(dir, 'mensajes'), 0o500);          // lectura y listado, sin escritura
  try {
    let r;
    assert.doesNotThrow(() => {
      r = publicar({ sesion: '-100_7', autor: 'claude', origen: 'telegram', texto: 'algo' });
    }, 'si esto lanza, un fallo de disco tumba el bot');
    assert.equal(r, null, 'y devuelve null, para que quien llame pueda notarlo si quiere');
  } finally {
    chmodSync(join(dir, 'mensajes'), 0o700);        // que el tmp se pueda limpiar
  }
});

test('un autor o un origen desconocidos se RECHAZAN, no se guardan', async () => {
  const dir = nuevoDir();
  const { publicar } = await mod(dir);
  assert.equal(publicar({ sesion: '-100_7', autor: 'jefe', origen: 'telegram', texto: 'x' }), null);
  assert.equal(publicar({ sesion: '-100_7', autor: 'claude', origen: 'paloma', texto: 'x' }), null);
  assert.deepEqual(lineas(dir), [],
    'si entraran, el lector tendría que mostrar categorías que nadie diseñó');
});

// ------------------------------------- 2. el fallo silencioso: el log partido

test('DATA_DIR manda, aunque el comando corra en el árbol de un workspace', () => {
  const datos = nuevoDir();
  const ws = nuevoDir();
  const salida = enProcesoAparte(
    `const m = await import('${RAIZ}/scripts/mensajes.mjs');
     m.publicar({sesion:'-100_7', autor:'usuario', origen:'web', texto:'hola'});
     console.log(m.rutaLog('-100_7'));`,
    { DATA_DIR: datos, COORD_WS: ws, COORD_HOME: ws },
  );
  assert.ok(salida.startsWith(datos),
    `el log tiene que ir a DATA_DIR (${datos}) y no al árbol del workspace: ${salida}`);
  assert.equal(lineas(datos).length, 1);
});

test('sin DATA_DIR cae al data/ de COORD_HOME, NUNCA a "data" relativo al cwd', () => {
  const casa = nuevoDir();
  const env = { COORD_HOME: casa };
  delete env.DATA_DIR;
  const salida = execFileSync(process.execPath,
    ['--input-type=module', '-e',
     `const m = await import('${RAIZ}/scripts/mensajes.mjs'); console.log(m.raizDatos());`],
    // el cwd es OTRO sitio a propósito: si el fallback fuera relativo, saldría de aquí
    { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, ...env, DATA_DIR: '' } }).trim();
  assert.equal(salida, join(casa, 'data'),
    'con el fallback relativo, un tema atado a un workspace escribiría en la copia ' +
    'y el log quedaría partido en dos sin dar ningún error');
});

// -------------------------------------------------------------- 3. la puerta

test('un secreto con forma conocida se REDACTA antes de tocar el disco', async () => {
  const dir = nuevoDir();
  const { publicar } = await mod(dir);
  const falso = 'ghp_' + 'a1b2c3d4e5'.repeat(3) + 'xy';        // forma de token de GitHub
  publicar({ sesion: '-100_7', autor: 'claude', origen: 'telegram', texto: `toma: ${falso}` });
  const crudo = readFileSync(join(dir, 'mensajes', '-100_7.jsonl'), 'utf8');
  assert.doesNotMatch(crudo, /ghp_a1b2/, 'el token no puede llegar al disco');
  assert.match(crudo, /REDACTADO:TOKEN-GITHUB/, 'y tiene que decir que se redactó, no callarlo');
});

// ------------------------------------------------- 4. el contrato con el lector

test('la línea tiene EXACTAMENTE los campos del contrato', async () => {
  const dir = nuevoDir();
  const { publicar } = await mod(dir);
  publicar({ sesion: '-100_7', autor: 'usuario', origen: 'telegram', texto: 'hola' });
  const [l] = lineas(dir);
  assert.deepEqual(Object.keys(l).sort(), ['autor', 'id', 'origen', 'sesion', 'texto', 'ts']);
  assert.equal(l.autor, 'usuario');
  assert.equal(l.origen, 'telegram');
  assert.equal(l.sesion, '-100_7');
  assert.equal(l.texto, 'hola');
  assert.match(l.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, 'ts en UTC y sin milisegundos');
});

// ⚠ El `timeout` no es adorno: la primera versión de `nuevoId` reintentaba al
// azar hasta superar el id anterior, y con el reloj parado eso NO TERMINA. Sin
// tope, este test no fallaba: colgaba el proceso entero, que es peor que fallar
// porque no dice qué pasa. Con tope, el fallo se lee en una línea.
test('los ids ORDENAN aunque el reloj no avance: `?desde=` pagina con ellos',
  { timeout: 15_000 }, async () => {
    const { nuevoId } = await mod(nuevoDir());
    const ids = Array.from({ length: 200 }, () => nuevoId(1_757_000_000_000));  // el MISMO ms
    assert.equal(new Set(ids).size, ids.length, 'no puede haber dos iguales');
    assert.deepEqual(ids, [...ids].sort(), 'y tienen que salir ya ordenados');
  });

test('y siguen ordenando cuando el contador del milisegundo se DESBORDA',
  { timeout: 30_000 }, async () => {
    const { nuevoId } = await mod(nuevoDir());
    // 50.000 > 46.655, que es lo que caben en los 3 caracteres del contador: a
    // partir de ahí se pide prestado el ms siguiente. Si alguien estrecha ese
    // campo, el orden se rompe justo aquí y no en el caso normal.
    const ids = Array.from({ length: 50_000 }, () => nuevoId(1_757_000_000_000));
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, [...ids].sort(),
      'al desbordar hay que subir el milisegundo, nunca dar la vuelta al contador');
  });

test('una respuesta larga se recorta Y LO DICE dentro del propio texto', async () => {
  const dir = nuevoDir();
  const { publicar, TOPE_TEXTO } = await mod(dir);
  publicar({ sesion: '-100_7', autor: 'claude', origen: 'telegram', texto: 'x'.repeat(TOPE_TEXTO + 5000) });
  const [l] = lineas(dir);
  assert.ok(l.texto.length < TOPE_TEXTO + 200, 'tiene que haberse recortado');
  assert.match(l.texto, /recortado: se guardan los primeros \d+ de \d+ caracteres/,
    'un mensaje truncado en silencio se lee como un mensaje corto');
});

test('una respuesta ENTERA se guarda en UNA línea, aunque Telegram la trocee', async () => {
  const dir = nuevoDir();
  const { publicar } = await mod(dir);
  const largo = 'tabla|con|saltos\n'.repeat(500);            // 8.500 caracteres, 500 saltos
  publicar({ sesion: '-100_7', autor: 'claude', origen: 'telegram', texto: largo });
  const crudo = readFileSync(join(dir, 'mensajes', '-100_7.jsonl'), 'utf8');
  assert.equal(crudo.trim().split('\n').length, 1,
    'los saltos van escapados por JSON: una línea = un mensaje, y por eso el ' +
    'lector puede reconstruir la tabla que en Telegram llegó partida');
  assert.equal(lineas(dir)[0].texto, largo);
});
