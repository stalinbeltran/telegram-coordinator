// ¿Quién más está trabajando en este workspace ahora mismo?
//
// Por qué existe
// --------------
// `workspace.mjs` contesta «qué PROCESOS corren que no son míos», y eso deja
// fuera justo el caso que más duele: una sesión de Claude leyendo y escribiendo
// ficheros **no deja ningún proceso corriendo**. El 2026-08-28 dos sesiones
// trabajaron a la vez sobre los mismos repos y la segunda sólo se entero de la
// primera porque el usuario se lo dijo a mano; el choque llego igual (un reporte
// citando rutas que la otra sesion acababa de mover). Que exista otra sesión
// tiene que ser un DATO, no algo que alguien recuerde mencionar.
//
//   node scripts/sesiones.mjs              # la tabla
//   node scripts/sesiones.mjs --json
//   node scripts/sesiones.mjs --registrar  # lee el JSON del hook por stdin
//
// La regla de caducidad, escrita al lado del marcador (CLAUDE.md, regla 3)
// ------------------------------------------------------------------------
// Una sesión NO puede probar que está viva con un pid: el proceso que escribe
// esto es el hook, que muere en cuanto termina, y nadie va a refrescar un
// heartbeat. Pero Claude Code **añade a su transcript en cada mensaje**, así que
// el mtime del `.jsonl` es un latido que ya existe y que nadie tiene que
// mantener. El marcador guarda DÓNDE está ese fichero; la vida se lee de él.
//
// Por eso un marcador huérfano caduca solo: si la sesión murió, su transcript
// deja de crecer y a los `ACTIVA_MIN` esto deja de contarla. Sin dueño vivo, no
// hay cerrojo.
//
// ⚠ Y si el transcript no se puede leer, se dice `NO SÉ` y se cuenta aparte, en
// vez de darla por muerta: entre un fallo ruidoso y uno silencioso, el ruidoso.
// Un falso «no hay nadie» es permiso para pisar el trabajo de otro.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COORD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME ?? '';

// Sobrescribibles para los tests, que no pueden usar el ~/.claude de verdad.
const REGISTRO = process.env.COORD_SESIONES_DIR ?? join(HOME, '.claude', 'ws-sesiones');
const RAIZ_WS = process.env.COORD_WS_RAIZ ?? join(HOME, 'ws');

// Los tres tramos, y por qué estos:
//  - ACTIVA: ha escrito hace poco. Es la que de verdad puede pisarte.
//  - CALLADA: abierta pero parada (esperándote a ti, o pensando). No es
//    ignorable: sigue teniendo ficheros abiertos y un usuario detrás.
//  - VIEJA: se da por muerta. Su marcador se borra al pasar por aquí.
const ACTIVA_MIN = 30;
const CALLADA_H = 4;
const BORRAR_DIAS = 7;

export function edadMin(ts) { return (Date.now() - ts) / 60000; }

/** El workspace al que pertenece una ruta: el ancestro que tiene WORKSPACE.json. */
export function workspaceDe(ruta) {
  let d = resolve(ruta);
  for (let i = 0; i < 8 && d !== '/' && d !== ''; i++) {
    if (existsSync(join(d, 'WORKSPACE.json'))) return d;
    d = dirname(d);
  }
  return null;
}

export function identidad(ws) {
  try { return JSON.parse(readFileSync(join(ws, 'WORKSPACE.json'), 'utf8')); }
  catch { return null; }
}

