import { Bot, type Context } from 'grammy';
import type { Message, UserFromGetMe } from 'grammy/types';
import { BOT_TOKEN, ALLOWED_USER_IDS } from './config.js';
import { seedBootKit, listExecutors, getExecutor, reportarFuentes, repoDe } from './registry.js';
import {
  loadSessions,
  getSession,
  setSession,
  endSession,
  sessionId,
} from './sessions.js';
import {
  loadWorkspaces,
  getWorkspace,
  setWorkspace,
  clearWorkspace,
  resolverWorkspace,
  listarWorkspaces,
  decidirWorkspace,
  marcarDefecto,
} from './workspaces.js';
import { processIncoming } from './orchestrator.js';
import {
  LIMITE,
  TTL_MS,
  esTrozo,
  pendiente,
  procesarEntrada,
  descartar,
  forzar,
  anotarAviso,
  contarPendientes,
} from './buffer.js';
import { runCommand } from './runner.js';
import { COORD_HOME } from './config.js';
// @ts-expect-error: modulo JS sin tipos (ver orchestrator.ts)
import { registrar } from '../scripts/errores.mjs';

const TELEGRAM_LIMIT = 4000; // margen bajo el límite real de 4096
/** Clonar los cinco repos tardó 6 s medido el 2026-08-28; el margen es por si
 *  la red va mal, no porque se espere tardar. */
const TIMEOUT_MONTAJE_MS = 600_000;

function sidOf(ctx: Context): string {
  return sessionId(ctx.chat!.id, ctx.message?.message_thread_id);
}

/** Envía texto respetando el tema (topic) y troceando mensajes largos.
 *  Devuelve lo enviado: el aviso de pegado necesita su `message_id` para poder
 *  EDITARLO en el trozo siguiente en vez de mandar N avisos. */
async function send(ctx: Context, text: string): Promise<Message.TextMessage[]> {
  const thread = ctx.message?.message_thread_id;
  const body = text.length ? text : '(vacío)';
  console.log(`[OUT] chat=${ctx.chat?.id} thread=${thread ?? '-'} text=${JSON.stringify(body.slice(0, 200))}`);
  const enviados: Message.TextMessage[] = [];
  for (let i = 0; i < body.length; i += TELEGRAM_LIMIT) {
    enviados.push(await ctx.reply(body.slice(i, i + TELEGRAM_LIMIT), { message_thread_id: thread }));
  }
  return enviados;
}

/** Corre el ejecutor de la sesión con el texto YA completo y responde.
 *  Lo comparten el flujo normal y `/pegado ya`, para no tener dos caminos que
 *  puedan divergir. */
async function atender(ctx: Context, exec: string, texto: string): Promise<void> {
  try {
    const replies = await processIncoming(exec, texto, sidOf(ctx));
    if (replies.length === 0) {
      await send(ctx, '(sin respuesta)');
    } else {
      for (const r of replies) await send(ctx, r);
    }
  } catch (err) {
    console.error('❌ Error inesperado del coordinador:', err);
    // lo INESPERADO: nadie lo declaró y sin log se pierde al reiniciar
    registrar('coordinador_inesperado', String(err),
              { origen: 'coordinador', donde: 'processIncoming',
                traza: err instanceof Error ? err.stack : String(err) });
    await send(ctx, `❌ Error inesperado del coordinador:\n${String(err)}`);
  }
}

/** Acusa recibo de un trozo. El PRIMERO se manda; del segundo en adelante se
 *  EDITA ese mismo aviso: 20 trozos serían 20 mensajes en dos segundos y la Bot
 *  API limita ~1 mensaje/s por chat.
 *  ⚠ Si el aviso falla NO pasa nada grave, y es por el orden: el trozo se
 *  guarda ANTES de avisar. El buffer es la fuente de verdad; el aviso, una
 *  comodidad — la misma regla que rige para `notify.mjs`. */
async function avisarPendiente(
  ctx: Context,
  sid: string,
  r: { trozos: number; chars: number; aviso?: number },
): Promise<void> {
  const txt =
    `📥 Pegado largo: ${r.trozos} trozo(s) · ${r.chars} caracteres guardados.\n` +
    'Espero la continuación: el primer mensaje que NO venga lleno lo cierra y va todo junto.\n\n' +
    'Si ya está completo → /pegado ya    ·    Para tirarlo → /pegado off';
  if (r.aviso !== undefined) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, r.aviso, txt);
      console.log(`[OUT] aviso de pegado editado chat=${ctx.chat?.id} trozos=${r.trozos}`);
      return;
    } catch (err) {
      console.error(`No se pudo editar el aviso de pegado (se manda otro): ${String(err)}`);
    }
  }
  const [m] = await send(ctx, txt);
  if (m) await anotarAviso(sid, m.message_id);
}

