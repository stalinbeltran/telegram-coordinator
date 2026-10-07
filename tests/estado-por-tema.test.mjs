// El estado por tema viaja al almacén y vuelve al nacer el dev (scripts/estado-por-tema.mjs).
//
// El esfuerzo va donde está la consecuencia (R10):
//   1. UN SECRETO EN EL REPO DE DATOS no se deshace: se prueba lo que la foto redacta, no el
//      camino feliz. mensajes.mjs redacta al escribir pero sin rejilla final.
//   2. PISAR LO LOCAL al restaurar es corrupción silenciosa: se prueba que nunca se quita una
//      línea local, ni por el tope, y que repetir no duplica (la frontera es determinista).
//   3. RESTAURAR DESDE UN CLON VIEJO (GitHub, o sin fetch) sería leer datos de antes del 10-03
//      con todos los indicadores en verde: se prueba que se niega ANTES de escribir.
//   4. Que la foto commitee algo que no es suyo (el trabajo a medias de quien edite el repo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARPETA, NO_VIAJAN, VIAJAN, escribirConCuidado } from '../scripts/estado-por-tema.mjs';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const GUION = join(RAIZ, 'scripts', 'estado-por-tema.mjs');
const ARCHIVADOR = join(RAIZ, 'scripts', 'guardar-conversacion.mjs');
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} en ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

const HOY = Date.now();
const hace = (dias, horas = 0) => HOY - Math.round(dias * 86_400_000) - Math.round(horas * 3_600_000);
const idEn = (ms, azar = 'aaaaaa') => ms.toString(36).padStart(8, '0') + '000' + azar;
const tsDe = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const linea = (ms, texto, extra = {}) =>
  JSON.stringify({ id: idEn(ms), ts: tsDe(ms), sesion: '-100_7', autor: 'claude', origen: 'telegram', texto, ...extra });
const leer = (ruta) => (existsSync(ruta) ? readFileSync(ruta, 'utf8') : null);
const lineasDe = (txt) => txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));

/**
 * Una máquina de mentira: su data/, su clon del repo de datos, y un ALMACÉN (repo desnudo)
 * con lo que otras máquinas dejaron. `clonDivergido` imita al dev del 2026-10-07: un clon
 * con otra historia (GitHub) y origin apuntado al almacén.
 */
function maquina({ locales = {}, almacen = {}, perfiles = {}, perfilesLocales = {}, secretos = '',
  clonDivergido = false } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'ept-'));
  const casa = join(raiz, 'src', 'telegram-coordinator');
  const data = join(casa, 'data');
  mkdirSync(join(data, 'mensajes'), { recursive: true });
  mkdirSync(join(raiz, '.config'), { recursive: true });
  writeFileSync(join(raiz, '.config', 'dev-secrets.env'), secretos);
  for (const [tema, ls] of Object.entries(locales)) {
    writeFileSync(join(data, 'mensajes', `${tema}.jsonl`), ls.join('\n') + '\n');
  }
  for (const [nombre, txt] of Object.entries(perfilesLocales)) {
    mkdirSync(join(data, 'claude-profile'), { recursive: true });
    writeFileSync(join(data, 'claude-profile', nombre), txt);
  }
  const bare = join(raiz, 'almacen.git');
  git(raiz, 'init', '-q', '--bare', '-b', 'main', bare);
  const seed = join(raiz, 'seed');
  git(raiz, 'init', '-q', '-b', 'main', seed);
  writeFileSync(join(seed, 'README.md'), 'repo de datos de mentira\n');
  mkdirSync(join(seed, 'conversaciones'), { recursive: true });
  writeFileSync(join(seed, 'conversaciones', 'README.md'), 'cabecera\n<!-- INDICE -->\n');
  for (const [maq, temas] of Object.entries(almacen)) {
    for (const [tema, ls] of Object.entries(temas)) {
      const d = join(seed, CARPETA, maq, 'mensajes');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, `${tema}.jsonl`), ls.join('\n') + '\n');
    }
  }
  for (const [maq, fs] of Object.entries(perfiles)) {
    for (const [nombre, txt] of Object.entries(fs)) {
      const d = join(seed, CARPETA, maq, 'claude-profile');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, nombre), txt);
    }
  }
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'almacén de mentira');
  git(seed, 'remote', 'add', 'origin', bare); git(seed, 'push', '-q', '-u', 'origin', 'main');

  const datos = join(raiz, 'src', 'foveal-vision-data');
  if (clonDivergido) {
    const otro = join(raiz, 'otro.git');
    git(raiz, 'init', '-q', '--bare', '-b', 'main', otro);
    const w = join(raiz, 'otro-work');
    git(raiz, 'init', '-q', '-b', 'main', w);
    writeFileSync(join(w, 'viejo.txt'), 'historia de GitHub\n');
    git(w, 'add', '-A'); git(w, 'commit', '-q', '-m', 'viejo');
    git(w, 'remote', 'add', 'origin', otro); git(w, 'push', '-q', '-u', 'origin', 'main');
    git(raiz, 'clone', '-q', otro, datos);
    git(datos, 'remote', 'set-url', 'origin', bare);
  } else {
    git(raiz, 'clone', '-q', bare, datos);
  }
  const env = { ...process.env, ...GIT_ENV, HOME: raiz, COORD_HOME: casa, COORD_DATOS: datos,
    DATA_DIR: data, COORD_MAQUINA_ID: 'maq-test' };
  return { raiz, casa, data, datos, bare, env, log: (tema) => join(data, 'mensajes', `${tema}.jsonl`) };
}

