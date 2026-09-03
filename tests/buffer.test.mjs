// Tests del reensamblado de mensajes que Telegram PARTE (src/buffer.ts).
//
// Qué se protege aquí, y por qué justo esto (R10: el esfuerzo se reparte por
// consecuencia del fallo, no por facilidad):
//
//   · Unir mal = ejecutar una instrucción MUTILADA sin un solo error. Es el
//     fallo silencioso caro: desde Telegram no se distingue de una respuesta
//     mala. Por eso se prueba con CUATRO trozos y no con dos — con dos, un bug
//     de orden puede pasar desapercibido.
//   · El orden lo fija el `message_id`. Si el cliente manda los trozos en
//     paralelo, el orden de llegada puede no ser el de redacción.
//   · Un pegado que mida múltiplo exacto del límite deja el último trozo LLENO,
//     así que la regla no puede cerrarlo sola: tiene que quedarse esperando y
//     soltarse con `/pegado ya`. Es el único caso que la regla no resuelve, y
//     no puede resolverse: «no viene nada más» no es observable.
//   · Un buffer vencido NO se pega al mensaje de tres horas después, y tampoco
//     se tira: se aparta. Tirar en silencio una instrucción larga tecleada
//     desde el móvil es el fallo caro de este proyecto con otro nombre.
//   · El estado se lee de DISCO cada vez, así que sobrevive al `systemctl
//     restart` con el que se despliega aquí.
//   · Y el camino común —un mensaje corto— no puede escribir nada: esto está
//     en el camino de TODOS los mensajes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// config.ts lee DATA_DIR al importarse: hay que ponerlo ANTES.
const raiz = mkdtempSync(join(tmpdir(), 'coord-buf-'));
process.env.BOT_TOKEN = 'test-token';
process.env.DATA_DIR = join(raiz, 'data');

const {
  LIMITE, TTL_MS, esTrozo, procesarEntrada, pendiente, descartar, forzar, anotarAviso, contarPendientes,
} = await import('../src/buffer.js');

const SID = '-1004383895505_2';
const fichero = (sid = SID) => join(raiz, 'data', 'buffer', `${sid.replace(/[^\w.-]/g, '_')}.json`);
const lleno = (c) => c.repeat(LIMITE);

test('la frontera es exacta: LIMITE-1 no es trozo, LIMITE sí', () => {
  assert.equal(esTrozo('x'.repeat(LIMITE - 1)), false);
  assert.equal(esTrozo('x'.repeat(LIMITE)), true);
  assert.equal(esTrozo('x'.repeat(LIMITE + 1)), true);
});

test('un mensaje corto sin nada pendiente NO escribe en disco', async () => {
  const sid = '-100_corto';
  const r = await procesarEntrada(sid, 1, 'hola');
  assert.equal(r.accion, 'atender');
  assert.equal(r.texto, 'hola');
  assert.equal(r.trozos, 1);
  assert.equal(existsSync(fichero(sid)), false);
});

test('cuatro trozos + uno corto se unen en orden y SIN separador', async () => {
  await descartar(SID);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(lleno);
  for (const [i, t] of [a, b, c, d].entries()) {
    const r = await procesarEntrada(SID, 10 + i, t);
    assert.equal(r.accion, 'esperar');
    assert.equal(r.trozos, i + 1);
    assert.equal(r.chars, LIMITE * (i + 1));
  }
  const fin = await procesarEntrada(SID, 14, 'FIN');
  assert.equal(fin.accion, 'atender');
  assert.equal(fin.trozos, 5);
  assert.equal(fin.texto, a + b + c + d + 'FIN');
  assert.equal(existsSync(fichero()), false);
});

test('el orden lo fija el message_id, no el de llegada', async () => {
  await descartar(SID);
  await procesarEntrada(SID, 22, lleno('b')); // el segundo llega primero
  await procesarEntrada(SID, 21, lleno('a'));
  const r = await procesarEntrada(SID, 23, 'z');
  assert.equal(r.texto, lleno('a') + lleno('b') + 'z');
});

test('múltiplo exacto del límite: se queda esperando, y forzar() lo suelta entero', async () => {
  await descartar(SID);
  await procesarEntrada(SID, 31, lleno('a'));
  const r = await procesarEntrada(SID, 32, lleno('b'));
  assert.equal(r.accion, 'esperar', 'el último trozo viene LLENO: no se puede cerrar solo');
  assert.equal((await pendiente(SID)).trozos, 2);

  const f = await forzar(SID);
  assert.equal(f.trozos, 2);
  assert.equal(f.texto, lleno('a') + lleno('b'));
  assert.equal(await pendiente(SID), undefined);
});

test('un buffer vencido NO se pega al mensaje nuevo: se aparta y se dice', async () => {
  await descartar(SID);
  await procesarEntrada(SID, 41, lleno('a'));
  const st = JSON.parse(readFileSync(fichero(), 'utf8'));
  st.ultimo = Date.now() - TTL_MS - 1000;
  writeFileSync(fichero(), JSON.stringify(st));

  const r = await procesarEntrada(SID, 42, 'otra cosa');
  assert.equal(r.accion, 'atender');
  assert.equal(r.texto, 'otra cosa', 'lo viejo NO se pega');
  assert.equal(r.trozos, 1);
  assert.ok(r.caducado, 'y se dice que había algo');
  assert.equal(r.caducado.trozos, 1);
  assert.equal(r.caducado.chars, LIMITE);
  assert.ok(existsSync(r.caducado.fichero), 'apartado, no borrado');
  assert.equal(existsSync(fichero()), false);
});

test('el pegado sobrevive a un reinicio: el estado se lee de disco, no de memoria', async () => {
  await descartar(SID);
  // Como si lo hubiera dejado el proceso ANTERIOR, antes de systemctl restart.
  mkdirSync(join(raiz, 'data', 'buffer'), { recursive: true });
  writeFileSync(fichero(), JSON.stringify({
    id: SID,
    trozos: [{ mid: 51, texto: lleno('a') }],
    desde: Date.now(), ultimo: Date.now(),
  }));
  const r = await procesarEntrada(SID, 52, 'y el final');
  assert.equal(r.accion, 'atender');
  assert.equal(r.texto, lleno('a') + 'y el final');
});

test('el message_id del aviso se recuerda, para EDITARLO en el trozo siguiente', async () => {
  await descartar(SID);
  const r1 = await procesarEntrada(SID, 61, lleno('a'));
  assert.equal(r1.aviso, undefined, 'el primero no tiene aviso que editar');
  await anotarAviso(SID, 999);
  const r2 = await procesarEntrada(SID, 62, lleno('b'));
  assert.equal(r2.aviso, 999);
});

test('descartar deja el tema limpio y dice si había algo; los caducados no cuentan', async () => {
  await descartar(SID);
  await procesarEntrada(SID, 71, lleno('a'));
  assert.equal(await contarPendientes(), 1);
  assert.equal(await descartar(SID), true);
  assert.equal(await descartar(SID), false);
  assert.equal(await pendiente(SID), undefined);
  assert.equal(await contarPendientes(), 0, 'el .caducado- de otro test no se cuenta como pendiente');
});
