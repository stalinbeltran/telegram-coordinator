/**
 * La entrada desde la web: mensajes que NO vienen de Telegram.
 *
 * Cómo llegan, y por qué así
 * --------------------------
 * La web deja un fichero en `data/entrada/` y esto lo recoge. Se eligió esto
 * (decisión P6) en vez de un endpoint en el coordinador porque es **simétrico
 * con lo que ya hacen los procesos desacoplados**: escribir un fichero funciona
 * aunque el otro lado esté caído, y no abre ningún puerto nuevo en el proceso que
 * hace long polling justamente para no tener ninguno.
 *
 * Qué garantiza
 * -------------
 * - **Entra por el mismo camino que un mensaje de Telegram**: `processIncoming`,
 *   con su cerrojo, su log y sus encargados. No hay una segunda forma de correr
 *   un turno que pueda divergir de la primera.
 * - **Se hace eco en Telegram**, porque si los dos clientes no ven lo mismo, el
 *   espejo miente. ⚠ Aparecerá como mensaje del BOT y con una marca: la Bot API
 *   no deja publicar en nombre de una persona.
 * - **Cada fichero se procesa UNA vez**: se renombra antes de tocarlo, así que
 *   dos vigilantes o un sondeo solapado no pueden duplicar un turno.
 *
 * ⚠⚠ LA CADUCIDAD, ESCRITA AL LADO (regla 3)
 * Si el coordinador está parado, los ficheros se acumulan — y eso es bueno, no se
 * pierden. Pero un mensaje de hace tres días **no se ejecuta al arrancar**: con
 * `bypassPermissions` eso puede alquilar máquinas por algo que ya no quieres. Lo
 * vencido se APARTA (no se borra: tirarlo también sería perder trabajo) y se
 * avisa, igual que hace `src/buffer.ts` con un pegado caducado.
 */
import { watch } from 'node:fs';
import { readFile, readdir, rename, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Bot } from 'grammy';
import { DATA_DIR } from './config.js';
import { getSession } from './sessions.js';
import { processIncoming } from './orchestrator.js';
// @ts-expect-error: modulo JS sin tipos (ver orchestrator.ts)
import { publicar } from '../scripts/mensajes.mjs';

/** Pasado esto, un mensaje que nunca se llegó a atender ya no se ejecuta. */
export const VENCE_MS = Number(process.env.COORD_ENTRADA_TTL_MS ?? 900_000);   // 15 min

/** Cada cuánto se mira, además del watcher — que no es fiable en todo sistema
 *  de ficheros y cuando falla no avisa. Mismo razonamiento que en la web. */
export const SONDEO_MS = Number(process.env.COORD_ENTRADA_SONDEO_MS ?? 2000);

export const dirEntrada = (): string => join(DATA_DIR, 'entrada');

export interface Pendiente { sesion: string; texto: string; cuando: string }

let trabajando = false;

/**
 * Recoge lo que haya y lo atiende. NUNCA lanza.
 * @param enviar cómo hablar con Telegram; se inyecta para poder probar sin red.
 */
