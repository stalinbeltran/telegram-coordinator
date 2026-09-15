// Tests del perfil cambiable desde la conversación (scripts/claude-profile.mjs)
// y de cómo lo aplica `claude-session.mjs`.
//
// Lo que se protege: que una línea `#modelo …` NUNCA llegue a claude como texto
// (sería una conversación sobre un comando que no entiende), que la precedencia
// tema > global > plantilla se resuelva CAMPO A CAMPO (si `#modelo opus` borrara
// el esfuerzo, cada cambio de modelo perdería el `max` en silencio), y que una
// orden sola no avance la conversación (no toca el marker, no llama a claude).
//
// `claude-session.mjs` se corre como subproceso real con un `claude` de mentira
// por delante en el PATH: registra qué flags y qué stdin recibió.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_SCRIPT = join('scripts', 'claude-session.mjs');
const TEMA = '-100123_4';

function nuevoDataDir() {
  return mkdtempSync(join(tmpdir(), 'coord-profile-'));
}

/** El módulo lee DATA_DIR al importarse, así que se importa DESPUÉS de fijarlo. */
async function cargar(dataDir) {
  process.env.DATA_DIR = dataDir;
  return import(`../scripts/claude-profile.mjs?${dataDir}`);
}

/**
 * Un `claude` falso, en un directorio propio que se pone DELANTE del PATH.
 * Anota en FAKE_OUT los argumentos y el stdin que recibió, y responde un texto
 * fijo. Hay versión sh y versión .cmd porque claude-session lo lanza con
 * shell:true y cada SO resuelve la suya.
 */
function claudeFalso() {
  const bin = mkdtempSync(join(tmpdir(), 'claude-falso-'));
  const js = join(bin, 'fake-claude.cjs');
  writeFileSync(
    js,
    `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{` +
      `require('fs').writeFileSync(process.env.FAKE_OUT,JSON.stringify({args:process.argv.slice(2),stdin:s}));` +
      `process.stdout.write('respuesta-falsa');});`,
  );
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec node "${js}" "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(bin, 'claude.cmd'), `@node "${js}" %*\r\n`);
  return { bin, out: join(bin, 'llamada.json') };
}

function correrSesion(dataDir, mensaje, falso, tema = TEMA) {
  const env = { ...process.env, DATA_DIR: dataDir, COORD_SESSION: tema, FAKE_OUT: falso.out };
  // En Windows la variable puede llamarse `Path`: se toca la que exista.
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = falso.bin + (process.platform === 'win32' ? ';' : ':') + env[pathKey];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SESSION_SCRIPT], { cwd: ROOT, windowsHide: true, env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ out, err, code }));
    child.stdin.write(mensaje);
    child.stdin.end();
  });
}

function llamada(falso) {
  return existsSync(falso.out) ? JSON.parse(readFileSync(falso.out, 'utf8')) : null;
}

test('un mensaje normal no es una orden: null', async () => {
  const m = await cargar(nuevoDataDir());
  assert.equal(m.parseCommand('hola, ¿qué modelo eres?'), null);
  assert.equal(m.parseCommand('usa #modelo opus'), null, 'solo cuenta al PRINCIPIO de la primera línea');
  assert.equal(m.parseCommand('#modelos nuevos'), null, 'la palabra entera, no un prefijo');
});

test('#modelo <modelo> <esfuerzo> en cualquier orden, sin distinguir mayúsculas', async () => {
  const m = await cargar(nuevoDataDir());
  assert.deepEqual(m.parseCommand('#modelo opus high'), { scope: 'tema', rest: '', model: 'opus', effort: 'high' });
  assert.deepEqual(m.parseCommand('#Modelo MAX Opus'), { scope: 'tema', rest: '', model: 'opus', effort: 'max' });
  assert.deepEqual(m.parseCommand('#modelo claude-opus-5'), { scope: 'tema', rest: '', model: 'claude-opus-5' });
});

test('global, reset y consulta; y el resto del mensaje se separa', async () => {
  const m = await cargar(nuevoDataDir());
  assert.deepEqual(m.parseCommand('#modelo global sonnet\nhola\nqué tal'), {
    scope: 'global', rest: 'hola\nqué tal', model: 'sonnet',
  });
  assert.deepEqual(m.parseCommand('#modelo reset'), { scope: 'tema', rest: '', reset: true });
  assert.deepEqual(m.parseCommand('#modelo global reset'), { scope: 'global', rest: '', reset: true });
  assert.deepEqual(m.parseCommand('#modelo'), { scope: 'tema', rest: '', query: true });
});

