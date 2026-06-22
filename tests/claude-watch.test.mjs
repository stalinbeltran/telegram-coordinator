// Test de contrato del encargado `claude-watch` (scripts/claude-watch.mjs).
// Se ejecuta como subproceso real (lee stdin, escribe stdout) para verificar el
// contrato sin Telegram. NO probamos aquí la rama de límite porque lanzaría el
// resumer DESACOPLADO (vive horas durmiendo); esa decisión ya la cubren los tests
// de limit-detect. Aquí validamos la salida normal: emite `>>USER` vacío y no rompe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WATCH = join('scripts', 'claude-watch.mjs');

function runWatch(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WATCH], { cwd: ROOT, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ out, err, code }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

test('claude-watch: salida normal emite >>USER vacío y termina ok', async () => {
  const { out, code } = await runWatch('Aquí está la respuesta normal del ejecutor.');
  assert.equal(code, 0, 'debería salir con código 0');
  assert.equal(out.trim(), '>>USER', 'debe emitir un >>USER vacío (lo descarta el orquestador)');
});