function correr(m, args, extraEnv = {}) {
  const r = spawnSync('node', [GUION, ...args], { encoding: 'utf8', cwd: m.casa, env: { ...m.env, ...extraEnv } });
  return { salida: (r.stdout ?? '') + (r.stderr ?? ''), codigo: r.status };
}

// ------------------------------------------------------------------ la FOTO

test('la foto copia el historial a coordinador/<máquina>/ y REDACTA lo que el log dejó pasar', () => {
  const secreto = 'ghp_UNSECRETOMUYLARGOQUENODEBEVIAJAR123456';
  const tg = `123456789:${'A'.repeat(35)}`;
  const m = maquina({ secretos: `GITHUB_TOKEN=${secreto}\n`,
    locales: { '-100_7': [linea(hace(0, 2), `token: ${secreto}`), linea(hace(0, 1), `bot ${tg}`)] } });
  const r = correr(m, ['--foto', '--sin-git']);
  assert.equal(r.codigo, 0, r.salida);
  const txt = leer(join(m.datos, CARPETA, 'maq-test', 'mensajes', '-100_7.jsonl'));
  assert.ok(txt, 'escribió la foto');
  assert.doesNotMatch(txt, /ghp_UNSECRETO/, 'EL SECRETO LLEGÓ AL REPO DE DATOS');
  assert.match(txt, /REDACTADO:GITHUB_TOKEN/);
  assert.doesNotMatch(txt, /123456789:AAAA/, 'un token con forma de Telegram llegó');
  assert.match(txt, /REDACTADO:TOKEN-TELEGRAM/);
  assert.deepEqual(lineasDe(txt).map((o) => o.id), lineasDe(leer(m.log('-100_7'))).map((o) => o.id),
    'mismos ids y mismo orden que el log');
  assert.ok(existsSync(join(m.datos, CARPETA, 'maq-test', 'meta.json')), 'meta.json de la máquina');
  assert.ok(existsSync(join(m.datos, CARPETA, 'README.md')), 'README de la carpeta');
  assert.ok(git(m.datos, 'status', '--porcelain').length, 'con --sin-git queda sin commitear');
});

test('--foto --seco dice qué cambiaría y no escribe nada', () => {
  const m = maquina({ locales: { '-100_7': [linea(hace(0, 1), 'hola')] } });
  const r = correr(m, ['--foto', '--seco']);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /SECO/);
  assert.match(r.salida, /1 fichero/);
  assert.ok(!existsSync(join(m.datos, CARPETA)), 'no escribió');
});

test('la foto commitea SÓLO coordinador/, empuja al almacén, y sin cambios no commitea', () => {
  const m = maquina({ locales: { '-100_7': [linea(hace(0, 1), 'hola')] } });
  writeFileSync(join(m.datos, 'ajeno.txt'), 'trabajo a medias de otro\n');
  const r = correr(m, ['--foto']);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /empujado/);
  const enAlmacen = git(m.bare, 'ls-tree', '-r', '--name-only', 'main');
  assert.match(enAlmacen, /coordinador\/maq-test\/mensajes\/-100_7\.jsonl/);
  assert.doesNotMatch(enAlmacen, /ajeno\.txt/, 'arrastró un fichero que no es suyo');
  const antes = git(m.bare, 'rev-parse', 'main');
  const r2 = correr(m, ['--foto']);
  assert.match(r2.salida, /nada ha cambiado/);
  assert.equal(git(m.bare, 'rev-parse', 'main'), antes, 'una foto sin cambios no commitea');
});

