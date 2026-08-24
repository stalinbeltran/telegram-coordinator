// Test del reanudador (scripts/claude-resumer.mjs) contra el fallo MEDIDO el
// 2026-08-23: el resumer mató su propia llamada a los 10 min (su
// CLAUDE_RETRY_RUN_TIMEOUT_MS por defecto) mientras el trabajo duraba una hora.
// El trabajo se completó entero; lo que se perdió fue la entrega, y el usuario
// recibió «❌ No pude reanudar la sesión: error desconocido» -- indistinguible
// de que claude hubiera fallado.
//
// Se corre como subproceso real contra un Telegram de mentira (TELEGRAM_API_BASE)
// y con un `claude-session.mjs` de mentira, así que no manda nada ni invoca a
// claude. La espera inicial se pasa por argv, que es como el resumer la recibe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESUMER = join(ROOT, 'scripts', 'claude-resumer.mjs');

function fakeTelegram() {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      seen.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ seen, server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

/** Un cwd de mentira con el `claude-session.mjs` que diga el test. */
function prepararCwd(cuerpoDelFalso) {
  const dir = mkdtempSync(join(tmpdir(), 'resumer-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'data', 'claude-sessions'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'claude-session.mjs'), cuerpoDelFalso);
  return dir;
}

function correrResumer(dir, base, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RESUMER, '1'], {   // argv[2]=1ms: sin espera
      cwd: dir,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        BOT_TOKEN: 'test-token-no-real',
        COORD_CHAT: '-100123',
        COORD_SESSION: 'test_1',
        TELEGRAM_API_BASE: base,
        CLAUDE_RETRY_MAX: '1',
        ...env,
      },
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ code, err }));
  });
}

test('un trabajo mas largo que el tope se anuncia como CORTE PROPIO, no como error desconocido',
  async () => {
    const { seen, server, base } = await fakeTelegram();
    // Un "claude" que tarda mucho y NO escribe nada mientras tanto: es
    // exactamente como se comporta `claude -p`, que no emite hasta terminar.
    // Por eso el caso real llegaba sin stdout NI stderr, y caía en el mensaje
    // generico.
    const dir = prepararCwd('setTimeout(() => {}, 60_000);\n');
    const { code } = await correrResumer(dir, base, { CLAUDE_RETRY_RUN_TIMEOUT_MS: '900' });
    server.close();

    const textos = seen.map((p) => p.text).join('\n');
    assert.equal(code, 0, 'el resumer debe terminar limpio aunque corte el trabajo');
    assert.doesNotMatch(textos, /error desconocido/,
      'el mensaje generico es justo el que confundio al usuario el 2026-08-23');
    assert.match(textos, /Cort[eé] la reanudaci[oó]n yo/,
      'tiene que decir QUIEN corto: si no, no se distingue de un fallo de claude');
    assert.match(textos, /pudo haber terminado igual/,
      'y que el trabajo pudo completarse: la entrega es lo que se perdio');
  });

test('el tope por defecto es holgado: 10 min cortaban tareas de una hora', async () => {
  const fuente = await import('node:fs').then((fs) =>
    fs.readFileSync(RESUMER, 'utf8'));
  const m = /RUN_TIMEOUT_MS = int\(process\.env\.CLAUDE_RETRY_RUN_TIMEOUT_MS, ([^)]+)\)/
    .exec(fuente);
  assert.ok(m, 'debe seguir existiendo el tope configurable');
  const ms = Function(`"use strict"; return (${m[1]})`)();
  assert.ok(ms >= 2 * 60 * 60 * 1000,
    `el tope por defecto (${ms} ms) tiene que cubrir tareas largas: el ejecutor ` +
    '`c` corre SIN limite a proposito, y el resumer existe para continuar una de esas');
  assert.ok(ms > 0,
    'pero no 0: el resumer tiene el cerrojo de la sesion y uno colgado para ' +
    'siempre bloquearia las reanudaciones siguientes');
});

test('al cortar no deja huerfanos: mata el ARBOL, no el envoltorio', async (t) => {
  if (process.platform === 'win32') return t.skip('taskkill /T ya lo cubre en Windows');
  const { seen, server, base } = await fakeTelegram();
  const dir = prepararCwd(`
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    // Un nieto que sobrevive si solo se mata al padre. Deja su pid en disco
    // para que el test pueda preguntar despues si sigue vivo.
    const nieto = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], {
      stdio: 'ignore',
    });
    writeFileSync('nieto.pid', String(nieto.pid));
    setTimeout(() => {}, 60_000);
  `);
  await correrResumer(dir, base, { CLAUDE_RETRY_RUN_TIMEOUT_MS: '1200' });
  server.close();

  const pidFile = join(dir, 'nieto.pid');
  assert.ok(existsSync(pidFile), 'el falso claude deberia haber dejado su nieto');
  const pid = Number(await import('node:fs').then((fs) => fs.readFileSync(pidFile, 'utf8')));
  await new Promise((r) => setTimeout(r, 300));   // margen para que muera el grupo
  let vivo = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    vivo = e.code === 'EPERM';
  }
  assert.equal(vivo, false,
    `el nieto ${pid} sigue vivo: matar el envoltorio dejaba a claude huerfano ` +
    'gastando tokens contra una tuberia que ya no lee nadie');
});
