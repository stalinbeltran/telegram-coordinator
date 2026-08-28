// Tests de «el primer mensaje de un tema decide su workspace» (src/workspaces.ts).
//
// Las cuatro reglas que el usuario fijó, y que son justo lo que se prueba aquí:
//
//   1. El PRIMER tema que escriba se queda con el árbol del coordinador (el
//      «defecto»). Lo elige él escribiendo ahí primero, no se configura.
//   2. Los demás temas, y SÓLO al escribir, montan el suyo. No se crean N
//      workspaces por adelantado: un tema que nunca escribe no cuesta nada.
//   3. Un tema ya decidido no vuelve a decidir. Ni el atado, ni el de defecto.
//   4. `/ws off` es una decisión, no una ausencia: un tema soltado a propósito
//      NO se re-monta solo en el mensaje siguiente. Antes esto no se podía
//      distinguir porque `clearWorkspace` BORRABA el fichero, y «suelto a
//      propósito» y «nunca visto» eran el mismo estado.
//
// R10: lo que se prueba es lo que duele si falla. Montar de más gasta disco y
// deja el freno de `cerrable` en rojo; montar cuando el usuario dijo «off» le
// quita la salida de emergencia; y perder el defecto le cambia el árbol al tema
// donde estaba trabajando, en silencio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config.ts lee DATA_DIR al importarse: hay que ponerlo ANTES.
const raiz = mkdtempSync(join(tmpdir(), 'coord-auto-'));
process.env.BOT_TOKEN = 'test-token';
process.env.DATA_DIR = join(raiz, 'casa', 'data');
process.env.COORD_WS_RAIZ = join(raiz, 'ws');

const CHAT = '-1004383895505';
const tema = (t) => `${CHAT}_${t}`;
const dirWs = () => join(raiz, 'casa', 'data', 'ws');
const ficherosWs = () => (existsSync(dirWs()) ? readdirSync(dirWs()).sort() : []);

/** Un workspace de mentira, ya montado en disco. */
function workspaceEnDisco(nombre) {
  const d = join(raiz, 'ws', nombre);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'WORKSPACE.json'),
    JSON.stringify({ nombre, prefijo: 'xx-', rama: nombre, creado: '2026-08-28', que: 'test' }));
  return d;
}

const mod = () => import('../src/workspaces.js');

// ------------------------------------------------------------ 1. el defecto
test('el PRIMER tema que escribe se queda con el árbol del coordinador', async () => {
  const { decidirWorkspace, marcarDefecto } = await mod();
  assert.deepEqual(decidirWorkspace(tema('main')), { accion: 'defecto' });
  await marcarDefecto(tema('main'));
  assert.deepEqual(decidirWorkspace(tema('main')), { accion: 'nada' },
    'ya decidido: no se vuelve a tocar');
});

test('el defecto lo elige quien escribe primero, no la configuración', async () => {
  const { decidirWorkspace } = await mod();
  const d = decidirWorkspace(tema('9'));
  assert.equal(d.accion, 'montar', 'el defecto ya está pillado: al siguiente le toca el suyo');
});

// --------------------------------------------------- 2. uno por tema, al usarlo
test('el SEGUNDO tema pide su propio workspace, con nombre y prefijo del tema', async () => {
  const { decidirWorkspace } = await mod();
  assert.deepEqual(decidirWorkspace(tema('7')),
    { accion: 'montar', nombre: 'tema-7', prefijo: 't7-' });
});

test('NO se montan workspaces por adelantado: sólo hay estado del tema que escribió', async () => {
  const { decidirWorkspace } = await mod();
  decidirWorkspace(tema('11'));   // decidir no escribe nada por sí solo
  decidirWorkspace(tema('12'));
  assert.deepEqual(ficherosWs(), [`${CHAT}_main.json`],
    'un tema que no ha escrito no cuesta ni un fichero');
  assert.equal(existsSync(join(raiz, 'ws', 'tema-11')), false,
    'y desde luego no cuesta 78 MB de clones');
});

// ------------------------------------------------------ 3. no se decide dos veces
test('un tema ya atado no vuelve a montar', async () => {
  const { decidirWorkspace, setWorkspace } = await mod();
  await setWorkspace(tema('7'), workspaceEnDisco('tema-7'));
  assert.deepEqual(decidirWorkspace(tema('7')), { accion: 'nada' });
});

test('la decisión sobrevive a recargar del disco (reiniciar el bot)', async () => {
  const { decidirWorkspace, loadWorkspaces } = await mod();
  await loadWorkspaces();
  assert.deepEqual(decidirWorkspace(tema('main')), { accion: 'nada' }, 'el defecto sigue siendo suyo');
  assert.deepEqual(decidirWorkspace(tema('7')), { accion: 'nada' });
});

// ------------------------------------------------------------- 4. /ws off manda
test('/ws off es una DECISIÓN: el tema soltado no se re-monta solo', async () => {
  const { decidirWorkspace, clearWorkspace } = await mod();
  await clearWorkspace(tema('7'));
  assert.deepEqual(decidirWorkspace(tema('7')), { accion: 'nada' },
    'si el mensaje siguiente lo re-montara, /ws off no serviría de nada');
});

test('soltar deja rastro en disco, no borra el fichero', async () => {
  assert.ok(ficherosWs().includes(`${CHAT}_7.json`),
    'borrarlo haría indistinguible «suelto a propósito» de «nunca visto»');
});

// ------------------------------------------- el caso de la máquina rehecha
test('un workspace que ya no está en disco no re-monta otro: degrada al árbol del coordinador', async () => {
  const { decidirWorkspace, setWorkspace, loadWorkspaces, getWorkspace } = await mod();
  await setWorkspace(tema('21'), join(raiz, 'ws', 'se-borro'));
  await loadWorkspaces();
  assert.equal(getWorkspace(tema('21')), undefined, 'la ruta muerta no se carga');
  assert.deepEqual(decidirWorkspace(tema('21')), { accion: 'nada' },
    'la decisión existe: montar otro a sus espaldas le cambiaría el árbol sin avisar');
});

// ------------------------------------------------------- el tema sin número
test('un tema sin id numérico monta igual, dejando que --nuevo elija prefijo', async () => {
  const { decidirWorkspace } = await mod();
  assert.deepEqual(decidirWorkspace(`${CHAT}_general`),
    { accion: 'montar', nombre: 'tema-general', prefijo: undefined });
});
