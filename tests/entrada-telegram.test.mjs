// Test de INTEGRACIÓN del camino real de un mensaje: update de Telegram →
// enrutado de grammY → buffer → ejecutor → respuesta. Sin red y sin token: el
// `botInfo` se inyecta y las llamadas salientes se interceptan con un
// transformer de grammY.
//
// Por qué hace falta además de los unitarios de `buffer.ts`: lo que puede
// romperse aquí no es la máquina de estados, es su ENCAJE con el enrutado —que
// los comandos de control sigan ganando, que un trozo que empieza por `/` no se
// lo trague el `return` de «comando no reconocido», y que el ejecutor reciba el
// texto UNIDO y no el último trozo—. Nada de eso se ve desde `buffer.ts`.
//
// (Y por eso `src/index.ts` se partió en `src/bot.ts`: importar el entry point
// arrancaba el bot, así que este camino no se podía probar y no lo probaba nadie.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = mkdtempSync(join(tmpdir(), 'coord-tg-'));
process.env.BOT_TOKEN = '123456:TEST-token';
process.env.ALLOWED_USER_IDS = '4242';
process.env.DATA_DIR = join(raiz, 'casa', 'data');
process.env.COORD_WS_RAIZ = join(raiz, 'ws');

// Un ejecutor que devuelve tal cual lo que recibe por stdin: así lo que se
// afirma es exactamente lo que le llegó al comando.
mkdirSync(join(raiz, 'casa', 'data', 'executors'), { recursive: true });
writeFileSync(join(raiz, 'casa', 'data', 'executors', 'eco.json'),
  JSON.stringify({ name: 'eco', command: 'cat', encargados: [] }));

const { crearBot } = await import('../src/bot.js');
const { LIMITE } = await import('../src/buffer.js');

const CHAT = -1004383895505;
const TEMA = 2;
const USUARIO = 4242;

const bot = await crearBot({
  id: 1, is_bot: true, first_name: 'coord', username: 'coordbot',
  can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false,
});

let salidas = [];
let idSalida = 5000;
bot.api.config.use(async (_prev, method, payload) => {
  salidas.push({ method, payload });
  if (method === 'sendMessage') {
    return { ok: true, result: { message_id: ++idSalida, date: 0, chat: { id: CHAT, type: 'supergroup' }, text: payload.text } };
  }
  return { ok: true, result: true };
});

let uid = 0;
let mid = 0;
function update(text, { comando = false } = {}) {
  const message = {
    message_id: ++mid,
    date: Math.floor(Date.now() / 1000),
    chat: { id: CHAT, type: 'supergroup', title: 'pruebas' },
    from: { id: USUARIO, is_bot: false, first_name: 'dueño' },
    message_thread_id: TEMA,
    text,
  };
  // Telegram marca `/loquesea` al principio como entidad, y grammY exige esa
  // entidad para que `bot.command` case. Sin esto, el test no probaría el
  // enrutado real.
  if (comando) message.entities = [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0].length }];
  return { update_id: ++uid, message };
}

const enviar = async (text, opts) => { salidas = []; await bot.handleUpdate(update(text, opts)); };
const textos = () => salidas.filter((s) => s.method === 'sendMessage').map((s) => s.payload.text);
/** El coordinador trocea la SALIDA a 4000; unirla devuelve lo que dio el ejecutor. */
const respuesta = () => textos().join('');
const lleno = (c) => c.repeat(LIMITE);

test('se abre la sesión con /use', async () => {
  await enviar('/use eco', { comando: true });
  assert.match(respuesta(), /Sesión abierta con "eco"/);
});

test('tres trozos llegan al ejecutor como UN texto, y el aviso se EDITA en vez de repetirse', async () => {
  const [a, b, c] = ['a', 'b', 'c'].map(lleno);

  await enviar(a);
  assert.equal(salidas.length, 1, 'un solo aviso');
  assert.equal(salidas[0].method, 'sendMessage');
  assert.match(textos()[0], /1 trozo\(s\) · 4096 caracteres/);

  await enviar(b);
  assert.equal(salidas[0].method, 'editMessageText', 'el segundo trozo EDITA el aviso, no manda otro');
  assert.match(salidas[0].payload.text, /2 trozo\(s\) · 8192 caracteres/);

  await enviar(c);
  assert.equal(salidas[0].method, 'editMessageText');
  assert.match(salidas[0].payload.text, /3 trozo\(s\) · 12288 caracteres/);

  await enviar('y esto lo cierra');
  assert.equal(respuesta(), a + b + c + 'y esto lo cierra',
    'el ejecutor recibió el pegado ENTERO, no el último trozo');
});

test('un trozo que empieza por «/» NO se descarta: es la continuación del pegado', async () => {
  const a = lleno('a');
  await enviar(a);
  assert.match(textos()[0], /1 trozo/);

  // El corte cayó justo antes de una ruta. Telegram lo marca como comando.
  await enviar('/usr/bin/env python3 sigue aquí', { comando: true });
  assert.equal(respuesta(), a + '/usr/bin/env python3 sigue aquí');
});

test('un comando desconocido SIN pegado a medias ahora avisa (antes: silencio)', async () => {
  await enviar('/noexiste', { comando: true });
  assert.match(respuesta(), /«\/noexiste» no es un comando/);
});

test('múltiplo exacto del límite: se queda esperando y /pegado ya lo suelta entero', async () => {
  const [a, b] = ['a', 'b'].map(lleno);
  await enviar(a);
  await enviar(b);
  assert.equal(salidas[0].method, 'editMessageText');

  await enviar('/pegado', { comando: true });
  assert.match(respuesta(), /2 trozo\(s\) · 8192 caracteres/);

  await enviar('/pegado ya', { comando: true });
  assert.equal(respuesta(), a + b, 'el ejecutor recibió los dos trozos, sin nada añadido');
});

test('/pegado off tira lo pendiente y lo dice', async () => {
  await enviar(lleno('z'));
  await enviar('/pegado off', { comando: true });
  assert.match(respuesta(), /Tirados 1 trozo\(s\) \(4096 caracteres\)/);

  await enviar('/pegado', { comando: true });
  assert.match(respuesta(), /No hay ningún pegado a medias/);
});

test('un mensaje normal sigue yendo directo al ejecutor', async () => {
  await enviar('hola, esto es corto');
  assert.equal(respuesta(), 'hola, esto es corto');
});
