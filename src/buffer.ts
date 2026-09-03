import { readFile, writeFile, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

/**
 * Reensambla los mensajes que el CLIENTE de Telegram parte por el límite de
 * longitud, para que el ejecutor reciba la instrucción entera y no un trozo.
 *
 * Va en el núcleo y se aplica a TODO ejecutor, sin excepción ni campo que lo
 * active: el límite es de Telegram, no de ningún ejecutor, igual que el troceo
 * de la SALIDA (`send()` en bot.ts) que ya se aplica a todos sin que nadie
 * opine. Esto es su simétrico exacto en la entrada.
 *
 * ⚠ Qué se puede observar y qué no, que es de donde sale toda la regla:
 * «no viene nada más» NO es observable desde aquí. Lo único observable es
 * «este mensaje no viene lleno». De ahí:
 *
 *     length >= LIMITE  ⇒  viene lleno  ⇒  hay más: se guarda y se espera
 *     cualquier otro    ⇒  cierra: se une todo y se manda al ejecutor
 *
 * Da igual que sean 2 trozos o 20: `N` no aparece en ninguna decisión. Los dos
 * casos que la regla no puede resolver sola —un pegado que mida múltiplo exacto
 * del límite, y un mensaje legítimo de exactamente esa longitud— NO se
 * resuelven en silencio: se anuncian y se sueltan con `/pegado ya`.
 *
 * El criterio es la LONGITUD y no un temporizador de silencio a propósito:
 *   · un temporizador grava todos los mensajes cortos, que son el 99 %;
 *   · y sobre todo dispararía FUERA del bucle de updates de grammY —que los
 *     procesa en serie (`node_modules/grammy/out/bot.js:189-194`, v1.44.0)—,
 *     así que podría lanzar un ejecutor en paralelo con el mensaje siguiente:
 *     dos `claude --resume <mismo uuid>` a la vez. Con la longitud no hay
 *     temporizador y ese problema no llega a existir.
 *
 * El estado vive en `DATA_DIR/buffer/` y se lee de disco cada vez (como
 * `claude-marker.mjs`): así sobrevive al `systemctl restart` con el que se
 * despliega aquí, y no hay dos copias que se puedan desincronizar.
 */

const dir = join(DATA_DIR, 'buffer');

/**
 * El límite real de la Bot API son 4096 unidades UTF-16, que es exactamente lo
 * que cuenta `String.length` en JS: la comparación es exacta, no aproximada.
 * (Leído de la doc de la Bot API; NO comprobado contra un corte real todavía.)
 *
 * ⚠ Es un número MEDIDO, no de gusto: si se comprueba que el cliente corta por
 * palabra POR DEBAJO del límite, ningún trozo llegará a 4096 y esto no
 * dispararía nunca — no falla a gritos, falla no haciendo nada. Se ajusta con
 * `COORD_INPUT_LIMIT` a lo que salga de medir, anotando la fecha aquí.
 *
 * `COORD_INPUT_LIMIT=0` apaga el reensamblado entero sin desplegar nada: es la
 * salida de emergencia de una función que está en el camino de TODO mensaje.
 */
export const LIMITE = Number(process.env.COORD_INPUT_LIMIT ?? 4096);

/**
 * Caducidad del buffer, escrita al lado del cerrojo que gobierna: los trozos de
 * un mismo pegado llegan con segundos de diferencia, así que 30 min es margen
 * de sobra, y pasado eso pegar lo de esta mañana al mensaje de esta tarde sería
 * corrupción silenciosa. Se comprueba AL LEER, nunca con un temporizador: entre
 * mensaje y mensaje no hay nada vivo en este sistema.
 */
export const TTL_MS = Number(process.env.COORD_BUFFER_TTL_MS ?? 1_800_000);

interface Trozo {
  /** `message_id` de Telegram: es lo que fija el ORDEN, no el de llegada. */
  mid: number;
  texto: string;
}

interface Pendiente {
  id: string;
  trozos: Trozo[];
  /** Epoch ms del primer trozo y del último; la caducidad mira el último. */
  desde: number;
  ultimo: number;
  /** `message_id` del aviso, para editarlo en vez de mandar N avisos. */
  aviso?: number;
}

/** Un buffer que venció su TTL: NO se pega al mensaje nuevo, se dice y se aparta. */
export interface Caducado {
  trozos: number;
  chars: number;
  edadMs: number;
  fichero: string;
}

export type Entrada =
  | { accion: 'esperar'; trozos: number; chars: number; aviso?: number }
  | { accion: 'atender'; texto: string; trozos: number; caducado?: Caducado };

function sanitize(id: string): string {
  return id.replace(/[^\w.-]/g, '_');
}

function fichero(sid: string): string {
  return join(dir, `${sanitize(sid)}.json`);
}

/** Un mensaje que viene LLENO es, casi seguro, un trozo de otro más largo. */
export function esTrozo(texto: string): boolean {
  return LIMITE > 0 && texto.length >= LIMITE;
}

async function leer(sid: string): Promise<Pendiente | undefined> {
  try {
    const p = JSON.parse(await readFile(fichero(sid), 'utf8')) as Pendiente;
    return Array.isArray(p?.trozos) && p.trozos.length ? p : undefined;
  } catch {
    return undefined; // no hay, o está corrupto: se trata igual que no haber
  }
}

async function escribir(p: Pendiente): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(fichero(p.id), JSON.stringify(p, null, 2) + '\n');
}

