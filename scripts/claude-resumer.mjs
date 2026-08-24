// Reanudador DESACOPLADO de una sesión de claude tras un límite de uso.
//
// Lo lanza el encargado `claude-watch` con `detached`+`unref`, así que vive FUERA
// del ciclo del coordinador (que mata todo comando a los 30s y no puede mandar
// mensajes después). Por eso el resumer se manda los mensajes a Telegram él mismo
// vía Bot API, usando lo que heredó del entorno:
//   BOT_TOKEN              (de .env)
//   CLAUDE_CODE_OAUTH_TOKEN (de ~/.config/dev-secrets.env)
// Los dos se cargan de DISCO al arrancar (cargar-secretos.mjs), porque
// `desacoplar.sh` no deja pasar credenciales y este proceso nace sin ellas.
//   COORD_SESSION/CHAT/THREAD  (identidad de la sesión = tema de Telegram)
//
// Flujo:
//   1. Espera el tiempo calculado para el límite ACTUAL (argv[2], en ms).
//   2. Reinyecta un prompt de "continúa" a `claude-session.mjs` (que usa --resume),
//      reanudando la conversación justo donde se cortó.
//   3. Si el límite SIGUE activo, recalcula la espera y reintenta (hasta MAX).
//   4. Entrega el resultado al tema de Telegram.
//
// Variables de entorno (opcionales):
//   CLAUDE_RETRY_MAX             (def 5)       reintentos máximos.
//   CLAUDE_RETRY_RUN_TIMEOUT_MS  (def 600000)  timeout de cada llamada a claude.
//   CLAUDE_CONTINUE_PROMPT       (def abajo)   el "continúa" que se reinyecta.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isRateLimited, calculateWaitMs } from './limit-detect.mjs';
import { cargarSecretos, pareceFalloDeLogin, pistaDeLogin } from './cargar-secretos.mjs';

// SIEMPRE, y de los DOS ficheros. Antes esto era `if (!BOT_TOKEN) loadEnvFile('.env')`,
// y el guard estaba puesto sobre la variable equivocada: `desacoplar.sh` no deja
// pasar credenciales, pero BOT_TOKEN sí se recuperaba de `.env`, así que la carga
// no llegaba a ejecutarse... y CLAUDE_CODE_OAUTH_TOKEN, que vive en
// ~/.config/dev-secrets.env, no lo cargaba nadie. Resultado: el resumer despertaba
// puntual y `claude --resume` contestaba «Not logged in · Please run /login».
// Es seguro hacerlo incondicional: loadEnvFile no pisa lo que ya está en el entorno.
cargarSecretos();

const TOKEN = process.env.BOT_TOKEN;
const CHAT = process.env.COORD_CHAT;
const THREAD = process.env.COORD_THREAD;
const SESSION = process.env.COORD_SESSION || 'default';
const DATA_DIR = process.env.DATA_DIR || 'data';

const MAX = int(process.env.CLAUDE_RETRY_MAX, 5);
// 6 h, y el 600_000 (10 min) que había antes era un fallo MEDIDO, no una
// preferencia. El 2026-08-23 el límite saltó a las 21:22 con un estudio a medias;
// el resumer despertó puntual a las 22:40, reinyectó el «continúa», y a las
// 22:50:31 -EXACTAMENTE 10 minutos después- mató la llamada. El trabajo duró una
// hora (alquilar nueve máquinas, entrenar y recogerlas), así que la respuesta no
// llegó nunca aunque el trabajo sí se hizo entero.
//
// El número contradecía al propio proyecto: el ejecutor `c` lleva `timeoutMs: 0`
// -sin límite- precisamente porque las tareas de claude son largas, y el resumer
// existe para CONTINUAR una de esas. Ponerle 10 minutos garantiza que todo lo que
// valga la pena reanudar se corte.
//
// No se pone 0 (sin límite) a propósito: este proceso tiene el cerrojo de la
// sesión, y uno colgado para siempre bloquearía las reanudaciones siguientes sin
// que nadie lo note. 6 h es más que cualquier tarea vista aquí y sigue siendo un
// tope.
const RUN_TIMEOUT_MS = int(process.env.CLAUDE_RETRY_RUN_TIMEOUT_MS, 6 * 60 * 60 * 1000);
const CONTINUE_PROMPT =
  process.env.CLAUDE_CONTINUE_PROMPT ||
  'Continúa con la tarea anterior justo donde te detuviste por el límite de uso. ' +
    'No reinicies desde cero; retoma el trabajo pendiente y termínalo.';

const initialWaitMs = Number(process.argv[2]) || calculateWaitMs('');

// Cerrojo por sesión: evita dos resumers simultáneos para el mismo tema.
//
// Pero un cerrojo sólo vale mientras su dueño viva. A este proceso lo pueden
// matar sin que ejecute el `cleanup` de abajo: `detached` le da sesión propia,
// NO cgroup propio, así que un `systemctl restart` del coordinador lo mata a
// él y a todo el árbol (KillMode=control-group, que es el default). Pasó el
// 2026-08-19: el resumer desperto puntual a las 22:00:32, y el reinicio de las
// 22:05:36 lo mato con claude a media respuesta.
//
// El fichero quedaba ahi para siempre, y como esto era un `existsSync` a secas,
// CUALQUIER limite futuro de ese tema salia por aqui en silencio: sin reanudar,
// sin avisar y sin dejar rastro. El cerrojo se convertia en un interruptor de
// apagado permanente. Por eso ahora se comprueba si el dueño sigue vivo.
const lockFile = join(DATA_DIR, 'claude-sessions', SESSION.replace(/[^\w.-]/g, '_') + '.resume.lock');
if (existsSync(lockFile) && dueñoVivo(lockFile)) process.exit(0);