test('una orden ambigua se rechaza con error, no se adivina', async () => {
  const m = await cargar(nuevoDataDir());
  assert.match(m.parseCommand('#modelo opus sonnet').error, /dos modelos/);
  assert.match(m.parseCommand('#modelo high low').error, /dos esfuerzos/);
  assert.match(m.parseCommand('#modelo reset opus').error, /reset/);
  assert.match(m.parseCommand('#modelo ¿?').error, /no entiendo/);
});

test('precedencia tema > global > plantilla, CAMPO A CAMPO', async () => {
  const dir = nuevoDataDir();
  const m = await cargar(dir);
  const plantilla = { model: 'fable', effort: 'max' };

  let p = m.resolveProfile(plantilla, TEMA);
  assert.deepEqual([p.model, p.effort], ['fable', 'max']);
  assert.deepEqual(p.origen, { model: 'plantilla', effort: 'plantilla' });

  await m.writeOverride('global', TEMA, { effort: 'low' });
  p = m.resolveProfile(plantilla, TEMA);
  assert.deepEqual([p.model, p.effort], ['fable', 'low'], 'el global solo pisa el campo que declara');

  await m.writeOverride('tema', TEMA, { model: 'opus' });
  p = m.resolveProfile(plantilla, TEMA);
  assert.deepEqual([p.model, p.effort], ['opus', 'low']);
  assert.deepEqual(p.origen, { model: 'tema', effort: 'global' });

  await m.writeOverride('tema', TEMA, { model: 'opus', effort: 'high' });
  assert.equal(m.resolveProfile(plantilla, TEMA).effort, 'high', 'el tema gana al global');

  await m.clearOverride('tema', TEMA);
  await m.clearOverride('global', TEMA);
  p = m.resolveProfile({}, TEMA);
  assert.deepEqual([p.model, p.effort], [undefined, undefined], 'sin nada, manda el default de claude');
  assert.equal(m.describe(p), '(default de claude)');
});

test('el override es POR TEMA: otro tema no lo ve', async () => {
  const m = await cargar(nuevoDataDir());
  await m.writeOverride('tema', TEMA, { model: 'opus' });
  assert.equal(m.resolveProfile({ model: 'fable' }, '-100123_9').model, 'fable');
});

test('una orden sola confirma, NO llama a claude y NO toca el marker', async () => {
  const dir = nuevoDataDir();
  const falso = claudeFalso();
  const { out, code, err } = await correrSesion(dir, '#modelo opus high', falso);
  assert.equal(code, 0, err);
  assert.match(out, /opus\/high/);
  assert.equal(llamada(falso), null, 'claude no debe haberse lanzado');
  assert.equal(existsSync(join(dir, 'claude-sessions')), false, 'la conversación no avanzó');
  assert.equal(existsSync(join(dir, 'claude-profile', TEMA.replace(/[^\w.-]/g, '_') + '.json')), true);
});

test('una orden con texto debajo: se aplica y el texto va a claude con los flags nuevos', async () => {
  const dir = nuevoDataDir();
  const falso = claudeFalso();
  const { out, code, err } = await correrSesion(dir, '#modelo sonnet low\nhola\nqué tal', falso);
  assert.equal(code, 0, err);
  const l = llamada(falso);
  assert.ok(l, 'claude debe haberse lanzado');
  assert.equal(l.stdin, 'hola\nqué tal', 'la línea #modelo NO llega a claude');
  const args = l.args.join(' ');
  assert.match(args, /--model sonnet/);
  assert.match(args, /--effort low/);
  assert.match(out, /sonnet\/low/, 'primero la confirmación');
  assert.match(out, /respuesta-falsa$/, 'y después la respuesta');
});

test('el perfil guardado se aplica a los mensajes SIGUIENTES sin repetir la orden', async () => {
  const dir = nuevoDataDir();
  const falso = claudeFalso();
  await correrSesion(dir, '#modelo opus', falso);
  const { out } = await correrSesion(dir, 'sigue', falso);
  const args = llamada(falso).args.join(' ');
  assert.match(args, /--model opus/);
  assert.doesNotMatch(out, /🎛/, 'sin orden no hay aviso');
});

test('#modelo reset borra el fichero y vuelve a la plantilla', async () => {
  const dir = nuevoDataDir();
  const falso = claudeFalso();
  await correrSesion(dir, '#modelo opus', falso);
  const { out, code } = await correrSesion(dir, '#modelo reset', falso);
  assert.equal(code, 0);
  assert.match(out, /borrado/);
  assert.equal(existsSync(join(dir, 'claude-profile', TEMA.replace(/[^\w.-]/g, '_') + '.json')), false);
});

test('una orden mal formada sale con error y NO llama a claude', async () => {
  const dir = nuevoDataDir();
  const falso = claudeFalso();
  const { code, err } = await correrSesion(dir, '#modelo opus sonnet', falso);
  assert.notEqual(code, 0);
  assert.match(err, /dos modelos/);
  assert.equal(llamada(falso), null);
});
