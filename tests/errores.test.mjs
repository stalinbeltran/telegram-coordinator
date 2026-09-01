// El registrador de errores del coordinador. Repartido por consecuencia (R10):
// lo que puede TUMBAR el coordinador primero, lo que puede filtrar un secreto
// despues, y el formato --que es el contrato con Python-- al final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Un arbol con `<casa>/../foveal-vision-data/.git`, que es lo que busca. */
function arbol() {
  const raiz = mkdtempSync(join(tmpdir(), 'err-'));
  const casa = join(raiz, 'telegram-coordinator');
  mkdirSync(join(raiz, 'foveal-vision-data', '.git'), { recursive: true });
  mkdirSync(casa, { recursive: true });
  return { raiz, casa, log: join(raiz, 'foveal-vision-data', 'errores') };
}

async function cargar(casa) {
  process.env.COORD_HOME = casa;
  // ?v= para que cada test tenga su modulo (el cache de repeticiones es global)
  return import('../scripts/errores.mjs?v=' + Math.random());
}

function lineas(log) {
  const d = new Date();
  const meses = ['01-enero','02-febrero','03-marzo','04-abril','05-mayo','06-junio',
    '07-julio','08-agosto','09-septiembre','10-octubre','11-noviembre','12-diciembre'];
  const f = join(log, String(d.getUTCFullYear()), meses[d.getUTCMonth()],
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`);
  return existsSync(f)
    ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
}

// ---------------------------------------- 1. no puede tumbar el coordinador

test('registrar NUNCA lanza, pase lo que pase', async () => {
  const { casa } = arbol();
  const m = await cargar(casa);
  // un objeto que revienta al serializar y un `extra` circular
  const circular = {}; circular.yo = circular;
  assert.doesNotThrow(() => m.registrar('x', { toString() { throw new Error('ni str'); } }));
  assert.doesNotThrow(() => m.registrar('x', 'y', { extra: circular }));
});

test('sin repo de datos NO registra, y tampoco revienta', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'err-'));
  const casa = join(raiz, 'telegram-coordinator');
  mkdirSync(casa, { recursive: true });                  // sin foveal-vision-data
  const m = await cargar(casa);
  assert.equal(m.registrar('x', 'y'), null);
});

// --------------------------------------------- 2. no se cuela un secreto

test('los secretos se redactan, con el MISMO modulo que las conversaciones', async () => {
  const { casa, log } = arbol();
  const secretos = join(casa, '.env');
  writeFileSync(secretos, 'BOT_TOKEN=123456789:AAEmiSecretoDeTelegramQueTiene35c\n');
  const m = await cargar(casa);
  m.registrar('con_secreto', 'fallo con ghp_' + 'A'.repeat(36) + ' dentro',
    { traza: 'Traceback: sk-ant-' + 'B'.repeat(30) });
  const crudo = JSON.stringify(lineas(log));
  assert.ok(!crudo.includes('ghp_' + 'A'.repeat(36)));
  assert.ok(!crudo.includes('sk-ant-' + 'B'.repeat(30)));
  assert.match(crudo, /REDACTADO:TOKEN-GITHUB/);
  assert.match(crudo, /REDACTADO:CLAVE-ANTHROPIC/);
});

// ------------------------------------ 3. el formato: contrato con Python

test('la linea trae los campos que fv/errores.py lee', async () => {
  const { casa, log } = arbol();
  const m = await cargar(casa);
  m.registrar('formato', 'mensaje', { hint: 'arreglo', donde: 'aqui' });
  const [l] = lineas(log);
  for (const campo of ['cuando', 'nivel', 'code', 'message', 'hint', 'origen',
                       'donde', 'maquina', 'version', 'pid']) {
    assert.ok(campo in l, `falta ${campo}`);
  }
  // la hora en el mismo formato que Python (isoformat con offset, sin micros)
  assert.match(l.cuando, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  assert.equal(l.origen, 'coordinador');
  assert.equal(l.nivel, 'error');
});

test('el fichero es uno por mes, bajo <anio>/<mes>/', async () => {
  const { casa, log } = arbol();
  const m = await cargar(casa);
  m.registrar('x', 'y');
  const d = new Date();
  const esperado = join(log, String(d.getUTCFullYear()));
  assert.ok(existsSync(esperado), 'falta la carpeta del anio');
  assert.equal(lineas(log).length, 1);
});

// ------------------------------------------------------ 4. la cadencia

test('las repeticiones se agrupan y la ventana CRECE', async () => {
  const { casa, log } = arbol();
  const m = await cargar(casa);
  for (let i = 0; i < 40; i++) m.registrar('bucle', 'otra vez', { donde: 'X' });
  assert.equal(lineas(log).length, 1, '40 sucesos tienen que ser 1 linea');
});

test('errores DISTINTOS no se agrupan entre si', async () => {
  const { casa, log } = arbol();
  const m = await cargar(casa);
  m.registrar('uno', 'a', { donde: 'X' });
  m.registrar('otro', 'a', { donde: 'X' });
  m.registrar('uno', 'a', { donde: 'Y' });
  assert.equal(lineas(log).length, 3);
});

test('la traza se guarda por el FINAL y si corta lo dice', async () => {
  const { casa, log } = arbol();
  const m = await cargar(casa);
  const larga = 'INICIO' + 'x'.repeat(20000) + 'LA-CAUSA-ESTA-AQUI';
  m.registrar('traza_larga', 'y', { traza: larga });
  const [l] = lineas(log);
  assert.ok(l.traza.includes('LA-CAUSA-ESTA-AQUI'), 'perdio el final, que es la causa');
  assert.ok(!l.traza.includes('INICIO'), 'guardo el principio en vez del final');
  assert.match(l.traza, /traza recortada/);
});

test('al salir el proceso no se pierde la cuenta', async () => {
  const { casa, log } = arbol();
  const m = await cargar(casa);
  for (let i = 0; i < 25; i++) m.registrar('racha', 'x', { donde: 'Y' });
  assert.equal(lineas(log).length, 1);              // 24 aun en memoria
  assert.equal(m.cerrarVentanas(), 1);
  const ls = lineas(log);
  assert.equal(ls.length, 2);
  assert.equal(ls[1].repeticiones, 24);             // 1 + 24 = 25 sucesos
  assert.equal(m.cerrarVentanas(), 0);              // no duplica
});
