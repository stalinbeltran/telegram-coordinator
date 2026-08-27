#!/usr/bin/env node
// ¿En qué workspace estoy, y está sano? — las cuatro preguntas de CLAUDE.md
// (§ «Varias sesiones a la vez»), contestadas de una vez.
//
// Por qué existe: desde 2026-08-27 hay varias sesiones de Claude sobre copias
// distintas de los mismos repos. Todo lo que las separa —la rama, el prefijo de
// las máquinas que se pagan, a qué árbol mira el coordinador— es un dato que
// está en un fichero distinto cada uno, y equivocarse en cualquiera no falla:
// funciona mal y en silencio. Esto los lee todos y los contrasta.
//
// Comprueba ESTADO UTILIZABLE, no presencia (CLAUDE.md, regla 5 de escritura):
// no basta con que el repo esté, tiene que estar en la rama de este workspace;
// no basta con que `fuentes.json` exista, tiene que apuntar aquí.
//
//   node scripts/workspace.mjs          # informe
//   node scripts/workspace.mjs --json   # lo mismo, para un script
//
// Sale con código 0 sólo si el workspace es coherente. Cada fallo trae el
// comando exacto que lo arregla.

import { readFileSync, existsSync, readlinkSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const COORD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WS = dirname(COORD);                 // el workspace es el PADRE del coordinador
const REPOS = ['foveal-vision', 'telegram-coordinator',
               'digital-ocean-dropplet-auto-launching', 'image-text-sample-generator'];

const problemas = [];
const ok = [];
const nota = (lista, campo, detalle, arreglo) =>
  lista.push({ campo, detalle, arreglo });

function sh(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

// --- 1. la identidad
let ws = null;
const wsFile = join(WS, 'WORKSPACE.json');
if (!existsSync(wsFile)) {
  nota(problemas, 'WORKSPACE.json', `no existe en ${WS}`,
    `crea ${wsFile} con {"nombre","prefijo","rama","creado","que"} — sin identidad, ` +
    `las máquinas que pagues no se distinguen de las de otra sesión`);
} else {
  try {
    ws = JSON.parse(readFileSync(wsFile, 'utf8'));
    for (const c of ['nombre', 'prefijo', 'rama']) {
      if (!ws[c]) nota(problemas, 'WORKSPACE.json', `le falta "${c}"`,
        `añádelo a ${wsFile}`);
    }
    if (ws.nombre) nota(ok, 'workspace', `"${ws.nombre}" · prefijo "${ws.prefijo}" · rama "${ws.rama}"`);
  } catch (e) {
    nota(problemas, 'WORKSPACE.json', `no es JSON válido: ${e.message}`, `arregla ${wsFile}`);
  }
}

// --- 2. los repos hermanos, TODOS: se resuelven por ROOT.parent
for (const r of REPOS) {
  const p = join(WS, r);
  if (!existsSync(p)) {
    nota(problemas, 'repo', `falta ${r}`,
      `los scripts buscan a sus hermanos en ROOT.parent (bench_dataset.py:46, ` +
      `estudio_flota.py:179): una copia parcial no falla al empezar, falla a mitad.\n` +
      `      git -C ${WS} clone https://github.com/stalinbeltran/${r}.git`);
    continue;
  }
  const rama = sh('git branch --show-current', p);
  if (ws?.rama && rama && rama !== ws.rama) {
    nota(problemas, 'rama', `${r} está en "${rama}" y este workspace es "${ws.rama}"`,
      `git -C ${p} checkout ${ws.rama}   (o corrige "rama" en WORKSPACE.json)`);
  } else {
    nota(ok, 'repo', `${r} en "${rama || '?'}"`);
  }
}

// --- 3. ¿a qué árbol mira el coordinador?
const fuentesFile = join(COORD, 'data', 'fuentes.json');
if (existsSync(fuentesFile)) {
  let fuentes = [];
  try { fuentes = JSON.parse(readFileSync(fuentesFile, 'utf8')).fuentes ?? []; } catch { /* roto: el bot ya avisa */ }
  const fuera = fuentes.filter((f) => !f.replace('~', process.env.HOME ?? '~').startsWith(WS));
  if (fuera.length) {
    nota(problemas, 'fuentes.json', `apunta fuera de este workspace: ${JSON.stringify(fuera)}`,
      `los ejecutores se llaman igual en todas las copias (bench, estudio, vigilante), ` +
      `así que /executors mezclaría los de otra sesión.\n` +
      `      escribe en ${fuentesFile}:  {"fuentes": ["${join(WS, '*', 'telegram')}"]}`);
  } else {
    nota(ok, 'fuentes.json', `${JSON.stringify(fuentes)} — sólo este workspace`);
  }
}

// --- 4. qué corre que NO es mío
//
// ⚠ De quién es un proceso lo dice su CWD, NO su línea de comando. Comprobado
// el 2026-08-27: la flota se lanza como `.venv/bin/python scripts/estudio_flota.py`,
// o sea con RUTA RELATIVA, así que la línea de `ps` no contiene el workspace por
// ningún lado y filtrar por ella clasifica tus propios procesos como ajenos.
// `/proc/<pid>/cwd` sí lo da bien. Es la misma trampa que hace inútil un
// `pgrep -f <ruta>`.
const vivos = (sh('ps -eo pid,args') ?? '').split('\n').slice(1)
  .filter((l) => /estudio_flota\.py|vigilante_avance\.py|bench_fleet\.py/.test(l))
  .filter((l) => !/\bgrep\b/.test(l))
  .map((l) => {
    const pid = l.trim().split(/\s+/)[0];
    let cwd = null;
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* murió, o no es Linux */ }
    return { pid, cwd, linea: l.trim() };
  })
  // sin cwd legible no se puede decir de quién es, y adivinarlo es peor que no
  // decirlo: se cuenta aparte en vez de asumir que es ajeno.
  .filter((v) => v.cwd !== null);
const ajenos = vivos.filter((v) => !v.cwd.startsWith(WS));
const mios = vivos.filter((v) => v.cwd.startsWith(WS));
if (mios.length) nota(ok, 'corriendo (mío)', `${mios.length} proceso(s)`);
if (ajenos.length) {
  nota(ok, 'corriendo (AJENO)',
    `${ajenos.length} proceso(s) de otro workspace — NO los toques, y no uses ` +
    `pkill -f: mataría los tuyos y los suyos`);
}

// --- informe
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ workspace: WS, identidad: ws, ok, problemas }, null, 1));
  process.exit(problemas.length ? 1 : 0);
}
console.log(`\nWorkspace: ${WS}  (${basename(WS)})\n`);
for (const o of ok) console.log(`[  ok  ] ${o.campo.padEnd(18)} ${o.detalle}`);
for (const p of problemas) console.log(`[ FALTA] ${p.campo.padEnd(18)} ${p.detalle}`);
if (problemas.length) {
  console.log(`\n${problemas.length} cosa(s) que arreglar:\n`);
  for (const p of problemas) console.log(`  ${p.campo}: ${p.detalle}\n    → ${p.arreglo}\n`);
} else {
  console.log('\nWorkspace coherente.');
}
process.exit(problemas.length ? 1 : 0);
