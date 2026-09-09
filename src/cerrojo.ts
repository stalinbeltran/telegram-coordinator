/**
 * El CERROJO POR SESIÓN: que nunca haya dos turnos a la vez en el mismo tema.
 *
 * Por qué hace falta
 * ------------------
 * Dos `claude --resume <mismo uuid>` a la vez se pisan: la conversación queda
 * corrupta y el trabajo de uno de los dos se pierde. Hoy eso casi no ocurre
 * porque grammY procesa los updates **en serie**, así que dos mensajes seguidos
 * de Telegram se ordenan solos. Pero en cuanto hay un segundo canal de entrada
 * —la web— eso deja de bastar: un `POST` y un mensaje de Telegram pueden llegar
 * en el mismo instante y no se ordenan por nada.
 *
 * Qué hace y qué NO hace
 * ----------------------
 * Serializa **dentro de este proceso**, que es donde entran Telegram y la web (la
 * web inyecta por fichero y lo recoge el coordinador: decisión P6). Lo que corre
 * FUERA —`repetir`, el resumer— sigue protegiéndose como ya lo hacía: mirando si
 * hay alguien en el hilo antes de escribir. No se sustituye ese mecanismo, que
 * está probado; se cubre el hueco que él no puede ver.
 *
 * ⚠⚠ Y LA REGLA DE CADUCIDAD, QUE AQUÍ ES GRATIS Y HAY QUE MANTENERLA ASÍ.
 * Este cerrojo vive **en memoria**, no en disco. Es deliberado: un cerrojo en
 * disco sobrevive a su dueño, y entonces un SIGKILL a mitad deja el tema
 * bloqueado para siempre — que es exactamente lo que costó el `.resume.lock`. Al
 * vivir en memoria, muere con el proceso y no hay nada que limpiar. **Si alguien
 * lo mueve a disco, tendrá que escribirle una caducidad; hoy no le hace falta
 * porque no puede quedar huérfano.**
 */

/** Cuántos pueden esperar por sesión antes de decir que no. */
export const COLA_MAX = Number(process.env.COORD_COLA_MAX ?? 5);

/** sesión -> promesa del último turno encolado. */
const colas = new Map<string, Promise<unknown>>();
const esperando = new Map<string, number>();

export class ColaLlena extends Error {
  constructor(public readonly sesion: string, public readonly cuantos: number) {
    super(`Ya hay ${cuantos} mensaje(s) esperando en este tema.`);
    this.name = 'ColaLlena';
  }
}

/** Cuántos esperan ahora mismo en esa sesión (sin contar al que corre). */
export function enEspera(sesion: string): number {
  return esperando.get(sesion) ?? 0;
}

/**
 * Corre `tarea` cuando le toque en su sesión. Si hay alguien delante, espera —no
 * se rechaza— porque un mensaje tuyo no se puede tirar: la decisión fue encolar y
 * avisar (P6).
 *
 * @param alEsperar se llama SÓLO si de verdad hay que esperar, para que quien
 *   llame pueda avisar. Sin esto, con `c` (sin timeout) el usuario se queda
 *   minutos sin ninguna señal, que es indistinguible de que el bot lo ignoró.
 */
export async function enTurno<T>(
  sesion: string,
  tarea: () => Promise<T>,
  alEsperar?: (delante: number) => void,
): Promise<T> {
  const anterior = colas.get(sesion);
  const delante = enEspera(sesion) + (anterior ? 1 : 0);

  if (delante > COLA_MAX) throw new ColaLlena(sesion, delante);

  if (anterior) {
    esperando.set(sesion, enEspera(sesion) + 1);
    try { alEsperar?.(delante); } catch { /* avisar no puede romper el turno */ }
  }

  const mio = (async () => {
    // `catch` y no `await` a secas: si el anterior falló, el siguiente tiene que
    // correr igual. Una excepción no puede dejar la sesión bloqueada.
    if (anterior) await anterior.catch(() => {});
    if (anterior) esperando.set(sesion, Math.max(0, enEspera(sesion) - 1));
    return tarea();
  })();

  colas.set(sesion, mio);

  try {
    return await mio;
  } finally {
    // Sólo se limpia si nadie se encoló detrás: si no, se borraría la cadena y
    // el siguiente arrancaría en paralelo con éste, que es justo lo que se evita.
    if (colas.get(sesion) === mio) {
      colas.delete(sesion);
      esperando.delete(sesion);
    }
  }
}

/** Sólo para los tests. */
export function limpiarCerrojos(): void {
  colas.clear();
  esperando.clear();
}
