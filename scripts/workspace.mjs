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

import { readFileSync, writeFileSync, existsSync, readlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { dentroDe } from './workspaces-locales.mjs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const COORD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// El workspace se DECLARA y sólo se deduce del disco como defecto (R4). Con
// `/ws` cada TEMA de Telegram tiene el suyo, y el coordinador lo pasa en
// `COORD_WS`: sin esto, este informe hablaba siempre del árbol del proceso --
// que es exactamente la causa de que todos los temas compartieran uno.
const WS = process.env.COORD_WS ? resolve(process.env.COORD_WS) : dirname(COORD);
// ⚠ `foveal-vision-data` va en la lista, y es el que MAS importa aqui: es donde
// viven los runs, los recorridos y los `windows.npz` que NO se pueden re-derivar.
// Faltaba (esta lista es anterior a la separacion de datos del 2026-08-27) y el
// fallo era del peor tipo: silencioso y creible. Medido el 2026-08-28 -- con dos
// informes de `patience` sin empujar en ese repo, esto imprimia
// "todo commiteado y empujado" y el veredicto salia VERDE, o sea permiso para
// destruir la maquina. Es exactamente la perdida que costo el `r20260824` y la
// comparabilidad de 20 runs ya pagados.
const REPOS = ['foveal-vision', 'foveal-vision-data', 'telegram-coordinator',
               'digital-ocean-dropplet-auto-launching', 'image-text-sample-generator'];

const RAIZ_WS = process.env.COORD_WS_RAIZ ?? join(process.env.HOME ?? '', 'ws');

// --- `--nuevo <linea>`: montar un workspace entero de una vez ----------------
//
// Existe porque hacerlo a mano son ocho pasos y olvidarse de uno no falla: falla
// a mitad y en silencio. Los ocho, y lo que cuesta saltarse cada uno:
//   1. el directorio bajo ~/ws (NO bajo ~/src, que es donde apunta el comodín
//      por defecto de fuentes.json y mezclaría los ejecutores de los dos)
//   2. los CINCO repos, aunque no los uses: los scripts se buscan entre ellos
//      por ROOT.parent, y una copia parcial falla a mitad
//   3. una rama propia en cada uno: el remoto es de todos
//   4. un prefijo propio: es lo ÚNICO que separa tus máquinas de pago de las de
//      otra sesión en una cuenta que es una sola
//   5. WORKSPACE.json en la raíz, que es donde vive esa identidad
//   6. fuentes.json apuntando aquí y sólo aquí
//   7. borrar el estado efímero por tema, que si no lo copiado cree que manda
//      sobre las mismas conversaciones -- incluida `ws/`, la atadura tema →
//      workspace: copiada, los temas del clon apuntarían al workspace de origen
//   8. NO arrancar el bot: sólo una instancia puede hacer polling (error 409)
function nuevo(linea, argv) {
  const dest = join(RAIZ_WS, linea);
  if (existsSync(dest)) {
    console.error(`Ya existe ${dest}. Elige otro nombre o bórralo a mano.`);
    return 1;
  }
  const opt = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };

  // El prefijo NO puede repetirse: `vigilante_avance.py` decide por él qué
  // máquinas son suyas, y dos workspaces con el mismo prefijo se destruyen las
  // máquinas el uno al otro creyéndolas huérfanas propias.
  const usados = new Set();
  for (const raiz of [RAIZ_WS, join(process.env.HOME ?? '', 'src')]) {
    for (const d of (existsSync(raiz) ? sh(`ls -1 ${raiz}`, null)?.split('\n') ?? [] : [])) {
      const f = join(raiz, d, 'WORKSPACE.json');
      if (existsSync(f)) { try { usados.add(JSON.parse(readFileSync(f, 'utf8')).prefijo); } catch { /* roto: no reserva nada */ } }
    }
    const propio = join(raiz, 'WORKSPACE.json');
    if (existsSync(propio)) { try { usados.add(JSON.parse(readFileSync(propio, 'utf8')).prefijo); } catch { /* idem */ } }
  }
  let prefijo = opt('--prefijo', null);
  if (!prefijo) {
    const base = linea.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'ws';
    for (const cand of [base.slice(0, 2), base.slice(0, 3), ...Array.from({ length: 9 }, (_, i) => base.slice(0, 2) + (i + 1))]) {
      if (!usados.has(`${cand}-`)) { prefijo = `${cand}-`; break; }
    }
  }
  if (!prefijo || usados.has(prefijo)) {
    console.error(`No pude elegir un prefijo libre (usados: ${[...usados].join(', ')}). Pásalo con --prefijo xx-`);
    return 1;
  }
  const rama = opt('--rama', linea);

  console.log(`Creando ${dest}\n  prefijo "${prefijo}"  ·  rama "${rama}"\n`);
  mkdirSync(dest, { recursive: true });
  for (const r of REPOS) {
    // el remoto se copia del clon que ya tienes, para respetar forks y
    // credenciales; sólo se inventa la URL si aquí no está ese repo
    const url = sh('git remote get-url origin', join(WS, r))
      ?? `https://github.com/stalinbeltran/${r}.git`;
    process.stdout.write(`  clonando ${r}… `);
    if (sh(`git clone --quiet ${url} ${join(dest, r)}`, dest) === null) {
      console.log('FALLÓ'); console.error(`  no pude clonar ${url}`); return 1;
    }
    sh(`git checkout -q -b ${rama}`, join(dest, r));
    console.log(`ok (${rama})`);
  }

  writeFileSync(join(dest, 'WORKSPACE.json'), JSON.stringify({
    nombre: linea, prefijo, rama,
    creado: new Date().toISOString().slice(0, 10),
    que: opt('--que', '<una linea: que se esta haciendo aqui>'),
    // ⚠ Los DOS nombres, y en este orden, igual que `sesiones.mjs`. La variable
    // que Claude Code pone de verdad es `CLAUDE_CODE_SESSION_ID` (comprobado el
    // 2026-08-28: `CLAUDE_SESSION_ID` está vacía), así que leer sólo la segunda
    // dejaba este campo en `<quien>` SIEMPRE — también cuando lo montaba una
    // sesión que sí sabía quién era. Un campo de identidad que nunca se rellena
    // no se distingue de uno que no hace falta.
    sesion: process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CLAUDE_SESSION_ID ?? '<quien>',
  }, null, 2) + '\n');

  const coordNuevo = join(dest, 'telegram-coordinator');
  writeFileSync(join(coordNuevo, 'data', 'fuentes.json'),
    JSON.stringify({ fuentes: [join(dest, '*', 'telegram')] }, null, 2) + '\n');
  // estado efímero POR TEMA de Telegram: copiado, dos coordinadores creerían los
  // dos que mandan sobre la misma conversación
  for (const d of ['sessions', 'claude-sessions', 'shell-cwd', 'ws']) {
    rmSync(join(coordNuevo, 'data', d), { recursive: true, force: true });
  }

  // ...y esta sesión pasa a ser su dueña, sin que haya que acordarse: quien
  // acaba de crear un workspace es exactamente quien va a trabajar en él.
  const traspaso = sh(`node ${join(COORD, 'scripts', 'sesiones.mjs')} --tomar ${dest}`, dest);

  console.log(`\nListo: ${dest}`);
  if (traspaso) console.log(`  (esta sesión ya consta como su dueña)`);
  console.log('\nLo que falta, y por qué no lo hago yo:');
  console.log(`  · el venv de foveal-vision (tarda minutos, y el preflight ya sabe):`);
  console.log(`      cd ${coordNuevo} && node scripts/bench-preflight.mjs --fix`);
  console.log('  · NO arranques el bot aquí: sólo una instancia puede hacer polling');
  console.log('    por token (error 409), y tumbaría la que te contesta por Telegram.');
  console.log(`  · di qué haces, para que la siguiente sesión lo lea:`);
  console.log(`      "que" en ${join(dest, 'WORKSPACE.json')}`);
  return 0;
}

