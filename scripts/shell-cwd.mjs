// Ejecutor con estado: un shell cuyo DIRECTORIO ACTUAL persiste POR SESIÓN
// (cada tema de Telegram tiene su propio `cd`).
//
// Por qué hace falta: cada mensaje se ejecuta con un `spawn` nuevo, y un proceso
// hijo no puede cambiar el directorio de su padre. Un `cd` normal muere con el
// shell que lo ejecutó, así que el mensaje siguiente volvía a empezar en la
// carpeta del coordinador. Aquí el directorio es ESTADO DE SESIÓN, guardado con
// el mismo patrón que la continuidad de `claude-session.mjs`:
//
//     data/shell-cwd/<sesión>.json
//
// - `cd <ruta>` (incluye `cd ..`, `cd ~`, `cd -`, `cd /d X:\...`, o `D:` a secas)
//   lo resuelve este script: valida que la carpeta exista, la persiste y responde
//   con la ruta nueva.
// - `cd` a secas, `pwd` o un mensaje vacío responden el directorio actual.
// - Cualquier otro comando se ejecuta EN ese directorio.
//
// Límite conocido: en `cd x && ls` el `cd` lo hace el shell, no este script, así
// que el comando funciona pero el cambio NO persiste. Para moverte, manda el `cd`
// solo.

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = process.env.DATA_DIR || 'data';
const session = process.env.COORD_SESSION || 'default';
const stateDir = join(DATA_DIR, 'shell-cwd');
const stateFile = join(stateDir, session.replace(/[^\w.-]/g, '_') + '.json');

function isDir(p) {
  try {
    return typeof p === 'string' && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Si la carpeta guardada ya no existe (la borraron, otro disco), se vuelve a la
// del coordinador en vez de fallar: el shell siempre tiene que arrancar en algo.
async function loadState() {
  try {
    const s = JSON.parse(await readFile(stateFile, 'utf8'));
    if (isDir(s.cwd)) return { cwd: s.cwd, prev: isDir(s.prev) ? s.prev : undefined };
  } catch {
    /* primera vez o archivo corrupto */
  }
  return { cwd: process.cwd(), prev: undefined };
}

async function saveState(state) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify({ session, ...state, updated: new Date().toISOString() }, null, 2) + '\n',
  );
}

function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
  });
}

/** Devuelve el destino de un `cd`, o null si el mensaje no es un cambio de directorio. */
function cdTarget(input) {
  // "D:" / "D:\" — en cmd.exe cambiar de unidad se escribe así, sin `cd`.
  if (/^[a-zA-Z]:\\?$/.test(input)) return input.endsWith('\\') ? input : input + '\\';
  if (/^pwd$/i.test(input) || input === '') return '';
  const m = /^cd(?:\s+([\s\S]*))?$/i.exec(input);
  if (!m) return null;
  let rest = (m[1] ?? '').trim();
  rest = rest.replace(/^\/d\s+/i, ''); // `cd /d X:\...` de cmd.exe
  // Comillas por rutas con espacios: cd "C:\Program Files"
  if (rest.length >= 2 && /^["']/.test(rest) && rest.at(-1) === rest[0]) rest = rest.slice(1, -1);
  return rest;
}

/** Resuelve el destino contra el estado actual. Devuelve { dir } o { error }. */
function resolveTarget(target, state) {
  if (target === '') return { dir: state.cwd };
  if (target === '-') {
    if (!state.prev) return { error: 'No hay directorio anterior al que volver.' };
    return { dir: state.prev };
  }
  let t = target;
  if (t === '~') t = homedir();
  else if (/^~[\\/]/.test(t)) t = join(homedir(), t.slice(2));
  const dir = resolve(state.cwd, t);
  if (!isDir(dir)) return { error: `No existe la carpeta: ${dir}` };
  return { dir };
}

function run(cmd, cwd) {
  return new Promise((res) => {
    let child;
    try {
      child = spawn(cmd, { shell: true, windowsHide: true, cwd, env: process.env });
    } catch (err) {
      res({ code: 1, out: '', err: `No se pudo iniciar el comando: ${String(err)}` });
      return;
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => res({ code: 1, out, err: e.message }));
    // Sin timeout propio: el coordinador ya mata el árbol completo al vencer el suyo.
    child.on('close', (code) => res({ code, out, err }));
    child.stdin.end();
  });
}

const input = (await readStdin()).trim();
const state = await loadState();

const target = cdTarget(input);
if (target !== null) {
  const { dir, error } = resolveTarget(target, state);
  if (error) {
    console.error(`${error}\n📁 Sigues en: ${state.cwd}`);
    process.exit(1);
  }
  if (dir !== state.cwd) await saveState({ cwd: dir, prev: state.cwd });
  process.stdout.write(`📁 ${dir}`);
  process.exit(0);
}

const res = await run(input, state.cwd);
if (res.code === 0) {
  // Hay comandos que informan por stderr aunque terminen bien (git, por ejemplo).
  process.stdout.write(res.out.trim() || res.err.trim());
} else {
  console.error((res.err || res.out || `exit code ${res.code}`).trim());
  process.exit(1);
}
