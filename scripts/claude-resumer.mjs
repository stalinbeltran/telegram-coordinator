// Reanudador DESACOPLADO de una sesión de claude tras un límite de uso.
//
// Lo lanza el encargado `claude-watch` con `detached`+`unref`, así que vive FUERA
// del ciclo del coordinador (que mata todo comando a los 30s y no puede mandar
// mensajes después). Por eso el resumer se manda los mensajes a Telegram él mismo
// vía Bot API, usando lo que heredó del entorno:
//   BOT_TOKEN              (lo cargó el coordinador desde .env; aquí lo recargamos
//                           si hiciera falta)
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
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isRateLimited, calculateWaitMs } from './limit-detect.mjs';

// Recarga .env solo si el token no vino heredado (p. ej. si se lanza a mano).
if (!process.env.BOT_TOKEN && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* sin .env: seguimos con lo que haya en el entorno */
  }
}

const TOKEN = process.env.BOT_TOKEN;
const CHAT = process.env.COORD_CHAT;
const THREAD = process.env.COORD_THREAD;
const SESSION = process.env.COORD_SESSION || 'default';
const DATA_DIR = process.env.DATA_DIR || 'data';

const MAX = int(process.env.CLAUDE_RETRY_MAX, 5);
const RUN_TIMEOUT_MS = int(process.env.CLAUDE_RETRY_RUN_TIMEOUT_MS, 600_000);
const CONTINUE_PROMPT =
  process.env.CLAUDE_CONTINUE_PROMPT ||
  'Continúa con la tarea anterior justo donde te detuviste por el límite de uso. ' +
    'No reinicies desde cero; retoma el trabajo pendiente y termínalo.';

const initialWaitMs = Number(process.argv[2]) || calculateWaitMs('');

// Cerrojo por sesión: evita dos resumers simultáneos para el mismo tema.
const lockFile = join(DATA_DIR, 'claude-sessions', SESSION.replace(/[^\w.-]/g, '_') + '.resume.lock');
if (existsSync(lockFile)) process.exit(0);
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

// --- Lanzar claude-session (reanuda con --resume) --------------------------
// Corre FUERA del runner del coordinador, así que el timeout de 30s no aplica:
// usamos uno propio y generoso para tareas largas.
function runClaudeSession(prompt) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['scripts/claude-session.mjs'], {
      windowsHide: true,
      env: process.env,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ya murió */
      }
    }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      res({ out: '', err: String(e.message), code: 1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ out, err, code: code ?? 1 });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// --- Bucle principal -------------------------------------------------------
async function main() {
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
    if (r.code !== 0 && !r.out.trim()) {
      await tg(`❌ No pude reanudar la sesión:\n${(r.err || 'error desconocido').trim()}`);
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