const problemas = [];
const ok = [];
const nota = (lista, campo, detalle, arreglo) =>
  lista.push({ campo, detalle, arreglo });

function sh(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

const iNuevo = process.argv.indexOf('--nuevo');
if (iNuevo >= 0) {
  const linea = process.argv[iNuevo + 1];
  if (!linea || linea.startsWith('--')) {
    console.error('Uso: node scripts/workspace.mjs --nuevo <linea-de-trabajo> [--prefijo xx-] [--rama r] [--que "..."]');
    console.error('La LÍNEA DE TRABAJO, no el repo ni la fecha: "cierre", "stride", "fechado".');
    process.exit(1);
  }
  process.exit(nuevo(linea, process.argv));
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
  const fuera = fuentes.filter((f) => !dentroDe(f.replace('~', process.env.HOME ?? '~'), WS));
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
const vivos_ = (sh('ps -eo pid,args') ?? '').split('\n').slice(1)
  .filter((l) => /estudio_flota\.py|vigilante_avance\.py|bench_fleet\.py/.test(l))
  .filter((l) => !/\bgrep\b/.test(l))
  .map((l) => {
    const pid = l.trim().split(/\s+/)[0];
    let cwd = null;
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* murió, o no es Linux */ }
    return { pid, cwd, linea: l.trim() };
  })
  // sin cwd legible no se puede decir de quién es, y adivinarlo es peor que no
  // decirlo: se cuentan aparte (abajo) en vez de asumir que son ajenos. Antes
  // este filtro los DESCARTABA y el comentario prometía lo que el código no hacía.
  ;
const ilegibles = vivos_.filter((v) => v.cwd === null);
const vivos = vivos_.filter((v) => v.cwd !== null);
const ajenos = vivos.filter((v) => !dentroDe(v.cwd, WS));
const mios = vivos.filter((v) => dentroDe(v.cwd, WS));
// ⚠ Se informa SIEMPRE, aunque no haya nada. Callar cuando no hay procesos hace
// que "no miré" y "miré y no hay" se lean igual -- y en un SO sin /proc los
// descarta TODOS en silencio, o sea que respondería "nadie" para siempre. Es el
// mismo criterio del NO SÉ de cerrable.mjs: entre un fallo ruidoso y uno
// silencioso, el ruidoso.
if (ilegibles.length) {
  nota(ok, 'corriendo (NO SÉ)',
    `${ilegibles.length} proceso(s) de trabajo sin /proc legible: no puedo decir de quién son`);
} else if (!vivos.length) {
  nota(ok, 'corriendo', 'nada de trabajo en marcha');
}
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