export async function recoger(
  enviar: (chatId: number, threadId: number | undefined, texto: string) => Promise<unknown>,
  ahora = Date.now(),
): Promise<number> {
  if (trabajando) return 0;      // el sondeo y el watcher pueden coincidir
  trabajando = true;
  let atendidos = 0;
  try {
    const dir = dirEntrada();
    await mkdir(dir, { recursive: true });
    const ficheros = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();

    for (const f of ficheros) {
      const origen = join(dir, f);
      // Se renombra ANTES de leer: es lo que garantiza que un fichero se atienda
      // una sola vez aunque dos pasadas se solapen.
      const tomado = `${origen}.tomado`;
      try { await rename(origen, tomado); } catch { continue; }

      let m: Pendiente;
      try {
        m = JSON.parse(await readFile(tomado, 'utf8'));
        if (!m?.sesion || typeof m.texto !== 'string') throw new Error('sin sesión o sin texto');
      } catch (e) {
        console.error(`[entrada] ${f} ilegible, lo aparto: ${(e as Error).message}`);
        await rename(tomado, `${origen}.roto`).catch(() => {});
        continue;
      }

      const edad = ahora - new Date(m.cuando ?? 0).getTime();
      if (Number.isFinite(edad) && edad > VENCE_MS) {
        // No se ejecuta y NO se borra: se aparta. Con `bypassPermissions`, correr
        // una orden de hace horas puede hacer algo que ya no quieres; y tirarla
        // sin más sería perder lo que escribiste.
        const guardado = `${origen}.caducado`;
        await rename(tomado, guardado).catch(() => {});
        console.error(`[entrada] ${f} tiene ${Math.round(edad / 60000)} min: NO lo ejecuto.`);
        await avisarSesion(m.sesion, enviar,
          `⏳ Tu mensaje desde la app llevaba ${Math.round(edad / 60000)} min esperando ` +
          '(el bot estaba parado), así que NO lo he ejecutado.\n' +
          `Sigue guardado en ${guardado}. Si aún lo quieres, mándalo otra vez.`);
        continue;
      }

      await atenderUno(m, enviar);
      await unlink(tomado).catch(() => {});
      atendidos++;
    }
  } catch (e) {
    console.error(`[entrada] no pude recoger: ${(e as Error)?.message ?? e}`);
  } finally {
    trabajando = false;
  }
  return atendidos;
}

function partes(sesion: string): { chat: number; hilo: number | undefined } {
  const i = sesion.lastIndexOf('_');
  const hilo = sesion.slice(i + 1);
  return { chat: Number(sesion.slice(0, i)), hilo: hilo === 'main' ? undefined : Number(hilo) };
}

async function avisarSesion(
  sesion: string,
  enviar: (c: number, h: number | undefined, t: string) => Promise<unknown>,
  texto: string,
): Promise<void> {
  const { chat, hilo } = partes(sesion);
  publicar({ sesion, autor: 'sistema', origen: 'web', texto });
  if (Number.isFinite(chat)) await enviar(chat, hilo, texto).catch(() => {});
}

async function atenderUno(
  m: Pendiente,
  enviar: (c: number, h: number | undefined, t: string) => Promise<unknown>,
): Promise<void> {
  const exec = getSession(m.sesion);
  if (!exec) {
    await avisarSesion(m.sesion, enviar,
      '❌ Escribiste desde la app, pero este tema no tiene ninguna sesión abierta.\n' +
      'Ábrela desde Telegram con /use c y vuelve a intentarlo.');
    return;
  }

  const { chat, hilo } = partes(m.sesion);
  // El eco. ⚠ Sale como mensaje del BOT y con marca: la Bot API no permite
  // publicar en nombre de una persona, así que fingir que eres tú sería mentir
  // sobre quién escribió.
  await enviar(chat, hilo, `📱 (desde la app) ${m.texto}`).catch((e) => {
    console.error(`[entrada] no pude hacer eco en Telegram: ${e?.message ?? e}`);
  });

  const replies = await processIncoming(exec, m.texto, m.sesion, 'web', (delante) => {
    void enviar(chat, hilo, `⏳ Hay ${delante} turno(s) por delante en este tema.`);
  });
  for (const r of replies) await enviar(chat, hilo, r).catch(() => {});
}

/** Arranca el vigilante. Devuelve cómo pararlo (para los tests). */
export function vigilarEntrada(bot: Bot,
  enviarA: (api: Bot['api'], c: number, h: number | undefined, t: string) => Promise<unknown>,
): () => void {
  const enviar = (c: number, h: number | undefined, t: string) => enviarA(bot.api, c, h, t);
  const tic = () => void recoger(enviar);

  const timer = setInterval(tic, SONDEO_MS);
  timer.unref();
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(dirEntrada(), tic);
    watcher.unref?.();
    watcher.on('error', () => { /* el sondeo sigue: por eso existe */ });
  } catch { /* el directorio aún no existe; el sondeo lo creará */ }

  tic();   // lo que se acumuló mientras el bot estaba parado
  return () => { clearInterval(timer); watcher?.close(); };
}
