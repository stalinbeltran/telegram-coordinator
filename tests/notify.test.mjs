// Test de contrato del notificador (scripts/notify.mjs).
// Se ejecuta como subproceso real, igual que el de claude-watch, y se apunta a
// un servidor HTTP local con TELEGRAM_API_BASE: así se prueban el troceo, los
// reintentos y las salidas SIN mandar nada a Telegram.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTIFY = join('scripts', 'notify.mjs');
const TOKEN = 'test-token-no-real-123456';

// Un Telegram de mentira: guarda lo que le mandan y contesta lo que le digan.
function fakeTelegram(reply = () => ({ status: 200, body: { ok: true } })) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const payload = JSON.parse(raw || '{}');
      seen.push({ url: req.url, payload });
      const { status, body } = reply(seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ seen, server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function runNotify(args, { env = {}, stdin = '' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [NOTIFY, ...args], {
      cwd: ROOT,
      windowsHide: true,
      // Entorno mínimo y explícito: el .env real no debe entrar en los tests.
      env: { PATH: process.env.PATH, BOT_TOKEN: TOKEN, COORD_CHAT: '-100123', ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ out, err, code }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

test('notify: envía el texto al chat y al hilo indicados', async () => {
  const tg = await fakeTelegram();
  const { code } = await runNotify(['hola', 'mundo'],
    { env: { TELEGRAM_API_BASE: tg.base, COORD_THREAD: '7' } });
  tg.server.close();

  assert.equal(code, 0);
  assert.equal(tg.seen.length, 1);
  assert.equal(tg.seen[0].payload.text, 'hola mundo');
  assert.equal(tg.seen[0].payload.chat_id, '-100123');
  assert.equal(tg.seen[0].payload.message_thread_id, 7);
});

test('notify: lee el texto de stdin si no hay argumento', async () => {
  const tg = await fakeTelegram();
  const { code } = await runNotify([],
    { env: { TELEGRAM_API_BASE: tg.base }, stdin: '  terminó el trabajo  ' });
  tg.server.close();

  assert.equal(code, 0);
  assert.equal(tg.seen[0].payload.text, 'terminó el trabajo');
});

test('notify: un tema "main" no lleva message_thread_id', async () => {
  // El General del grupo no es un hilo; mandarlo daría "message thread not found".
  const tg = await fakeTelegram();
  await runNotify(['x'], { env: { TELEGRAM_API_BASE: tg.base, COORD_THREAD: 'main' } });
  tg.server.close();

  assert.ok(!('message_thread_id' in tg.seen[0].payload));
});

test('notify: trocea lo que no cabe en un mensaje', async () => {
  const tg = await fakeTelegram();
  const largo = 'A'.repeat(4000) + 'B'.repeat(100);
  const { code } = await runNotify([], { env: { TELEGRAM_API_BASE: tg.base }, stdin: largo });
  tg.server.close();

  assert.equal(code, 0);
  assert.equal(tg.seen.length, 2);
  assert.equal(tg.seen[0].payload.text.length, 4000);
  assert.equal(tg.seen[1].payload.text, 'B'.repeat(100));
});

test('notify: {ok:false} con HTTP 200 se trata como fallo', async () => {
  // Telegram contesta 200 con ok:false en errores reales; mirar solo el código
  // HTTP daría por enviado algo que no salió.
  const tg = await fakeTelegram(() => ({ status: 200, body: { ok: false, description: 'nope' } }));
  const { code, err } = await runNotify(['x'], { env: { TELEGRAM_API_BASE: tg.base } });
  tg.server.close();

  assert.equal(code, 1);
  assert.match(err, /No se pudo enviar/);
});

test('notify: un 4xx no se reintenta; un 5xx sí', async () => {
  const malo = await fakeTelegram(() => ({ status: 400, body: { ok: false, description: 'chat not found' } }));
  const r400 = await runNotify(['x'], { env: { TELEGRAM_API_BASE: malo.base } });
  malo.server.close();
  assert.equal(r400.code, 1);
  assert.equal(malo.seen.length, 1, 'un 400 no se arregla esperando');
  assert.match(r400.err, /1 intento/);

  // 5xx: falla dos veces y a la tercera pasa.
  const flaky = await fakeTelegram((n) =>
    n < 3 ? { status: 500, body: { ok: false } } : { status: 200, body: { ok: true } });
  const r500 = await runNotify(['x'], { env: { TELEGRAM_API_BASE: flaky.base } });
  flaky.server.close();
  assert.equal(r500.code, 0);
  assert.equal(flaky.seen.length, 3);
});

test('notify: sin destino se niega con exit 2 y SIN filtrar el token', async () => {
  // El token se filtró una vez por esta vía; que no vuelva a pasar lo fija aquí.
  const { code, err, out } = await runNotify(['hola'],
    { env: { COORD_CHAT: '', TELEGRAM_API_BASE: 'http://127.0.0.1:1' } });

  assert.equal(code, 2);
  assert.match(err, /COORD_CHAT/);
  assert.ok(!(err + out).includes(TOKEN), 'el token no puede aparecer en la salida');
});

test('notify: un fallo de red tampoco filtra el token', async () => {
  // Puerto cerrado: el error de fetch puede traer la URL, y la URL lleva el token.
  const { code, err, out } = await runNotify(['hola'],
    { env: { TELEGRAM_API_BASE: 'http://127.0.0.1:1' } });

  assert.equal(code, 1);
  assert.ok(!(err + out).includes(TOKEN), 'el token no puede aparecer en la salida');
});

test('notify: sin texto se niega con exit 2', async () => {
  const { code, err } = await runNotify([], { stdin: '   ' });
  assert.equal(code, 2);
  assert.match(err, /No hay texto/);
});
