// El triage decide QUE CLASE de petición es y a qué agente obliga. Lo que se
// prueba aquí es lo que puede fallar en silencio: que calle cuando no toca (si
// habla siempre, se deja de leer), que no calle cuando sí toca, y que un fallo
// suyo nunca impida al usuario mandar su mensaje.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { clasificar, aviso } from '../scripts/triage.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUION = join(RAIZ, 'scripts', 'triage.mjs');

const correrHook = (prompt) =>
  execFileSync('node', [GUION, '--hook'], {
    input: JSON.stringify({ prompt, session_id: 'x', cwd: RAIZ }),
    encoding: 'utf8',
  });

test('una consulta normal NO imprime nada: un aviso que sale siempre se deja de leer', () => {
  for (const q of ['¿cuántos repos hay?', 'explícame cómo funciona el registry',
                   'qué dice el reporte del 26', 'hola']) {
    assert.equal(clasificar(q), null, `no debería clasificar: ${q}`);
    assert.equal(aviso(q), '');
    assert.equal(correrHook(q), '', `el hook debería callar en: ${q}`);
  }
});

test('lo que gasta dinero se clasifica como gasto, y manda al revisor', () => {
  for (const q of ['lanza el estudio do-v en la flota', 'alquila 5 máquinas en vast',
                   'corre bench_fleet --vcpus 2,4,8', 'destruye los droplets']) {
    assert.equal(clasificar(q)?.clase, 'gasto', `mal clasificado: ${q}`);
    assert.match(aviso(q), /revisor/);
  }
});

test('lanzar un ESTUDIO es gasto aunque no se nombre la flota ni Vast', () => {
  // ⚠ El caso que se escapaba, y era el peor posible: «lanza el estudio do-v» es
  // LA tarea pendiente de CLAUDE.md —≈1,1 $ y 20 runs en máquinas alquiladas— y
  // salía `consulta`. El test de arriba no lo veía porque decía «...EN LA FLOTA»,
  // y lo que casaba era «flota»: la prueba había elegido sin querer la única
  // redacción que pasaba, y el ejemplo de docs/agentes.md (sin «flota») era falso.
  // Lo encontró ejecutar el comando que el documento promete, no leerlo.
  for (const q of ['lanza el estudio do-v', 'corre el tanteo de patience',
                   'ejecuta el recorrido pa-t', 'repite el barrido de dropout']) {
    assert.equal(clasificar(q)?.clase, 'gasto', `mal clasificado: ${q}`);
  }
});

test('...pero PREGUNTAR por un estudio no es gasto', () => {
  // El otro lado, y es igual de importante: el patrón lleva VERBO a propósito.
  // Con `estudios?` suelto, cualquier pregunta se volvía una alarma de dinero, y
  // un aviso que salta siempre se deja de leer en una semana.
  for (const q of ['¿qué dice el reporte del estudio de dropout?',
                   'cuántos estudios hay', 'resume el tanteo de dropout']) {
    assert.equal(clasificar(q)?.clase ?? 'consulta', 'consulta', `falso positivo: ${q}`);
  }
});

test('el gasto GANA a lo destructivo cuando la petición es las dos cosas', () => {
  // "destruye los droplets" casa con los dos patrones. Lo que hay que leer
  // primero es que cuesta dinero, así que el orden de CLASES no es cosmético.
  assert.equal(clasificar('destruye los droplets del barrido').clase, 'gasto');
});

test('lo destructivo sin gasto se clasifica aparte, y exige mirar el destino', () => {
  const a = aviso('borra los ficheros temporales de data/');
  assert.equal(clasificar('borra los ficheros temporales de data/').clase, 'destructivo');
  assert.match(a, /MIRA el destino/);
  assert.match(a, /TUYO/);
});

test('una decisión de estructura manda al arquitecto, no al revisor', () => {
  for (const q of ['crear un repo nuevo para los informes', '¿dónde guardo el resultado?',
                   'vamos a migrar los reportes', 'define la interfaz entre las dos piezas']) {
    assert.equal(clasificar(q)?.clase, 'estructura', `mal clasificado: ${q}`);
    assert.match(aviso(q), /arquitecto/);
  }
});

test('implementar obliga a verificar ANTES de decir hecho', () => {
  const a = aviso('añade un flag --seco al script');
  assert.equal(clasificar('añade un flag --seco al script').clase, 'implementacion');
  assert.match(a, /verificador/);
  assert.match(a, /hecho/);
});

test('el aviso dice SIEMPRE que el triage puede equivocarse de clase', () => {
  // Casa por patrones, no entiende. Si no lo dijera, un falso positivo se leería
  // como un veredicto y el modelo obedecería a una clasificación tonta.
  for (const q of ['lanza la flota', 'borra esto', 'crea un repo', 'implementa X']) {
    assert.match(aviso(q), /puede equivocarse/);
  }
});

test('--hook devuelve la envoltura que el harness sabe leer', () => {
  const salida = JSON.parse(correrHook('lanza la flota de vast'));
  assert.equal(salida.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(salida.hookSpecificOutput.additionalContext, /GASTO/);
});

test('el hook NUNCA puede impedir que el usuario mande su mensaje', () => {
  // Basura por stdin, sin JSON, con --hook: tiene que salir 0 y no romper nada.
  const r = execFileSync('node', [GUION, '--hook'], {
    input: '}{ esto no es json',
    encoding: 'utf8',
  });
  assert.equal(typeof r, 'string');   // no lanzó: execFileSync tiraría si el código != 0
});

test('sin texto no clasifica: un prompt vacío no es una petición de gasto', () => {
  assert.equal(clasificar(''), null);
  assert.equal(clasificar(null), null);
  assert.equal(clasificar(undefined), null);
});

test('los agentes que el triage nombra EXISTEN en .claude/agents', async () => {
  // Si alguien renombra un agente, el triage seguiría mandando al que ya no
  // está y el aviso se volvería una instrucción imposible, en silencio.
  const { readdirSync } = await import('node:fs');
  const hay = new Set(readdirSync(join(RAIZ, '.claude', 'agents'))
    .filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')));
  for (const q of ['lanza la flota', 'borra data/', 'crea un repo nuevo', 'implementa X']) {
    for (const [, nombre] of aviso(q).matchAll(/`(revisor|arquitecto|verificador)`/g)) {
      assert.ok(hay.has(nombre), `el triage manda a \`${nombre}\` y no existe su .md`);
    }
  }
});
