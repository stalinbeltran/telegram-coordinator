import { getExecutor, getEncargado } from './registry.js';
import { runCommand } from './runner.js';
import { parseCommands } from './protocol.js';

/**
 * Procesa un mensaje del usuario para una sesión:
 *   1. corre el ejecutor ligado con el texto del usuario,
 *   2. pasa su salida a cada encargado asociado,
 *   3. interpreta los comandos de los encargados (>>USER / >>SHELL).
 * Devuelve la lista de textos a enviar de vuelta por Telegram.
 */
export async function processIncoming(executorName: string, text: string): Promise<string[]> {
  const executor = await getExecutor(executorName);
  if (!executor) {
    return [`❌ El ejecutor "${executorName}" ya no existe. Usa /end y abre otra sesión.`];
  }

  const result = await runCommand(executor.command, text);
  if (!result.ok) {
    return [`❌ Error del ejecutor "${executor.name}":\n${result.output}`];
  }

  // Sin encargados: devolvemos la salida cruda del ejecutor.
  if (!executor.encargados || executor.encargados.length === 0) {
    return [result.output];
  }

  const replies: string[] = [];
  for (const encName of executor.encargados) {
    const enc = await getEncargado(encName);
    if (!enc) {
      replies.push(`⚠️ Encargado "${encName}" no encontrado.`);
      continue;
    }

    const encResult = await runCommand(enc.command, result.output);
    if (!encResult.ok) {
      replies.push(`❌ Error del encargado "${encName}":\n${encResult.output}`);
      continue;
    }

    for (const action of parseCommands(encResult.output)) {
      if (action.type === 'user') {
        if (action.text.trim()) replies.push(action.text);
      } else {
        const shellRes = await runCommand(action.cmd, '');
        replies.push(shellRes.ok ? shellRes.output : `❌ Error al ejecutar comando:\n${shellRes.output}`);
      }
    }
  }
  return replies;
}
