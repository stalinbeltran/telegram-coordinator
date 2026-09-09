// Tests del CERROJO POR SESIÓN (src/cerrojo.ts).
//
// Lo que se juega, y por qué es la parte más delicada del proyecto (R10): dos
// `claude --resume <mismo uuid>` a la vez se pisan, la conversación queda
// corrupta y el trabajo de uno de los dos se pierde. Hoy casi no pasa porque
// grammY procesa los updates en serie; en cuanto la web pueda escribir, un POST
// y un mensaje de Telegram pueden llegar en el mismo instante y no los ordena
// nadie.
//
// Los cuatro casos, en orden de lo que cuesta el fallo:
//   1. que DE VERDAD no se solapen dos turnos del mismo tema;
//   2. que un fallo NO deje la sesión bloqueada — un cerrojo que se queda puesto
//      es peor que no tenerlo, porque el tema deja de responder para siempre;
//   3. que temas distintos NO se estorben (si se serializara todo, un turno de
//      claude de diez minutos congelaría el bot entero);
//   4. que la cola tenga tope, y que se avise al que espera.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BOT_TOKEN = '123456:TEST-token';
const C = await import('../src/cerrojo.js');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('dos turnos del MISMO tema no se solapan', async () => {
  C.limpiarCerrojos();
  const orden = [];
  const tarea = (n) => async () => {
    orden.push(`entra${n}`);
    await espera(30);
    orden.push(`sale${n}`);
  };
  await Promise.all([
    C.enTurno('-100_7', tarea(1)),
    C.enTurno('-100_7', tarea(2)),
    C.enTurno('-100_7', tarea(3)),
  ]);
  assert.deepEqual(orden,
    ['entra1', 'sale1', 'entra2', 'sale2', 'entra3', 'sale3'],
    'si aparece un «entra» antes del «sale» anterior, hay dos claude a la vez');
});

test('temas DISTINTOS corren a la vez: no se estorban', async () => {
  C.limpiarCerrojos();
  const t0 = Date.now();
  await Promise.all([
    C.enTurno('-100_7', () => espera(120)),
    C.enTurno('-100_8', () => espera(120)),
    C.enTurno('-100_9', () => espera(120)),
  ]);
  assert.ok(Date.now() - t0 < 300,
    'serializar entre temas congelaría el bot entero durante un turno largo de claude');
});

test('⚠ un fallo NO deja la sesión bloqueada', async () => {
  C.limpiarCerrojos();
  await assert.rejects(() => C.enTurno('-100_7', async () => { throw new Error('reventó'); }));
  // El siguiente tiene que poder correr. Si no, ese tema deja de responder para
  // siempre y sólo se arregla reiniciando el bot.
  assert.equal(await C.enTurno('-100_7', async () => 'sigo vivo'), 'sigo vivo');
});

test('el que espera detrás corre aunque el de delante falle', async () => {
  C.limpiarCerrojos();
  const hechas = [];
  const a = C.enTurno('-100_7', async () => { await espera(20); throw new Error('x'); });
  const b = C.enTurno('-100_7', async () => { hechas.push('b'); });
  await a.catch(() => {});
  await b;
  assert.deepEqual(hechas, ['b']);
});

test('al que tiene que esperar SE LE AVISA, y sólo a ése', async () => {
  C.limpiarCerrojos();
  const avisos = [];
  const a = C.enTurno('-100_7', () => espera(40), () => avisos.push('a'));
  await espera(5);
  const b = C.enTurno('-100_7', async () => {}, (delante) => avisos.push(`b:${delante}`));
  await Promise.all([a, b]);
  assert.deepEqual(avisos, ['b:1'],
    'el primero no espera a nadie: avisarle de una cola que no existe sería ruido, ' +
    'y con `c` (sin timeout) el que SÍ espera puede estar minutos sin señal');
});

test('la cola tiene tope: con demasiados esperando, se dice que no', async () => {
  C.limpiarCerrojos();
  const enMarcha = [];
  for (let i = 0; i <= C.COLA_MAX; i++) {
    enMarcha.push(C.enTurno('-100_7', () => espera(60)).catch((e) => e));
  }
  const uno = await C.enTurno('-100_7', async () => 'no debería correr').catch((e) => e);
  assert.ok(uno instanceof C.ColaLlena, 'sin tope, un pegado repetido encola sin fin');
  assert.match(uno.message, /esperando en este tema/);
  await Promise.all(enMarcha);
});

test('⚠ el cerrojo vive EN MEMORIA: no puede quedar huérfano', async () => {
  // Estructural a propósito. Un cerrojo en disco sobrevive a su dueño, y un
  // SIGKILL a mitad dejaría el tema bloqueado para siempre — el fallo del
  // `.resume.lock`. Si alguien lo mueve a disco, tendrá que escribirle una
  // caducidad; hoy no le hace falta.
  const fuente = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/cerrojo.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(fuente, /writeFile|appendFile|mkdirSync/,
    'este cerrojo no escribe en disco, y esa es su regla de caducidad');
});
