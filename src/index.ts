import { Bot, type Context } from 'grammy';
import { BOT_TOKEN, ALLOWED_USER_IDS } from './config.js';
import { seedBootKit, listExecutors, getExecutor } from './registry.js';
import {
  loadSessions,
  getSession,
  setSession,
  endSession,
  sessionId,
} from './sessions.js';
import { processIncoming } from './orchestrator.js';

const TELEGRAM_LIMIT = 4000; // margen bajo el límite real de 4096

function sidOf(ctx: Context): string {
  return sessionId(ctx.chat!.id, ctx.message?.message_thread_id);
}

/** Envía texto respetando el tema (topic) y troceando mensajes largos. */
async function send(ctx: Context, text: string): Promise<void> {
  const thread = ctx.message?.message_thread_id;
  const body = text.length ? text : '(vacío)';
  for (let i = 0; i < body.length; i += TELEGRAM_LIMIT) {
    await ctx.reply(body.slice(i, i + TELEGRAM_LIMIT), { message_thread_id: thread });
  }
}

async function main(): Promise<void> {
  await seedBootKit();
  await loadSessions();

  const bot = new Bot(BOT_TOKEN);

  // /whoami funciona SIN allowlist, para que descubras tu id al configurar.
  bot.command('whoami', async (ctx) => {
    await send(ctx, `Tu user id es: ${ctx.from?.id}\nChat id: ${ctx.chat?.id}`);
  });

  // A partir de aquí, todo exige estar en la allowlist.
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid && ALLOWED_USER_IDS.includes(uid)) return next();
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
        '  /who              muestra el ejecutor activo',
        '  /executors        lista los ejecutores disponibles',
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
    const lines = execs.map(
      (e) => `• ${e.name}  →  encargados: ${e.encargados?.join(', ') || '(ninguno)'}`,
    );
    await send(ctx, 'Ejecutores:\n' + lines.join('\n'));
  });

  bot.command('use', async (ctx) => {
    const name = (ctx.match ?? '').trim();
    if (!name) {
      await send(ctx, 'Uso: /use <ejecutor>');
      return;
    }
    if (!(await getExecutor(name))) {
      await send(ctx, `No existe el ejecutor "${name}". Usa /executors para ver la lista.`);
      return;
    }
    await setSession(sidOf(ctx), name);
    await send(ctx, `✅ Sesión abierta con "${name}". Envía tus mensajes.`);
  });

  bot.command('who', async (ctx) => {
    const exec = getSession(sidOf(ctx));
    await send(ctx, exec ? `Sesión activa: ${exec}` : 'No hay sesión activa en este tema.');
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
      const replies = await processIncoming(exec, text);
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
