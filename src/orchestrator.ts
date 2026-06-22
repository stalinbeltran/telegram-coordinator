import { getExecutor, getEncargado } from './registry.js';
import { runCommand } from './runner.js';
import { parseCommands } from './protocol.js';

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
  // (p.ej. continuidad de conversación de claude por tema).
  const [chat = '', thread = ''] = sessionId.split('_');
  const env: Record<string, string> = {
    COORD_SESSION: sessionId,
    COORD_CHAT: chat,
    COORD_THREAD: thread,
  };

  const result = await runCommand(executor.command, text, env);
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

    const encResult = await runCommand(enc.command, result.output, env);
    if (!encResult.ok) {
      replies.push(fail(`❌ Error del encargado "${encName}":\n${encResult.output}`));
      continue;
    }

    for (const action of parseCommands(encResult.output)) {
      if (action.type === 'user') {
        if (action.text.trim()) replies.push(action.text);
      } else {
        const shellRes = await runCommand(action.cmd, '', env);
        replies.push(
          shellRes.ok ? shellRes.output : fail(`❌ Error al ejecutar comando:\n${shellRes.output}`),
        );
      }
    }
  }
  return replies;
}
