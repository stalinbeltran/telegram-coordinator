import { Bot, type Context } from 'grammy';
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
} from './workspaces.js';
import { processIncoming } from './orchestrator.js';

const TELEGRAM_LIMIT = 4000; // margen bajo el límite real de 4096

function sidOf(ctx: Context): string {
  return sessionId(ctx.chat!.id, ctx.message?.message_thread_id);
}

/** Envía texto respetando el tema (topic) y troceando mensajes largos. */
async function send(ctx: Context, text: string): Promise<void> {
  const thread = ctx.message?.message_thread_id;
  const body = text.length ? text : '(vacío)';
  console.log(`[OUT] chat=${ctx.chat?.id} thread=${thread ?? '-'} text=${JSON.stringify(body.slice(0, 200))}`);
  for (let i = 0; i < body.length; i += TELEGRAM_LIMIT) {
    await ctx.reply(body.slice(i, i + TELEGRAM_LIMIT), { message_thread_id: thread });
  }
}

async function main(): Promise<void> {
  await seedBootKit();
  await reportarFuentes();
  await loadSessions();
  await loadWorkspaces();

  const bot = new Bot(BOT_TOKEN);

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
        '  /executors        lista los ejecutores disponibles',
        '  /executors <n>    la ficha de uno: qué hace y ejemplos',
        '  /whoami           muestra tu id de Telegram',
        '',
        'Con una sesión abierta, cualquier texto se envía al ejecutor.',
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

  // Cualquier texto que no sea comando: va al ejecutor de la sesión.
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // comando no reconocido
    const exec = getSession(sidOf(ctx));
    if (!exec) {
      await send(ctx, 'No hay sesión activa. Usa /use <ejecutor> para empezar.');
      return;
    }
    try {
      const replies = await processIncoming(exec, text, sidOf(ctx));
      if (replies.length === 0) {
        await send(ctx, '(sin respuesta)');
      } else {
        for (const r of replies) await send(ctx, r);
      }
    } catch (err) {
      console.error('❌ Error inesperado del coordinador:', err);
      await send(ctx, `❌ Error inesperado del coordinador:\n${String(err)}`);
    }
  });

  // Evita que cualquier error tumbe el proceso.
  bot.catch((err) => {
    console.error('Error en el bot:', err);
  });

  console.log('🚀 Coordinador arrancando (long polling)...');
  await bot.start({
    onStart: (info) => console.log(`Conectado como @${info.username}`),
  });
}

main().catch((err) => {
  console.error('Fallo fatal al iniciar:', err);
  process.exit(1);
});
