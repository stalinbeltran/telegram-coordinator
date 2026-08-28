import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, isAbsolute, basename, relative } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR, COORD_HOME } from './config.js';

/**
 * Qué workspace usa cada TEMA de Telegram.
 *
 * Por qué existe
 * --------------
 * Los workspaces (CLAUDE.md § «Varias sesiones a la vez») separaban sesiones de
 * *Claude Code*: cada una en su copia de los repos. El coordinador no participaba
 * en eso, así que todos los temas compartían un único árbol —el del proceso—
 * aunque en disco hubiera diez workspaces. La causa era exacta y está en R4:
 *
 *     scripts/workspace.mjs:27   const WS = dirname(COORD);
 *     scripts/cerrable.mjs:35    const WS = dirname(COORD);
 *
 * ...o sea, el acoplamiento DEDUCIDO del layout del disco. Un coordinador vive en
 * un directorio, y sólo puede haber uno (error 409): un directorio, un workspace,
 * para todos los temas. R4 pide declararlo, no deducirlo, y eso es esto: la
 * atadura tema → workspace es un DATO, y lo deducido queda de defecto.
 *
 * Dónde vive el dato (R7: el artefacto vive en la pieza de quien lo produce)
 * -------------------------------------------------------------------------
 *     data/ws/<sesión>.json   →   { session, ws, updated }
 *
 * Es estado por tema, como `data/shell-cwd/` y `data/claude-sessions/`, y por
 * las mismas razones: lo produce el tema, no el ejecutor.
 *
 * ⚠ Y NO va dentro de `data/sessions/<sesión>.json`, que sería lo aparentemente
 * obvio, porque `/end` lo borra. El workspace tiene que sobrevivir a `/end`
 * igual que el `cd` del shell y la conversación de claude: cerrar la sesión
 * suelta el ejecutor, no te muda de árbol.
 *
 * ⚠ Es EFÍMERO (`data/` está en .gitignore): se pierde al rehacer la máquina, y
 * es a propósito —el mismo precio que ya se paga con los markers de claude—.
 * Lo que sobrevive es el id del tema, que es un hecho de Telegram; volver a atar
 * es un `/ws <nombre>` por tema. Por eso `/ws` acepta el NOMBRE del workspace y
 * no sólo una ruta: reconstruirlo a mano tiene que caber en un mensaje.
 */

const dir = join(DATA_DIR, 'ws');

// sessionId -> raíz del workspace (absoluta)
const porSesion = new Map<string, string>();

/** Dónde se buscan los workspaces por nombre. Mismo nombre de variable que
 *  `scripts/sesiones.mjs`, para que las dos mitades se muevan juntas. */
export function raizWorkspaces(): string {
  return process.env.COORD_WS_RAIZ ?? join(homedir(), 'ws');
}

function sanitize(id: string): string {
  return id.replace(/[^\w.-]/g, '_');
}

/** ¿Es `hijo` el propio `padre` o algo dentro de él? Comparación por SEGMENTO. */
export function dentroDe(hijo: string, padre: string): boolean {
  const rel = relative(padre, hijo);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function loadWorkspaces(): Promise<void> {
  // Se vacía primero: esto es «lee el estado del disco», no «añade». Sin esto,
  // una atadura a un workspace que ya no está sobrevivía en memoria a la recarga.
  porSesion.clear();
  await mkdir(dir, { recursive: true });
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await readFile(join(dir, f), 'utf8'));
      // Un workspace que ya no está en disco NO se carga: la máquina se rehizo
      // y la atadura apunta a nada. Mejor "no hay workspace" (que degrada al
      // árbol del coordinador, R2) que una ruta muerta que falla en cada mensaje.
      // El fichero NO se borra a propósito: si ese workspace se vuelve a montar
      // con el mismo nombre, el tema se re-ata solo al siguiente arranque.
      if (data?.session && data?.ws && existsSync(data.ws)) porSesion.set(data.session, data.ws);
    } catch {
      /* ignora archivos corruptos */
    }
  }
}

export function getWorkspace(session: string): string | undefined {
  return porSesion.get(session);
}