/**
 * El PRIMER mensaje de un tema decide en qué árbol trabaja, y se corre ANTES de
 * atender ese mensaje: si no, el primero correría en el árbol equivocado.
 *
 *   · el primer tema que escriba se queda con el del coordinador. Así es como
 *     el usuario lo elige —escribiendo ahí primero—, sin nada que configurar.
 *   · los demás montan el suyo, y sólo al escribir: un tema que nunca escribe
 *     no cuesta ni un fichero ni los ~78 MB de los cinco clones.
 *   · un tema ya decidido no se vuelve a tocar, y `/ws off` ES una decisión.
 *
 * ⚠ Si el montaje falla NO se escribe decisión, así que el mensaje siguiente lo
 * reintenta (R2: no se sigue a medias ni en silencio). Para dejar de intentarlo,
 * `/ws off` — y por eso el aviso de error lo dice.
 */
async function asegurarWorkspace(ctx: Context): Promise<void> {
  const sid = sidOf(ctx);
  const d = decidirWorkspace(sid);
  if (d.accion === 'nada') return;

  if (d.accion === 'defecto') {
    await marcarDefecto(sid);
    console.log(`[WS] ${sid} se queda con el árbol del coordinador (primer tema que escribe)`);
    return;
  }

  // Si ya está montado —reintento tras un fallo, o lo montó alguien a mano— se
  // ata y ya: volver a clonar sobre él fallaría con «ya existe».
  const previo = await resolverWorkspace(d.nombre);
  if ('ws' in previo) {
    await setWorkspace(sid, previo.ws);
    await send(ctx, `🧰 Este tema queda atado a su workspace:\n  ${previo.ws}`);
    return;
  }

  await send(ctx, `🧰 Primer mensaje de este tema: le monto su propio workspace "${d.nombre}" (unos segundos)…`);
  const args = ['--nuevo', d.nombre, ...(d.prefijo ? ['--prefijo', d.prefijo] : []),
    '--que', `tema ${sid} de Telegram`];
  const r = await runCommand(
    `node scripts/workspace.mjs ${args.map((a) => JSON.stringify(a)).join(' ')} 2>&1`,
    '', {}, TIMEOUT_MONTAJE_MS, COORD_HOME,
  );
  const destino = await resolverWorkspace(d.nombre);
  if (!r.ok || 'error' in destino) {
    console.error(`❌ No se pudo montar el workspace de ${sid}:\n${r.output}`);
    await send(ctx, `❌ No pude montarle un workspace a este tema:\n\n${r.output.slice(-1200)}\n\n` +
      'Sigo en el árbol del coordinador y lo reintento en el próximo mensaje. ' +
      'Para que deje de intentarlo: /ws off');
    return;
  }
  await setWorkspace(sid, destino.ws);
  await send(ctx, `🧰 Workspace propio montado y atado:\n  ${destino.ws}\n\n` +
    'Todo lo de este tema corre ahí. Se suelta con /ws off.');
}

/** Monta el bot con todos sus handlers y NO lo arranca.
 *  Separado de `arrancar()` para que se pueda probar el camino real de un
 *  mensaje —enrutado de comandos incluido— sin red y sin token: `bot.botInfo`
 *  se inyecta y las llamadas salientes se interceptan con un transformer. */
