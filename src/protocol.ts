export type Action =
  | { type: 'user'; text: string }
  | { type: 'shell'; cmd: string };

const USER = '>>USER';
const SHELL = '>>SHELL';

/**
 * Interpreta la salida de un encargado como una lista de comandos para el coordinador.
 *
 *   >>USER <texto>   -> enviar <texto> al usuario por Telegram
 *   >>SHELL <cmd>    -> ejecutar <cmd> en el shell y enviar su salida
 *   (sin prefijo)    -> se trata todo el texto como un único >>USER
 *
 * Las directivas pueden abarcar varias líneas: una línea sin prefijo
 * se anexa a la directiva anterior.
 */
export function parseCommands(raw: string): Action[] {
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const actions: Action[] = [];
  let current: Action | null = null;
  let sawDirective = false;

  for (const line of lines) {
    if (line.startsWith(USER)) {
      sawDirective = true;
      if (current) actions.push(current);
      current = { type: 'user', text: line.slice(USER.length).trimStart() };
    } else if (line.startsWith(SHELL)) {
      sawDirective = true;
      if (current) actions.push(current);
      current = { type: 'shell', cmd: line.slice(SHELL.length).trimStart() };
    } else if (current) {
      if (current.type === 'user') current.text += '\n' + line;
      else current.cmd += '\n' + line;
    }
  }
  if (current) actions.push(current);

  if (!sawDirective) {
    const t = text.trim();
    return t ? [{ type: 'user', text: t }] : [];
  }
  return actions;
}
