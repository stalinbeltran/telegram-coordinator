// Tests de la REDACCIÓN (scripts/redactar.mjs).
//
// Por qué existe este fichero, y por qué tan tarde: la redacción se probaba sólo
// de refilón, desde los tests del archivador de conversaciones. Y es el módulo
// del que dependen TRES sitios que escriben a disco —el archivador, el log de
// errores y el log de mensajes— y uno de ellos, `data/mensajes/`, **se sirve por
// HTTPS a la app**. Un patrón que falte aquí es un secreto en claro en un fichero
// que alguien puede leer desde el móvil.
//
// ⚠⚠ Y las dos direcciones cuestan, no sólo una:
//   · quedarse corto → el secreto llega a disco, y git no lo suelta: hay que
//     ROTARLO, no basta con borrarlo;
//   · pasarse → se destroza el texto que se guarda justamente para poder leerlo.
//     Ya pasó: filtrar por longitud borraba `CLAUDE_PERMISSION_MODE` de las 18
//     veces que sale en una conversación normal.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { redactar, loQueSigueSiendoSecreto } = await import('../scripts/redactar.mjs');

const REDACTADO = /«REDACTADO:/;

// Formas de secreto que este proyecto maneja de verdad. Si alguien añade un
// proveedor nuevo, su clave va aquí y al módulo EN EL MISMO COMMIT.
const CLAVES = [
  ['Telegram', '1234567890:AAH' + 'a1b2c3d4e5'.repeat(3) + 'XY'],
  ['Anthropic', 'sk-ant-api03-' + 'aB3'.repeat(12)],
  ['GitHub', 'ghp_' + 'a1B2c3D4e5'.repeat(3) + 'xy'],
  ['DigitalOcean', 'dop_v1_' + 'a1b2c3d4'.repeat(8)],
  ['AWS', 'AKIAIOSFODNN7EXAMPLE'],
  ['Tailscale (auth)', 'tskey-auth-kA1b2C3d4E5A1b2C3-xYz9abc'],
  ['Tailscale (api)', 'tskey-api-abc123DEF456-ghi789jkl'],
  ['Tailscale (oauth)', 'tskey-client-kXyZ99-secreto123abc'],
];

for (const [nombre, clave] of CLAVES) {
  test(`una clave de ${nombre} NO llega a disco`, () => {
    const { texto } = redactar(`la clave es ${clave} y ya`, []);
    assert.doesNotMatch(texto, new RegExp(clave.slice(0, 14).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'si esto falla, el secreto queda en un fichero que se sirve por HTTPS');
    assert.match(texto, REDACTADO, 'y tiene que DECIR que se redactó, no borrarlo en silencio');
    assert.match(texto, /^la clave es .* y ya$/, 'el resto del texto se conserva');
  });
}

test('la REJILLA FINAL ve lo que se escapó de la redacción', () => {
  // Es la segunda barrera: si tras redactar sigue habiendo forma de secreto, la
  // conversación no se guarda. A medias es peor que nada.
  for (const [, clave] of CLAVES) {
    assert.ok(loQueSigueSiendoSecreto(`algo ${clave}`).length > 0,
      `la rejilla no reconoce ${clave.slice(0, 12)}…`);
  }
  assert.deepEqual(loQueSigueSiendoSecreto('un texto normal sin nada'), []);
});

test('⚠ NO se redacta de más: la configuración sobrevive', () => {
  // El fallo del otro lado, ya medido: filtrar por longitud borraba
  // `CLAUDE_PERMISSION_MODE` de una conversación normal.
  const normal = 'corre con CLAUDE_PERMISSION_MODE=bypassPermissions y DATA_DIR=/home/deploy/data';
  assert.equal(redactar(normal, []).texto, normal);
});

test('un valor conocido se redacta por VALOR, con el nombre de su variable', () => {
  const { texto, n } = redactar('el token era abcdefghijklmnop aquí',
    [['abcdefghijklmnop', 'MI_TOKEN']]);
  assert.match(texto, /«REDACTADO:MI_TOKEN»/);
  assert.equal(n, 1);
});
