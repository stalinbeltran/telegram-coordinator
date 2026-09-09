// El motor de `repetir`: escribe una frase a la conversación de `c` de ESTE tema,
// cada N, un número acotado de veces. Corre DESACOPLADO como unidad de systemd
// (padre PID 1), así que sobrevive al fin del turno que lo armó y a un reinicio
// del coordinador. Lo lanza `repetir.mjs`; a mano se usa así:
//
//   node scripts/repetir-bucle.mjs --con "node scripts/claude-session.mjs"
//
// El COMANDO de claude es un ARGUMENTO, no una constante: así el ejecutor
// `repetir` declara en su JSON los mismos flags que `c` (`--model opus --effort
// max`) y cambiar de variante no toca este fichero. Filosofía 2 de CLAUDE.md.
//
// Qué NO hace, a propósito:
//   - no decide la frase, la cadencia ni las vueltas: eso ya está en el estado;
//   - no manda el mensaje él mismo por Bot API, llama a `notify.mjs` -- que
//     trocea, reintenta y comprueba `body.ok`. El `tg()` de `claude-resumer.mjs`
//     NO mira la respuesta de la API, así que un 400 de Telegram (hilo borrado)
//     se pierde en silencio. Aquí no se repite ese fallo: se reutiliza el que ya
//     lo arregló.

import { spawn, spawnSync } from 'node:child_process';
import { cargarSecretos } from './cargar-secretos.mjs';
import {
  MAX_DURACION_MS,
  VENTANA_ACTIVIDAD_MS,
  humano,
  leerEstado,
  guardarEstado,
  borrarEstado,
  markerDelTema,
} from './repetir-estado.mjs';
import { publicar } from './mensajes.mjs';

// Siempre y de los DOS ficheros: una unidad de systemd nace sin credenciales
// (no viajan a propósito, `sudo` las escribiría en claro en el journal).
cargarSecretos();

const SESION = process.env.COORD_SESSION || 'default';
const FALLOS_SEGUIDOS_MAX = 3;
const TROZO_MS = Number(process.env.REPETIR_TROZO_MS) || 5000;

function arg(nombre, def = null) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const COMANDO = arg('--con', 'node scripts/claude-session.mjs');

// Todo lo que salga de este bucle queda marcado como suyo en el log: los avisos
// que manda por `notify.mjs` heredan esta variable, así que la web puede
// distinguir una vuelta de `repetir` de un mensaje tuyo sin cablear nada.
process.env.COORD_ORIGEN = 'repetir';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Avisa al tema. Nunca lanza: el aviso es una comodidad, el estado en disco es
 *  la fuente de verdad. Y sobre todo, un aviso que falla NO puede tumbar esto --
 *  en una unidad con Restart=on-failure un fallo al final no es un fallo, es un
 *  bucle (medido el 2026-09-04: 62 relanzamientos por un `notify` que salió !=0). */
function avisar(texto) {
  return new Promise((res) => {
    const c = spawn(process.execPath, ['scripts/notify.mjs'], { windowsHide: true, env: process.env });
    let err = '';
    c.stderr.on('data', (d) => (err += d.toString()));
    c.on('error', (e) => { console.error('[repetir] no pude avisar:', e.message); res(); });
    c.on('close', (code) => {
      if (code !== 0) console.error('[repetir] el aviso falló:', err.trim());
      res();
    });
    c.stdin.write(texto);
    c.stdin.end();
  });
}

/** Llama a claude con la frase. `topeMs` es lo que queda hasta el tope global de
 *  10 h: así ninguna vuelta puede empujar la repetición más allá de su límite, y
 *  ninguna se corta antes de tiempo por un reloj inventado aparte. Es el fallo
 *  del resumer del 2026-08-23 -- 10 min propios contra un trabajo de una hora,
 *  que se completó entero y cuya ENTREGA se perdió. */
function escribirAClaude(frase, topeMs) {
  return new Promise((res) => {
    const child = spawn(COMANDO, {
      shell: true, windowsHide: true, env: process.env,
      detached: process.platform !== 'win32',
    });
    let out = '', err = '', expiro = false;
    const t = setTimeout(() => {
      expiro = true;
      // Matar el ÁRBOL, no el envoltorio: el shell lanza `claude`, y un kill al
      // shell lo deja huérfano gastando tokens contra una tubería que ya no lee
      // nadie. Misma lección que `runner.ts` en Windows y que el resumer.
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* ya murió */ } }
    }, Math.max(1000, topeMs));
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { clearTimeout(t); res({ ok: false, out: '', err: e.message, expiro: false }); });
    child.on('close', (code) => { clearTimeout(t); res({ ok: code === 0 && !expiro, out, err, expiro }); });
    child.stdin.write(frase);
    child.stdin.end();
  });
}

/** ¿Hay un `claude` vivo hablando en ESTE hilo? El uuid del tema va en la línea
 *  de comando de `claude --resume <uuid>`, así que es observable directamente --
 *  y es la única señal que ve un turno EN CURSO, porque el marker sólo se
 *  escribe al terminar. Sin `pgrep` (Windows) devuelve false y se sigue: no
 *  poder mirar no es motivo para no repetir nunca. */
