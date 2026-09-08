// Estado y reglas del ejecutor `repetir`: una frase que se le escribe a `c` cada
// N minutos, un número de vueltas acotado, en ESTE tema.
//
// Vive aparte porque lo comparten los DOS lados -- `repetir.mjs` (la cara de
// Telegram, que arma y para) y `repetir-bucle.mjs` (el motor desacoplado, que
// dispara) -- y dos copias del parseo y de los topes divergen sin que nadie se
// entere. Mismo motivo que `workspaces-locales.mjs`.
//
// EL ESTADO: data/repeticiones/<tema>.json
//
//     { sesion, frase, cadenciaMs, vueltas, hechas, saltadas, fallos,
//       arrancado, proximo, unidad, marcaMarker }
//
// Es EFÍMERO (data/ está en .gitignore) y eso es a propósito: una repetición que
// sobreviviera a rehacer la máquina sería una que nadie recuerda haber armado.
// Lo que sí sobrevive a un reinicio del BOT es la unidad de systemd, que es
// hija de PID 1 -- por eso `ver` pregunta por ella y no por este fichero.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ⚠ LOS DOS TOPES SON DUROS Y LOS FIJÓ EL DUEÑO (2026-09-08): 20 vueltas y 10 h,
// EL QUE SE ALCANCE PRIMERO. No son una preferencia de estilo -- este bot corre
// con CLAUDE_PERMISSION_MODE=bypassPermissions, así que cada vuelta puede
// alquilar máquinas de Vast sin nadie mirando. «Para siempre» no es una opción:
// es como se llega a los 62 relanzamientos del 2026-09-04.
export const MAX_VUELTAS = 20;
export const MAX_DURACION_MS = 10 * 60 * 60 * 1000;
// Por abajo también hay tope: por debajo de un minuto esto no es una repetición,
// es un martillo -- y cada vuelta arranca un `claude` que tarda ~8 s sólo en
// empezar (medido el 2026-09-08 con la prueba del resumer).
export const MIN_CADENCIA_MS = 60 * 1000;

/** ⚠ Su REGLA DE CADUCIDAD, al lado de lo que protege (regla 3 de escritura).
 *  Si el tema tuvo actividad ajena hace menos que esto, la vuelta se SALTA: dos
 *  `claude --resume` sobre el mismo uuid a la vez es justo lo que el buffer de
 *  entrada existe para evitar, y un cron dispara fuera del bucle serial de
 *  grammY donde esa protección vive. */
export const VENTANA_ACTIVIDAD_MS = 3 * 60 * 1000;

export function raizDeDatos() {
  return process.env.DATA_DIR || 'data';
}

export function dirEstado() {
  return join(raizDeDatos(), 'repeticiones');
}

export function ficheroEstado(sesion) {
  return join(dirEstado(), sesion.replace(/[^\w.-]/g, '_') + '.json');
}

/** Nombre de la unidad de systemd de este tema. Único por tema a propósito:
 *  systemd se NIEGA a arrancar una unidad con un nombre ya tomado, y ése es
 *  justo el freno que queremos contra armar dos repeticiones en el mismo hilo. */
export function nombreUnidad(sesion) {
  return 'repetir-' + sesion.replace(/[^\w.-]/g, '_');
}

export function leerEstado(sesion) {
  try {
    const e = JSON.parse(readFileSync(ficheroEstado(sesion), 'utf8'));
    return e && typeof e === 'object' ? e : null;
  } catch {
    return null;
  }
}

export function guardarEstado(sesion, estado) {
  mkdirSync(dirEstado(), { recursive: true });
  writeFileSync(ficheroEstado(sesion), JSON.stringify({ sesion, ...estado }, null, 2) + '\n');
}

export function borrarEstado(sesion) {
  try {
    rmSync(ficheroEstado(sesion));
    return true;
  } catch {
    return false;
  }
}

/** «30m» / «2h» / «90s» -> ms. null si no lo es. */
export function parsearCadencia(txt) {
  const m = /^(\d+)\s*([smh])$/i.exec(String(txt).trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * { s: 1000, m: 60000, h: 3600000 }[m[2].toLowerCase()];
}

export function humano(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`;
  const h = ms / 3600000;
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
}

/**
 * Parsea `<cadencia> x<N> <frase>` y aplica los topes.
 * Devuelve { ok, plan } o { ok:false, error } con el texto para Telegram.
 *
 * ⚠ Los topes se comprueban AQUÍ, o sea antes de arrancar nada, y no dentro del
 * bucle: R2 -- o degrada, o falla ANTES de empezar. Un tope que salta a mitad
 * deja media repetición hecha y el usuario sin saber cuánta.
 */
export function parsearPlan(resto) {
  const m = /^(\S+)\s+x\s*(\d+)\s+([\s\S]+)$/i.exec(String(resto).trim());
  if (!m) {
    return { ok: false, error: 'Formato: `cada <cadencia> x<vueltas> <frase>`\nEjemplo: `cada 30m x8 revisa el barrido y sigue`' };
  }
  const cadenciaMs = parsearCadencia(m[1]);
  if (cadenciaMs == null) {
    return { ok: false, error: `No entiendo la cadencia "${m[1]}". Usa \`30m\`, \`2h\` o \`90s\`.` };
  }
  if (cadenciaMs < MIN_CADENCIA_MS) {
    return { ok: false, error: `Cadencia mínima ${humano(MIN_CADENCIA_MS)}: por debajo, cada vuelta se pisa con el arranque de claude (~8 s).` };
  }
  const vueltas = parseInt(m[2], 10);
  if (!vueltas) return { ok: false, error: 'Las vueltas tienen que ser 1 o más.' };

  // Los dos topes, y el que se alcance PRIMERO manda.
  if (vueltas > MAX_VUELTAS) {
    return { ok: false, error: `Tope: ${MAX_VUELTAS} vueltas como máximo (pediste ${vueltas}).` };
  }
  const duracion = cadenciaMs * vueltas;
  if (duracion > MAX_DURACION_MS) {
    const caben = Math.floor(MAX_DURACION_MS / cadenciaMs);
    return {
      ok: false,
      error:
        `Tope: ${humano(MAX_DURACION_MS)} como máximo, y ${vueltas} × ${humano(cadenciaMs)} son ${humano(duracion)}.\n` +
        `Con esa cadencia caben ${caben} vueltas (\`x${caben}\`).`,
    };
  }

  const frase = m[3].trim();
  if (!frase) return { ok: false, error: 'Falta la frase que quieres que se escriba.' };
  return { ok: true, plan: { cadenciaMs, vueltas, frase, duracion } };
}

/** Las horas de cada disparo, desde `desde`. Es lo que imprime `seco`. */
export function horarios(cadenciaMs, vueltas, desde = Date.now()) {
  return Array.from({ length: vueltas }, (_, i) =>
    new Date(desde + cadenciaMs * (i + 1)).toISOString().slice(11, 16));
}

/** ¿Cuándo se tocó por última vez la conversación de claude de este tema?
 *  Es el mismo latido observable que usa `destino-telegram.mjs`: el coordinador
 *  reescribe el marker en cada mensaje, así que su mtime dice si hay alguien. */
export function markerDelTema(sesion) {
  const f = join(raizDeDatos(), 'claude-sessions', sesion.replace(/[^\w.-]/g, '_') + '.json');
  try {
    return { existe: true, visto: statSync(f).mtimeMs, uuid: JSON.parse(readFileSync(f, 'utf8')).uuid ?? null };
  } catch {
    return { existe: false, visto: 0, uuid: null };
  }
}
