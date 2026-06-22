// Prueba un ejecutor por su nombre, fuera de Telegram, mostrando cada paso.
//
// Uso:
//   npx tsx scripts/test-executor.mjs <ejecutor> <texto de entrada...>
//
// Ejemplos:
//   npx tsx scripts/test-executor.mjs directorio
//   npx tsx scripts/test-executor.mjs shell "echo hola"
//   npx tsx scripts/test-executor.mjs c "resume este repo"
//
// Variables útiles para depurar:
//   COMMAND_TIMEOUT_MS=120000 npx tsx scripts/test-executor.mjs c "..."   (más tiempo)

// Evita que config.ts aborte por falta de token cuando depuras sin .env.
process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'debug-token';

const { getExecutor, getEncargado } = await import('../src/registry.js');
const { runCommand } = await import('../src/runner.js');
const { parseCommands } = await import('../src/protocol.js');

const [, , execName, ...rest] = process.argv;
const input = rest.join(' ');

const line = (c = '─') => console.log(c.repeat(60));
const show = (label, text) =>
  console.log(`${label}:\n${String(text).split('\n').map((l) => '    ' + l).join('\n')}`);

if (!execName) {
  console.error('Uso: npx tsx scripts/test-executor.mjs <ejecutor> <texto...>');
  process.exit(1);
}

console.log(`TIMEOUT por comando: ${process.env.COMMAND_TIMEOUT_MS ?? 30000} ms`);
console.log(`DATA_DIR: ${process.env.DATA_DIR ?? 'data'}`);
line('═');

const executor = await getExecutor(execName);
if (!executor) {
  console.error(`❌ No existe el ejecutor "${execName}".`);
  process.exit(1);
}

console.log(`EJECUTOR: ${executor.name}`);
console.log(`  plantilla : ${executor.command}`);
console.log(`  encargados: ${executor.encargados?.join(', ') || '(ninguno)'}`);
const usesPlaceholder = executor.command.includes('{{input}}');
const resolved = usesPlaceholder ? executor.command.split('{{input}}').join(input) : executor.command;
console.log(`  entrada   : ${JSON.stringify(input)} ${usesPlaceholder ? '(sustituida en {{input}})' : '(por stdin)'}`);
console.log(`  comando   : ${resolved}`);
line();

let t = Date.now();
const result = await runCommand(executor.command, input);
console.log(`▶ Ejecutor terminó en ${Date.now() - t} ms · ok=${result.ok}`);
show('  salida', result.output);
line('═');

if (!result.ok) {
  console.log('⛔ El ejecutor falló: no se ejecutan encargados (es lo que verías en Telegram).');
  process.exit(0);
}

if (!executor.encargados || executor.encargados.length === 0) {
  console.log('Sin encargados → se devolvería la salida cruda del ejecutor.');
  process.exit(0);
}

const replies = [];
for (const encName of executor.encargados) {
  console.log(`ENCARGADO: ${encName}`);
  const enc = await getEncargado(encName);
  if (!enc) {
    console.log(`  ⚠️ No encontrado.`);
    continue;
  }
  console.log(`  comando: ${enc.command}`);
  t = Date.now();
  const encResult = await runCommand(enc.command, result.output);
  console.log(`  ▶ terminó en ${Date.now() - t} ms · ok=${encResult.ok}`);
  show('  salida', encResult.output);
  if (!encResult.ok) {
    line();
    continue;
  }
  const actions = parseCommands(encResult.output);
  console.log(`  acciones interpretadas: ${JSON.stringify(actions)}`);
  for (const action of actions) {
    if (action.type === 'user') {
      if (action.text.trim()) replies.push(action.text);
    } else {
      const shellRes = await runCommand(action.cmd, '');
      replies.push(shellRes.ok ? shellRes.output : `❌ Error al ejecutar comando:\n${shellRes.output}`);
    }
  }
  line();
}

line('═');
console.log(`RESPUESTAS QUE LLEGARÍAN A TELEGRAM (${replies.length}):`);
replies.forEach((r, i) => show(`  [${i + 1}]`, r));
if (replies.length === 0) console.log('  (ninguna → en Telegram verías "(sin respuesta)")');
