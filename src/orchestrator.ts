import { getExecutor, getEncargado } from './registry.js';
import { runCommand } from './runner.js';
import { parseCommands } from './protocol.js';
import { COMMAND_TIMEOUT_MS, COORD_HOME, DATA_DIR } from './config.js';
import { getWorkspace, cwdEnWorkspace } from './workspaces.js';
// @ts-expect-error: modulo JS sin tipos, a proposito -- lo usan tambien
// los scripts sueltos y anadirle un .d.ts seria una segunda definicion
import { registrar } from '../scripts/errores.mjs';
// @ts-expect-error: mismo caso, y por el mismo motivo: lo importan tambien los
// procesos DESACOPLADOS, que corren con `node` a secas y no pueden leer un .ts
import { publicar } from '../scripts/mensajes.mjs';

/** Registra el error en la terminal, en el LOG y lo devuelve para Telegram.
 *
 * Los tres sitios, y cada uno cubre un agujero del otro: la terminal se pierde
 * al reiniciar, Telegram lo ve quien esté mirando en ese momento, y el log es el
 * único que sigue ahí mañana. El dueño lo pidió por eso mismo: «si algo ocurre
 * hoy y no salta a la vista nunca me entero».
 *
 * ⚠ `registrar` NUNCA lanza (lo garantiza `scripts/errores.mjs`), que es lo que
 * permite llamarlo desde aquí: si el registrador pudiera fallar, un fallo de un
 * ejecutor se convertiría en una caída del coordinador — justo la regla 3 de
 * CLAUDE.md al revés.
 */
function fail(message: string, donde = ''): string {
  console.error(message);
  registrar('ejecutor_fallo', message, { origen: 'coordinador', donde });
  return message;
}

/**
 * Procesa un mensaje del usuario para una sesión:
 *   1. corre el ejecutor ligado con el texto del usuario,
 *   2. pasa su salida a cada encargado asociado,
 *   3. interpreta los comandos de los encargados (>>USER / >>SHELL).
 * Devuelve la lista de textos a enviar de vuelta por Telegram.
 */
