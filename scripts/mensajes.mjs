// El LOG DE MENSAJES: lo que se dijo en cada tema, en un JSONL por sesión.
//
// Por qué existe
// --------------
// El coordinador no guardaba *lo que se dijo*: `data/` tiene el ejecutor ligado,
// el `cwd`, la época de claude y el pegado a medias, pero el texto de la
// conversación vivía en el chat de Telegram y en ningún sitio propio. Sin este
// registro no hay segundo cliente posible, y con él el resto sale casi gratis.
//
// Por qué en `scripts/` y no en `src/`
// ------------------------------------
// Porque lo tienen que importar los procesos DESACOPLADOS (`notify.mjs`,
// `repetir-bucle.mjs`, `claude-reset.mjs`), y ésos se lanzan con `node` a secas,
// sin `tsx`: desde ahí no se puede importar un `.ts`. Es exactamente el caso de
// `errores.mjs`, que `src/orchestrator.ts` importa con un `@ts-expect-error`.
// Ponerlo en `src/` obligaría a una segunda implementación para los scripts, y
// dos copias de esto divergen sin que nadie se entere.
//
// Las cinco reglas que hay que respetar si se toca
// ------------------------------------------------
// 1. ⚠⚠ PUBLICAR NO PUEDE TUMBAR EL COORDINADOR. Es la regla 3 de su CLAUDE.md
//    («los errores nunca tumban el coordinador») aplicada al que registra: si
//    esto lanza, un fallo de escritura se convierte en una caída del bot. Todo va
//    en try/catch y lo peor que pasa es un `console.error`. Igual que
//    `errores.mjs`, y por lo mismo.
// 2. ⚠⚠ `DATA_DIR` SE RESUELVE EN UN SOLO SITIO, Y NUNCA CAE A `'data'`. El
//    coordinador pasa `DATA_DIR` absoluto a todo comando precisamente para que el
//    estado por tema NO se mude con el workspace. Un fallback relativo al cwd
//    —que es lo que hacen hoy `claude-marker.mjs:26`, `repetir-estado.mjs:42`,
//    `shell-cwd.mjs:28` y `define.mjs:23`— haría que un tema atado a `~/ws/tema-2`
//    escribiera su log en la copia, partiéndolo en dos SIN UN SOLO ERROR. Es la
//    misma forma del fallo de `notify.mjs` con `.env` del 2026-09-04.
// 3. Se REDACTA con `redactar.mjs`, el mismo módulo que el archivador de
//    conversaciones y el log de errores. Copiar la redacción era la trampa
//    conocida: la copia que se queda corta es la que deja el secreto en disco.
// 4. El texto se RECORTA con tope, y cuando se recorta SE DICE dentro del propio
//    texto. Un mensaje truncado en silencio se lee como un mensaje corto.
// 5. El `id` ORDENA. `?desde=<id>` pagina con él, así que tiene que ser monótono
//    y único aunque dos mensajes caigan en el mismo milisegundo.
//
// Formato: una línea por mensaje, y la línea entera es el contrato.
//
//   {"id":"…","ts":"2026-09-09T14:22:31Z","sesion":"-100…_7",
//    "autor":"usuario|claude|sistema","origen":"telegram|web|resumer|repetir","texto":"…"}
//
// `autor` es QUIÉN habla; `origen`, POR DÓNDE entró. Se separan porque un mensaje
// tuyo puede llegar desde Telegram o desde la web, y hay que poder distinguirlo
// cuando algo se comporte raro.
//
// ⚠ El log NO es la conversación de claude. Aquélla vive en el almacén de claude;
// esto es una transcripción paralela y se pueden desincronizar (un `creset`, un
// resumer que reinyecta). Esos sucesos se registran como mensajes de `sistema`,
// nunca se esconden.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { redactar, valoresSecretos } from './redactar.mjs';

const CASA = process.env.COORD_HOME || dirname(dirname(fileURLToPath(import.meta.url)));

/** Tope por mensaje. Un `>>SHELL` puede volcar megabytes, y el log no es un
 *  almacén de salidas: es la conversación. Se conserva el PRINCIPIO —al revés
 *  que en una traza, donde la causa está al final— y se dice cuánto se cortó. */
export const TOPE_TEXTO = Number(process.env.COORD_LOG_MAX ?? 64_000);

const AUTORES = new Set(['usuario', 'claude', 'sistema']);
const ORIGENES = new Set(['telegram', 'web', 'resumer', 'repetir', 'creset', 'shell']);

let secretos = null;      // se leen una vez: cambiarlos pide reiniciar, como en errores.mjs
let ultimoMs = 0, seq = 0;   // ver `nuevoId`: el orden dentro de un ms lo da el contador

/**
 * El `data/` del coordinador que CORRE, resuelto en un solo sitio (regla 2).
 * `DATA_DIR` lo pone el coordinador en todo comando; sin él, el `data/` de casa.
 */