function claudeVivoEn(uuid) {
  if (!uuid) return false;
  try {
    return spawnSync('pgrep', ['-f', uuid], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}

/** ¿Hay alguien MÁS en esta conversación? Dos señales, y hacen falta las dos
 *  porque miden cosas distintas: un turno en curso (pgrep) y uno recién
 *  terminado con el usuario probablemente todavía escribiendo (mtime del marker,
 *  el mismo latido observable que usa `destino-telegram.mjs`).
 *
 *  Sin esto, la vuelta lanzaría un segundo `claude --resume <mismo uuid>`, que es
 *  exactamente lo que `src/buffer.ts` existe para evitar en la entrada -- y esto
 *  dispara FUERA del bucle serial de grammY, donde esa protección no alcanza. */
function hayAlguienMas(estado) {
  const marker = markerDelTema(SESION);
  if (claudeVivoEn(marker.uuid)) return 'hay un turno de claude en curso en este hilo';
  if (marker.existe && marker.visto !== estado.marcaMarker &&
      Date.now() - marker.visto < VENTANA_ACTIVIDAD_MS) {
    return `hablaste hace ${humano(Date.now() - marker.visto)}`;
  }
  return null;
}

/** Duerme a trozos y se rinde en cuanto el estado desaparece del disco. `off`
 *  hace las dos cosas -- `systemctl stop` y borrar el fichero -- porque el stop
 *  puede fallar (sin sudo) y entonces esto es la red: el bucle se para solo a la
 *  vuelta siguiente en vez de seguir escribiendo a un tema que dijo basta. */
async function dormirVigilando(ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    await sleep(Math.min(TROZO_MS, fin - Date.now()));
    if (!leerEstado(SESION)) return false;
  }
  return true;
}

async function main() {
  let estado = leerEstado(SESION);
  if (!estado) {
    console.error('[repetir] no hay nada armado para', SESION);
    return 0;
  }
  const finArmado = new Date(estado.arrancado).getTime() + MAX_DURACION_MS;
  let seguidos = 0;

  while (estado.hechas < estado.vueltas) {
    if (!(await dormirVigilando(estado.cadenciaMs))) {
      console.error('[repetir] cortado durante la espera');
      return 0;
    }
    estado = leerEstado(SESION);
    if (!estado) return 0;

    const restante = finArmado - Date.now();
    if (restante <= 0) {
      await avisar(`⏹️ Repetición terminada por el tope de ${humano(MAX_DURACION_MS)} en la vuelta ${estado.hechas}/${estado.vueltas}.`);
      borrarEstado(SESION);
      return 0;
    }

    const ocupado = hayAlguienMas(estado);
    if (ocupado) {
      estado.saltadas = (estado.saltadas || 0) + 1;
      estado.hechas += 1; // una vuelta saltada CONSUME vuelta: el tope es de tiempo y de intentos
      estado.proximo = new Date(Date.now() + estado.cadenciaMs).toISOString();
      guardarEstado(SESION, estado);
      await avisar(`⏭️ Vuelta ${estado.hechas}/${estado.vueltas} saltada: ${ocupado}.`);
      continue;
    }

    // La frase se anota como TUYA, porque lo es: la escribiste tú al armar la
    // repetición y esto la reinyecta en tu nombre. La respuesta no se anota aquí:
    // ya va dentro del aviso que manda `avisar()`, y anotarla dos veces la
    // enseñaría duplicada en la web.
    publicar({ sesion: SESION, autor: 'usuario', origen: 'repetir', texto: estado.frase });

    const r = await escribirAClaude(estado.frase, restante);
    estado = leerEstado(SESION) ?? estado;
    estado.hechas += 1;
    estado.marcaMarker = markerDelTema(SESION).visto;
    estado.proximo = estado.hechas < estado.vueltas
      ? new Date(Date.now() + estado.cadenciaMs).toISOString() : null;

    if (r.ok) {
      seguidos = 0;
      estado.fallos = estado.fallos || 0;
      guardarEstado(SESION, estado);
      await avisar(`🔁 vuelta ${estado.hechas}/${estado.vueltas} →\n\n${r.out.trim() || '(sin respuesta)'}`);
    } else {
      seguidos += 1;
      estado.fallos = (estado.fallos || 0) + 1;
      guardarEstado(SESION, estado);
      const detalle = r.expiro
        ? `la corté yo: se pasó del tope de ${humano(MAX_DURACION_MS)} de la repetición`
        : (r.err || r.out || 'sin mensaje').trim().slice(0, 500);
      await avisar(`⚠️ vuelta ${estado.hechas}/${estado.vueltas} falló (${seguidos}/${FALLOS_SEGUIDOS_MAX}):\n${detalle}`);
      if (seguidos >= FALLOS_SEGUIDOS_MAX) {
        await avisar(`⏹️ Paro: ${FALLOS_SEGUIDOS_MAX} fallos seguidos. Nada más se escribirá en este tema.`);
        borrarEstado(SESION);
        return 0;
      }
    }
  }

  await avisar(
    `✅ Repetición terminada: ${estado.hechas} vuelta(s)` +
    (estado.saltadas ? `, ${estado.saltadas} saltada(s)` : '') +
    (estado.fallos ? `, ${estado.fallos} con fallo` : '') + '.');
  borrarEstado(SESION);
  return 0;
}

// Siempre 0: esto corre como unidad con Restart=on-failure, y un fallo al final
// no es un fallo, es un bucle. Lo que haya pasado se dice por Telegram y queda
// en el log de la unidad.
main().then(
  (c) => process.exit(c ?? 0),
  (e) => { console.error('[repetir] error inesperado:', e?.message); process.exit(0); },
);