export async function processIncoming(
  executorName: string,
  text: string,
  sessionId: string,
  origen: string = 'telegram',
): Promise<string[]> {
  const executor = await getExecutor(executorName);
  if (!executor) {
    return [fail(`❌ El ejecutor "${executorName}" ya no existe. Usa /end y abre otra sesión.`)];
  }

  /**
   * Anotar en `data/mensajes/` lo que se dice en este tema, si el ejecutor lo
   * pide con `registrar: true` en su JSON.
   *
   * ⚠ La pregunta es «¿este ejecutor pide registro?», NUNCA «¿se llama `c`?».
   * Cablear el nombre aquí metería un ejecutor concreto en el núcleo, que es la
   * filosofía 2 del proyecto y la R18 rotas — y hoy da lo mismo, pero mañana
   * registrar otro sería editar el enrutado en vez de un dato.
   *
   * ⚠⚠ Y `publicar` NUNCA lanza (lo garantiza `scripts/mensajes.mjs`), que es lo
   * que permite llamarlo desde aquí sin envolverlo: si el registrador pudiera
   * fallar, un fallo de disco se convertiría en una caída del coordinador.
   *
   * El `origen` es POR DÓNDE entró el turno, y viaja entero: cuando la web pueda
   * escribir, todo lo de ese turno quedará marcado como suyo sin tocar esto.
   */
  const anota = (autor: 'usuario' | 'claude' | 'sistema', texto: string): void => {
    if (executor.registrar === true) publicar({ sesion: sessionId, autor, origen, texto });
  };
  anota('usuario', text);

  // Identidad de sesión expuesta a todo comando, para ejecutores con estado
  // (p.ej. continuidad de conversación de claude por tema). `COORD_HOME` va
  // aquí para que un ejecutor de otro repo encuentre notify.mjs o
  // desacoplar.sh sin suponer dónde está clonado el coordinador.
  const [chat = '', thread = ''] = sessionId.split('_');
  const ws = getWorkspace(sessionId);
  const env: Record<string, string> = {
    COORD_SESSION: sessionId,
    COORD_CHAT: chat,
    COORD_THREAD: thread,
    COORD_HOME,
    // El workspace de ESTE tema, DECLARADO en vez de deducido del disco (R4).
    // Ausente = no hay atadura, y quien lo lea cae a lo de siempre
    // (`dirname(COORD)`), que es la comodidad por defecto que R4 sí admite.
    ...(ws ? { COORD_WS: ws } : {}),
    // Absoluto y del coordinador que CORRE. Sin esto, re-enraizar el cwd movería
    // en silencio el estado por tema (`data/shell-cwd/`, `data/claude-sessions/`)
    // a la copia del workspace: atar un tema parecería borrarle el `cd` y la
    // conversación de claude. El estado se indexa por tema y vive en un sitio.
    DATA_DIR,
  };

  const dirEjecutor = cwdEnWorkspace(executor.cwd, executor.origen?.raiz, ws, executor.command);
  if ('error' in dirEjecutor) {
    const m = fail(`❌ Ejecutor "${executor.name}": ${dirEjecutor.error}`);
    anota('sistema', m);
    return [m];
  }

  const result = await runCommand(
    executor.command,
    text,
    env,
    executor.timeoutMs ?? COMMAND_TIMEOUT_MS,
    dirEjecutor.cwd,
  );
  if (!result.ok) {
    const m = fail(`❌ Error del ejecutor "${executor.name}":\n${result.output}`);
    anota('sistema', m);
    return [m];
  }

  // Sin encargados: devolvemos la salida cruda del ejecutor.
  if (!executor.encargados || executor.encargados.length === 0) {
    anota('claude', result.output);
    return [result.output];
  }

  const replies: string[] = [];
  for (const encName of executor.encargados) {
    const enc = await getEncargado(encName);
    if (!enc) {
      const m = fail(`⚠️ Encargado "${encName}" no encontrado.`);
      anota('sistema', m);
      replies.push(m);
      continue;
    }

    const dirEnc = cwdEnWorkspace(enc.cwd, enc.origen?.raiz, ws, enc.command);
    if ('error' in dirEnc) {
      const m = fail(`❌ Encargado "${encName}": ${dirEnc.error}`);
      anota('sistema', m);
      replies.push(m);
      continue;
    }

    const encResult = await runCommand(
      enc.command,
      result.output,
      env,
      enc.timeoutMs ?? COMMAND_TIMEOUT_MS,
      dirEnc.cwd,
    );
    if (!encResult.ok) {
      const m = fail(`❌ Error del encargado "${encName}":\n${encResult.output}`);
      anota('sistema', m);
      replies.push(m);
      continue;
    }

    for (const action of parseCommands(encResult.output)) {
      if (action.type === 'user') {
        // Lo que el usuario ve como respuesta. Para `c` es la salida de claude
        // reenviada por `echo`; se anota como `claude` porque es lo que se lee
        // como su turno, aunque quien lo escriba sea el encargado.
        if (action.text.trim()) { anota('claude', action.text); replies.push(action.text); }
      } else {
        // El `>>SHELL` corre en el directorio del ENCARGADO que lo pidió: es
        // suyo, no del ejecutor. Para los encargados de `data/` eso es la raíz
        // del coordinador, o sea lo de siempre.
        const shellRes = await runCommand(action.cmd, '', env, COMMAND_TIMEOUT_MS, dirEnc.cwd);
        const m = shellRes.ok
          ? shellRes.output
          : fail(`❌ Error al ejecutar comando:\n${shellRes.output}`);
        // La salida de un `>>SHELL` NO la dijo claude: la pidió un encargado.
        anota('sistema', m);
        replies.push(m);
      }
    }
  }
  return replies;
}
