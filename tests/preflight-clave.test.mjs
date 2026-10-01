// Tests del preflight para la CLAVE con la que se entra en los droplets de medición.
//
// Por qué existe
// --------------
// Hasta el 2026-10-01 `bench-preflight.mjs` miraba `~/.ssh/do_droplet`, que en
// una máquina de la flota NO existe —la flota entra con la clave de flota desde
// el 2026-09-11—, así que el preflight del benchmark de vCPU decía FALTA en todo
// dev nuevo. Y peor: `--fix` la GENERABA y la registraba como `lanzador-<máquina>`,
// o sea una clave nueva en la cuenta por cada máquina —el goteo que la de flota
// existe para cortar— y con el nombre que barre `keys --prune "lanzador-*"`.
//
// Ahora la clave se le PREGUNTA al lanzador (`do_droplet.py clave-de-entrada`).
// Lo que fijan estos tests:
//   1. se usa la que da el lanzador (en la flota, la de flota), tomando la ÚLTIMA
//      línea: antes puede venir el aviso de la caída a la flota;
//   2. sin clave, FALTA y el remedio es REENVIARLA, no generarla;
//   3. una ruta que el lanzador da pero no existe no se da por buena;
//   4. `--fix` ya no genera claves ni las nombra `lanzador-*`.
// Medido el 2026-10-01 contra el preflight anterior: fallan 1, 2 y 4.
//
// Sin `--fix` a propósito: con él el preflight clona repos y monta un venv, y un
// test no puede ponerse a descargar. Sin DO_TOKEN ni GITHUB_TOKEN: no hay red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);
const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const PREFLIGHT = join(RAIZ, 'scripts', 'bench-preflight.mjs');

/**
 * Un árbol de mentira: el preflight COPIADO (mira el lanzador como hermano de su
 * propio repo) y un `do_droplet.py` de pega que contesta lo que diga `python`.
 */
function arbol(python) {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-preclave-'));
  const home = join(raiz, 'home');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(join(home, '.config'), { recursive: true });
  const coord = join(raiz, 'src', 'telegram-coordinator', 'scripts');
  mkdirSync(coord, { recursive: true });
  writeFileSync(join(coord, 'bench-preflight.mjs'), readFileSync(PREFLIGHT, 'utf8'));
  const lanz = join(raiz, 'src', 'digital-ocean-dropplet-auto-launching', 'scripts');
  mkdirSync(lanz, { recursive: true });
  writeFileSync(join(lanz, 'do_droplet.py'), python(home));
  return { home, preflight: join(coord, 'bench-preflight.mjs') };
}

/** Corre el preflight y devuelve toda su salida. */
async function correr(a) {
  const r = await ejecutar(process.execPath, [a.preflight], {
    env: { ...process.env, HOME: a.home, DO_TOKEN: '', DIGITALOCEAN_TOKEN: '',
           GITHUB_TOKEN: '', GH_TOKEN: '', DO_SSH_KEY_FILE: '', DO_FLEET_KEY_FILE: '' },
    timeout: 60000,
  }).catch((e) => e); // sale con 1 cuando algo falta, que aquí es lo normal
  return (r.stdout || '') + (r.stderr || '');
}

const lineaClave = (salida) => {
  const l = salida.split('\n').find((x) => /^\[.*\] clave SSH/.test(x));
  assert.ok(l, `el preflight no dijo nada de la clave SSH.\n${salida}`);
  return l;
};

test('usa la clave que da el lanzador: en la flota, la de flota', async () => {
  const a = arbol((home) => {
    writeFileSync(join(home, '.ssh', 'do_flota'), 'privada de mentira\n');
    // Con el aviso delante, como sale de verdad cuando se cae a la de flota.
    return `print("  AVISO: no existe ~/.ssh/do_droplet; se usa la clave de la flota")\n`
      + `print(${JSON.stringify(join(home, '.ssh', 'do_flota'))})\n`;
  });
  const linea = lineaClave(await correr(a));
  assert.doesNotMatch(linea, /FALTA/, 'en la flota la clave SÍ está: es la de flota');
  assert.match(linea, /do_flota/);
  assert.equal(existsSync(join(a.home, '.ssh', 'do_droplet')), false);
});

test('sin clave, FALTA, y el remedio es REENVIARLA, nunca generarla', async () => {
  const a = arbol(() =>
    'import sys\nsys.stderr.write("ERROR: No hay clave con la que entrar en los droplets\\n")\nsys.exit(1)\n');
  const salida = await correr(a);
  assert.match(lineaClave(salida), /FALTA/);
  assert.match(salida, /autorizar-flota/, 'en la flota, la clave se reenvía desde otra máquina');
  // El remedio de antes decía «--fix (la genera y la registra)»: eso es lo que no puede volver.
  assert.doesNotMatch(salida, /la genera y la registra/,
    'generar una por máquina es el goteo que la de flota corta');
});

test('una ruta que el lanzador da pero NO existe no se da por buena', async () => {
  const a = arbol((home) => `print(${JSON.stringify(join(home, '.ssh', 'no-esta'))})\n`);
  assert.match(lineaClave(await correr(a)), /FALTA/);
});

test('--fix ya no genera claves ni las nombra lanzador-*', () => {
  const fuente = readFileSync(PREFLIGHT, 'utf8');
  assert.doesNotMatch(fuente, /intenta\([^)]*ssh-keygen/, 'nada de fabricar un par aquí');
  assert.doesNotMatch(fuente, /`lanzador-\$\{/, '`lanzador-*` es lo que barre la poda de claves');
});
