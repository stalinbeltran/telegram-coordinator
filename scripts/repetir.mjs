// Ejecutor `repetir`: arma, mira y para una repetición en ESTE tema.
//
//   ver                      qué hay armado aquí (o `` vacío, que es lo mismo)
//   seco <cad> x<N> <frase>  enseña el plan y las horas. NO llama a claude
//   cada <cad> x<N> <frase>  lo arranca de verdad
//   ya [frase]               una escritura AHORA, sin tocar el contador
//   off                      corta: para la unidad y borra el estado
//
// La frase se le escribe a la conversación de `c` de este tema -- el mismo uuid,
// o sea el mismo hilo: cada vuelta es el turno siguiente, no un mensaje suelto.
// Comprobado el 2026-09-08 con dos escrituras seguidas: la segunda recordaba a la
// primera.
//
// ⚠ POR QUÉ EL BUCLE NO VIVE AQUÍ. Un ejecutor muere al responder y se lleva todo
// lo que lanzó (CLAUDE.md § «Un mensaje = un proceso que muere al responder»), así
// que la repetición se registra como UNIDAD de systemd -- padre PID 1, sobrevive
// al turno Y al `systemctl restart` del coordinador. `desacoplar.sh` (scope) no
// vale: el fin del turno es exactamente «muere su padre», que es la columna donde
// el scope pierde.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  MAX_VUELTAS, MAX_DURACION_MS,
  parsearPlan, horarios, humano,
  leerEstado, guardarEstado, borrarEstado,
  nombreUnidad, markerDelTema,
} from './repetir-estado.mjs';

const SESION = process.env.COORD_SESSION || 'default';
const UNIDAD = nombreUnidad(SESION);

function arg(nombre, def = null) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const COMANDO = arg('--con', 'node scripts/claude-session.mjs');

function readStdin() {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res('');
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
    process.stdin.on('error', () => res(s));
  });
}

const hhmm = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : '—');

/** ¿Sigue viva la unidad? Se pregunta a systemd y no al fichero de estado: la
 *  unidad es hija de PID 1 y sobrevive a un reinicio del bot, así que el fichero
 *  puede estar y el motor no (o al revés, si alguien paró la unidad a mano). */
function unidadViva() {
  try {
    return spawnSync('systemctl', ['is-active', '--quiet', UNIDAD]).status === 0;
  } catch {
    return false;
  }
}

function ver() {
  const e = leerEstado(SESION);
  const viva = unidadViva();
  if (!e && !viva) return 'Nada armado en este tema.\n\n`cada 30m x8 <frase>` para armar · `seco …` para ver el plan sin arrancar.';
  if (!e && viva) {
    return `⚠️ La unidad \`${UNIDAD}\` está viva pero no hay estado en disco.\n` +
           'Alguien borró el fichero o la paró a medias. `off` lo deja limpio.';
  }
  const lineas = [
    viva ? `🔁 **Viva** · vuelta ${e.hechas} de ${e.vueltas} hecha(s)` : `⚠️ **Armada pero la unidad NO corre** (vuelta ${e.hechas}/${e.vueltas})`,
    `cada ${humano(e.cadenciaMs)} · próxima ${hhmm(e.proximo)} UTC`,
    `«${e.frase}»`,
  ];
  if (e.saltadas) lineas.push(`${e.saltadas} saltada(s) por actividad tuya en el tema`);
  if (e.fallos) lineas.push(`${e.fallos} con fallo`);
  if (!viva) lineas.push('→ `off` para limpiar, y vuelve a armarla.');
  return lineas.join('\n');
}

function planEnTexto(plan, cabecera) {
  return [
    cabecera,
    `Frase:    «${plan.frase}»`,
    `Cadencia: cada ${humano(plan.cadenciaMs)} · ${plan.vueltas} vuelta(s) · ${humano(plan.duracion)} en total`,
    `Hilo:     la conversación de \`c\` de ESTE tema${markerDelTema(SESION).existe ? '' : ' (todavía sin empezar)'}`,
    `Disparos: ${horarios(plan.cadenciaMs, plan.vueltas).join(' · ')} UTC`,
  ].join('\n');
}

