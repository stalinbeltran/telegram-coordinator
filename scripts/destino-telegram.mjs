// ¿A qué tema de Telegram avisar cuando NADIE ha dicho a cuál?
//
// POR QUE EXISTE
// --------------
// `notify.mjs` necesita `COORD_CHAT`/`COORD_THREAD`, que el coordinador pasa a
// todo comando. Un proceso que no nace de un mensaje --un `cron`, un `ssh`, un
// script lanzado a mano-- no los tiene, y hasta ahora el aviso se perdía: exit 2
// y a otra cosa. Pero el destino NO es un secreto perdido: está en disco, porque
// el coordinador guarda estado POR TEMA y el nombre del fichero ES la identidad
// del tema.
//
//     data/<sessions|ws|claude-sessions|shell-cwd|buffer>/<chatId>_<threadId>.json
//
// ⚠ ES UN RESPALDO, NUNCA UN ATAJO. Si viene `COORD_CHAT`, manda ése y esto no
// se llama siquiera: adivinar cuando te lo han dicho es cambiar un dato por una
// suposición.
//
// LAS TRES REGLAS, EN ESTE ORDEN (las pidió el dueño el 2026-09-04)
// ----------------------------------------------------------------
// 1. Sólo cuentan los temas VIVOS. «Vivo» no se puede preguntar a Telegram desde
//    aquí, así que lo observable es cuándo se tocó por última vez su estado, que
//    el coordinador reescribe en cada mensaje. Caduca a los 7 días.
//    ⚠ Y ésta es su REGLA DE CADUCIDAD escrita al lado, como manda la regla 3 de
//      escritura: sin ella, un marcador de un tema abandonado hace meses seguiría
//      pareciendo un destino válido para siempre.
// 2. Entre los vivos gana el PRINCIPAL: el tema que NO está atado a un workspace
//    (`data/ws/<s>.json` con `ws: null`), que es exactamente el que trabaja en el
//    árbol del coordinador. Es la misma noción que usa el automontaje: el primer
//    tema que escribe se queda con `~/src` y los demás montan el suyo.
// 3. Si no hay forma de distinguir un principal, gana el de ACTIVIDAD MÁS
//    RECIENTE.
//
// Y si no queda ninguno vivo, devuelve `null`: se falla como siempre. Inventarse
// un destino es peor que no avisar -- un aviso en el sitio equivocado se lee como
// que el trabajo era de otra cosa.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 7 días. Ver la regla 1 de arriba: un tema más viejo no es un destino. */
export const CADUCIDAD_MS = 7 * 24 * 60 * 60 * 1000;

/** Todos los sitios donde el coordinador deja estado POR TEMA.
 *  Se miran TODOS y se toma el más reciente: `sessions/` sólo existe entre
 *  `/use` y `/end`, así que mirar sólo ahí daría por muerto un tema donde se
 *  acaba de hablar sin sesión abierta. */
export const DIRS_POR_TEMA = ['sessions', 'ws', 'claude-sessions', 'shell-cwd', 'buffer'];

/** La raíz de `data/`: la que pasa el coordinador, o la de este repo. */
export function raizDeDatos() {
  if (process.env.DATA_DIR) return resolve(process.env.DATA_DIR);
  const casa = process.env.COORD_HOME ||
    resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return join(casa, 'data');
}

/** `-1004383895505_main` -> { chat: '-1004383895505', thread: undefined }
 *  ⚠ Se parte por el ÚLTIMO `_`, no por el primero: el chatId de un grupo es
 *    NEGATIVO y puede llevar guiones, y el hilo es lo que va detrás. */
export function partirSesion(sesion) {
  const i = sesion.lastIndexOf('_');
  if (i <= 0) return null;
  const chat = sesion.slice(0, i);
  const hilo = sesion.slice(i + 1);
  if (!chat || !hilo) return null;
  return { chat, thread: hilo === 'main' ? undefined : hilo };
}

function mtime(fichero) {
  try { return statSync(fichero).mtimeMs; } catch { return 0; }
}

/** ¿Está este tema atado a un workspace? null = no se sabe. */
function atadoAWorkspace(raiz, sesion) {
  const f = join(raiz, 'ws', `${sesion}.json`);
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return Boolean(j.ws);
  } catch {
    return null;   // un JSON roto no decide nada
  }
}

/** Todos los temas de los que hay rastro, con cuándo se vieron por última vez. */
export function temasConocidos(raiz = raizDeDatos()) {
  const visto = new Map();
  const abierta = new Set();
  for (const d of DIRS_POR_TEMA) {
    const carpeta = join(raiz, d);
    let ficheros;
    try { ficheros = readdirSync(carpeta); } catch { continue; }
    for (const f of ficheros) {
      if (!f.endsWith('.json')) continue;
      // los `.caducado-<ts>.json` que aparta el buffer no son un tema
      const sesion = f.slice(0, -'.json'.length);
      if (sesion.includes('.caducado-')) continue;
      if (!partirSesion(sesion)) continue;
      const t = mtime(join(carpeta, f));
      if (t > (visto.get(sesion) ?? 0)) visto.set(sesion, t);
      if (d === 'sessions') abierta.add(sesion);
    }
  }
  return [...visto.entries()].map(([sesion, cuando]) => ({
    sesion,
    ...partirSesion(sesion),
    visto: cuando,
    abierta: abierta.has(sesion),
    atado: atadoAWorkspace(raiz, sesion),
  }));
}

/**
 * El destino, o `null` si no hay ninguno defendible.
 * Devuelve además `porque`, para poder decirlo en el aviso: un mensaje que
 * aparece en un tema al que nadie lo dirigió tiene que explicar por qué está ahí.
 */
export function elegirDestino({ raiz = raizDeDatos(), ahora = Date.now(),
                                caducidad = CADUCIDAD_MS } = {}) {
  const vivos = temasConocidos(raiz)
    .filter((t) => ahora - t.visto <= caducidad)
    .sort((a, b) => b.visto - a.visto);          // el más reciente primero
  if (!vivos.length) return null;

  const principales = vivos.filter((t) => t.atado === false);
  const elegido = principales[0] ?? vivos[0];
  const porque = principales.length
    ? (principales.length > 1 ? 'tema principal más reciente' : 'tema principal')
    : 'tema con la actividad más reciente';
  return { ...elegido, porque, candidatos: vivos.length };
}

/** Cuánto hace, en texto corto, para el aviso. */
export function haceCuanto(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}
