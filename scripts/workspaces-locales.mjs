// Qué workspaces hay en ESTA máquina, y a cuál pertenece una ruta.
//
// Vive aparte porque lo usan `cerrable.mjs` (¿se puede apagar el server?) y
// `workspace.mjs` (¿está sano el mío?), y son las dos caras de la misma pregunta.
// Si cada uno lo dedujera por su cuenta, una de las dos se quedaría atrás y nadie
// se enteraría -- el mismo motivo por el que `claude-marker.mjs` existe.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';

/**
 * ¿Es `hijo` el propio `padre` o algo dentro de él? Comparación por SEGMENTO.
 *
 * ⚠ NO es `startsWith`. Con `startsWith`, estando en `~/ws/do` un proceso de
 * `~/ws/do-v` salía como PROPIO, y lo ajeno leído como propio es justo lo que te
 * hace matar el trabajo de otro (regla 0 de CLAUDE.md). Comprobado el 2026-08-28
 * con un proceso corriendo en `/home/deploy/src-otro` estando en `/home/deploy/src`.
 * Con un workspace por TEMA los nombres vecinos dejan de ser hipotéticos.
 */
export function dentroDe(hijo, padre) {
  if (!hijo || !padre) return false;
  const rel = relative(padre, hijo);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Dónde se buscan los workspaces por nombre. Mismo nombre de variable que
 *  `sesiones.mjs` y `src/workspaces.ts`, para que las tres se muevan juntas. */
export function raizWorkspaces() {
  return process.env.COORD_WS_RAIZ ?? join(homedir(), 'ws');
}

/**
 * Los workspaces montados en esta máquina: `~/ws/*` con identidad, más los
 * árboles que se pasen (el del coordinador, el del tema).
 *
 * ⚠ R11, y es la razón de que devuelva TODOS y no sólo el del que pregunta: la
 * pregunta operativa es «¿se puede apagar este SERVER?», no «¿puedo soltar mi
 * workspace?». Desde que cada tema de Telegram puede tener el suyo, un mismo bot
 * alquila con varios prefijos desde una sola máquina, y todo lo que muera con
 * ella cuenta, sea del tema que sea.
 */
export function workspacesLocales(extra = []) {
  const out = [];
  const anadir = (raiz) => {
    if (!raiz || out.some((o) => o.raiz === raiz)) return;
    let id = null;
    try { id = JSON.parse(readFileSync(join(raiz, 'WORKSPACE.json'), 'utf8')); }
    catch { /* sin identidad, o rota: sigue contando como árbol */ }
    // ⚠ `montado` es «lo creó `--nuevo`», y se mira por el FICHERO, no por que
    // haya parseado: una identidad rota sigue siendo un workspace montado. Es lo
    // que separa una copia del árbol de casa, y quien pregunta no entra en la
    // cuenta — ver el uso en `cerrable.mjs`.
    out.push({
      raiz, nombre: id?.nombre ?? basename(raiz), prefijo: id?.prefijo ?? null,
      montado: existsSync(join(raiz, 'WORKSPACE.json')),
    });
  };
  const base = raizWorkspaces();
  try {
    for (const e of readdirSync(base).sort()) {
      if (existsSync(join(base, e, 'WORKSPACE.json'))) anadir(join(base, e));
    }
  } catch { /* no hay ~/ws: normal en una máquina de un solo workspace */ }
  for (const e of extra) anadir(e);
  return out;
}
