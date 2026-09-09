// Tests de «¿QUÉ repos vigila el freno?» (la lista `REPOS` de scripts/cerrable.mjs).
//
// Por qué existe, y por qué es el caso caro (R10)
// ----------------------------------------------
// La lista se DECLARA, no se descubre. Eso es deliberado —descubrir cualquier
// `.git` bajo `~/src` metería clones de terceros y repos de usar y tirar— pero
// tiene una consecuencia que ya ha costado tres veces: **un repo nuevo es
// invisible para el freno hasta que alguien lo apunta**, y lo que se ve desde el
// móvil es un `🟢 CERRABLE — todo empujado` con trabajo real sin empujar dentro.
// O sea permiso para destruir la máquina.
//
// Las tres, con su fecha, todas con el mismo síntoma y la misma causa:
//   · `foveal-vision-data`        (2026-08-28) — dos informes de `patience` dentro
//   · `estudios-redes-neuronales` (2026-08-29) — el repo central de los reportes
//   · `claude-code-webapp-mobile` (2026-09-09) — los tres documentos de su plan
//
// Lo que fija este fichero es la REGLA, no la lista: que un repo declarado con
// trabajo sin commitear impide el verde, y que uno que no esté clonado no rompe
// nada. Así, la próxima vez que se añada uno, el test dice si se añadió bien.
//
// ⚠ El primer test FALLA con el código anterior al 2026-09-09 (el repo no estaba
// en la lista): es la comprobación de que esto mide algo y no se limita a
// repetir la constante.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const G = 'git -c user.email=t@test -c user.name=test -c init.defaultBranch=main';
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * Un repo clonado de un remoto propio, que es como nace cada uno en esta máquina.
 * Si es el coordinador, se le meten los scripts commiteados: copiarlos después
 * los dejaría sin trackear y el arnés ensuciaría el árbol que va a medir.
 */
function repoEn(padre, nombre) {
  const origen = join(padre, `${nombre}.git`);
  const semilla = join(padre, `semilla-${nombre}`);
  const dest = join(padre, nombre);
  sh(`${G} init --bare -q ${origen}`, padre);
  sh(`${G} clone -q ${origen} ${semilla}`, padre);
  writeFileSync(join(semilla, 'README.md'), `# ${nombre}\n`);
  if (nombre === 'telegram-coordinator') {
    mkdirSync(join(semilla, 'data'), { recursive: true });
    mkdirSync(join(semilla, 'scripts'), { recursive: true });
    writeFileSync(join(semilla, 'data', 'fuentes.json'), '{"fuentes":["~/src/*/telegram"]}\n');
    for (const f of ['cerrable.mjs', 'workspaces-locales.mjs', 'git-pendiente.mjs']) {
      sh(`cp ${join(RAIZ, 'scripts', f)} ${join(semilla, 'scripts', f)}`, padre);
    }
  }
  sh(`${G} add -A`, semilla);
  sh(`${G} commit -qm inicial`, semilla);
  sh(`${G} push -q origin main`, semilla);
  sh(`${G} clone -q ${origen} ${dest}`, padre);
  rmSync(semilla, { recursive: true, force: true });
  return dest;
}

/** Una máquina de mentira: `$HOME/src` con el coordinador y los repos que se pidan. */
function maquina(extra = []) {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-repos-'));
  const casa = join(raiz, 'src');
  mkdirSync(casa, { recursive: true });
  mkdirSync(join(raiz, 'ws'), { recursive: true });
  const coord = repoEn(casa, 'telegram-coordinator');
  const repos = Object.fromEntries(extra.map((n) => [n, repoEn(casa, n)]));
  return { raiz, casa, coord, repos };
}

/** ⚠ En este arnés el veredicto NUNCA es 🟢: falta el repo del lanzador, así que
 *  `cerrable` no puede preguntar qué hay alquilado y dice `🟡 NO SÉ` — que es su
 *  decisión 1 y está bien. Por eso estos tests miran las RAZONES, no el color. */
function correr(m) {
  const base = { ...process.env };
  delete base.COORD_HOME;
  delete base.COORD_WS;
  return execSync(`node ${join(m.coord, 'scripts', 'cerrable.mjs')} --exit0`, {
    cwd: m.coord, encoding: 'utf8', stdio: 'pipe',
    env: { ...base, COORD_WS_RAIZ: join(m.raiz, 'ws'), HOME: m.raiz, COORD_HOME: m.coord },
  });
}

// --------------------------------------------------------- el caso que ya pasó

test('trabajo sin commitear en claude-code-webapp-mobile IMPIDE el verde', () => {
  const m = maquina(['claude-code-webapp-mobile']);
  writeFileSync(join(m.repos['claude-code-webapp-mobile'], 'plan.md'), 'trabajo real\n');

  const salida = correr(m);
  assert.match(salida, /· claude-code-webapp-mobile: 1 fichero\(s\) sin commitear/,
    'el repo tiene que estar en REPOS y su trabajo pendiente tiene que salir NOMBRADO ' +
    'entre lo que «se perdería»: esto es exactamente lo que el 2026-09-09 salía como ' +
    '«🟢 CERRABLE — todo empujado»');
  assert.doesNotMatch(salida, /🟢/,
    'con trabajo sin empujar, el veredicto NO puede ser verde');
});

// -------------------------- y la otra mitad: añadirlo no rompe donde no está

test('un repo declarado que NO está clonado no da ni aviso ni duda', () => {
  const m = maquina();          // sólo el coordinador: los otros siete no están
  const salida = correr(m);
  assert.doesNotMatch(salida, /claude-code-webapp-mobile/,
    'un repo ausente no puede aparecer: el bucle lo salta, que es lo que hace ' +
    'seguro añadir uno a la lista sin romper las máquinas que no lo tienen');
  assert.doesNotMatch(salida, /sin commitear|sin empujar/,
    'sin trabajo pendiente no puede haber ninguna razón de git');
});
