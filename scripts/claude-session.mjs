// Ejecutor con estado: conversa con `claude` manteniendo continuidad POR SESIÓN
// (un tema de Telegram = una conversación de claude independiente).
//
// - Lee tu mensaje por stdin (no necesita comillas ni escapes).
// - Deriva un UUID estable del tema (COORD_SESSION) y su época: ver
//   claude-marker.mjs, que es donde vive ese estado.
// - Primer mensaje de la conversación: la crea con --session-id <uuid>.
//   Mensajes siguientes: la continúa con --resume <uuid>.
// - Para empezar de cero SIN cambiar de tema: `/use creset`, que sube la época
//   y con ella el uuid (scripts/claude-reset.mjs).
// - Imprime SOLO la respuesta de claude por stdout (la recoge el encargado echo).
//
// Perfil (modelo + esfuerzo) como DATO, no como código: se declara en la
// plantilla del ejecutor, así que puedes tener varias variantes sin tocar nada:
//     node scripts/claude-session.mjs --model opus   --effort high
//     node scripts/claude-session.mjs --model sonnet --effort low
// Sin flags, claude usa sus propios valores por defecto.
//   --model  : alias ("fable", "opus", "sonnet") o nombre completo ("claude-opus-5").
//   --effort : low | medium | high | xhigh | max
//
// Permisos: por defecto "acceptEdits" (claude puede crear/editar archivos sin
// preguntar, pero no más). Para autonomía total ponlo en .env:
//     CLAUDE_PERMISSION_MODE=bypassPermissions   (⚠️ claude ejecuta cualquier cosa)

import { spawn } from 'node:child_process';
import { isRateLimited } from './limit-detect.mjs';
import {
  SESSION,
  readMarker,
  epochOf,
  isStarted,
  uuidFor,
  writeMarker,
} from './claude-marker.mjs';

const permissionMode = process.env.CLAUDE_PERMISSION_MODE || 'acceptEdits';

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Lee --model / --effort de la plantilla del ejecutor (acepta "--x v" y "--x=v").
function parseProfile(argv) {
  const profile = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(model|effort)(?:=(.*))?$/.exec(argv[i]);
    if (!m) {
      console.error(`Opción desconocida: ${argv[i]}. Solo se aceptan --model y --effort.`);
      process.exit(1);
    }
    const value = m[2] !== undefined ? m[2] : argv[++i];
    if (!value) {
      console.error(`Falta el valor de --${m[1]}.`);
      process.exit(1);
    }
    profile[m[1]] = value;
  }
  if (profile.effort && !EFFORT_LEVELS.includes(profile.effort)) {
    console.error(`Esfuerzo inválido "${profile.effort}". Usa: ${EFFORT_LEVELS.join(', ')}.`);
    process.exit(1);
  }
  return profile;
}

const profile = parseProfile(process.argv.slice(2));
const profileArgs = [
  ...(profile.model ? ['--model', profile.model] : []),
  ...(profile.effort ? ['--effort', profile.effort] : []),
];

function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
  });
}

function runClaude(mode, uuid, prompt) {
  return new Promise((res) => {
    const sessionArgs =
      mode === 'resume' ? ['--resume', uuid] : ['--session-id', uuid];
    const args = ['-p', '--permission-mode', permissionMode, ...profileArgs, ...sessionArgs];
    const child = spawn('claude', args, { shell: true, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => res({ ok: false, out: '', err: e.message }));
    child.on('close', (code) => res({ ok: code === 0, out, err }));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const prompt = (await readStdin()).trim();
if (!prompt) {
  console.error('Mensaje vacío.');
  process.exit(1);
}

const marker = readMarker();
const epoch = epochOf(marker);
const uuid = uuidFor(SESSION, epoch);
const started = isStarted(marker);

let res = await runClaude(started ? 'resume' : 'create', uuid, prompt);

// Si falló, se prueba el modo CONTRARIO. El marker y lo que claude tiene guardado
// pueden desincronizarse en LOS DOS sentidos (borrar el marker con ~/.claude
// intacta, o rehacer data/ sin rehacer ~/.claude), y antes solo se cubría uno:
// una creación que chocaba con un uuid ya existente moría sin red.
// Si el reintento tampoco va, se reporta el fallo ORIGINAL —el del modo que
// tocaba— porque es el que explica algo; el otro solo diría que no existe.
// NO se reintenta ante un límite de uso: ahí la sesión sigue intacta y tocarla
// perdería el contexto, así que se deja que el encargado la reanude.
if (!res.ok && !isRateLimited(`${res.err}\n${res.out}`)) {
  const retry = await runClaude(started ? 'create' : 'resume', uuid, prompt);
  if (retry.ok) res = retry;
}

if (res.ok) {
  await writeMarker(SESSION, { epoch, uuid, started: true });
  process.stdout.write(res.out.trim() || '(sin respuesta de claude)');
} else if (isRateLimited(`${res.err}\n${res.out}`)) {
  // Límite de tokens: NO es un error fatal para el flujo. Volcamos el banner a
  // stdout y salimos con código 0 para que el ejecutor se considere "exitoso" y
  // el orquestador SÍ corra los encargados (con exit!=0 los saltaría). Así el
  // encargado `claude-watch` puede detectar el límite y programar la reanudación.
  process.stdout.write((res.err || res.out || 'Usage limit reached.').trim());
} else {
  console.error((res.err || res.out || 'claude falló sin mensaje.').trim());
  process.exit(1);
}
