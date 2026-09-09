// Tests del LATIDO del coordinador (src/latido.ts).
//
// Qué se juega aquí (R10): el latido es lo único con lo que la web puede
// distinguir «claude está pensando» de «el bot está parado». Si se equivoca en
// una dirección, la web dice «esperando respuesta» para siempre por un turno de
// hace tres días; si se equivoca en la otra, dice que el bot está caído cuando
// está trabajando y el usuario reinicia un servicio que iba bien.
//
// ⚠⚠ El caso que fija este fichero, y es el que ya costó caro una vez con el
// `.resume.lock`: **un turno no puede sobrevivir a su dueño**. Si el proceso
// muere por SIGKILL a mitad, nadie corre ningún `cleanup` — así que el turno no
// puede estar en un fichero propio que quede ahí. Vive DENTRO del latido, y
// cuando el latido vence se cae con él.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = mkdtempSync(join(tmpdir(), 'coord-latido-'));
process.env.BOT_TOKEN = '123456:TEST-token';
process.env.DATA_DIR = raiz;

const L = await import('../src/latido.js');
const leer = () => JSON.parse(readFileSync(L.ficheroLatido(), 'utf8'));

test('el latido dice quién es, cuándo se le vio y cuándo VENCE', () => {
  L.escribir();
  const l = leer();
  assert.equal(l.pid, process.pid);
  assert.match(l.visto, /^\d{4}-\d\d-\d\dT/);
  assert.equal(l.vence_ms, L.VENCE_MS,
    'la regla de caducidad VIAJA con el dato: el lector no tiene que adivinarla');
  assert.deepEqual(l.turnos, {});
});

test('un turno en curso aparece, y desaparece al acabar', () => {
  L.empiezaTurno('-100_7', 'c');
  L.escribir();
  const conTurno = leer();
  assert.deepEqual(Object.keys(conTurno.turnos), ['-100_7']);
  assert.equal(conTurno.turnos['-100_7'].ejecutor, 'c');
  assert.match(conTurno.turnos['-100_7'].desde, /^\d{4}-/);

  L.acabaTurno('-100_7');
  L.escribir();
  assert.deepEqual(leer().turnos, {}, 'si no se suelta, la web dice «esperando» para siempre');
});

test('dos temas a la vez son dos turnos, no uno', () => {
  L.empiezaTurno('-100_7', 'c');
  L.empiezaTurno('-100_8', 'shell');
  L.escribir();
  assert.deepEqual(Object.keys(leer().turnos).sort(), ['-100_7', '-100_8']);
  L.pararLatido();
});

test('⚠ el turno vive DENTRO del latido: no puede sobrevivir a su dueño', () => {
  // La comprobación es estructural a propósito. Si alguien saca los turnos a su
  // propio fichero, este test falla — y ese fichero sería un cerrojo sin dueño
  // vivo, que es el fallo que costó el `.resume.lock`.
  const l = leer();
  assert.ok('turnos' in l && 'visto' in l,
    'los turnos y el latido tienen que compartir fichero, o los turnos no caducan');
  assert.equal(existsSync(join(raiz, 'turnos.json')), false,
    'no puede haber un fichero de turnos aparte');
});

test('la ventana de vencimiento son 3 latidos, no uno', () => {
  // Con un solo latido de margen, un turno que bloquee el bucle un instante haría
  // que la web anunciara una caída que no ha ocurrido.
  assert.equal(L.VENCE_MS, L.LATIDO_MS * 3);
});

test('escribir NUNCA lanza, aunque el directorio no se pueda escribir', () => {
  const antes = process.env.DATA_DIR;
  try {
    assert.doesNotThrow(() => L.escribir(), 'un fallo de disco no puede tumbar el bot');
  } finally { process.env.DATA_DIR = antes; }
});
