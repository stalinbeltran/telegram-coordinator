// Tests del ejecutor de comandos (src/runner.ts).
//
// Aquí sólo va lo que rompe la promesa central del proyecto: «los errores nunca
// tumban el coordinador» (CLAUDE.md, filosofía 3). Un fallo que devuelve
// `ok:false` es correcto; uno que mata el proceso deja al usuario sin bot y sin
// mensaje, y desde Telegram es indistinguible de que no hubiera pasado nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BOT_TOKEN = 'test-token';
const { runCommand } = await import('../src/runner.js');

test('una entrada larga a un comando que NO lee stdin no tumba el proceso', async () => {
  // El EPIPE llega como evento 'error' de un socket: sin manejador es una
  // excepción no capturada, y `bot.catch` no la ve. Medido el 2026-08-28: con
  // 200 KB y `true`, el proceso moría en la primera vuelta.
  for (let i = 0; i < 5; i++) {
    const r = await runCommand('true', 'x'.repeat(200_000), undefined, 5000, '/tmp');
    assert.equal(r.ok, true, 'el comando terminó bien: que ignore la entrada no es un fallo');
  }
});

test('un comando que falla se REPORTA, no se lanza', async () => {
  const r = await runCommand('exit 3', '', undefined, 5000, '/tmp');
  assert.equal(r.ok, false);
  assert.match(r.output, /3/);
});

test('un cwd inexistente se explica en vez de dar un ENOENT ambiguo', async () => {
  const r = await runCommand('pwd', '', undefined, 5000, '/no/existe/seguro');
  assert.equal(r.ok, false);
  assert.match(r.output, /directorio de trabajo/);
});
