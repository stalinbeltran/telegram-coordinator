// Test de contrato de `scripts/desacoplar-persistente.sh`.
//
// LO QUE COMPRUEBA, Y POR QUE ES ESTE Y NO OTRO
// --------------------------------------------
// La unidad lleva `Restart=on-failure`, que existe para que un vigilante que se
// cae vuelva solo. El peligro simetrico es que un trabajo que falla SIEMPRE se
// relance para siempre, y eso ya paso dos veces con el mismo mecanismo:
//
//   2026-09-02  la sonda L1 termino bien, `notify.mjs` fallo al final, y la
//               unidad quedo reiniciandose cada 30 s.
//   2026-09-04  un entrenamiento de 37 epocas termino bien, `notify.mjs` salio
//               con 2, y systemd relanzo la cadena 62 VECES.
//
// El limitador por defecto de systemd (5 arranques en 10 s) NO puede saltar con
// `RestartSec=30`: nunca caben 5 en 10 s. Por eso el arreglo es ensanchar la
// VENTANA, y por eso este test mide el comportamiento REAL --cuantas veces se
// relanza algo que falla siempre-- y no que el flag aparezca en una cadena.
//
// ⚠ Necesita systemd y `sudo -n`. Donde no los haya se SALTA diciendolo: un
// test que se salta en silencio es indistinguible de uno que pasa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'desacoplar-persistente.sh');
const UNIDAD = `test-bucle-${process.pid}`;

function hay(cmd) {
  try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { return false; }
}
const PUEDE = hay('command -v systemd-run') && hay('sudo -n true');

function prop(unidad, nombre) {
  try {
    return execSync(`systemctl show ${unidad} -p ${nombre} --value`,
                    { encoding: 'utf8' }).trim();
  } catch { return null; }
}
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** `systemctl show` devuelve duraciones legibles ("30s", "1min 30s"), no numeros.
 *  La primera version hacia `Number("30s")` -> NaN, y NaN <= NaN es false: el
 *  test "pasaba" por comparar dos NaN. Un test que no puede fallar no comprueba
 *  nada, asi que esto parsea de verdad y se niega ante lo que no entiende. */
const UNIDADES = { us: 1e-6, ms: 1e-3, s: 1, min: 60, h: 3600, d: 86400 };
function segundos(texto) {
  if (texto === 'infinity') return Infinity;
  const partes = [...String(texto).matchAll(/(\d+(?:\.\d+)?)\s*(us|ms|min|[smhd])/g)];
  assert.ok(partes.length, `no se entiende la duracion '${texto}'`);
  return partes.reduce((t, [, n, u]) => t + Number(n) * UNIDADES[u], 0);
}

test('un trabajo que falla SIEMPRE se rinde: no se relanza para siempre', async (t) => {
  if (!PUEDE) {
    t.skip('sin systemd o sin sudo -n: no se puede levantar una unidad');
    return;
  }
  // Falla al instante, siempre. Con espera de 1 s y tope de 2 arranques en una
  // ventana de 60 s, systemd tiene que rendirse en unos segundos.
  execFileSync(SCRIPT, [UNIDAD, 'sh', '-c', 'exit 7'], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, DESACOPLAR_ESPERA: '1',
           DESACOPLAR_LIMITE_ARRANQUES: '2', DESACOPLAR_LIMITE_VENTANA: '60' },
  });
  try {
    // margen de sobra: 2 arranques con 1 s de espera se agotan en ~2-3 s
    for (let i = 0; i < 60; i++) {
      if (prop(UNIDAD, 'ActiveState') === 'failed') break;
      await dormir(250);
    }
    const estado = prop(UNIDAD, 'ActiveState');
    const arranques = Number(prop(UNIDAD, 'NRestarts'));
    assert.equal(estado, 'failed',
      `la unidad tiene que RENDIRSE y quedar visible en failed, no seguir; está en '${estado}'`);
    assert.ok(arranques <= 2,
      `se relanzó ${arranques} veces con el tope en 2: el limitador no está frenando`);
  } finally {
    execSync(`sudo -n systemctl stop ${UNIDAD} 2>/dev/null || true`);
    execSync(`sudo -n systemctl reset-failed ${UNIDAD} 2>/dev/null || true`);
  }
});

test('la ventana del limitador es MAYOR que espera x arranques, o es decorativa', async (t) => {
  if (!PUEDE) {
    t.skip('sin systemd o sin sudo -n: no se puede levantar una unidad');
    return;
  }
  // La regresión concreta del 2026-09-04: con los valores por defecto del script,
  // `RestartSec x StartLimitBurst` tiene que CABER en la ventana. Si no, el
  // limitador no puede saltar y `on-failure` es un bucle infinito.
  const u = `${UNIDAD}-def`;
  execFileSync(SCRIPT, [u, 'sleep', '30'], { cwd: ROOT, encoding: 'utf8' });
  try {
    const espera = segundos(prop(u, 'RestartUSec'));
    const burst = Number(prop(u, 'StartLimitBurst'));
    const ventana = segundos(prop(u, 'StartLimitIntervalUSec'));
    assert.ok(Number.isFinite(espera) && Number.isFinite(ventana) && burst > 0,
      `no se pudieron leer las propiedades: espera=${espera} ventana=${ventana} burst=${burst}`);
    assert.ok(ventana > espera * burst,
      `ventana ${ventana}s <= espera ${espera}s x ${burst} arranques: ` +
      'el limitador NO puede saltar, y eso es un bucle infinito');
  } finally {
    execSync(`sudo -n systemctl stop ${u} 2>/dev/null || true`);
    execSync(`sudo -n systemctl reset-failed ${u} 2>/dev/null || true`);
  }
});