/** Todos los marcadores, con su estado de vida leído del transcript. */
export function sesiones({ ahora = Date.now(), limpiar = true } = {}) {
  if (!existsSync(REGISTRO)) return [];
  const out = [];
  for (const f of readdirSync(REGISTRO)) {
    if (!f.endsWith('.json')) continue;
    const p = join(REGISTRO, f);
    let m;
    try { m = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }

    // La vida sale del TRANSCRIPT, no del marcador: el marcador no se refresca
    // nunca (nadie mantendría un heartbeat), el transcript sí lo hace solo.
    let latido = null, vivo = 'NO SE';
    try {
      latido = statSync(m.transcript).mtimeMs;
      const min = (ahora - latido) / 60000;
      vivo = min < ACTIVA_MIN ? 'ACTIVA' : (min < CALLADA_H * 60 ? 'CALLADA' : 'VIEJA');
    } catch { /* sin transcript legible no se puede decir: se queda en NO SE */ }

    if (limpiar && latido !== null && (ahora - latido) > BORRAR_DIAS * 86400000) {
      try { unlinkSync(p); } catch { /* da igual: se reintenta la proxima vez */ }
      continue;
    }
    out.push({ ...m, latido, vivo, edad_min: latido === null ? null : Math.round((ahora - latido) / 60000) });
  }
  return out.sort((a, b) => (b.latido ?? 0) - (a.latido ?? 0));
}

/** El transcript de una sesión, buscándolo por su id. Para cuando no hay
 *  marcador previo: el hook lo recibe por stdin, pero `--tomar` no. */
export function transcriptDe(sesion) {
  const raiz = join(HOME, '.claude', 'projects');
  if (!existsSync(raiz)) return '';
  for (const d of readdirSync(raiz)) {
    const p = join(raiz, d, `${sesion}.jsonl`);
    if (existsSync(p)) return p;
  }
  return '';
}

export function marcadorDe(sesion) {
  try { return JSON.parse(readFileSync(join(REGISTRO, `${sesion}.json`), 'utf8')); }
  catch { return null; }
}

export function olvidar(sesion) {
  try { unlinkSync(join(REGISTRO, `${sesion}.json`)); return true; } catch { return false; }
}

export function registrar({ sesion, cwd, transcript, tomado = false }) {
  // ⚠ Un traspaso EXPLÍCITO (`--tomar`) sobrevive a que la sesión se reanude.
  //
  // Medido el 2026-08-28, con el hook ya en marcha: esta sesión hizo
  // `--tomar ~/ws/fechado`, se reanudó, y el `--registrar` del SessionStart
  // reescribió el marcador con el workspace deducido del cwd (`~/src`) --
  // borrando la mudanza. Una decisión explícita pisada por una inferida, y en
  // silencio: el registro pasaba a avisar del choque equivocado.
  //
  // El cwd sí se refresca (es un dato), pero el workspace no: quien dijo dónde
  // trabaja manda sobre dónde arrancó.
  const previo = marcadorDe(sesion);
  const heredado = !tomado && previo?.tomado ? previo.workspace : null;
  const ws = heredado ?? workspaceDe(cwd) ?? workspaceDe(COORD);
  mkdirSync(REGISTRO, { recursive: true });
  const marca = {
    sesion, cwd, transcript, workspace: ws,
    tomado: tomado || Boolean(heredado),
    desde: previo?.desde ?? new Date().toISOString(),
    visto: new Date().toISOString(),
  };
  writeFileSync(join(REGISTRO, `${sesion}.json`), JSON.stringify(marca, null, 2) + '\n');
  return marca;
}

