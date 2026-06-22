// Encargado especialista en el RESETEO de tokens del ejecutor `c` (claude).
// Recibe por stdin la salida del ejecutor; NO se comunica con el usuario (de eso
// se encarga `echo`, el especialista en comunicación). Su único trabajo:
//
//   - Salida normal  -> no hace nada (echo ya la reenvió).
//   - Límite de uso   -> lanza un proceso `claude-resumer` DESACOPLADO (sobrevive
//     al timeout de 30s del coordinador) que espera al reinicio de tokens y reanuda
//     la conversación con --resume. El propio resumer avisa y entrega el resultado
//     a Telegram por su cuenta (hereda BOT_TOKEN/COORD_* del entorno).
//
// En ambos casos emite un `>>USER` vacío: así el orquestador no agrega ninguna
// respuesta de este encargado (descarta los `>>USER` sin texto), dejando que `echo`
// sea la única voz hacia el usuario.

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

if (isRateLimited(output)) {
  // Programa la reanudación en segundo plano. El tiempo de espera del límite ACTUAL
  // se calcula aquí y se pasa al resumer; este lo recalcula en cada reintento.
  const waitMs = calculateWaitMs(output);
  const child = spawn(process.execPath, ['scripts/claude-resumer.mjs', String(waitMs)], {
    detached: true, // grupo propio: no muere con este encargado
    stdio: 'ignore',
    windowsHide: true,
    env: process.env, // arrastra BOT_TOKEN, COORD_SESSION/CHAT/THREAD, etc.
  });
  child.unref(); // que este encargado pueda salir sin esperarlo
}

// `>>USER` vacío = "sin respuesta de este encargado" (lo descarta el orquestador).
process.stdout.write('>>USER');
