// Test de contrato del notificador (scripts/notify.mjs).
// Se ejecuta como subproceso real, igual que el de claude-watch, y se apunta a
// un servidor HTTP local con TELEGRAM_API_BASE: así se prueban el troceo, los
// reintentos y las salidas SIN mandar nada a Telegram.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTIFY = join(ROOT, 'scripts', 'notify.mjs');
const TOKEN = 'test-token-no-real-123456';
/** Un `data/` vacío: ver el aviso de `runNotify`. */
const VACIO = mkdtempSync(join(tmpdir(), 'data-vacio-'));

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

function runNotify(args, { env = {}, stdin = '', cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [args[0] === undefined ? NOTIFY : NOTIFY, ...args], {
      cwd,
      windowsHide: true,
      // Entorno mínimo y explícito: el .env real no debe entrar en los tests.
      // ⚠ Una clave con valor `undefined` se QUITA, no se pasa: `spawn` la
      //   convertiría en la cadena "undefined", que para `notify.mjs` es un
      //   token válido. Hace falta para poder probar el camino en que NO hay
      //   token en el entorno y hay que cargarlo de disco -- sin esto, el
      //   arnés inyecta BOT_TOKEN siempre y ese camino no se prueba nunca.
      env: Object.fromEntries(Object.entries(
        { PATH: process.env.PATH, BOT_TOKEN: TOKEN, COORD_CHAT: '-100123',
          // ⚠⚠ DATA_DIR VACÍO POR DEFECTO, y esto es una barrera de seguridad,
          //    no comodidad. Desde que `notify.mjs` BUSCA destino cuando no se
          //    lo dan, un test sin COORD_CHAT alcanzaría el `data/` REAL del
          //    repo, sacaría de ahí el chat de verdad del dueño e intentaría
          //    enviarle un mensaje. Un test no puede poder hacer eso.
          //    Quien quiera probar el respaldo pone SU DATA_DIR.
          DATA_DIR: VACIO, ...env })
        .filter(([, v]) => v !== undefined)),
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
  // ⚠ El DATA_DIR por defecto del arnés está VACÍO, así que el respaldo de
  //   destino no encuentra ningún tema y esto sigue siendo el camino de "no hay
  //   a dónde avisar". Con temas, lo que pasa lo fijan los tests de más abajo.
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

// ---------------------------------------------------------------------------
// El fallo del 2026-09-04: el aviso sólo salía si lo llamabas DESDE el repo del
// coordinador.
//
// `notify.mjs` cargaba `.env` con `existsSync('.env')`, o sea relativo al CWD.
// Un trabajo desacoplado corre en el directorio de SU repo --`desacoplar.sh`
// conserva el cwd a propósito-- así que ahí no hay `.env` y el aviso moría con
// «Falta BOT_TOKEN» (exit 2) sin llegar a intentarlo.
//
// Se veía desde fuera como que los ejecutores `entrenar`, `continuar` y
// `entrenar-vast` dejaron de avisar al terminar, mientras que `bench`,
// `estudio` y `estudio-stride` seguían avisando -- porque ésos SÍ hacen
// `. "$COORD_HOME/.env"` en su plantilla. Un fallo que depende de qué comando
// lances es de los que se atribuyen a "cosas de la red".
test('notify: encuentra el token desde OTRO cwd, que es donde corre lo desacoplado',
  async () => {
    const tg = await fakeTelegram();
    // un COORD_HOME de mentira con su .env, y se llama desde un cwd cualquiera
    const casa = mkdtempSync(join(tmpdir(), 'coord-'));
    writeFileSync(join(casa, '.env'), `BOT_TOKEN=${TOKEN}\n`);
    const otro = mkdtempSync(join(tmpdir(), 'otro-repo-'));
    try {
      const { code, err } = await runNotify(['listo'], {
        cwd: otro,
        // ⚠ BOT_TOKEN fuera: es el camino que se quiere probar. Y HOME apunta a
        //   un temporal para que `cargarSecretos` no encuentre los secretos
        //   REALES de la máquina (~/.config/dev-secrets.env) y el test pase por
        //   el motivo equivocado.
        env: { TELEGRAM_API_BASE: tg.base, COORD_HOME: casa, HOME: otro,
               BOT_TOKEN: undefined, COORD_CHAT: '-100', COORD_THREAD: '5' },
      });
      assert.equal(code, 0,
        `desde otro cwd tiene que poder avisar; salió ${code}: ${err}`);
      assert.equal(tg.seen.length, 1, 'tenía que haber mandado el mensaje');
      assert.equal(tg.seen[0].payload.text, 'listo');
    } finally {
      tg.server.close();
      rmSync(casa, { recursive: true, force: true });
      rmSync(otro, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------
// El respaldo de destino (2026-09-04, pedido por el dueño): un proceso que no
// nace de un mensaje --cron, ssh, script a mano-- no tiene COORD_CHAT, y hasta
// ahora perdía el aviso entero. El destino está en disco: el coordinador guarda
// estado POR TEMA y el nombre del fichero ES la identidad del tema.
// La elección la hace `destino-telegram.mjs` y tiene sus propios tests; aquí se
// comprueba el cableado, que es donde se puede romper de la forma cara.

/** Un `data/` de mentira con un tema principal y otro atado a un workspace. */
function datosConTemas(casa) {
  for (const [dir, sesion, cuerpo] of [
    ['ws', '-100_main', { ws: null }],
    ['ws', '-100_2', { ws: '/home/x/ws/tema-2' }],
    ['claude-sessions', '-100_main', { id: 1 }],
    ['claude-sessions', '-100_2', { id: 2 }],
  ]) {
    mkdirSync(join(casa, 'data', dir), { recursive: true });
    writeFileSync(join(casa, 'data', dir, `${sesion}.json`), JSON.stringify(cuerpo));
  }
}

test('notify: sin COORD_CHAT, busca el tema en el estado del coordinador', async () => {
  const tg = await fakeTelegram();
  const casa = mkdtempSync(join(tmpdir(), 'coord-'));
  datosConTemas(casa);
  try {
    const { code, err } = await runNotify(['terminó el barrido'], {
      env: { TELEGRAM_API_BASE: tg.base, DATA_DIR: join(casa, 'data'),
             COORD_CHAT: undefined, COORD_THREAD: undefined },
    });
    assert.equal(code, 0, `tenía que encontrar destino; salió ${code}: ${err}`);
    assert.equal(tg.seen.length, 1);
    assert.equal(tg.seen[0].payload.chat_id, '-100');
    assert.equal(tg.seen[0].payload.message_thread_id, undefined,
      'el principal es el tema general: no lleva message_thread_id');
    // Un mensaje que aparece donde nadie lo dirigió tiene que decir por qué.
    assert.match(tg.seen[0].payload.text, /^terminó el barrido/);
    assert.match(tg.seen[0].payload.text, /sin destino explícito/);
    assert.match(tg.seen[0].payload.text, /principal/);
  } finally {
    tg.server.close();
    rmSync(casa, { recursive: true, force: true });
  }
});

test('notify: si SÍ viene COORD_CHAT, el respaldo no se usa ni se menciona', async () => {
  // La forma cara de romper esto: cambiar un dato por una suposición. Con
  // destino explícito, el estado del disco no puede opinar.
  const tg = await fakeTelegram();
  const casa = mkdtempSync(join(tmpdir(), 'coord-'));
  datosConTemas(casa);
  try {
    const { code } = await runNotify(['listo'], {
      env: { TELEGRAM_API_BASE: tg.base, DATA_DIR: join(casa, 'data'),
             COORD_CHAT: '-999', COORD_THREAD: '42' },
    });
    assert.equal(code, 0);
    assert.equal(tg.seen[0].payload.chat_id, '-999', 'manda lo que te dijeron');
    assert.equal(tg.seen[0].payload.message_thread_id, 42,
      'el hilo viaja como NÚMERO a la Bot API, no como cadena');
    assert.equal(tg.seen[0].payload.text, 'listo', 'sin coletilla: no hubo respaldo');
  } finally {
    tg.server.close();
    rmSync(casa, { recursive: true, force: true });
  }
});

test('notify: si el elegido es un tema NUMERADO, el hilo llega como número', async () => {
  // El respaldo saca el hilo del NOMBRE DEL FICHERO, o sea una cadena. La Bot
  // API quiere un número en `message_thread_id`, y el tema general no lleva
  // ninguno. Las dos formas tienen que salir bien de la misma ruta.
  const tg = await fakeTelegram();
  const casa = mkdtempSync(join(tmpdir(), 'coord-'));
  mkdirSync(join(casa, 'data', 'ws'), { recursive: true });
  writeFileSync(join(casa, 'data', 'ws', '-100_7.json'),
                JSON.stringify({ ws: '/home/x/ws/tema-7' }));
  try {
    const { code } = await runNotify(['listo'], {
      env: { TELEGRAM_API_BASE: tg.base, DATA_DIR: join(casa, 'data'),
             COORD_CHAT: undefined, COORD_THREAD: undefined },
    });
    assert.equal(code, 0);
    assert.equal(tg.seen[0].payload.chat_id, '-100');
    assert.equal(tg.seen[0].payload.message_thread_id, 7);
    assert.match(tg.seen[0].payload.text, /más reciente/,
      'sin principal, se dice que se eligió por recencia');
  } finally {
    tg.server.close();
    rmSync(casa, { recursive: true, force: true });
  }
});

test('notify: --chat gana al respaldo Y a COORD_CHAT', async () => {
  const tg = await fakeTelegram();
  const casa = mkdtempSync(join(tmpdir(), 'coord-'));
  datosConTemas(casa);
  try {
    const { code } = await runNotify(['--chat', '-777', 'listo'], {
      env: { TELEGRAM_API_BASE: tg.base, DATA_DIR: join(casa, 'data'),
             COORD_CHAT: '-999' },
    });
    assert.equal(code, 0);
    assert.equal(tg.seen[0].payload.chat_id, '-777');
    assert.equal(tg.seen[0].payload.text, 'listo');
  } finally {
    tg.server.close();
    rmSync(casa, { recursive: true, force: true });
  }
});

test('notify: sin destino Y sin ningún tema vivo, sigue negándose con exit 2', async () => {
  const casa = mkdtempSync(join(tmpdir(), 'coord-'));
  mkdirSync(join(casa, 'data'), { recursive: true });
  try {
    const { code, err } = await runNotify(['listo'], {
      env: { DATA_DIR: join(casa, 'data'), COORD_CHAT: undefined },
    });
    assert.equal(code, 2, 'inventarse un destino es peor que no avisar');
    assert.match(err, /no hay a dónde avisar/);
    assert.match(err, /actividad\s+reciente/, 'y dice DÓNDE miró');
  } finally { rmSync(casa, { recursive: true, force: true }); }
});