export function raizDatos() {
  return process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(CASA, 'data');
}

export function rutaLog(sesion) {
  return join(raizDatos(), 'mensajes', `${String(sesion).replace(/[^\w.-]/g, '_')}.jsonl`);
}

/**
 * Un id ordenable lexicográficamente, en tres trozos de ancho FIJO —que es lo que
 * hace que ordenar como texto sea ordenar de verdad—:
 *
 *     <ms en base36, 8>  <contador, 3>  <azar, 6>
 *
 * - **ms**: 8 caracteres bastan hasta el año 2059, por eso el `padStart`.
 * - **contador**: da el orden dentro de un mismo milisegundo, que es el caso
 *   normal cuando el bot publica la entrada y la salida seguidas.
 * - **azar**: dos procesos distintos —el bot y un desacoplado— pueden caer en el
 *   mismo ms con el mismo contador, y no comparten estado.
 *
 * ⚠⚠ El contador es la parte que hay que respetar. La primera versión reintentaba
 * al azar hasta superar el id anterior (`do … while (id <= ultimo)`), y eso es un
 * **bucle casi infinito**: dentro del mismo ms sólo se sale si el azar sale
 * mayor, y con un `ultimo` alto eso puede no pasar nunca. Lo pilló su propio test
 * al pedir 200 ids con el reloj parado — colgó el proceso, y en producción habría
 * colgado el turno entero la primera vez que dos mensajes cayeran juntos.
 *
 * ⚠ Y el reloj no siempre avanza: un ajuste de NTP puede retrasarlo. Se toma
 * `max(ahora, ultimoMs)` para que el orden no se rompa nunca hacia atrás.
 */
export function nuevoId(ahora = Date.now()) {
  let ms = Math.max(ahora, ultimoMs);
  if (ms === ultimoMs) {
    seq += 1;
    // 3 caracteres en base36 dan 46.656 por milisegundo; si se desbordan, se pide
    // prestado el ms siguiente en vez de dar la vuelta y romper el orden.
    if (seq > 46_655) { ms = ultimoMs + 1; seq = 0; }
  } else {
    seq = 0;
  }
  ultimoMs = ms;
  return ms.toString(36).padStart(8, '0')
    + seq.toString(36).padStart(3, '0')
    + randomBytes(3).toString('hex');
}

function recorta(texto) {
  const t = String(texto ?? '');
  if (t.length <= TOPE_TEXTO) return t;
  return t.slice(0, TOPE_TEXTO) +
    `\n\n[… recortado: se guardan los primeros ${TOPE_TEXTO} de ${t.length} caracteres …]`;
}

function red(texto) {
  if (secretos === null) {
    try { secretos = valoresSecretos().redactar; } catch { secretos = []; }
  }
  try { return redactar(String(texto ?? ''), secretos).texto; } catch { return String(texto ?? ''); }
}

/**
 * Añade un mensaje al log. NUNCA lanza; devuelve la línea escrita o `null`.
 *
 * @param {{sesion:string, autor:string, texto:string, origen:string, ts?:string}} m
 */
export function publicar(m) {
  try {
    const { sesion, autor, texto, origen } = m ?? {};
    // Un autor u origen que no se reconoce es un fallo de quien llama, no un dato
    // que guardar: se rechaza y se dice. Si entrara, el lector tendría que
    // aprender a mostrar categorías que nadie diseñó.
    if (!sesion) return null;
    if (!AUTORES.has(autor)) {
      console.error(`[mensajes] autor desconocido "${autor}" (sesión ${sesion}): no se registra`);
      return null;
    }
    if (!ORIGENES.has(origen)) {
      console.error(`[mensajes] origen desconocido "${origen}" (sesión ${sesion}): no se registra`);
      return null;
    }

    const linea = {
      id: nuevoId(),
      ts: (m.ts ? new Date(m.ts) : new Date()).toISOString().replace(/\.\d+Z$/, 'Z'),
      sesion: String(sesion),
      autor,
      origen,
      texto: red(recorta(texto)),
    };

    const f = rutaLog(sesion);
    mkdirSync(dirname(f), { recursive: true });
    // Una línea, UN solo `write` y en modo `a` (O_APPEND): en Linux los write a
    // un fichero regular se serializan por el inode, así que dos procesos no se
    // intercalan a media línea. (Leído, NO medido aquí; en otros SO no se ha
    // comprobado.) Es lo que permite que los desacoplados escriban directamente
    // en vez de tener que hablar con el coordinador.
    appendFileSync(f, JSON.stringify(linea) + '\n', 'utf8');
    return linea;
  } catch (e) {
    console.error(`[mensajes] no pude registrar: ${e?.message ?? e}`);
    return null;
  }
}
