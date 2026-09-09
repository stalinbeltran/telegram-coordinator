/**
 * El LATIDO del coordinador: un fichero que dice que sigue vivo y qué está
 * atendiendo ahora mismo.
 *
 * Para qué
 * --------
 * La web de lectura tiene que poder contestar dos preguntas que hasta ahora
 * nadie podía:
 *
 *   1. **¿está el bot vivo?** Enseñar el último log como si fuera de ahora es
 *      fallar a mitad: el usuario cree que claude no le ha contestado cuando en
 *      realidad el coordinador está parado.
 *   2. **¿hay un turno en curso?** Sin streaming no hay señal de vida: si no se
 *      marca, la web parece colgada mientras claude piensa (que pueden ser
 *      minutos, porque `c` corre con `timeoutMs: 0`).
 *
 * Las dos se responden con el MISMO fichero, y no es por ahorrar: es que
 * comparten la regla de caducidad.
 *
 * ⚠⚠ LA CADUCIDAD, ESCRITA AL LADO (regla 3 de escritura del proyecto)
 * ---------------------------------------------------------------------
 * El proceso puede morir por SIGKILL sin borrar nada, así que un `existsSync` a
 * secas convertiría un fallo de una tarde en «hay un turno en curso» PARA
 * SIEMPRE — que es exactamente lo que costó el `.resume.lock`.
 *
 * Por eso el fichero **no declara** que está vivo: lo demuestra refrescando
 * `visto`. Si `visto` tiene más de `VENCE_MS`, todo lo que diga se descarta,
 * incluidos los turnos. Y como los turnos viven dentro del mismo fichero, **se
 * caen con él**: si el bot muere a mitad de un turno, no queda ningún «pendiente»
 * colgado que limpiar. No hay estado que sobreviva a su dueño.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

/** Cada cuánto se refresca. Suficientemente corto para que la web note una caída
 *  en segundos, suficientemente largo para no escribir sin parar. */
export const LATIDO_MS = Number(process.env.COORD_LATIDO_MS ?? 15_000);

/** Sin refrescar durante esto, se da por muerto. Son 3 latidos: uno perdido por
 *  carga o por un turno que bloquea el bucle no puede leerse como una caída. */
export const VENCE_MS = LATIDO_MS * 3;

export const ficheroLatido = (): string => join(DATA_DIR, 'coordinador.json');

const turnos = new Map<string, { desde: string; ejecutor: string }>();
let arrancado = '';
let timer: NodeJS.Timeout | undefined;

/**
 * Escribe el latido. NUNCA lanza: un fallo de disco no puede tumbar el bot.
 *
 * ⚠ SÍNCRONA a propósito. Con escrituras asíncronas sin esperar, un
 * `empiezaTurno` y el `acabaTurno` que le sigue son dos escrituras concurrentes
 * del MISMO fichero, y pueden llegar en orden inverso: el latido se queda
 * diciendo que hay un turno que ya terminó, y la web anuncia «esperando
 * respuesta» hasta el siguiente latido periódico. Lo pilló su test de
 * integración el 2026-09-09. Son ~300 bytes: el coste de serializar así es
 * ninguno, y a cambio desaparece la clase entera de carreras. Es el mismo
 * razonamiento del `appendFileSync` de `errores.mjs`.
 */
export function escribir(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ficheroLatido(), JSON.stringify({
      pid: process.pid,
      arrancado,
      visto: new Date().toISOString(),
      vence_ms: VENCE_MS,   // el lector no tiene que adivinar la regla: viaja con el dato
      turnos: Object.fromEntries(turnos),
    }, null, 2) + '\n');
  } catch (e) {
    console.error(`[latido] no pude escribir: ${(e as Error)?.message ?? e}`);
  }
}

export function empiezaTurno(sesion: string, ejecutor: string): void {
  turnos.set(sesion, { desde: new Date().toISOString(), ejecutor });
  escribir();
}

export function acabaTurno(sesion: string): void {
  turnos.delete(sesion);
  escribir();
}

/** Arranca el latido periódico. `unref()` para que no impida salir al proceso. */
export function arrancarLatido(): void {
  arrancado = new Date().toISOString();
  escribir();
  timer = setInterval(escribir, LATIDO_MS);
  timer.unref();
}

/** Sólo para los tests: para el reloj y limpia. */
export function pararLatido(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  turnos.clear();
}