test('la foto NO borra la carpeta de otra máquina', () => {
  const m = maquina({ locales: { '-100_7': [linea(hace(0, 1), 'hola')] },
    almacen: { 'do-1': { '-100_7': [linea(hace(2), 'de la máquina anterior')] } } });
  const r = correr(m, ['--foto']);
  assert.equal(r.codigo, 0, r.salida);
  const enAlmacen = git(m.bare, 'ls-tree', '-r', '--name-only', 'main');
  assert.match(enAlmacen, /coordinador\/do-1\/mensajes\/-100_7\.jsonl/);
  assert.match(enAlmacen, /coordinador\/maq-test\/mensajes\/-100_7\.jsonl/);
});

test('el archivador de conversaciones hace la foto en el mismo viaje', () => {
  const m = maquina({ locales: { '-100_7': [linea(hace(0, 1), 'hola')] } });
  const proy = join(m.raiz, '.claude', 'projects', '-x');
  mkdirSync(proy, { recursive: true });
  writeFileSync(join(proy, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'),
    JSON.stringify({ type: 'user', timestamp: '2026-10-07T00:00:00.000Z', message: { content: 'hola' } }) + '\n');
  const r = spawnSync('node', [ARCHIVADOR, '--sin-git'], { encoding: 'utf8', cwd: m.casa, env: m.env });
  const salida = (r.stdout ?? '') + (r.stderr ?? '');
  assert.equal(r.status, 0, salida);
  assert.match(salida, /estado por tema: 1 fichero/);
  assert.ok(existsSync(join(m.datos, CARPETA, 'maq-test', 'mensajes', '-100_7.jsonl')), 'la foto se hizo');
});

// ---------------------------------------------------------- la RESTAURACIÓN

test('restaurar fusiona por id, no toca lo local, deja la frontera y repetir no duplica', () => {
  const m = maquina({ locales: { '-100_7': [linea(hace(0, 1), 'hoy, local')] },
    almacen: { 'do-1': { '-100_7': [linea(hace(3), 'ayer 1'), linea(hace(2), 'ayer 2')] } } });
  const r = correr(m, ['--restaurar']);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /\+2 línea/);
  const ls = lineasDe(leer(m.log('-100_7')));
  assert.deepEqual(ls.map((o) => o.texto.slice(0, 6)), ['ayer 1', 'ayer 2', '⟂ Máqu', 'hoy, l'],
    'lo viejo, la frontera, y lo local al final, por id');
  const frontera = ls[2];
  assert.equal(frontera.autor, 'sistema');
  assert.equal(frontera.origen, 'restaurar');
  assert.match(frontera.texto, /claude NO lo recuerda/);
  assert.match(frontera.texto, /\/use c/);
  for (let i = 1; i < ls.length; i++) assert.ok(ls[i - 1].id < ls[i].id, 'los ids crecen');
  const txt1 = leer(m.log('-100_7'));
  const r2 = correr(m, ['--restaurar']);
  assert.equal(r2.codigo, 0, r2.salida);
  assert.match(r2.salida, /Nada que restaurar/);
  assert.equal(leer(m.log('-100_7')), txt1, 'repetir no cambió ni un byte');
});

test('restaurar se NIEGA si origin apunta a GitHub, sin escribir nada', () => {
  const m = maquina({ locales: { '-100_7': [linea(hace(0, 1), 'local')] },
    almacen: { 'do-1': { '-100_7': [linea(hace(2), 'viejo')] } } });
  git(m.datos, 'remote', 'set-url', 'origin', 'https://github.com/x/y.git');
  const antes = leer(m.log('-100_7'));
  const r = correr(m, ['--restaurar']);
  assert.equal(r.codigo, 2, r.salida);
  assert.match(r.salida, /NO restauro/);
  assert.match(r.salida, /GitHub/);
  assert.equal(leer(m.log('-100_7')), antes);
});

test('restaurar se NIEGA si no puede hablar con el almacén', () => {
  const m = maquina({ locales: { '-100_7': [linea(hace(0, 1), 'local')] } });
  git(m.datos, 'remote', 'set-url', 'origin', join(m.raiz, 'no-existe.git'));
  const r = correr(m, ['--restaurar']);
  assert.equal(r.codigo, 2, r.salida);
  assert.match(r.salida, /no pude hablar con el almacén/);
});

test('restaurar funciona aunque el clon esté DIVERGIDO del almacén (lee origin/main, no el árbol)', () => {
  const m = maquina({ clonDivergido: true, locales: { '-100_7': [linea(hace(0, 1), 'local')] },
    almacen: { 'do-1': { '-100_7': [linea(hace(2), 'viejo')] } } });
  git(m.datos, 'fetch', '-q', 'origin');   // con origin/main ya apuntando al almacén…
  assert.throws(() => git(m.datos, 'merge-base', 'HEAD', 'origin/main'), 'la prueba es válida: no hay base común');
  const r = correr(m, ['--restaurar']);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /\+1 línea/);
  assert.equal(lineasDe(leer(m.log('-100_7'))).length, 3);
});

