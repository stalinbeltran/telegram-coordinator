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
//   COORD_SESSION=pruebas npx tsx scripts/test-executor.mjs creset "x"    (otro tema)
//
// ⚠️ COORD_SESSION se HEREDA si ya venía puesta, y llega puesta cuando el propio
// coordinador te lanzó (un `c` depurándose a sí mismo). Entonces esto NO trabaja
// sobre "debug-session", sino sobre el tema de verdad — y con un ejecutor que
// toca estado (`creset` reinicia la conversación) eso se nota. Por eso la sesión
// en uso se imprime abajo: mírala antes de probar algo destructivo.

// Evita que config.ts aborte por falta de token cuando depuras sin .env.
process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'debug-token';
// Identidad de sesión para depurar ejecutores con estado (se hereda al hijo).
process.env.COORD_SESSION = process.env.COORD_SESSION || 'debug-session';

const { getExecutor, getEncargado, fuentes, repoDe } = await import('../src/registry.js');
const { COORD_HOME } = await import('../src/config.js');
process.env.COORD_HOME = COORD_HOME;
const { runCommand } = await import('../src/runner.js');
const { parseCommands } = await import('../src/protocol.js');
// El workspace del tema re-enraíza el cwd de TODO comando. Si este arnés no lo
// aplicara, depurar un ejecutor atado a un workspace mostraría un directorio
// distinto del que corre de verdad -- o sea, mentiría justo donde se usa para
// no tener que fiarse de la memoria.
const { loadWorkspaces, getWorkspace, cwdEnWorkspace } = await import('../src/workspaces.js');
await loadWorkspaces();
const WS = process.env.COORD_WS || getWorkspace(process.env.COORD_SESSION);
if (WS) process.env.COORD_WS = WS;

/** El cwd real de un comando, o aborta diciendo por qué no lo hay. */
function cwdDe(def) {
  const r = cwdEnWorkspace(def.cwd, def.origen?.raiz, WS);
  if ('error' in r) {
    console.error(`\n⛔ ${r.error}`);
    process.exit(1);
  }
  return r.cwd;
}

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
console.log(`COORD_SESSION: ${process.env.COORD_SESSION}`);
console.log(`COORD_HOME: ${COORD_HOME}`);
console.log(`COORD_WS: ${WS ?? '(ninguno: se usa el árbol del coordinador)'}`);
console.log('FUENTES (manda la primera):');
for (const f of await fuentes()) console.log(`  ${f.dir}   → cwd ${f.raiz}`);
line('═');

const executor = await getExecutor(execName);
if (!executor) {
  console.error(`❌ No existe el ejecutor "${execName}".`);
  process.exit(1);
}

console.log(`EJECUTOR: ${executor.name}   [${repoDe(executor)}]`);
console.log(`  definido  : ${executor.origen?.fichero}`);
console.log(`  directorio: ${cwdDe(executor)}${WS ? `   (re-enraizado en ${WS})` : ''}`);
if (executor.origen?.pisados.length) {
  console.log(`  ⚠️ pisa a : ${executor.origen.pisados.join(', ')}`);
}
console.log(`  plantilla : ${executor.command}`);
console.log(`  encargados: ${executor.encargados?.join(', ') || '(ninguno)'}`);
console.log(
  `  timeout   : ${
    executor.timeoutMs === undefined
      ? '(global)'
      : executor.timeoutMs <= 0
        ? 'sin límite'
        : `${executor.timeoutMs} ms`
  }`,
);
const usesPlaceholder = executor.command.includes('{{input}}');
const resolved = usesPlaceholder ? executor.command.split('{{input}}').join(input) : executor.command;
console.log(`  entrada   : ${JSON.stringify(input)} ${usesPlaceholder ? '(sustituida en {{input}})' : '(por stdin)'}`);
console.log(`  comando   : ${resolved}`);
line();

let t = Date.now();
const result = await runCommand(executor.command, input, undefined, executor.timeoutMs, cwdDe(executor));
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
  console.log(`  directorio: ${cwdDe(enc)}`);
  t = Date.now();
  const encResult = await runCommand(enc.command, result.output, undefined, enc.timeoutMs, cwdDe(enc));
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
      const shellRes = await runCommand(action.cmd, '', undefined, undefined, cwdDe(enc));
      replies.push(shellRes.ok ? shellRes.output : `❌ Error al ejecutar comando:\n${shellRes.output}`);
    }
  }
  line();
}

line('═');
console.log(`RESPUESTAS QUE LLEGARÍAN A TELEGRAM (${replies.length}):`);
replies.forEach((r, i) => show(`  [${i + 1}]`, r));
if (replies.length === 0) console.log('  (ninguna → en Telegram verías "(sin respuesta)")');