export async function crearBot(botInfo?: UserFromGetMe): Promise<Bot> {
  await loadSessions();
  await loadWorkspaces();

  const bot = botInfo ? new Bot(BOT_TOKEN, { botInfo }) : new Bot(BOT_TOKEN);

  // Log de TODO mensaje entrante (antes de cualquier filtro).
  bot.on('message', async (ctx, next) => {
    const m = ctx.message;
    console.log(
      `[IN] user=${ctx.from?.id} chat=${ctx.chat?.id} thread=${m?.message_thread_id ?? '-'} ` +
        `text=${JSON.stringify(m?.text ?? m?.caption ?? '(sin texto)')}`,
    );
    await next();
  });

  // /whoami funciona SIN allowlist, para que descubras tu id al configurar.
  bot.command('whoami', async (ctx) => {
    await send(ctx, `Tu user id es: ${ctx.from?.id}\nChat id: ${ctx.chat?.id}`);
  });

  // A partir de aquí, todo exige estar en la allowlist.
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid && ALLOWED_USER_IDS.includes(uid)) return next();
    console.log(`[BLOCKED] user=${uid} no está en ALLOWED_USER_IDS=[${ALLOWED_USER_IDS.join(',')}]`);
    // Silencio para no filtrar la existencia del bot a terceros.
  });

  bot.command(['start', 'help'], async (ctx) => {
    await send(
      ctx,
      [
        '🤖 Coordinador listo.',
        '',
        'Comandos:',
        '  /use <ejecutor>   abre una sesión en este tema',
        '  /end              cierra la sesión de este tema',
        '  /who              muestra el ejecutor activo y el workspace',
        '  /ws               en qué workspace trabaja este tema',
        '  /ws <nombre>      ata este tema a un workspace (sobrevive a /end)',
        '  /ws off           lo suelta: vuelve al árbol del coordinador',
        '  /pegado           ve/manda/tira un pegado largo a medias',
        '  /executors        lista los ejecutores disponibles',
        '  /executors <n>    la ficha de uno: qué hace y ejemplos',
        '  /whoami           muestra tu id de Telegram',
        '',
        'Con una sesión abierta, cualquier texto se envía al ejecutor.',
        `Un mensaje de ${LIMITE} caracteres o más se guarda como trozo de un pegado largo:`,
        'Telegram parte ahí los mensajes, y el coordinador los une antes de ejecutar.',
        'Tip: usa un grupo con Temas activados → cada tema es una sesión independiente.',
      ].join('\n'),
    );
  });

  bot.command('executors', async (ctx) => {
    const execs = await listExecutors();
    if (execs.length === 0) {
      await send(ctx, 'No hay ejecutores definidos.');
      return;
    }

    // `/executors <nombre>`: la ficha entera. Sustituye al catálogo que antes
    // había que imprimir desde otro repo, porque la descripción ya viaja en el
    // mismo JSON que define el ejecutor.
    const pedido = (ctx.match ?? '').trim();
    if (pedido) {
      const e = execs.find((x) => x.name === pedido);
      if (!e) {
        await send(ctx, `No existe el ejecutor "${pedido}". Usa /executors para ver la lista.`);
        return;
      }
      const det = [
        `• ${e.name}   [${repoDe(e)}]`,
        e.descripcion ? `\n${e.descripcion}` : '\n(sin descripción en su JSON)',
        '',
        `encargados: ${e.encargados?.join(', ') || '(ninguno)'}`,
        `timeout   : ${
          e.timeoutMs === undefined ? '(global)' : e.timeoutMs <= 0 ? 'sin límite' : `${e.timeoutMs} ms`
        }`,
        `directorio: ${e.cwd}`,
        `definido  : ${e.origen?.fichero}`,
      ];
      if (e.requiere?.length) det.push(`necesita  : ${e.requiere.join(', ')}`);
      if (e.falta?.length) {
        det.push('', `⛔ En esta máquina falta: ${e.falta.join(', ')}. Este ejecutor va a fallar.`);
      }
      if (e.ejemplos?.length) det.push('', 'Ejemplos:', ...e.ejemplos.map((x) => `  ${x}`));
      if (e.origen?.pisados.length) {
        det.push('', '⚠️ Definido más de una vez; los pisados son:', ...e.origen.pisados.map((p) => `  ${p}`));
      }
      await send(ctx, det.join('\n'));
      return;
    }

    const lines = execs.map((e) => {
      // Se MARCA, no se esconde: un comando ausente no se distingue de un repo
      // que falta, y entonces no sabes si instalar algo o clonar algo.
      const avisos =
        (e.origen?.pisados.length ? '  ⚠️ duplicado' : '') +
        (e.falta?.length ? `  ⛔ falta ${e.falta.join(', ')}` : '');
      const desc = e.descripcion ?? `encargados: ${e.encargados?.join(', ') || '(ninguno)'}`;
      return `• ${e.name}   [${repoDe(e)}]${avisos}\n    ${desc}`;
    });
    await send(
      ctx,
      'Ejecutores (entre corchetes, el repo que lo declara):\n\n' +
        lines.join('\n') +
        '\n\nDetalle de uno: /executors <nombre>',
    );
  });

  bot.command('use', async (ctx) => {
    await asegurarWorkspace(ctx);
    const name = (ctx.match ?? '').trim();
    if (!name) {
      await send(ctx, 'Uso: /use <ejecutor>');
      return;
    }
    const exec = await getExecutor(name);
    if (!exec) {
      await send(ctx, `No existe el ejecutor "${name}". Usa /executors para ver la lista.`);
      return;
    }
    await setSession(sidOf(ctx), name);
    // Los ejemplos se muestran AQUÍ porque es cuando hacen falta: acabas de
    // abrir la sesión y lo siguiente que escribes es la entrada del ejecutor.
    // Avisa pero NO bloquea: la comprobación mira el PATH de este proceso, y un
    // falso negativo que impidiera abrir una sesión que sí funciona sería peor
    // que el aviso. Si de verdad falta, el ejecutor fallará con su propio error.
    const extra = [
      exec.falta?.length
        ? `\n\n⛔ Ojo: falta ${exec.falta.join(', ')} en esta máquina. Es probable que falle.`
        : '',
      exec.descripcion ? `\n${exec.descripcion}` : '',
      exec.ejemplos?.length ? '\n\nEjemplos:\n' + exec.ejemplos.map((x) => `  ${x}`).join('\n') : '',
    ].join('');
    await send(ctx, `✅ Sesión abierta con "${name}". Envía tus mensajes.${extra}`);
  });

  bot.command('who', async (ctx) => {
    const sid = sidOf(ctx);
    const exec = getSession(sid);
    const ws = getWorkspace(sid);
    await send(
      ctx,
      [
        exec ? `Sesión activa: ${exec}` : 'No hay sesión activa en este tema.',
        ws ? `Workspace: ${ws}` : 'Workspace: (ninguno) — se usa el árbol del coordinador.',
      ].join('\n'),
    );
  });

  // `/ws` es un comando de CONTROL y no un ejecutor a propósito: los ejecutores
  // se re-enraízan bajo el workspace del tema, así que si esto fuera uno, la
  // forma de soltar un workspace roto viviría DENTRO de ese workspace. Un
  // comando de control corre en el proceso del bot y no se puede re-enraizar:
  // la salida de emergencia nunca depende de aquello de lo que quieres salir.
  bot.command('ws', async (ctx) => {
    const sid = sidOf(ctx);
    const arg = (ctx.match ?? '').trim();

    if (!arg) {
      const ws = getWorkspace(sid);
      const otros = await listarWorkspaces();
      const lista = otros.length
        ? '\n\nMontados en esta máquina:\n' +
          otros.map((o) => `  ${o.nombre}${o.prefijo ? `  (${o.prefijo})` : ''}   ${o.raiz}`).join('\n')
        : '\n\nNo hay ninguno montado. Móntalo con /use workspace → --nuevo <linea>';
      await send(
        ctx,
        (ws
          ? `Este tema trabaja en:\n  ${ws}`
          : 'Este tema no está atado a ningún workspace: usa el árbol del coordinador.') + lista,
      );
      return;
    }

    if (arg === 'off' || arg === 'none' || arg === '-') {
      const habia = await clearWorkspace(sid);
      await send(
        ctx,
        habia
          ? '🔓 Workspace soltado. Este tema vuelve al árbol del coordinador.'
          : 'Este tema no estaba atado a ningún workspace.',
      );
      return;
    }

    const r = await resolverWorkspace(arg);
    if ('error' in r) {
      await send(ctx, `❌ ${r.error}`);
      return;
    }
    await setWorkspace(sid, r.ws);
    await send(
      ctx,
      `✅ Este tema trabaja ahora en:\n  ${r.ws}\n\n` +
        'Todo ejecutor correrá en el repo equivalente de ese árbol, y recibe ' +
        '`COORD_WS`. Sobrevive a /end; se suelta con /ws off.',
    );
  });

  bot.command('end', async (ctx) => {
    const existed = await endSession(sidOf(ctx));
    await send(ctx, existed ? '🔚 Sesión cerrada.' : 'No había sesión activa en este tema.');
  });

  // Ver / mandar ya / tirar el pegado a medias. Es comando de CONTROL por lo
  // mismo que `/ws`: corre en el proceso del bot, así que la salida de
  // emergencia no depende de aquello de lo que quieres salir.
  bot.command('pegado', async (ctx) => {
    const sid = sidOf(ctx);
    const arg = (ctx.match ?? '').trim().toLowerCase();
    const p = await pendiente(sid);

    if (arg === 'off' || arg === 'no' || arg === '-') {
      const habia = await descartar(sid);
      await send(ctx, habia
        ? `🗑️ Tirados ${p!.trozos} trozo(s) (${p!.chars} caracteres).`
        : 'No hay ningún pegado a medias en este tema.');
      return;
    }

    if (!p) {
      await send(ctx,
        'No hay ningún pegado a medias en este tema.\n\n' +
        `Se acumula solo: un mensaje de ${LIMITE} caracteres o más se guarda como trozo ` +
        '(Telegram parte ahí los mensajes largos), y el primero que venga más corto lo cierra.');
      return;
    }

    if (arg === 'ya' || arg === 'ok') {
      const exec = getSession(sid);
      if (!exec) {
        await send(ctx, 'No hay sesión activa. Usa /use <ejecutor> y repite /pegado ya.');
        return;
      }
      const f = await forzar(sid);
      if (!f) {
        await send(ctx, 'No hay ningún pegado a medias en este tema.');
        return;
      }
      console.log(`[BUF] ${sid}: /pegado ya → ${f.trozos} trozo(s), ${f.texto.length} car.`);
      await atender(ctx, exec, f.texto);
      return;
    }

    await send(ctx, [
      `📥 Pegado a medias: ${p.trozos} trozo(s) · ${p.chars} caracteres.`,
      `Último trozo hace ${Math.round(p.edadMs / 1000)} s (caduca a los ${Math.round(TTL_MS / 60000)} min).`,
      '',
      'Mandarlo ya → /pegado ya    ·    Tirarlo → /pegado off',
    ].join('\n'));
  });

  // Cualquier texto que no sea comando: va al ejecutor de la sesión.
  bot.on('message:text', async (ctx) => {
    const sid = sidOf(ctx);
    const text = ctx.message.text;

    // Aquí sólo llegan comandos NO reconocidos (grammY ya se llevó los de
    // verdad). Dos cambios sobre el `return` mudo de antes:
    //   · se avisa, en vez de tragárselo sin dejar rastro;
    //   · y si hay un pegado a medias, o el mensaje viene LLENO, no es un
    //     comando fallido: es la continuación de un pegado cuyo corte cayó
    //     justo antes de un `/` (una ruta, un `/usr/...`). Descartarla
    //     ensamblaba una instrucción mutilada y la ejecutaba entera.
    if (text.startsWith('/') && !esTrozo(text) && !(await pendiente(sid))) {
      await send(ctx, `«${text.split(/\s+/)[0]}» no es un comando (mira /help). ` +
        'Si iba para el ejecutor, ponle un espacio delante.');
      return;
    }

    // ANTES de enrutar: si no, el primer mensaje de un tema correría en el árbol
    // del coordinador y sólo el segundo iría a donde toca.
    await asegurarWorkspace(ctx);
    const exec = getSession(sid);
    if (!exec) {
      // Sin sesión no se acumula: no habría a quién mandárselo, y guardar en
      // silencio lo que nadie va a atender es peor que repetir este aviso.
      await send(ctx, 'No hay sesión activa. Usa /use <ejecutor> para empezar.');
      return;
    }

    const r = await procesarEntrada(sid, ctx.message.message_id, text);
    if (r.accion === 'esperar') {
      await avisarPendiente(ctx, sid, r);
      return;
    }
    if (r.caducado) {
      await send(ctx,
        `⏳ Había ${r.caducado.trozos} trozo(s) (${r.caducado.chars} caracteres) de hace ` +
        `${Math.round(r.caducado.edadMs / 60000)} min: NO los pego a esto. Siguen en:\n  ${r.caducado.fichero}`);
    }
    if (r.trozos > 1) {
      console.log(`[BUF] ${sid}: ${r.trozos} trozos unidos → ${r.texto.length} caracteres`);
    }
    await atender(ctx, exec, r.texto);
  });

  // Evita que cualquier error tumbe el proceso.
  bot.catch((err) => {
    console.error('Error en el bot:', err);
    registrar('bot_error', String(err), { origen: 'coordinador', donde: 'grammY',
      traza: err instanceof Error ? err.stack : String(err) });
  });

  return bot;
}

/** Arranque de verdad: siembra el kit, informa de las fuentes y hace polling. */
export async function arrancar(): Promise<void> {
  await seedBootKit();
  await reportarFuentes();
  const bot = await crearBot();
  const aMedias = await contarPendientes();
  if (aMedias) {
    console.log(`📥 ${aMedias} tema(s) con un pegado a medias en data/buffer/ (sobrevivieron al reinicio).`);
  }
  console.log('🚀 Coordinador arrancando (long polling)...');
  await bot.start({
    onStart: (info) => console.log(`Conectado como @${info.username}`),
  });
}