/** El texto que ve una sesión al abrirse. Es lo único que lee el hook. */
export function veredicto(marca, otras) {
  const id = (s) => String(s).slice(0, 8);
  const ws = marca.workspace;
  const yo = ws ? `${ws} (${identidad(ws)?.nombre ?? basename(ws)})` : '⚠ NINGUNO';
  const l = [];
  l.push(`Tu sesión: ${id(marca.sesion)} · workspace ${yo}` + (marca.tomado ? ' (tomado a mano, no deducido del cwd)' : ''));

  if (!ws) {
    l.push('');
    l.push('⚠ Este directorio no está dentro de un workspace: no hay WORKSPACE.json');
    l.push('  en ningún ancestro. Sin identidad, las máquinas que pagues no se');
    l.push('  distinguen de las de otra sesión, y `--prefijo` no sale de ningún sitio.');
    l.push('  → node scripts/workspace.mjs --nuevo <linea-de-trabajo>');
    return l.join('\n');
  }

  const aqui = otras.filter((o) => o.workspace === ws && o.sesion !== marca.sesion);
  const activas = aqui.filter((o) => o.vivo === 'ACTIVA' || o.vivo === 'CALLADA');
  const dudosas = aqui.filter((o) => o.vivo === 'NO SE');

  if (!activas.length && !dudosas.length) {
    l.push('Nadie más trabaja aquí. Adelante.');
    return l.join('\n');
  }

  l.push('');
  l.push('🔴 HAY OTRA SESIÓN EN ESTE MISMO WORKSPACE');
  for (const o of activas) {
    l.push(`   ${id(o.sesion)}  ${o.vivo === 'ACTIVA' ? 'activa' : 'callada'} desde hace ${o.edad_min} min`);
  }
  for (const o of dudosas) {
    l.push(`   ${id(o.sesion)}  NO SÉ: no puedo leer su transcript (${o.transcript})`);
  }
  l.push('');
  l.push('  Los dos editaríais los mismos ficheros. Eso NO da conflicto de git:');
  l.push('  da trabajo destruido en caliente y sin síntoma hasta que a alguien le');
  l.push('  fallan los números. Crea el tuyo antes de tocar nada:');
  l.push('');
  l.push('      node scripts/workspace.mjs --nuevo <linea-de-trabajo>');
  l.push('');
  l.push('  (clona los 5 repos, con rama y prefijo propios, y deja el bot parado)');
  return l.join('\n');
}

// --- CLI ---------------------------------------------------------------------

function leerStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--registrar')) {
    // El hook manda {session_id, cwd, transcript_path} por stdin. Si no viene
    // (invocación a mano), se cae al entorno y al cwd, que sigue siendo util.
    let h = {};
    try { h = JSON.parse(leerStdin() || '{}'); } catch { /* a mano, sin stdin */ }
    const marca = registrar({
      sesion: h.session_id ?? process.env.CLAUDE_SESSION_ID ?? `manual-${process.pid}`,
      cwd: h.cwd ?? process.cwd(),
      transcript: h.transcript_path ?? '',
    });
    const texto = veredicto(marca, sesiones());

    // `--hook`: la envoltura que mete el texto en el contexto de la sesion.
    // `additionalContext` es lo que lee el modelo; `systemMessage` es lo que ve
    // el usuario, y solo se manda cuando hay choque -- un aviso que sale
    // siempre se deja de leer a la tercera vez.
    if (args.includes('--hook')) {
      const choca = texto.includes('HAY OTRA SESION') || texto.includes('HAY OTRA SESIÓN')
        || texto.includes('no está dentro de un workspace');
      console.log(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texto },
        ...(choca ? { systemMessage: texto.split('\n').slice(1).join('\n').trim() } : {}),
      }));
      return 0;
    }
    console.log(texto);
    return 0;
  }

  if (args.includes('--cerrar')) {
    // El hook SessionEnd: la sesión suelta su workspace al cerrarse.
    //
    // ⚠ Esto es una COMODIDAD, no el mecanismo. La regla sigue siendo la
    // caducidad por transcript (regla 3 de escritura): una sesión que muere por
    // SIGKILL, por cerrar la terminal o porque se rehace la máquina NUNCA corre
    // su SessionEnd. Si esto fuera el único borrado, un marcador huérfano
    // bloquearía el workspace para siempre -- que es exactamente el fallo del
    // `.resume.lock`. Lo que aporta es que un cierre limpio libere YA en vez de
    // en 30 min.
    let h = {};
    try { h = JSON.parse(leerStdin() || '{}'); } catch { /* a mano */ }
    const sesion = h.session_id ?? process.env.CLAUDE_CODE_SESSION_ID
      ?? process.env.CLAUDE_SESSION_ID;
    if (sesion && olvidar(sesion)) console.log(`sesión ${String(sesion).slice(0, 8)} liberada`);
    return 0;
  }

  const iTomar = args.indexOf('--tomar');
  if (iTomar >= 0) {
    // Mudarse de workspace SIN abrir sesión nueva. Hace falta porque el cwd de
    // una sesión es donde arrancó, no donde acaba trabajando: ésta empezó en
    // `~/src/telegram-coordinator` y a los diez minutos su trabajo estaba en
    // `~/ws/fechado`. Sin esto el registro se queda apuntando al workspace que
    // la sesión ya no toca -- y entonces avisa de un choque que no existe y
    // calla el que sí.
    const destino = args[iTomar + 1];
    const sesion = process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CLAUDE_SESSION_ID;
    if (!destino || destino.startsWith('--')) {
      console.error('Uso: node scripts/sesiones.mjs --tomar <ruta-del-workspace>');
      return 1;
    }
    if (!sesion) {
      console.error('No sé qué sesión soy: falta CLAUDE_CODE_SESSION_ID en el entorno.');
      return 1;
    }
    const ws = workspaceDe(destino);
    if (!ws) {
      console.error(`${destino} no es un workspace: no hay WORKSPACE.json ahí ni encima.`);
      return 1;
    }
    const previo = sesiones({ limpiar: false }).find((x) => x.sesion === sesion);
    const marca = registrar({
      sesion, cwd: ws, transcript: previo?.transcript || transcriptDe(sesion),
      tomado: true,
    });
    console.log(`Esta sesión pasa a ser la dueña de ${ws} (${identidad(ws)?.nombre ?? '?'}).`);
    console.log(veredicto(marca, sesiones()));
    return 0;
  }

  const todas = sesiones();
  if (args.includes('--json')) {
    console.log(JSON.stringify({ registro: REGISTRO, raiz_ws: RAIZ_WS, sesiones: todas }, null, 1));
    return 0;
  }
  if (!todas.length) {
    console.log(`No hay ninguna sesión registrada en ${REGISTRO}.`);
    console.log('Se registran solas al abrirse (hook SessionStart de .claude/settings.json).');
    return 0;
  }
  console.log(`\nSesiones registradas en ${REGISTRO}`);
  console.log(`(ACTIVA < ${ACTIVA_MIN} min · CALLADA < ${CALLADA_H} h · VIEJA se borra a los ${BORRAR_DIAS} días)\n`);
  for (const s of todas) {
    const ws = s.workspace ? basename(s.workspace) : '—';
    const edad = s.edad_min === null ? 'sin latido' : `hace ${s.edad_min} min`;
    console.log(`  ${String(s.sesion).slice(0, 8)}  ${s.vivo.padEnd(8)} ${ws.padEnd(12)} ${edad}`);
  }
  const porWs = {};
  for (const s of todas) {
    if (s.vivo === 'ACTIVA' || s.vivo === 'CALLADA') (porWs[s.workspace] ??= []).push(s);
  }
  const chocan = Object.entries(porWs).filter(([, v]) => v.length > 1);
  if (chocan.length) {
    console.log('\n🔴 Más de una sesión viva en el mismo workspace:');
    for (const [ws, v] of chocan) console.log(`   ${ws}: ${v.map((s) => String(s.sesion).slice(0, 8)).join(', ')}`);
    console.log('   → node scripts/workspace.mjs --nuevo <linea>  (desde la que deba mudarse)');
  }
  return 0;
}

// Sólo corre el CLI si se invoca directo: los tests importan las funciones.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((c) => process.exit(c)).catch((e) => {
    // Un hook que revienta NO puede impedir que arranque la sesión.
    console.log(`(sesiones.mjs no pudo comprobar nada: ${e.message})`);
    process.exit(0);
  });
}
