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

// ⚠⚠ LOS SECRETOS SE CARGAN POR RUTA ABSOLUTA, NUNCA RELATIVOS AL CWD.
// Aquí había `existsSync('.env')`, o sea `.env` **del directorio actual** — y
// eso convierte al avisador en algo que sólo funciona si lo llamas desde el
// repo del coordinador. Un trabajo desacoplado corre en el directorio de SU
// repo (`desacoplar.sh` conserva el cwd a propósito), así que ahí no hay
// ningún `.env` y el aviso moría con «Falta BOT_TOKEN» sin llegar a intentarlo.
//
// Medido el 2026-09-04, mismo comando y mismo entorno, sólo cambiando el cwd:
//   desde ~/src/foveal-vision        -> exit 2, "Falta BOT_TOKEN"  (ni lo intenta)
//   desde ~/src/telegram-coordinator -> exit 1, "fetch failed"     (sí tenía token)
//
// Qué se veía desde fuera: los ejecutores `entrenar`, `continuar` y
// `entrenar-vast` —que NO hacen `. "$COORD_HOME/.env"` en su plantilla— dejaron
// de avisar al terminar. Los que sí lo hacen (`bench`, `estudio`,
// `estudio-stride`) seguían funcionando, y por eso el fallo era intermitente
// según qué comando lanzaras.
//
// `cargarSecretos()` resuelve contra `COORD_HOME` (que el coordinador pasa a
// TODO comando y `desacoplar.sh` deja viajar) o, si no viniera, contra la
// ubicación de este fichero. Y son DOS ficheros, no uno. No se reimplementa
// aquí porque dos copias de esa resolución divergen y nadie se entera.
import { cargarSecretos } from './cargar-secretos.mjs';
import { elegirDestino, haceCuanto, raizDeDatos } from './destino-telegram.mjs';

cargarSecretos();

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
  '     <comando> | node scripts/notify.mjs\n' +
  '\n' +
  'Destino: --chat gana; si no, COORD_CHAT/COORD_THREAD del entorno; y si\n' +
  'tampoco, se BUSCA en el estado por tema del coordinador (el principal, o el\n' +
  'de actividad mas reciente, descartando lo de mas de 7 dias). Sin ninguno,\n' +
  'sale con 2: inventarse un destino es peor que no avisar.\n' +
  'Salidas: 0 enviado - 1 fallo de envio - 2 mal invocado o sin destino.';

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
  let chat = args.chat || process.env.COORD_CHAT;
  let thread = args.thread ?? process.env.COORD_THREAD;

  // Sin destino explícito, se BUSCA en el estado del coordinador (ver
  // `destino-telegram.mjs`). Es un respaldo para lo que no nace de un mensaje
  // --un cron, un ssh, un script a mano--, que antes perdía el aviso entero.
  // ⚠ Sólo cuando NO viene: si te han dicho a dónde, se va a donde te han dicho.
  let respaldo = null;
  if (!chat) {
    respaldo = elegirDestino();
    if (respaldo) {
      chat = respaldo.chat;
      thread = respaldo.thread;
    }
  }

  if (!token || !chat) {
    console.error(
      '[notify] Falta ' +
        (!token ? 'BOT_TOKEN' : 'COORD_CHAT') +
        ': no hay a dónde avisar.\n' +
        (!token
          ? '        Hereda el entorno del coordinador, o pasa --chat <id>.'
          : '        No vino en el entorno y no hay ningún tema con actividad\n' +
            '        reciente en ' + raizDeDatos() + '. Pasa --chat <id>.'),
    );
    return 2;
  }

  let text = (args.text.length ? args.text.join(' ') : await readStdin()).trim();
  if (!text) {
    console.error('[notify] No hay texto que enviar (ni argumento ni stdin).\n' + USAGE);
    return 2;
  }

  // Un mensaje que aparece en un tema al que NADIE lo dirigió tiene que explicar
  // por qué está ahí. Si no, se lee como que el trabajo era de esta conversación.
  if (respaldo) {
    text += `\n\n— sin destino explícito → ${respaldo.porque}` +
      ` (actividad hace ${haceCuanto(Date.now() - respaldo.visto)}` +
      (respaldo.candidatos > 1 ? `, de ${respaldo.candidatos} temas` : '') + ')';
    console.error(`[notify] sin COORD_CHAT: elegido ${respaldo.sesion} (${respaldo.porque}).`);
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
