// Ejecutor con estado: conversa con `claude` manteniendo continuidad POR SESIÓN
// (un tema de Telegram = una conversación de claude independiente).
//
// - Lee tu mensaje por stdin (no necesita comillas ni escapes).
// - Deriva un UUID estable de COORD_SESSION (lo pone el coordinador).
// - Primer mensaje de la sesión: crea la conversación con --session-id <uuid>.
//   Mensajes siguientes: la continúa con --resume <uuid>.
// - Imprime SOLO la respuesta de claude por stdout (la recoge el encargado echo).
//
// Permisos: por defecto "acceptEdits" (claude puede crear/editar archivos sin
// preguntar, pero no más). Para autonomía total ponlo en .env:
//     CLAUDE_PERMISSION_MODE=bypassPermissions   (⚠️ claude ejecuta cualquier cosa)

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || 'data';
const session = process.env.COORD_SESSION || 'default';
const permissionMode = process.env.CLAUDE_PERMISSION_MODE || 'acceptEdits';

function uuidFrom(s) {
  const h = createHash('sha1').update(s).digest('hex');
  // Formato UUID v4 válido (8-4-4-4-12) derivado determinísticamente de la sesión.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
  });
}

function runClaude(mode, uuid, prompt) {
  return new Promise((res) => {
    const sessionArgs =
      mode === 'resume' ? ['--resume', uuid] : ['--session-id', uuid];
    const args = ['-p', '--permission-mode', permissionMode, ...sessionArgs];
    const child = spawn('claude', args, { shell: true, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => res({ ok: false, out: '', err: e.message }));
    child.on('close', (code) => res({ ok: code === 0, out, err }));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const prompt = (await readStdin()).trim();
if (!prompt) {
  console.error('Mensaje vacío.');
  process.exit(1);
}

const uuid = uuidFrom(session);
const dir = join(DATA_DIR, 'claude-sessions');
const marker = join(dir, session.replace(/[^\w.-]/g, '_') + '.json');
const firstTime = !existsSync(marker);

let res = await runClaude(firstTime ? 'create' : 'resume', uuid, prompt);

// Si la continuación falló (sesión perdida/limpiada), arranca una nueva.
if (!res.ok && !firstTime) {
  res = await runClaude('create', uuid, prompt);
}

if (res.ok) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    marker,
    JSON.stringify({ session, uuid, updated: new Date().toISOString() }, null, 2) + '\n',
  );
  process.stdout.write(res.out.trim() || '(sin respuesta de claude)');
} else {
  console.error((res.err || res.out || 'claude falló sin mensaje.').trim());
  process.exit(1);
}
