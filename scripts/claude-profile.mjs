// Perfil (modelo + esfuerzo) de claude cambiable DESDE LA CONVERSACIÓN, sin
// salir del tema ni tocar ningún JSON. Lo usa `claude-session.mjs`.
//
// Por qué así: el perfil vive en la plantilla del ejecutor (`c` trae
// `--model fable --effort max`), y cambiarlo exigía editar `c.json` o hacer
// `/end` + `/use c-otro`. Con esto, la PRIMERA LÍNEA de un mensaje a `c` puede
// ser una orden de perfil:
//
//     #modelo opus high        -> este tema usa opus/high a partir de ahora
//     #modelo sonnet           -> solo el modelo; el esfuerzo se queda como estaba
//     #modelo max              -> solo el esfuerzo
//     #modelo global opus high -> default para TODOS los temas sin perfil propio
//     #modelo reset            -> este tema vuelve a lo que diga la plantilla
//     #modelo global reset     -> quita el default global
//     #modelo                  -> ¿qué perfil está usando este tema y de dónde sale?
//
// Si debajo de esa línea hay más texto, se manda a claude ya con el perfil
// nuevo; si no, solo se confirma el cambio (no se llama a claude).
//
// Precedencia, de más concreta a más general: override del TEMA, override
// GLOBAL, flags de la plantilla, default de claude. Se resuelve CAMPO A CAMPO:
// `#modelo opus` cambia el modelo y deja el esfuerzo en lo que diga el nivel
// siguiente. Como `repetir` también pasa por `claude-session.mjs`, hereda el
// perfil del tema sin hacer nada.
//
// El prefijo es `#` y no `/` a propósito: lo que empieza por `/` es un comando
// de control del coordinador y no llega al ejecutor.
//
// Estado efímero en `data/claude-profile/` (ignorado por git): si se pierde, el
// tema vuelve a la plantilla, que es el mismo precio que paga el resto de `data/`.

import { readFileSync } from 'node:fs';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || 'data';
const dir = join(DATA_DIR, 'claude-profile');

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// `_global` no puede chocar con un tema: los temas son `<chatId>_<threadId>` y
// empiezan por un dígito o por `-`.
const GLOBAL = '_global';

export function profilePath(scope, session) {
  const nombre = scope === 'global' ? GLOBAL : String(session).replace(/[^\w.-]/g, '_');
  return join(dir, nombre + '.json');
}

/** El override guardado ({model?, effort?}) o {} si no hay (o está corrupto). */
export function readOverride(scope, session) {
  try {
    const o = JSON.parse(readFileSync(profilePath(scope, session), 'utf8'));
    return o && typeof o === 'object' ? pick(o) : {};
  } catch {
    return {};
  }
}

export async function writeOverride(scope, session, override) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    profilePath(scope, session),
    JSON.stringify({ ...pick(override), updated: new Date().toISOString() }, null, 2) + '\n',
  );
}

export async function clearOverride(scope, session) {
  try {
    await unlink(profilePath(scope, session));
  } catch {
    /* no había: ya está borrado */
  }
}

function pick(o) {
  const r = {};
  if (typeof o.model === 'string' && o.model) r.model = o.model;
  if (typeof o.effort === 'string' && EFFORT_LEVELS.includes(o.effort)) r.effort = o.effort;
  return r;
}

/**
 * ¿Empieza el mensaje por una orden `#modelo`? Devuelve null si no (el mensaje
 * es conversación normal). Si sí, devuelve:
 *   { scope: 'tema'|'global', model?, effort?, reset?, query?, rest, error? }
 * `rest` es el texto que sigue a la primera línea (lo que va a claude).
 */
