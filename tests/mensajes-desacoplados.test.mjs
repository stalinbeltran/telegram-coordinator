// Tests de que los procesos DESACOPLADOS también dejan rastro en el log
// (`notify.mjs` y `claude-reset.mjs` → `data/mensajes/`).
//
// Por qué escriben al FICHERO y no le hablan al coordinador
// --------------------------------------------------------
// Es la misma razón que ya está escrita en `errores.mjs`: si tuvieran que pedirle
// algo al bot por HTTP, dejarían de funcionar **justo cuando el bot está caído**,
// que es cuando más falta hacen. Un aviso de «terminó la flota» tiene que quedar
// registrado aunque el coordinador se esté reiniciando.
//
// Y por qué importa que lo dejen
// ------------------------------
// Porque si un aviso sólo llegara a Telegram, aparecería en el chat y NO en la
// web — y dos clientes que no ven lo mismo es exactamente lo que este log existe
// para evitar («si los dos clientes no ven lo mismo, el espejo miente»).
//
// ⚠⚠ Y el arnés fija `DATA_DIR` a un temporal SIEMPRE. Aquí no es comodidad: es
// la lección de esta misma sesión. Al comprobar «que el módulo carga» se ejecutó
// `claude-reset.mjs` heredando el `COORD_SESSION` real del tema, y subió de
// verdad la época de la conversación del dueño (se revirtió borrando el marker,
// que devuelve a la época 0). Un script con efectos no se prueba sin aislarlo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = '123456:TEST-token';
const nuevoDir = () => mkdtempSync(join(tmpdir(), 'coord-desac-'));

function fakeTelegram(reply = () => ({ status: 200, body: { ok: true } })) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      seen.push(JSON.parse(raw || '{}'));
      const { status, body } = reply(seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1',
    () => r({ seen, server, base: `http://127.0.0.1:${server.address().port}` })));
}

function correr(script, args, env, stdin = '') {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(RAIZ, 'scripts', script), ...args], {
      cwd: RAIZ, windowsHide: true,
      env: Object.fromEntries(Object.entries({ PATH: process.env.PATH, ...env })
        .filter(([, v]) => v !== undefined)),
    });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d.toString()));
    c.stderr.on('data', (d) => (err += d.toString()));
    c.on('close', (code) => resolve({ out, err, code }));
    c.stdin.write(stdin);
    c.stdin.end();
  });
}

function lineas(datos, sesion) {
  const f = join(datos, 'mensajes', `${sesion.replace(/[^\w.-]/g, '_')}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --------------------------------------------------------------- notify.mjs

test('notify anota en el log lo mismo que manda a Telegram', async () => {
  const tg = await fakeTelegram();
  const datos = nuevoDir();
  const { code } = await correr('notify.mjs', ['terminó la flota'], {
    BOT_TOKEN: TOKEN, COORD_CHAT: '-100123', COORD_THREAD: '7',
    DATA_DIR: datos, TELEGRAM_API_BASE: tg.base,
  });
  tg.server.close();
  assert.equal(code, 0);
  const l = lineas(datos, '-100123_7');
  assert.equal(l.length, 1, 'el aviso tiene que quedar en el log del tema');
  assert.equal(l[0].autor, 'sistema', 'esto no lo dijo claude: lo compuso quien llamó a notify');
  assert.equal(l[0].texto, 'terminó la flota');
});

test('lo anota AUNQUE el envío a Telegram falle: el fichero es la fuente de verdad', async () => {
  const datos = nuevoDir();
  const { code } = await correr('notify.mjs', ['algo importante'], {
    BOT_TOKEN: TOKEN, COORD_CHAT: '-100123', COORD_THREAD: '7',
    DATA_DIR: datos, TELEGRAM_API_BASE: 'http://127.0.0.1:1',   // nadie escucha ahí
  });
  assert.equal(code, 1, 'el envío falla…');
  assert.equal(lineas(datos, '-100123_7').length, 1,
    '…y aun así el rastro queda: si sólo se anotara al enviar bien, se perdería ' +
    'justo lo que pasa cuando la red o el hilo fallan');
});

test('el `origen` lo declara quien llama, con COORD_ORIGEN', async () => {
  const tg = await fakeTelegram();
  const datos = nuevoDir();
  await correr('notify.mjs', ['vuelta 1/2'], {
    BOT_TOKEN: TOKEN, COORD_CHAT: '-100123', COORD_THREAD: '7',
    DATA_DIR: datos, TELEGRAM_API_BASE: tg.base, COORD_ORIGEN: 'repetir',
  });
  tg.server.close();
  assert.equal(lineas(datos, '-100123_7')[0].origen, 'repetir',
    'así la web puede distinguir un aviso de `repetir` de uno tuyo');
});

test('COORD_SESSION manda sobre chat+thread cuando está', async () => {
  const tg = await fakeTelegram();
  const datos = nuevoDir();
  await correr('notify.mjs', ['x'], {
    BOT_TOKEN: TOKEN, COORD_CHAT: '-100123', COORD_THREAD: '7',
    COORD_SESSION: '-100123_99', DATA_DIR: datos, TELEGRAM_API_BASE: tg.base,
  });
  tg.server.close();
  assert.equal(lineas(datos, '-100123_99').length, 1, 'el dato explícito gana');
  assert.equal(lineas(datos, '-100123_7').length, 0, 'y no se escribe en el derivado');
});

// ---------------------------------------------------------- claude-reset.mjs

test('creset deja la DIVISORIA en el log, no sólo en el marker', async () => {
  const datos = nuevoDir();
  const { code } = await correr('claude-reset.mjs', [],
    { DATA_DIR: datos, COORD_SESSION: '-100123_7' }, 'lo que sea');
  assert.equal(code, 0);
  const l = lineas(datos, '-100123_7');
  assert.equal(l.length, 1);
  assert.equal(l[0].autor, 'sistema');
  assert.equal(l[0].origen, 'creset');
  assert.match(l[0].texto, /época 0 → 1/);
  assert.match(l[0].texto, /ya NO está en su contexto/,
    'sin esta línea, la web enseña un hilo que claude ya no tiene — la clase de ' +
    'confusión que cuesta media hora entender');
});