function dueñoVivo(fichero) {
  let pid;
  try {
    pid = JSON.parse(readFileSync(fichero, 'utf8')).pid;
  } catch {
    return false; // ilegible o a medio escribir: no es un dueño que respetar
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // señal 0: no mata, sólo pregunta si existe
    return true;
  } catch (e) {
    // EPERM = existe pero es de otro usuario -> vivo. ESRCH = no existe.
    return e.code === 'EPERM';
  }
}
try {
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }) + '\n');
} catch {
  /* si no se puede escribir el lock, seguimos igual */
}
const cleanup = () => {
  try {
    rmSync(lockFile);
  } catch {
    /* ya no está */
  }
};
process.on('exit', cleanup);

// --- Telegram (Bot API por fetch, sin dependencias) ------------------------
const TG_LIMIT = 4000;
async function tg(text) {
  if (!TOKEN || !CHAT) {
    console.error('[claude-resumer] Falta BOT_TOKEN o COORD_CHAT; no puedo avisar a Telegram.');
    return;
  }
  const body = text && text.length ? text : '(vacío)';
  for (let i = 0; i < body.length; i += TG_LIMIT) {
    const payload = { chat_id: CHAT, text: body.slice(i, i + TG_LIMIT) };
    if (THREAD) payload.message_thread_id = Number(THREAD);
    try {
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('[claude-resumer] Error enviando a Telegram:', e.message);
    }
  }
}

// Mata el ÁRBOL, no el proceso. Mismo patrón que `runner.ts`: en POSIX el hijo
// tiene grupo propio (`detached`) y se mata el grupo; en Windows `taskkill /T`.
function matarArbol(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ya murió */
    }
  }
}

// --- Lanzar claude-session (reanuda con --resume) --------------------------
// Corre FUERA del runner del coordinador, así que el timeout de 30s no aplica:
// usamos uno propio y generoso para tareas largas.
function runClaudeSession(prompt) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['scripts/claude-session.mjs'], {
      windowsHide: true,
      env: process.env,
      // Grupo propio en POSIX para poder matar el ÁRBOL, no sólo el envoltorio.
      // `claude-session.mjs` lanza a su vez `claude`: un `child.kill()` a secas
      // mataba el wrapper y dejaba a `claude` huérfano trabajando contra una
      // tubería muerta -- gastando tokens sin que nadie recogiera la respuesta.
      // Es el mismo motivo por el que `runner.ts` mata el árbol y no el proceso.
      detached: process.platform !== 'win32',
    });
    let out = '';
    let err = '';
    let expiro = false;
    const timer = setTimeout(() => {
      expiro = true;
      matarArbol(child);
    }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      res({ out: '', err: String(e.message), code: 1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ out, err, code: code ?? 1, expiro });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// --- Bucle principal -------------------------------------------------------
async function main() {
  // Aviso inicial (claude-watch es mudo; aquí es donde se informa del reseteo).
  const firstWhen = new Date(Date.now() + initialWaitMs).toLocaleTimeString();
  const mins = Math.max(1, Math.round(initialWaitMs / 60000));
  await tg(
    [
      '⏳ Se alcanzó el límite de uso de Claude en esta sesión.',
      `Reanudaré la conversación automáticamente alrededor de las ${firstWhen} (~${mins} min).`,
      'No necesitas enviar nada: te aviso aquí cuando continúe.',
    ].join('\n'),
  );

  await sleep(initialWaitMs);

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const r = await runClaudeSession(CONTINUE_PROMPT);
    const combined = `${r.out}\n${r.err}`;

    if (isRateLimited(combined)) {
      if (attempt >= MAX) {
        await tg(
          `❌ El límite de uso sigue activo tras ${MAX} intentos. ` +
            'Cuando se restablezca, envía un mensaje en este tema para continuar a mano.',
        );
        return;
      }
      const waitMs = calculateWaitMs(combined);
      const when = new Date(Date.now() + waitMs).toLocaleTimeString();
      await tg(`⏳ El límite sigue activo. Reintento ${attempt}/${MAX} alrededor de las ${when}.`);
      await sleep(waitMs);
      continue;
    }

    // Reanudación lograda (o error que NO es límite).
    if (r.expiro) {
      // Se dice con todas las letras QUIÉN lo cortó. Antes esto caía en el
      // "error desconocido" de abajo, y desde fuera era indistinguible de que
      // claude hubiera fallado -- cuando en realidad el trabajo pudo terminar
      // bien y lo único que se perdió fue la entrega.
      const horas = (RUN_TIMEOUT_MS / 3600000).toFixed(1);
      await tg(
        [
          `⏱️ Corté la reanudación yo: llevaba más de ${horas} h y ese es mi tope`,
          '(CLAUDE_RETRY_RUN_TIMEOUT_MS).',
          '',
          '⚠️ El trabajo pudo haber terminado igual: lo que se perdió es la',
          'entrega de la respuesta, no necesariamente lo hecho. Mira el estado en',
          'disco (repos, logs) antes de repetir nada.',
          r.out.trim() ? `\nLo que alcancé a capturar:\n\n${r.out.trim()}` : '',
        ].join('\n'),
      );
    } else if (r.code !== 0 && !r.out.trim()) {
      const detalle = (r.err || 'error desconocido').trim();
      const pista = pareceFalloDeLogin(detalle) ? pistaDeLogin() : '';
      await tg(`❌ No pude reanudar la sesión:\n${detalle}${pista}`);
    } else {
      await tg(`✅ Sesión reanudada automáticamente:\n\n${r.out.trim() || '(sin salida de claude)'}`);
    }
    return;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function int(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

main().catch(async (e) => {
  await tg(`❌ El reanudador falló inesperadamente: ${e.message}`);
  process.exit(1);
});
