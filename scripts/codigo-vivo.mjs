// ¿Corre el bot el código que hay en disco, o uno anterior?
//
// Por qué existe, y lo que costó
// -----------------------------
// El coordinador corre con `tsx` y carga sus módulos AL ARRANCAR. Commitear un
// cambio no lo cambia: sigue con lo que cargó. Eso ha mordido tres veces en dos
// días, y la tercera costó de verdad:
//
//   · 2026-09-09: el servicio de la web servía el código anterior, y una
//     comprobación entera midió lo que no era.
//   · 2026-09-10: la caja de texto estaba commiteada y no aparecía.
//   · 2026-09-10: se añadió el patrón que redacta las authkeys de Tailscale…
//     y el bot siguió con el redactor viejo, así que **una authkey de verdad
//     quedó en claro en `data/mensajes/`**. El patrón estaba en git y no
//     protegía nada.
//
// Lo que falla no es no saberlo: es que **no se ve**. Un cambio commiteado
// parece hecho. Por eso esto no es una nota, es una comprobación.
//
// ⚠ Y avisa SÓLO si hay commits que tocan el código que el bot carga (`src/`,
// `scripts/`) posteriores a su arranque. Un aviso que sale siempre se deja de
// leer en una semana; éste sale cuando de verdad hay algo desplegado a medias, y
// desaparece en cuanto se reinicia.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CASA = process.env.COORD_HOME || join(homedir(), 'src', 'telegram-coordinator');

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 15_000 }).trim(); }
  catch { return ''; }
}

/**
 * @returns {{ok:boolean, commits:number, desde:string|null, detalle:string[]}}
 *   `ok: true` = el bot corre lo que hay en disco (o no se pudo saber, que se
 *   distingue con `commits: -1`).
 */
export function codigoVivo(unidad = 'telegram-coordinator') {
  const arranque = sh('systemctl', ['show', unidad, '-p', 'ActiveEnterTimestamp', '--value']);
  if (!arranque) return { ok: true, commits: -1, desde: null, detalle: [] };

  const t = new Date(arranque);
  if (Number.isNaN(t.getTime())) return { ok: true, commits: -1, desde: null, detalle: [] };

  // Sólo lo que el proceso CARGA. Un cambio en `docs/` o en un JSON de ejecutor
  // no necesita reinicio: los ejecutores se descubren en cada mensaje.
  const desde = t.toISOString();
  const salida = sh('git', ['-C', CASA, 'log', `--since=${desde}`, '--format=%h %s', '--', 'src/', 'scripts/']);
  const detalle = salida ? salida.split('\n').filter(Boolean) : [];
  return { ok: detalle.length === 0, commits: detalle.length, desde: arranque, detalle };
}

// Como comando: sale con 1 si hay código sin desplegar, para poder encadenarlo.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const r = codigoVivo();
  if (r.commits === -1) {
    console.log('no sé si el bot corre el código de disco (¿no hay systemd?)');
    process.exit(0);
  }
  if (r.ok) {
    console.log(`ok  el bot corre el código de disco (arrancó ${r.desde})`);
    process.exit(0);
  }
  console.log(`⚠ el bot corre código ANTERIOR: ${r.commits} commit(s) de src/ o scripts/ desde que arrancó`);
  for (const l of r.detalle.slice(0, 5)) console.log(`    ${l}`);
  console.log('  Se despliega reiniciando:  scripts/reiniciar-bot.sh');
  process.exit(1);
}
