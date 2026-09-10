// Tests de la entrada desde la WEB (src/entrada.ts).
//
// Lo que se juega aquí es lo más peligroso de todo el proyecto (R10): este es el
// camino por el que un texto escrito en una web llega a `claude` con
// `bypassPermissions`, o sea a alquilar máquinas y a ejecutar shell. Los cuatro
// casos, por lo que cuesta el fallo:
//
//   1. QUE NO SE EJECUTE DOS VECES. Un turno duplicado es dinero gastado dos
//      veces, y con `c` puede ser una flota entera.
//   2. QUE NO SE EJECUTE LO VIEJO. Si el bot estuvo parado, los mensajes se
//      acumulan — eso está bien, no se pierden. Pero correr al arrancar una orden
//      de hace horas puede hacer algo que ya no quieres.
//   3. QUE APAREZCA EN TELEGRAM. Si los dos clientes no ven lo mismo, el espejo
//      miente.
//   4. QUE UN FICHERO ROTO NO PARE LA COLA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = mkdtempSync(join(tmpdir(), 'coord-entweb-'));
const datos = join(raiz, 'data');
process.env.BOT_TOKEN = '123456:TEST-token';
process.env.ALLOWED_USER_IDS = '4242';
process.env.DATA_DIR = datos;
process.env.COORD_HOME = raiz;

mkdirSync(join(datos, 'executors'), { recursive: true });
mkdirSync(join(datos, 'entrada'), { recursive: true });
writeFileSync(join(datos, 'fuentes.json'), JSON.stringify({ fuentes: [] }));
writeFileSync(join(datos, 'executors', 'eco.json'),
  JSON.stringify({ name: 'eco', command: 'cat', encargados: [], registrar: true }));

const E = await import('../src/entrada.js');
const { setSession } = await import('../src/sessions.js');

const SESION = '-100123_7';
await setSession(SESION, 'eco');

/** Un Telegram de mentira: guarda lo que le mandan. */
const enviados = [];
const enviar = async (chat, hilo, texto) => { enviados.push({ chat, hilo, texto }); };

function dejar(texto, { sesion = SESION, cuando = new Date().toISOString(), nombre } = {}) {
  const f = join(datos, 'entrada', nombre ?? `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify({ sesion, texto, cuando }));
  return f;
}
const log = (s = SESION) => {
  const f = join(datos, 'mensajes', `${s.replace(/[^\w.-]/g, '_')}.jsonl`);
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
};
const enCola = () => readdirSync(join(datos, 'entrada'));

// ------------------------------------------------ 3. el camino normal y el eco

test('un mensaje de la web se atiende, y aparece TAMBIÉN en Telegram', async () => {
  enviados.length = 0;
  dejar('hola desde la app');
  const n = await E.recoger(enviar);
  assert.equal(n, 1);

  // El eco, con su marca: la Bot API no deja publicar en nombre de una persona,
  // así que fingir que eres tú sería mentir sobre quién escribió.
  assert.match(enviados[0].texto, /^📱 \(desde la app\) hola desde la app$/);
  assert.equal(enviados[0].chat, -100123);
  assert.equal(enviados[0].hilo, 7);
  // Y la respuesta del ejecutor también sale por Telegram.
  assert.ok(enviados.some((e) => e.texto === 'hola desde la app'));

  // En el log queda marcado como venido de la web, no de Telegram.
  const l = log();
  assert.deepEqual(l.map((m) => m.origen), ['web', 'web']);
  assert.deepEqual(l.map((m) => m.autor), ['usuario', 'claude']);
});

test('el fichero se borra al atenderlo: no queda nada que repetir', () => {
  assert.deepEqual(enCola(), []);
});

// ------------------------------------------------- 1. que no se ejecute 2 veces

test('⚠ dos pasadas a la vez NO duplican el turno', async () => {
  enviados.length = 0;
  dejar('una sola vez');
  // Dos recogidas simultáneas: es lo que pasa cuando el watcher y el sondeo
  // coinciden. Un turno duplicado con `c` puede ser una flota entera pagada dos veces.
  const [a, b] = await Promise.all([E.recoger(enviar), E.recoger(enviar)]);
  assert.equal(a + b, 1, 'entre las dos tienen que atender UNO, no dos');
  assert.equal(enviados.filter((e) => e.texto.includes('una sola vez')).length, 2,
    'el eco y la respuesta, una vez cada uno');
});

// -------------------------------------------------- 2. que no se ejecute lo viejo

test('⚠ un mensaje VENCIDO no se ejecuta, se aparta y se avisa', async () => {
  enviados.length = 0;
  const antes = log().length;
  dejar('rm -rf algo que ya no quiero', { cuando: new Date(Date.now() - 3600_000).toISOString() });
  await E.recoger(enviar);

  assert.equal(log().length, antes + 1, 'sólo la línea de aviso: NO se ejecutó');
  assert.match(enviados.at(-1).texto, /NO lo he ejecutado/);
  assert.ok(enCola().some((f) => f.endsWith('.caducado')),
    'y NO se borra: tirarlo sería perder lo que escribiste');
});

// --------------------------------------------------- 4. que un roto no pare todo

test('un fichero ilegible se aparta y la cola SIGUE', async () => {
  enviados.length = 0;
  writeFileSync(join(datos, 'entrada', '0000-roto.json'), '{no es json');
  dejar('este sí tiene que correr', { nombre: '9999-bueno.json' });
  await E.recoger(enviar);
  assert.ok(enviados.some((e) => e.texto.includes('este sí tiene que correr')),
    'un fichero corrupto no puede bloquear los que vienen detrás');
  assert.ok(enCola().some((f) => f.endsWith('.roto')));
});

// ------------------------------------------------------- sin sesión abierta

test('sin sesión abierta se DICE, en vez de tragárselo', async () => {
  enviados.length = 0;
  dejar('a un tema sin sesión', { sesion: '-100123_99' });
  await E.recoger(enviar);
  assert.match(enviados.at(-1).texto, /no tiene ninguna sesión abierta/);
  assert.match(enviados.at(-1).texto, /\/use c/, 'y dice cómo arreglarlo');
  assert.equal(enviados.at(-1).hilo, 99);
});