export function parseCommand(text) {
  const nl = text.indexOf('\n');
  const primera = (nl === -1 ? text : text.slice(0, nl)).trim();
  const rest = nl === -1 ? '' : text.slice(nl + 1).trim();
  const m = /^#modelo\b(.*)$/i.exec(primera);
  if (!m) return null;

  const cmd = { scope: 'tema', rest };
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const v = t.toLowerCase();
    if (v === 'global') cmd.scope = 'global';
    else if (v === 'reset') cmd.reset = true;
    else if (EFFORT_LEVELS.includes(v)) {
      if (cmd.effort) return { ...cmd, error: `dos esfuerzos: «${cmd.effort}» y «${v}».` };
      cmd.effort = v;
    } else if (/^[a-z][\w.:-]*$/i.test(t)) {
      if (cmd.model) return { ...cmd, error: `dos modelos: «${cmd.model}» y «${t}».` };
      cmd.model = v;
    } else {
      return { ...cmd, error: `no entiendo «${t}».` };
    }
  }
  if (cmd.reset && (cmd.model || cmd.effort)) {
    return { ...cmd, error: '«reset» va solo (o con «global»).' };
  }
  if (!cmd.reset && !cmd.model && !cmd.effort) cmd.query = true;
  return cmd;
}

/**
 * Aplica la orden al almacén. Devuelve el override resultante del ámbito tocado
 * (o {} si se borró). No toca nada si es una consulta.
 */
export async function applyCommand(cmd, session) {
  if (cmd.query) return readOverride(cmd.scope, session);
  if (cmd.reset) {
    await clearOverride(cmd.scope, session);
    return {};
  }
  const nuevo = { ...readOverride(cmd.scope, session) };
  if (cmd.model) nuevo.model = cmd.model;
  if (cmd.effort) nuevo.effort = cmd.effort;
  await writeOverride(cmd.scope, session, nuevo);
  return nuevo;
}

/**
 * Perfil efectivo para un tema: tema > global > plantilla > (nada: default de
 * claude). Campo a campo. `origen` dice de dónde salió cada uno, para que la
 * consulta explique en vez de solo decir un nombre.
 */
export function resolveProfile(template, session) {
  const capas = [
    ['tema', readOverride('tema', session)],
    ['global', readOverride('global', session)],
    ['plantilla', pick(template || {})],
  ];
  const out = { origen: {} };
  for (const campo of ['model', 'effort']) {
    const capa = capas.find(([, v]) => v[campo]);
    if (capa) {
      out[campo] = capa[1][campo];
      out.origen[campo] = capa[0];
    } else {
      out.origen[campo] = 'claude';
    }
  }
  return out;
}

/** "opus/high", "opus/(default de claude)", "(default de claude)" */
export function describe(p) {
  const model = p.model || '(default de claude)';
  const effort = p.effort || '(default de claude)';
  if (!p.model && !p.effort) return '(default de claude)';
  return `${model}/${effort}`;
}

const DONDE = { tema: 'de este tema', global: 'del default global', plantilla: 'de la plantilla', claude: 'de claude' };

/** Texto que ve el usuario tras una orden `#modelo`. */
export function explain(cmd, session, template) {
  const efectivo = resolveProfile(template, session);
  const ambito = cmd.scope === 'global' ? 'global' : 'de este tema';
  if (cmd.query) {
    const de = [...new Set(Object.values(efectivo.origen))].map((o) => DONDE[o]).join(' y ');
    return (
      `🎛 Perfil de claude en este tema: ${describe(efectivo)} (${de}).\n` +
      'Cámbialo con «#modelo <modelo> [esfuerzo]», «#modelo global …» o «#modelo reset». ' +
      `Esfuerzos: ${EFFORT_LEVELS.join(', ')}.`
    );
  }
  if (cmd.reset) {
    return `🎛 Perfil ${ambito} borrado. Este tema usa ahora ${describe(efectivo)}.`;
  }
  const nota = cmd.scope === 'global' ? ' Los temas con perfil propio no cambian.' : '';
  return `🎛 Perfil ${ambito}: ${describe(readOverride(cmd.scope, session))}. Este tema usa ${describe(efectivo)}.${nota}`;
}
