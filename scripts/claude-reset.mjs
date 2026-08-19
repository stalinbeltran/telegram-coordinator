// Ejecutor de un uso: REINICIA la conversación de claude del TEMA actual.
//
// Por qué hacía falta: el id de sesión de claude no se guardaba, se DERIVA del
// tema, así que dentro de un tema la conversación era la misma para siempre. Ni
// `/end` ni reiniciar el bot la cortaban (`/end` solo suelta la atadura con el
// ejecutor, en `src/sessions.ts`), y crecía sin techo. La única salida era abrir
// un tema nuevo, y con ella se perdían el `cd` del shell y el resto del hilo.
//
// Cómo la corta sin romper esa derivación: el marker guarda una ÉPOCA y el uuid
// pasa a derivarse de `<tema>#<época>`. Subir la época da un uuid que claude no
// ha visto nunca — o sea, una conversación en blanco— sin tocar el coordinador y
// sin salir del tema.
//
//     /use creset
//     <cualquier texto>     -> reinicia (da igual lo que escribas)
//     /use c                -> mismo tema, conversación nueva
//
// La conversación anterior NO se borra: sigue en el almacén de claude, solo deja
// de estar referenciada. Reiniciar es barato y no destruye nada.

import { SESSION, readMarker, epochOf, uuidFor, writeMarker } from './claude-marker.mjs';

// El coordinador escribe el mensaje en stdin siempre; lo drenamos aunque no nos
// importe su contenido, para no dejar la tubería a medias.
function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
  });
}

await readStdin();

const previo = epochOf(readMarker());
const epoch = previo + 1;

// `started: false` es lo que hace que el próximo mensaje llame a claude con
// `--session-id` (crear) en vez de `--resume` (continuar).
await writeMarker(SESSION, { epoch, uuid: uuidFor(SESSION, epoch), started: false });

process.stdout.write(
  [
    `🔄 Conversación de claude reiniciada en este tema (época ${previo} → ${epoch}).`,
    'La anterior no se borra: deja de usarse, nada más.',
    'Vuelve con /use c — el siguiente mensaje empieza en blanco.',
  ].join('\n'),
);
