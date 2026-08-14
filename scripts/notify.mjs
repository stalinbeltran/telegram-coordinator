// Notificador de propósito general: manda un mensaje al tema de Telegram desde
// FUERA del ciclo del coordinador.
//
// Existe por la trampa que documenta CLAUDE.md: un mensaje es un proceso
// `claude -p` que muere al responder, y se lleva todo lo que lanzó. El trabajo
// largo se desacopla con `setsid`/`detached`, pero entonces nadie queda vivo
// para avisar de que terminó. Este script es ese "alguien": corre desacoplado y
// se manda el mensaje él mismo por Bot API, igual que ya hacía
// `claude-resumer.mjs` para su caso particular.
//
// Uso:
//   node scripts/notify.mjs "terminó el benchmark: benchmarks/foveal_*.json"
//   <comando> | node scripts/notify.mjs                    (texto por stdin)
//   node scripts/notify.mjs --chat <id> --thread <id> "…"  (fuera de una sesión)
//
// El caso para el que se hizo:
//   setsid sh -c '<trabajo largo>; node scripts/notify.mjs "terminó: <dónde>"' &
//
// Y despertar la conversación además de avisar, componiendo lo que ya hay
// (claude-session.mjs lee el prompt por stdin y escribe la respuesta por stdout):
//   setsid sh -c '<trabajo>; echo "<qué mirar>" | node scripts/claude-session.mjs | node scripts/notify.mjs' &
//
// Entorno (lo hereda de quien lo lanzó; `.env` solo se lee si falta el token):
//   BOT_TOKEN                          el bot que envía
//   COORD_CHAT / COORD_THREAD          a qué tema (los pasa el coordinador)
//
// Salidas: 0 enviado · 1 fallo de envío · 2 mal invocado o sin configuración.

import { existsSync } from 'node:fs';

if (!process.env.BOT_TOKEN && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* sin .env: seguimos con lo que haya en el entorno */
  }
}

const TG_LIMIT = 4000; // Telegram corta en 4096; dejamos margen.
const ATTEMPTS = 3;
const BACKOFF_MS = [1000, 3000];
// Única costura para los tests: los apunta a un servidor local y así se prueban
// el troceo, los reintentos y el 4xx sin mandar nada a Telegram. En producción
// no se define y vale la API real.
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

// El token NUNCA sale por pantalla: un error de red puede traer la URL entera,
// y esta es la vía por la que ya se filtró una vez (CLAUDE.md, Seguridad).
function safe(text, token) {
  const s = String(text ?? '');
  return token ? s.split(token).join('***') : s;
}

function parseArgs(argv) {
  const out = { chat: null, thread: null, text: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chat') out.chat = argv[++i];
    else if (a === '--thread') out.thread = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else out.text.push(a);
  }
  return out;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

const USAGE =
  'Uso: node scripts/notify.mjs [--chat <id>] [--thread <id>] "texto"\n' +
  '     <comando> | node scripts/notify.mjs';

async function sendChunk(token, payload) {
  // Un fallo de red no puede perder el aviso a la primera: reintentamos, que
  // es barato, antes de declarar que no se pudo avisar.
  let last = '';
  let tried = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    tried = attempt + 1;
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 3000));
    }
    try {
      const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      // Telegram contesta 200 con {ok:false} en varios errores reales, así que
      // no basta con mirar el código HTTP.
      if (res.ok && body.ok) return { ok: true };
      last = `HTTP ${res.status} ${body.description || ''}`.trim();
      // Un 4xx no se arregla esperando (chat inexistente, hilo borrado, token
      // revocado): reintentarlo solo retrasa el aviso de que no se pudo avisar.
      // El 429 sí, que es "vas muy rápido" y trae cuánto esperar.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, error: last, tried };
      }
      if (res.status === 429) {
        const wait = Number(body.parameters?.retry_after);
        if (Number.isFinite(wait)) await new Promise((r) => setTimeout(r, wait * 1000));
      }
    } catch (e) {
      last = e.message;
    }
  }
  return { ok: false, error: last, tried };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const token = process.env.BOT_TOKEN;
  const chat = args.chat || process.env.COORD_CHAT;
  const thread = args.thread ?? process.env.COORD_THREAD;

  if (!token || !chat) {
    console.error(
      '[notify] Falta ' +
        (!token ? 'BOT_TOKEN' : 'COORD_CHAT') +
        ': no hay a dónde avisar.\n' +
        '        Hereda el entorno del coordinador, o pasa --chat <id>.',
    );
    return 2;
  }

  const text = (args.text.length ? args.text.join(' ') : await readStdin()).trim();
  if (!text) {
    console.error('[notify] No hay texto que enviar (ni argumento ni stdin).\n' + USAGE);
    return 2;
  }

  // El tema puede ser "main" (el General del grupo, sin hilo): ahí no se manda
  // message_thread_id, y mandarlo daría "message thread not found".
  const threadId = Number(thread);
  const payload = (chunk) => {
    const p = { chat_id: chat, text: chunk };
    if (Number.isFinite(threadId)) p.message_thread_id = threadId;
    return p;
  };

  for (let i = 0; i < text.length; i += TG_LIMIT) {
    const r = await sendChunk(token, payload(text.slice(i, i + TG_LIMIT)));
    if (!r.ok) {
      const veces = r.tried === 1 ? '1 intento' : `${r.tried} intentos`;
      console.error(`[notify] No se pudo enviar tras ${veces}: ${safe(r.error, token)}`);
      return 1;
    }
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    // Nada de lo que pase aquí debe dejar un rastro con el token dentro.
    console.error('[notify] Error inesperado:', safe(e && e.message, process.env.BOT_TOKEN));
    process.exit(1);
  },
);
