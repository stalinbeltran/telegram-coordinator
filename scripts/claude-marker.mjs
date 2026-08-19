// Estado por tema de la conversación de claude. Lo comparten `claude-session.mjs`
// (que la usa) y `claude-reset.mjs` (que la corta), y viven aquí juntos a
// propósito: si cada uno derivara el uuid por su cuenta y las dos funciones se
// separaran, el reset dejaría de reiniciar nada y nadie se enteraría.
//
// El marker `data/claude-sessions/<tema>.json` es:
//
//     { session, epoch, uuid, started, updated }
//
// - `epoch`: cuántas veces se ha reiniciado la conversación en ESTE tema. El uuid
//   se deriva de `<tema>#<época>`; la época 0 se deriva del tema a secas, para no
//   cortar las conversaciones que ya existían antes de que hubiera épocas.
// - `started`: si claude YA tiene esa conversación. Decide `--resume` (true) o
//   `--session-id` (false). Un marker viejo no trae el campo: se asume `true`,
//   que es exactamente lo que significaba "el marker existe" antes de esto.
//
// Es estado efímero (ignorado por git). Si se pierde con la máquina se vuelve a
// la época 0 y la conversación empieza en blanco: aceptable a propósito, es el
// mismo precio que ya se paga cada vez que el servidor se rehace.

import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || 'data';
const dir = join(DATA_DIR, 'claude-sessions');

export const SESSION = process.env.COORD_SESSION || 'default';

export function markerPath(session = SESSION) {
  return join(dir, session.replace(/[^\w.-]/g, '_') + '.json');
}

/** El marker del tema, o null si no existe (o está corrupto: se trata como nuevo). */
export function readMarker(session = SESSION) {
  try {
    const m = JSON.parse(readFileSync(markerPath(session), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

/** Época del tema. Sin marker, sin campo o con basura: la 0. */
export function epochOf(marker) {
  const n = Number(marker?.epoch);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** ¿Tiene claude ya esta conversación? Un marker viejo (sin el campo) sí la tiene. */
export function isStarted(marker) {
  return marker ? (marker.started ?? true) : false;
}

/**
 * UUID v4 válido derivado determinísticamente del tema y su época. No es un id
 * que se guarde y se recuerde: se recalcula igual en cada mensaje, así que el
 * único modo de tener una conversación nueva sin cambiar de tema es subir la época.
 */
export function uuidFor(session, epoch) {
  const seed = epoch > 0 ? `${session}#${epoch}` : session;
  const h = createHash('sha1').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

export async function writeMarker(session, data) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    markerPath(session),
    JSON.stringify({ session, ...data, updated: new Date().toISOString() }, null, 2) + '\n',
  );
}
