// Encargado del ejecutor `c` (claude). Recibe por stdin la salida del ejecutor.
//
//   - Salida normal  -> la reenvía al usuario (igual que el encargado `echo`).
//   - Límite de uso   -> NO molesta al usuario con el banner: lanza un proceso
//     `claude-resumer` DESACOPLADO (sobrevive al timeout de 30s del coordinador)
//     que espera al reinicio de tokens y reanuda la conversación con --resume,
//     entregando el resultado a Telegram por su cuenta. Aquí solo avisamos.
//
// Por qué desacoplado: el coordinador mata todo comando a los 30s y no puede
// mandar mensajes "espontáneos" después; el resumer corre fuera de ese ciclo y
// se manda los mensajes él mismo vía Bot API (hereda BOT_TOKEN/COORD_* del entorno).

import { spawn } from 'node:child_process';
import { isRateLimited, calculateWaitMs } from './limit-detect.mjs';

function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
  });
}

const output = await readStdin();

if (!isRateLimited(output)) {
  // Sin límite: reenvía la respuesta de claude tal cual (como `echo`).
  process.stdout.write('>>USER ' + output);
  process.exit(0);
}

// Límite detectado: programa la reanudación en segundo plano.
const waitMs = calculateWaitMs(output);

const child = spawn(process.execPath, ['scripts/claude-resumer.mjs', String(waitMs)], {
  detached: true, // grupo propio: no muere con este encargado
  stdio: 'ignore',
  windowsHide: true,
  env: process.env, // arrastra BOT_TOKEN, COORD_SESSION/CHAT/THREAD, etc.
});
child.unref(); // que este encargado pueda salir sin esperarlo

const when = new Date(Date.now() + waitMs).toLocaleTimeString();
const mins = Math.max(1, Math.round(waitMs / 60000));
process.stdout.write(
  '>>USER ' +
    [
      '⏳ Se alcanzó el límite de uso de Claude en esta sesión.',
      `Reanudaré la conversación automáticamente alrededor de las ${when} (~${mins} min).`,
      'No necesitas enviar nada: te aviso en este mismo tema cuando continúe.',
    ].join('\n'),
);
