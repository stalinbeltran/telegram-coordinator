// Crea/actualiza un ejecutor o encargado a partir de una entrada simple por stdin.
//
// Formato (1ra línea = encabezado, el resto = el comando literal):
//
//   exec <nombre> [encargado1 encargado2 ...]
//   <comando...>
//
//   enc <nombre>
//   <comando...>
//
// Notas:
//  - En `exec`, si no listas encargados se asigna "echo" por defecto.
//    Para no asignar ninguno, usa:  exec <nombre> -
//  - El comando va SIEMPRE en las líneas siguientes (puede ser multilínea
//    y contener cualquier carácter, incluido {{input}}).
//  - Timeout (opcional) como dato: añade un token `timeout=<ms>` en el
//    encabezado. `timeout=0` desactiva el límite (tareas largas como claude).
//    Ej:  exec c echo claude-watch timeout=0

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || 'data';

function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
  });
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  console.error(
    'Uso:\n  exec <nombre> [encargados...]\n  <comando>\n\n  enc <nombre>\n  <comando>',
  );
  process.exit(1);
}

const raw = (await readStdin()).replace(/\r\n/g, '\n').trim();
if (!raw) fail('Entrada vacía.');

const nl = raw.indexOf('\n');
const header = (nl === -1 ? raw : raw.slice(0, nl)).trim();
const command = (nl === -1 ? '' : raw.slice(nl + 1)).trim();

const parts = header.split(/\s+/);
const kind = parts.shift();
const name = parts.shift();

// Token opcional `timeout=<ms>` en cualquier posición del encabezado.
let timeoutMs;
for (let i = parts.length - 1; i >= 0; i--) {
  const m = /^timeout=(-?\d+)$/.exec(parts[i]);
  if (m) {
    timeoutMs = Number(m[1]);
    parts.splice(i, 1);
  }
}

if (kind !== 'exec' && kind !== 'enc') fail(`Tipo desconocido "${kind}". Usa "exec" o "enc".`);
if (!name) fail('Falta el <nombre>.');
if (!/^[\w.-]+$/.test(name)) fail(`Nombre inválido "${name}". Usa letras, números, "_", "-" o ".".`);
if (!command) fail('Falta el comando (debe ir en las líneas siguientes al encabezado).');

let dir;
let entity;
if (kind === 'exec') {
  let encargados = parts;
  if (encargados.length === 0) {
    encargados = ['echo'];
  } else if (encargados.length === 1 && (encargados[0] === '-' || encargados[0] === 'none')) {
    encargados = [];
  }
  dir = join(DATA_DIR, 'executors');
  entity = { name, command, encargados };
} else {
  dir = join(DATA_DIR, 'encargados');
  entity = { name, command };
}

if (timeoutMs !== undefined) entity.timeoutMs = timeoutMs;

await mkdir(dir, { recursive: true });
const file = join(dir, `${name}.json`);
await writeFile(file, JSON.stringify(entity, null, 2) + '\n');

const tipo = kind === 'exec' ? 'Ejecutor' : 'Encargado';
let extra =
  kind === 'exec'
    ? `\n   encargados: ${entity.encargados.join(', ') || '(ninguno)'}`
    : '';
if (timeoutMs !== undefined) {
  extra += `\n   timeout: ${timeoutMs <= 0 ? 'sin límite' : `${timeoutMs} ms`}`;
}
console.log(`✅ ${tipo} "${name}" guardado.\n   comando: ${command}${extra}\n   archivo: ${file}`);
