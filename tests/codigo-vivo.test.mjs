// Tests de «¿corre el bot el código que hay en disco?» (scripts/codigo-vivo.mjs).
//
// Por qué existe, y lo que costó (R10): el coordinador corre con `tsx` y carga
// sus módulos AL ARRANCAR, así que commitear un cambio no lo cambia. Ha mordido
// tres veces en dos días, y la tercera de verdad: se añadió el patrón que redacta
// las authkeys de Tailscale, el bot siguió con el redactor viejo, y **una authkey
// real quedó en claro en `data/mensajes/`**. El patrón estaba en git y no
// protegía nada.
//
// Lo que falla no es no saberlo: es que no se VE. Un cambio commiteado parece
// hecho. Estos tests fijan las dos mitades — que avise cuando de verdad hay algo
// sin desplegar, y que NO avise cuando no lo hay, porque un aviso que sale
// siempre se deja de leer en una semana.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const G = 'git -c user.email=t@test -c user.name=test -c init.defaultBranch=main';
const sh = (cmd, cwd, env) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ...env } });

/** Un repo con un commit en `src/`, hecho AHORA. */
function repoCon(rutas) {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-cv-'));
  sh(`${G} init -q .`, raiz);
  mkdirSync(join(raiz, 'src'), { recursive: true });
  mkdirSync(join(raiz, 'docs'), { recursive: true });
  writeFileSync(join(raiz, 'src', 'base.ts'), 'export const a = 1;\n');
  sh(`${G} add -A`, raiz);
  // ⚠ El commit base va con fecha ANTIGUA a propósito: también toca `src/`, así
  // que si fuera de ahora caería dentro de la ventana y el test mediría su propio
  // montaje en vez de la regla. Le pasó a la primera versión.
  const viejo = new Date(Date.now() - 2 * 86400_000).toISOString();
  sh(`${G} -c commit.gpgsign=false commit -qm base --date="${viejo}"`,
    raiz, { GIT_COMMITTER_DATE: viejo });
  for (const r of rutas) {
    writeFileSync(join(raiz, r), `cambio ${r}\n`);
    sh(`${G} add -A`, raiz); sh(`${G} commit -qm "toca ${r}"`, raiz);
  }
  return raiz;
}

/** `codigoVivo` con un arranque simulado, sin depender de systemd. */
async function conArranque(raiz, cuandoArranco) {
  process.env.COORD_HOME = raiz;
  const mod = await import(`../scripts/codigo-vivo.mjs?${Math.random()}`);
  // Se sustituye la única entrada externa: qué dice systemd del arranque.
  const original = process.env.PATH;
  const bin = mkdtempSync(join(tmpdir(), 'fakebin-'));
  writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\necho "${cuandoArranco}"\n`);
  execSync(`chmod +x ${join(bin, 'systemctl')}`);
  process.env.PATH = `${bin}:${original}`;
  try { return mod.codigoVivo(); } finally { process.env.PATH = original; }
}

test('avisa si hay commits de src/ posteriores al arranque', async () => {
  const raiz = repoCon(['src/nuevo.ts']);
  const r = await conArranque(raiz, new Date(Date.now() - 3600_000).toUTCString());
  assert.equal(r.ok, false);
  assert.ok(r.commits >= 1);
  assert.match(r.detalle[0], /toca src\/nuevo\.ts/, 'y dice CUÁL, para saber qué falta');
});

test('⚠ NO avisa si no hay nada sin desplegar', async () => {
  const raiz = repoCon([]);
  // El bot arrancó DESPUÉS del último commit: está al día.
  const r = await conArranque(raiz, new Date(Date.now() + 60_000).toUTCString());
  assert.equal(r.ok, true, 'un aviso que sale siempre se deja de leer en una semana');
  assert.equal(r.commits, 0);
});

test('un cambio en docs/ NO cuenta: el bot no lo carga', async () => {
  const raiz = repoCon(['docs/algo.md']);
  const r = await conArranque(raiz, new Date(Date.now() - 3600_000).toUTCString());
  assert.equal(r.ok, true,
    'sólo `src/` y `scripts/`: los JSON de ejecutor y la documentación no piden reinicio');
});

test('si no se puede preguntar por el arranque, NO inventa', async () => {
  const raiz = repoCon(['src/nuevo.ts']);
  const r = await conArranque(raiz, '');   // systemctl no dice nada
  assert.equal(r.commits, -1, 'se distingue «no sé» de «está al día»');
  assert.equal(r.ok, true, 'y no se convierte en un aviso que nadie puede resolver');
});