test('restaurar NUNCA quita una línea local: el tope se come lo restaurado más viejo', () => {
  const locales = [1, 2, 3, 4].map((h) => linea(hace(0, h), `local ${h}`));
  const viejas = Array.from({ length: 10 }, (_, i) => linea(hace(5, i), `viejo ${i}`));
  const m = maquina({ locales: { '-100_7': locales }, almacen: { 'do-1': { '-100_7': viejas } } });
  const r = correr(m, ['--restaurar'], { COORD_LOG_TOPE: '5' });
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /\+1 línea/);
  const ls = lineasDe(leer(m.log('-100_7')));
  const textos = ls.map((o) => o.texto);
  for (const h of [1, 2, 3, 4]) assert.ok(textos.includes(`local ${h}`), `se perdió «local ${h}»`);
  assert.ok(textos.includes('viejo 0'), 'entra la restaurada MÁS RECIENTE (viejo 0 es la más nueva)');
  assert.equal(ls.filter((o) => o.origen === 'telegram').length, 5, '4 locales + 1 restaurada = el tope');
});

test('restaurar aplica la ventana de la purga a lo que trae', () => {
  const m = maquina({ almacen: { 'do-1': { '-100_7': [linea(hace(40), 'de hace 40 días'), linea(hace(2), 'de hace 2 días')] } } });
  const r = correr(m, ['--restaurar'], { COORD_LOG_DIAS: '30' });
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /\+1 línea/);
  const textos = lineasDe(leer(m.log('-100_7'))).map((o) => o.texto);
  assert.ok(textos.includes('de hace 2 días'));
  assert.ok(!textos.includes('de hace 40 días'), 'una línea más vieja que la purga no vuelve');
});

test('restaurar trae el #modelo por tema si falta y no pisa el que ya está', () => {
  const m = maquina({
    almacen: { 'do-1': { '-100_7': [linea(hace(2), 'viejo')] } },
    perfiles: { 'do-1': { '-100_7.json': '{"model":"opus"}\n', '_global.json': '{"model":"sonnet"}\n' } },
    perfilesLocales: { '_global.json': '{"model":"haiku"}\n' },
  });
  const r = correr(m, ['--restaurar']);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /1 restaurado\(s\), 1 ya estaba/);
  assert.equal(leer(join(m.data, 'claude-profile', '-100_7.json')), '{"model":"opus"}\n');
  assert.equal(leer(join(m.data, 'claude-profile', '_global.json')), '{"model":"haiku"}\n', 'pisó el local');
});

test('--restaurar --seco dice qué traería y no escribe', () => {
  const m = maquina({ almacen: { 'do-1': { '-100_7': [linea(hace(3), 'a'), linea(hace(2), 'b')] } } });
  const r = correr(m, ['--restaurar', '--seco']);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /SECO/);
  assert.match(r.salida, /\+2 línea/);
  assert.ok(!existsSync(m.log('-100_7')), 'no escribió');
});

test('escribir con cuidado: un append durante la fusión no se pierde', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'ept-'));
  const f = join(raiz, 'x.jsonl');
  writeFileSync(f, 'uno\n');
  const bytesAntes = 4;
  appendFileSync(f, 'dos, escrita mientras se fusionaba\n');
  assert.equal(escribirConCuidado(f, 'FUSION\n', bytesAntes), false, 'tiene que negarse: el original creció');
  assert.match(readFileSync(f, 'utf8'), /dos, escrita mientras/);
  assert.ok(!existsSync(`${f}.restaurando`), 'sin temporal huérfano');
  assert.equal(escribirConCuidado(f, 'FUSION\n', readFileSync(f).length), true, 'y con el tamaño actual, escribe');
});

// ------------------------------------------------------------ la CLASIFICACIÓN

test('toda carpeta de data/ en .gitignore está clasificada: viaja o no viaja', () => {
  const gi = readFileSync(join(RAIZ, '.gitignore'), 'utf8');
  const carpetas = [...gi.matchAll(/^data\/([\w-]+)\/\s*$/gm)].map((m) => m[1]);
  assert.ok(carpetas.length >= 5, 'la prueba lee algo');
  const sinClasificar = carpetas.filter((c) => !VIAJAN.includes(c) && !NO_VIAJAN.includes(c));
  assert.deepEqual(sinClasificar, [], `carpetas de data/ sin decidir si viajan: ${sinClasificar.join(', ')}`);
  assert.deepEqual(VIAJAN.filter((c) => NO_VIAJAN.includes(c)), [], 'una carpeta no puede estar en las dos listas');
});
