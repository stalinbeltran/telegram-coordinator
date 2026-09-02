// ¿Qué se perdería de ESTE repo si la máquina desapareciera ahora mismo?
//
// Vive aparte porque es una POLÍTICA, no un detalle de `cerrable.mjs`: decide
// qué cuenta como «trabajo en riesgo» y qué es ruido. Separarla es lo que
// permite probarla contra repos de git de verdad (`tests/git-pendiente.test.mjs`)
// sin depender del árbol real de la máquina, que es lo que antes la hacía
// imposible de testear.
//
// La regla que cambia, y por qué
// ------------------------------
// Antes bastaba con que la rama actual no estuviera en el remoto para avisar. Es
// correcto cuando la rama tiene trabajo, y sólo entonces: `--nuevo` crea una
// rama local en CADA uno de los cinco repos, así que un workspace recién montado
// y sin tocar daba **cinco** avisos de «se perdería» por un árbol vacío (medido
// el 2026-08-28 con ~/ws/prueba: 5 ramas + el fuentes.json del propio montaje).
//
// Con un workspace por TEMA eso se multiplica por tema y el veredicto se queda
// en 🔴 para siempre. Y ese veredicto es lo único que el usuario lee desde el
// móvil antes de destruir un droplet: un aviso que sale siempre se deja de leer,
// y el día que esté rojo por una flota facturando estará igual de rojo que los
// treinta días anteriores.
//
// ⚠ Pero aflojar esto es la dirección CARA. Por eso la regla es
// **«una rama SIN commits propios no es trabajo»** —que es demostrable: esa rama
// es idéntica a lo que ya está en el remoto— y NO «ignora las ramas de los
// workspaces», que escondería trabajo real. Perder eso ya costó el `r20260824`
// y la comparabilidad de 20 runs pagados.

import { execSync } from 'node:child_process';

const crudo = (cmd, cwd) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
};
const sh = (cmd, cwd) => { const s = crudo(cmd, cwd); return s === null ? null : s.trim(); };

/**
 * Lo que `scripts/workspace.mjs --nuevo` reescribe él mismo al montar, así que
 * aparece «modificado» en toda copia sin que nadie haya trabajado.
 *
 * ⚠ Es una lista corta y explícita a propósito. El precio es que un cambio de
 * verdad en ese fichero dentro de un workspace no se avisaría; se acepta porque
 * es un puntero que `--nuevo` regenera, y porque la alternativa (commitearlo)
 * dejaría la rama con un commit propio y volvería a encender el aviso siempre.
 */
export const IGNORA_AL_MONTAR = ['data/fuentes.json'];

/**
 * @returns {{duda: boolean, razones: {n: number, texto: string}[]}}
 *   `duda: true` = no se pudo leer el git. Eso NO es «todo bien»: mismo criterio
 *   que el `NO SÉ` de cerrable.mjs, porque un fallo silencioso que se lee como
 *   permiso es exactamente el que cuesta dinero.
 */
export function razonesGit(repo, { ignorar = [] } = {}) {
  // ⚠ SIN trim: el formato de --porcelain son dos caracteres de estado, un
  // espacio y la ruta, y el primero de esos dos es un espacio cuando el cambio
  // no está en el índice (` M data/fuentes.json`). Recortar la salida entera se
  // come ese espacio SÓLO en la primera línea, y entonces la ruta sale
  // desplazada un carácter y no casa con `ignorar`. Cazado por su test.
  const sucio = crudo('git status --porcelain', repo);
  if (sucio === null) return { duda: true, razones: [] };

  const razones = [];
  const sucias = sucio.split('\n').filter(Boolean).filter((l) => !ignorar.includes(l.slice(3).trim()));
  if (sucias.length) razones.push({ n: sucias.length, texto: `${sucias.length} fichero(s) sin commitear` });

  const rama = sh('git branch --show-current', repo);
  if (!rama) return { duda: false, razones };   // detached HEAD: no hay rama que perder

  // Lo que se pierde son los commits que no están en NINGÚN remoto, y esa
  // pregunta se hace IGUAL exista o no `origin/<rama>`. Hasta el 2026-09-02 se
  // hacía de dos formas distintas —`--not --remotes` sólo cuando la rama remota
  // no existía, y `origin/<rama>..<rama>` cuando sí— y esa asimetría es un
  // FALSO POSITIVO: contra una rama remota VIEJA, todo lo que main ha avanzado
  // desde entonces se lee como «se perdería», aunque esté en `origin/main`.
  //
  // Medido ese día en ~/ws/tema-2: `origin/tema-2` se había quedado en un commit
  // de agosto, la rama local se puso al día con main, y el freno decía
  // «foveal-vision [tema-2]: 5 commit(s) sin empujar» con los cinco ya en
  // `origin/main`. Es justo el 🔴 permanente que este fichero existe para no
  // producir: un aviso que sale siempre se deja de leer, y el día que sea real
  // estará igual de rojo que los treinta anteriores.
  //
  // ⚠ NO es aflojar la regla, que sería la dirección cara: `--not --remotes` es
  // una PRUEBA de que el commit sobrevive a la máquina, no una excepción para
  // una clase de ramas. Un commit que no esté en ningún remoto sigue avisando,
  // esté su rama en el remoto o no.
  const propios = sh(`git log --oneline ${rama} --not --remotes`, repo);
  if (propios === null) return { duda: true, razones };   // el git no se deja leer
  if (propios) {
    const n = propios.split('\n').length;
    // La rama remota no cambia QUÉ se pierde, sólo qué hay que teclear para
    // salvarlo (`git push` contra `git push -u`), así que va en el texto.
    const hayRemota = sh(`git rev-parse --verify -q origin/${rama}`, repo) !== null;
    razones.push({
      n,
      texto: hayRemota
        ? `${n} commit(s) sin empujar en "${rama}"`
        : `la rama "${rama}" no está en el remoto`,
    });
  }
  return { duda: false, razones };
}
