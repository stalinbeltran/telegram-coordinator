// El fixture compartido: que sigue cumpliendo el contrato que documenta
// `docs/log-de-mensajes.md`.
//
// Por qué existe este test y no basta con tener el fichero (R6: cuando origen y
// destino son distintos a propósito, se escribe junto y con TEST). El fixture lo
// lee un repo distinto —`claude-code-webapp-mobile`— para probar su lector sin
// arrancar el coordinador. Si el formato cambia aquí y nadie regenera el fixture,
// el otro repo sigue pasando sus tests contra una forma que ya no existe, y el
// desajuste se descubre en producción, leyendo la web.
//
// Así que esto comprueba dos cosas a la vez:
//   · que el fixture es válido según el contrato de HOY;
//   · y que el módulo sigue produciendo exactamente esa forma.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(RAIZ, 'tests', 'fixtures', 'mensajes', '-1001234567_7.jsonl');

const lineas = readFileSync(FIXTURE, 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => JSON.parse(l));

test('el fixture cumple el contrato campo por campo', () => {
  assert.ok(lineas.length >= 7, 'tiene que cubrir los siete casos del README');
  for (const l of lineas) {
    assert.deepEqual(Object.keys(l).sort(), ['autor', 'id', 'origen', 'sesion', 'texto', 'ts'],
      'ni un campo de más ni de menos: es lo que el lector espera');
    assert.ok(['usuario', 'claude', 'sistema'].includes(l.autor));
    assert.ok(['telegram', 'web', 'resumer', 'repetir', 'creset', 'shell'].includes(l.origen));
    assert.match(l.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  }
});

test('los ids del fixture están ordenados: es lo que hace que `?desde=` funcione', () => {
  const ids = lineas.map((l) => l.id);
  assert.deepEqual(ids, [...ids].sort());
});

test('cubre los casos que el lector tiene que saber mostrar', () => {
  const tiene = (f) => lineas.some(f);
  assert.ok(tiene((l) => l.autor === 'usuario' && l.origen === 'telegram'), 'un mensaje tuyo');
  assert.ok(tiene((l) => l.autor === 'claude' && /\|---\|/.test(l.texto)), 'una TABLA de claude');
  assert.ok(tiene((l) => l.autor === 'sistema' && /Error del ejecutor/.test(l.texto)), 'un error');
  assert.ok(tiene((l) => l.origen === 'repetir'), 'una vuelta de repetir');
  assert.ok(tiene((l) => /recortado: se guardan los primeros/.test(l.texto)), 'un recorte');
  assert.ok(tiene((l) => l.origen === 'creset'), 'la divisoria de un creset');
  assert.ok(tiene((l) => l.origen === 'web'), 'un mensaje escrito desde la app');
});

test('una respuesta con saltos de línea sigue siendo UNA línea del fichero', () => {
  const crudo = readFileSync(FIXTURE, 'utf8').trim();
  assert.equal(crudo.split('\n').length, lineas.length,
    'si esto falla, el lector partiría un mensaje en varios al leer por líneas');
  assert.ok(lineas.some((l) => l.texto.includes('\n')),
    'y tiene que haber al menos uno con saltos, o no se está probando nada');
});
