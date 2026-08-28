import { getExecutor, getEncargado } from './registry.js';
import { runCommand } from './runner.js';
import { parseCommands } from './protocol.js';
import { COMMAND_TIMEOUT_MS, COORD_HOME, DATA_DIR } from './config.js';
import { getWorkspace, cwdEnWorkspace } from './workspaces.js';

/** Registra el error en la terminal y lo devuelve para enviarlo por Telegram. */
function fail(message: string): string {
  console.error(message);
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
): Promise<string[]> {
  const executor = await getExecutor(executorName);
  if (!executor) {
    return [fail(`❌ El ejecutor "${executorName}" ya no existe. Usa /end y abre otra sesión.`)];
  }

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

  const dirEjecutor = cwdEnWorkspace(executor.cwd, executor.origen?.raiz, ws);
  if ('error' in dirEjecutor) {
    return [fail(`❌ Ejecutor "${executor.name}": ${dirEjecutor.error}`)];
  }

  const result = await runCommand(
    executor.command,
    text,
    env,
    executor.timeoutMs ?? COMMAND_TIMEOUT_MS,
    dirEjecutor.cwd,
  );
  if (!result.ok) {
    return [fail(`❌ Error del ejecutor "${executor.name}":\n${result.output}`)];
  }

  // Sin encargados: devolvemos la salida cruda del ejecutor.
  if (!executor.encargados || executor.encargados.length === 0) {
    return [result.output];
  }

  const replies: string[] = [];
  for (const encName of executor.encargados) {
    const enc = await getEncargado(encName);
    if (!enc) {
      replies.push(fail(`⚠️ Encargado "${encName}" no encontrado.`));
      continue;
    }

    const dirEnc = cwdEnWorkspace(enc.cwd, enc.origen?.raiz, ws);
    if ('error' in dirEnc) {
      replies.push(fail(`❌ Encargado "${encName}": ${dirEnc.error}`));
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
      replies.push(fail(`❌ Error del encargado "${encName}":\n${encResult.output}`));
      continue;
    }

    for (const action of parseCommands(encResult.output)) {
      if (action.type === 'user') {
        if (action.text.trim()) replies.push(action.text);
      } else {
        // El `>>SHELL` corre en el directorio del ENCARGADO que lo pidió: es
        // suyo, no del ejecutor. Para los encargados de `data/` eso es la raíz
        // del coordinador, o sea lo de siempre.
        const shellRes = await runCommand(action.cmd, '', env, COMMAND_TIMEOUT_MS, dirEnc.cwd);
        replies.push(
          shellRes.ok ? shellRes.output : fail(`❌ Error al ejecutar comando:\n${shellRes.output}`),
        );
      }
    }
  }
  return replies;
}
