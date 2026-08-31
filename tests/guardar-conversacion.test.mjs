// Archivar las conversaciones de Claude Code en el repo de datos.
//
// El esfuerzo está donde está la consecuencia (R10), y aquí es MUY desigual:
//
//   1. LA REDACCIÓN — el repo de datos es PÚBLICO y git no olvida. Un secreto
//      que se cuele no se puede deshacer: hay que rotar la credencial. Es lo
//      único de este script que no admite un fallo, así que se prueba lo que
//      RECHAZA y lo que redacta, no el camino feliz.
//   2. QUE REDACTE DE MÁS — medido el 2026-08-31: filtrar sólo por longitud
//      borraba `CLAUDE_PERMISSION_MODE` (= `bypassPermissions`, configuración)
//      de las 18 veces que aparece. Silencioso, y destroza justo el texto que se
//      guarda para poder leerlo.
//   3. que el hook rompa una sesión — sale con 0 pase lo que pase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const GUION = join(RAIZ, 'scripts', 'guardar-conversacion.mjs');

/** Una máquina de mentira: HOME propio, repo de datos propio, un transcript. */
function maquina({ secretos = '', lineas = [] } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'conv-'));
  const casa = join(raiz, 'src', 'telegram-coordinator');
  const datos = join(raiz, 'src', 'foveal-vision-data');
  const proy = join(raiz, '.claude', 'projects', '-x');
  for (const d of [casa, join(datos, 'conversaciones'), proy, join(raiz, '.config')]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(join(raiz, '.config', 'dev-secrets.env'), secretos);
  writeFileSync(join(datos, 'conversaciones', 'README.md'), 'cabecera\n<!-- INDICE -->\nviejo\n');
  writeFileSync(join(proy, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'),
    lineas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { raiz, casa, datos, proy };
}

function correr(m, ...extra) {
  // ⚠ stdout Y stderr: los AVISOS (lo dudoso, lo rechazado, "no encuentro el
  // repo") van por stderr, y son justo lo que hay que comprobar. Capturar sólo
  // stdout hacía pasar por vacío el caso interesante.
  const r = spawnSync('node', [GUION, '--sin-git', ...extra], {
    encoding: 'utf8', cwd: m.casa,
    env: { ...process.env, HOME: m.raiz, COORD_HOME: m.casa },
  });
  return { salida: (r.stdout ?? '') + (r.stderr ?? ''), codigo: r.status };
}

const MSG = (t) => ({ type: 'user', timestamp: '2026-08-31T10:00:00.000Z',
                      message: { content: t } });

function guardado(m) {
  const dir = join(m.datos, 'conversaciones', '2026');
  if (!existsSync(dir)) return null;
  const mes = join(dir, readdirSync(dir)[0]);
  const f = readdirSync(mes)[0];
  return gunzipSync(readFileSync(join(mes, f))).toString('utf8');
}

// --------------------------------------------------- 1. la redacción, la puerta

test('un secreto del .env NO llega al fichero guardado', () => {
  const m = maquina({
    secretos: 'GITHUB_TOKEN=ghp_UNSECRETOMUYLARGOQUENODEBEVIAJAR123456\n',
    lineas: [MSG('mira este token: ghp_UNSECRETOMUYLARGOQUENODEBEVIAJAR123456 ya está')],
  });
  correr(m);
  const txt = guardado(m);
  assert.ok(txt, 'se guardó algo');
  assert.doesNotMatch(txt, /ghp_UNSECRETOMUYLARGOQUENODEBEVIAJAR/,
    'EL SECRETO LLEGÓ AL REPO PÚBLICO');
  assert.match(txt, /REDACTADO:GITHUB_TOKEN/, 'y se ve que estuvo ahí');
});

test('un secreto por PATRÓN se redacta aunque no esté en ningún .env', () => {
  // el caso real: una clave que apareció en la conversación y que esta máquina
  // no tiene en sus ficheros (la pegó el usuario, la imprimió un error...)
  const m = maquina({
    lineas: [MSG('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA fin')],
  });
  correr(m);
  assert.doesNotMatch(guardado(m), /sk-ant-api03-A{10}/);
});

test('si TRAS redactar sigue habiendo forma de secreto, NO se guarda', () => {
  // Se fuerza con un patrón que la redacción por valor no puede cubrir y que la
  // rejilla final sí ve. En un repo público, a medias es peor que nada.
  const m = maquina({ lineas: [MSG('-----BEGIN RSA PRIVATE KEY-----\nabc\n')] });
  const { salida } = correr(m);
  // o lo redactó entero (bien) o se negó (bien); lo que NO puede es guardarlo
  const txt = guardado(m);
  if (txt) assert.doesNotMatch(txt, /BEGIN RSA PRIVATE KEY-----\nabc/);
  else assert.match(salida, /NO la guardo/);
});

// ------------------------------------- 2. redactar de MÁS también es un fallo

test('la CONFIGURACIÓN no se redacta aunque sea larga', () => {
  // Medido el 2026-08-31: con el filtro sólo por longitud, `bypassPermissions`
  // (17 chars) desaparecía de las 18 veces que sale en una conversación normal.
  // El nombre de la variable es lo que decide, que es la convención de siempre.
  const m = maquina({
    secretos: 'CLAUDE_PERMISSION_MODE=bypassPermissions\nFV_WEB_UNIT=foveal-vision-web.service\n',
    lineas: [MSG('corre con bypassPermissions sobre foveal-vision-web.service')],
  });
  correr(m);
  const txt = guardado(m);
  assert.match(txt, /bypassPermissions/, 'se redactó configuración: el archivo pierde sentido');
  assert.match(txt, /foveal-vision-web\.service/);
});

test('un valor largo con nombre que no parece de credencial se AVISA', () => {
  // No se redacta (no parece secreto) pero tampoco se calla: decidir en silencio
  // en cualquiera de los dos sentidos es el fallo.
  const m = maquina({
    secretos: 'ALGO_RARO=valorlargonoobviamentesecreto123\n',
    lineas: [MSG('usa valorlargonoobviamentesecreto123 aquí')],
  });
  const { salida } = correr(m);
  assert.match(salida, /ALGO_RARO/);
  assert.match(salida, /NO se redacta/);
});

// ------------------------------------------------------- 3. lo demás no rompe

test('el hook sale con 0 aunque no haya repo de datos', () => {
  const m = maquina({ lineas: [MSG('hola')] });
  execFileSync('rm', ['-rf', m.datos]);
  const { codigo, salida } = correr(m, '--hook');
  assert.equal(codigo, 0, 'un hook JAMÁS puede impedir que arranque una sesión');
  assert.match(salida, /no encuentro el repo de datos/);
});

test('--seco no escribe nada', () => {
  const m = maquina({ lineas: [MSG('hola')] });
  const { salida } = correr(m, '--seco');
  assert.match(salida, /se guardaría/);
  assert.equal(guardado(m), null, '--seco escribió');
});

test('el índice enlaza a un fichero que EXISTE y cuenta los mensajes del usuario', () => {
  const m = maquina({
    lineas: [MSG('primera pregunta del usuario'),
             { type: 'assistant', message: { content: 'respuesta' } },
             MSG('<system-reminder>ruido</system-reminder>'),
             MSG('segunda pregunta')],
  });
  correr(m);
  const readme = readFileSync(join(m.datos, 'conversaciones', 'README.md'), 'utf8');
  assert.match(readme, /^cabecera/, 'la cabecera del README se conserva');
  assert.doesNotMatch(readme, /viejo/, 'el índice anterior se reescribe, no se acumula');
  const rel = readme.match(/\]\(([^)]+\.jsonl\.gz)\)/)?.[1];
  assert.ok(rel, 'hay enlace');
  assert.ok(existsSync(join(m.datos, 'conversaciones', rel)),
    `el enlace del índice está roto: ${rel}`);
  assert.match(readme, /\| 2 \|/, 'cuenta 2 mensajes de usuario, no el ruido del sistema');
  assert.match(readme, /primera pregunta del usuario/, 'el titular es el primer mensaje real');
});

test('archivar dos veces no reescribe lo que no cambió', () => {
  // Una conversación en curso se archiva muchas veces; cada reescritura sería un
  // objeto nuevo en git para siempre.
  const m = maquina({ lineas: [MSG('hola')] });
  correr(m);
  const { salida } = correr(m);
  assert.match(salida, /0 guardada\(s\), 1 sin cambios/);
});