export async function setWorkspace(session: string, ws: string): Promise<void> {
  porSesion.set(session, ws);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${sanitize(session)}.json`),
    JSON.stringify({ session, ws, updated: new Date().toISOString() }, null, 2) + '\n',
  );
}

export async function clearWorkspace(session: string): Promise<boolean> {
  const habia = porSesion.delete(session);
  try {
    await unlink(join(dir, `${sanitize(session)}.json`));
  } catch {
    /* no existía el archivo */
  }
  return habia;
}

/**
 * Traduce lo que escribe el usuario a una raíz de workspace comprobada.
 * Acepta un NOMBRE (`dropout` → `~/ws/dropout`) o una ruta.
 *
 * R2: o vale, o se niega ANTES de empezar diciendo qué falta. Nunca devuelve
 * una ruta a medias: atar un tema a un árbol que no existe se descubriría a
 * mitad, con un ejecutor corriendo en el árbol equivocado — que es justo el
 * fallo silencioso y caro que esto viene a quitar.
 */
export async function resolverWorkspace(
  texto: string,
): Promise<{ ws: string } | { error: string }> {
  const t = texto.trim();
  if (!t) return { error: 'Falta el nombre o la ruta del workspace.' };

  const candidato = isAbsolute(t) || t.startsWith('~') || t.startsWith('.')
    ? resolve(COORD_HOME, t.startsWith('~/') ? join(homedir(), t.slice(2)) : t)
    : join(raizWorkspaces(), t);

  if (!existsSync(candidato)) {
    const otros = await listarWorkspaces();
    return {
      error:
        `No existe "${candidato}".` +
        (otros.length
          ? `\n\nWorkspaces en esta máquina:\n${otros.map((o) => `  ${o.nombre}   ${o.raiz}`).join('\n')}`
          : '\n\nNo hay ninguno montado todavía.') +
        `\n\nPara montar uno: /use workspace  →  --nuevo <linea-de-trabajo>`,
    };
  }
  if (!existsSync(join(candidato, 'WORKSPACE.json'))) {
    return {
      error:
        `"${candidato}" existe pero no es un workspace: no tiene WORKSPACE.json.\n` +
        `Sin identidad no hay prefijo, y sin prefijo las máquinas que pagues no se ` +
        `distinguen de las de otro tema.`,
    };
  }
  return { ws: candidato };
}

/** Los workspaces montados en esta máquina: `~/ws/*` más el árbol del coordinador. */
export async function listarWorkspaces(): Promise<{ raiz: string; nombre: string; prefijo?: string }[]> {
  const out: { raiz: string; nombre: string; prefijo?: string }[] = [];
  const anadir = async (raiz: string) => {
    if (out.some((o) => o.raiz === raiz)) return;
    try {
      const id = JSON.parse(await readFile(join(raiz, 'WORKSPACE.json'), 'utf8'));
      out.push({ raiz, nombre: id?.nombre ?? basename(raiz), prefijo: id?.prefijo });
    } catch {
      /* no es workspace, o su identidad está rota: no se lista */
    }
  };

  const base = raizWorkspaces();
  let entradas: string[] = [];
  try {
    entradas = (await readdir(base)).sort();
  } catch {
    /* no hay ~/ws: normal en una máquina que no lo usa */
  }
  for (const e of entradas) await anadir(join(base, e));
  // El árbol donde vive el propio coordinador cuenta si tiene identidad: es el
  // caso de una máquina con un solo workspace, que es lo normal hoy.
  await anadir(resolve(COORD_HOME, '..'));
  return out;
}

/**
 * El directorio donde tiene que correr un comando, dado el workspace del tema.
 *
 * El registry fija el cwd al CARGAR (`registry.ts:239`): la raíz del repo que
 * declara el comando. Aquí se re-enraíza esa misma ruta bajo el workspace del
 * tema, conservando el subdirectorio si el JSON declaraba un `cwd` propio.
 *
 *     ~/src/foveal-vision/scripts   +   ~/ws/dropout
 *       →  ~/ws/dropout/foveal-vision/scripts
 *
 * Se aplica a TODO comando, incluidos los del propio coordinador: así
 * `dirname(COORD)` vuelve a ser cierto dentro de sus scripts y `cerrable.mjs` o
 * `workspace.mjs` informan del workspace del tema sin saber que esto existe.
 * Una excepción del tipo «menos los de casa» sería una regla escondida, y la
 * salida de emergencia no depende de ella: `/ws` es un comando de control, o
 * sea que corre DENTRO del bot y no se puede re-enraizar.
 */
export function cwdEnWorkspace(
  cwd: string | undefined,
  raizDeclarante: string | undefined,
  ws: string | undefined,
): { cwd?: string } | { error: string } {
  if (!ws || !raizDeclarante) return { cwd };
  // Ya está dentro: el comando lo declaró un repo de este mismo workspace.
  if (dentroDe(raizDeclarante, ws)) return { cwd };

  const repo = basename(raizDeclarante);
  const destinoRepo = join(ws, repo);
  if (!existsSync(destinoRepo)) {
    return {
      error:
        `Este tema trabaja en el workspace "${ws}", y ahí no está el repo "${repo}".\n` +
        `El comando se declara en ${raizDeclarante}; correrlo desde ahí mezclaría dos ` +
        `workspaces (otra rama, otro prefijo) sin decírtelo.\n\n` +
        `  · clónalo:      git -C ${ws} clone https://github.com/stalinbeltran/${repo}.git\n` +
        `  · o suéltalo:   /ws off   (este tema vuelve al árbol del coordinador)`,
    };
  }
  const sub = cwd && cwd !== raizDeclarante ? relative(raizDeclarante, cwd) : '';
  const destino = sub && !sub.startsWith('..') ? join(destinoRepo, sub) : destinoRepo;
  return { cwd: destino };
}