function arrancar(plan) {
  if (unidadViva()) {
    return `⚠️ Ya hay una repetición viva en este tema. Míralas con \`ver\`, o \`off\` primero.\n\n` + ver();
  }
  const ahora = Date.now();
  guardarEstado(SESION, {
    frase: plan.frase,
    cadenciaMs: plan.cadenciaMs,
    vueltas: plan.vueltas,
    hechas: 0,
    saltadas: 0,
    fallos: 0,
    arrancado: new Date(ahora).toISOString(),
    proximo: new Date(ahora + plan.cadenciaMs).toISOString(),
    unidad: UNIDAD,
    // La marca del marker AL ARMAR: lo que haya pasado antes en el tema no
    // cuenta como "alguien está hablando ahora".
    marcaMarker: markerDelTema(SESION).visto,
  });

  const lanzador = 'scripts/desacoplar-persistente.sh';
  if (!existsSync(lanzador)) {
    borrarEstado(SESION);
    return `❌ No encuentro ${lanzador}. Sin él esto moriría con el turno, así que no lo armo.`;
  }
  const r = spawnSync(lanzador, [UNIDAD, process.execPath, 'scripts/repetir-bucle.mjs', '--con', COMANDO],
    { encoding: 'utf8', env: process.env });
  if (r.status !== 0) {
    // Se deshace el estado: dejarlo puesto sin motor haría que `ver` mintiera.
    borrarEstado(SESION);
    return `❌ No pude registrar la unidad:\n${(r.stderr || r.stdout || 'sin mensaje').trim()}`;
  }
  return [
    `▶️ Armada. Primera vuelta a las ${hhmm(new Date(ahora + plan.cadenciaMs).toISOString())} UTC (en ${humano(plan.cadenciaMs)}).`,
    `Tienes ese rato para \`off\` antes de que escriba nada.`,
    '',
    planEnTexto(plan, 'El plan:'),
    '',
    `unidad: \`${UNIDAD}\` · log \`/tmp/${UNIDAD}.log\``,
  ].join('\n');
}

function parar() {
  const habia = leerEstado(SESION);
  const viva = unidadViva();
  // Se para la unidad Y se borra el estado. Las dos, porque cada una cubre el
  // fallo de la otra: el stop necesita sudo, y el borrado sólo se nota cuando el
  // bucle despierta (duerme a trozos de 5 s, así que enseguida).
  let stopErr = '';
  if (viva) {
    const r = spawnSync('sudo', ['-n', 'systemctl', 'stop', UNIDAD], { encoding: 'utf8' });
    if (r.status !== 0) stopErr = (r.stderr || '').trim();
  }
  borrarEstado(SESION);
  if (!habia && !viva) return 'No había nada armado en este tema.';
  const donde = habia ? ` en la vuelta ${habia.hechas} de ${habia.vueltas}` : '';
  if (stopErr) {
    return `⚠️ Borré el estado, pero \`systemctl stop\` falló:\n${stopErr}\n\n` +
           `El bucle se parará solo en menos de un minuto (relee el estado al despertar).\n` +
           `Si quieres cortarlo ya: \`sudo systemctl stop ${UNIDAD}\``;
  }
  return `⏹️ Cortada${donde}. No escribirá más en este tema.`;
}

/** Una escritura AHORA, en primer plano. No toca el contador de la repetición
 *  armada: es un disparo suelto, y por eso no arranca ninguna unidad. El bucle
 *  que estuviera armado ve este `claude` con `pgrep` y salta su vuelta si
 *  coincide, así que los dos no se pisan. */
function ya(frase) {
  const e = leerEstado(SESION);
  const texto = frase || e?.frase;
  if (!texto) return 'No hay frase: `ya <frase>`, o arma una repetición y `ya` usará la suya.';
  const r = spawnSync(COMANDO, { shell: true, input: texto, encoding: 'utf8', env: process.env });
  if (r.status !== 0) return `❌ Falló la escritura:\n${(r.stderr || r.stdout || 'sin mensaje').trim()}`;
  return `🔁 (suelta, no cuenta como vuelta) →\n\n${(r.stdout || '').trim() || '(sin respuesta)'}`;
}

const entrada = (await readStdin()).trim();
const [verbo = 'ver', ...resto] = entrada.split(/\s+/);
const cola = entrada.slice(verbo.length).trim();

let salida;
switch (verbo.toLowerCase()) {
  case '':
  case 'ver':
  case 'estado':
    salida = ver();
    break;
  case 'seco': {
    const p = parsearPlan(cola);
    salida = p.ok
      ? planEnTexto(p.plan, '🧪 SECO — no he llamado a claude ni he arrancado nada.') +
        '\n\nPara arrancarlo de verdad, repite el mensaje con `cada` en vez de `seco`.'
      : `❌ ${p.error}`;
    break;
  }
  case 'cada': {
    const p = parsearPlan(cola);
    salida = p.ok ? arrancar(p.plan) : `❌ ${p.error}`;
    break;
  }
  case 'ya':
    salida = ya(cola);
    break;
  case 'off':
  case 'stop':
  case 'basta':
    salida = parar();
    break;
  default:
    salida = [
      `No entiendo «${verbo}». Lo que hay:`,
      '`ver` · `seco <cad> x<N> <frase>` · `cada <cad> x<N> <frase>` · `ya [frase]` · `off`',
      '',
      `Topes: ${MAX_VUELTAS} vueltas y ${humano(MAX_DURACION_MS)}, el que se alcance primero.`,
    ].join('\n');
}

process.stdout.write(salida);