/** Une los trozos SIN separador: un corte del cliente parte por el carácter. */
function unir(p: Pendiente): string {
  return [...p.trozos].sort((a, b) => a.mid - b.mid).map((t) => t.texto).join('');
}

function chars(p: Pendiente): number {
  return p.trozos.reduce((n, t) => n + t.texto.length, 0);
}

/** Qué hay guardado en este tema (para `/pegado` y para el aviso). */
export async function pendiente(
  sid: string,
): Promise<{ trozos: number; chars: number; edadMs: number; aviso?: number } | undefined> {
  const p = await leer(sid);
  if (!p) return undefined;
  return { trozos: p.trozos.length, chars: chars(p), edadMs: Date.now() - p.ultimo, aviso: p.aviso };
}

/**
 * Aparta un buffer caducado en vez de borrarlo. Tirar en silencio una
 * instrucción larga tecleada desde el móvil es el fallo caro de este proyecto
 * con otro nombre; el nombre lleva la hora para que una segunda caducidad no
 * pise a la primera.
 */
async function apartar(p: Pendiente): Promise<string> {
  const destino = join(dir, `${sanitize(p.id)}.caducado-${p.ultimo}.json`);
  try {
    await rename(fichero(p.id), destino);
  } catch {
    /* si no se puede mover, se pierde el apartado pero no el flujo */
  }
  return destino;
}

/** Borra lo pendiente. `true` si había algo. */
export async function descartar(sid: string): Promise<boolean> {
  const p = await leer(sid);
  try {
    await unlink(fichero(sid));
  } catch {
    /* no existía */
  }
  return Boolean(p);
}

/** Vacía y devuelve lo pendiente sin añadir nada (`/pegado ya`). */
export async function forzar(sid: string): Promise<{ texto: string; trozos: number } | undefined> {
  const p = await leer(sid);
  if (!p) return undefined;
  await descartar(sid);
  return { texto: unir(p), trozos: p.trozos.length };
}

/** Anota el `message_id` del aviso para poder EDITARLO en el trozo siguiente. */
export async function anotarAviso(sid: string, aviso: number): Promise<void> {
  const p = await leer(sid);
  if (!p) return; // se vació entre medias: el aviso ya no gobierna nada
  p.aviso = aviso;
  await escribir(p);
}

/**
 * La máquina de estados entera, en una función pura de leer/escribir disco.
 * Vive aquí y no en `bot.ts` porque `bot.ts` arranca el bot al importarse y no
 * se puede testear: lo que puede romperse en silencio tiene que ser probable.
 */
export async function procesarEntrada(sid: string, mid: number, texto: string): Promise<Entrada> {
  const previo = await leer(sid);

  // Camino común (mensaje corto, nada pendiente): ni una escritura en disco.
  if (!previo && !esTrozo(texto)) return { accion: 'atender', texto, trozos: 1 };

  let caducado: Caducado | undefined;
  let base = previo;
  if (previo && Date.now() - previo.ultimo > TTL_MS) {
    const f = await apartar(previo);
    caducado = { trozos: previo.trozos.length, chars: chars(previo), edadMs: Date.now() - previo.ultimo, fichero: f };
    base = undefined;
  }

  const ahora = Date.now();
  const p: Pendiente = base ?? { id: sid, trozos: [], desde: ahora, ultimo: ahora };
  p.trozos.push({ mid, texto });
  p.ultimo = ahora;

  if (esTrozo(texto)) {
    await escribir(p);
    return { accion: 'esperar', trozos: p.trozos.length, chars: chars(p), aviso: p.aviso };
  }

  await descartar(sid);
  return { accion: 'atender', texto: unir(p), trozos: p.trozos.length, ...(caducado ? { caducado } : {}) };
}

/** Cuántos temas tienen algo a medias (para el arranque del bot). */
export async function contarPendientes(): Promise<number> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.includes('.caducado-')).length;
  } catch {
    return 0;
  }
}
