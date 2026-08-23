// Carga los secretos DE DISCO, para procesos desacoplados.
//
// Por qué hace falta: `desacoplar.sh` no deja pasar credenciales a propósito
// (sudo escribiría la lista de --preserve-env en el journal), así que todo lo
// que corre en su propio cgroup nace SIN tokens y tiene que cargárselos él.
// Eso ya estaba documentado; lo que no estaba escrito es que **son dos ficheros
// y no uno**:
//
//   <COORD_HOME>/.env            configuración del servicio (BOT_TOKEN…)
//   ~/.config/dev-secrets.env    secretos de la MÁQUINA (CLAUDE_CODE_OAUTH_TOKEN,
//                                GITHUB_TOKEN, los tokens de las nubes…)
//
// El bot no nota la diferencia porque su unit arranca con `bash -lc` y `.bashrc`
// carga el segundo; un proceso desacoplado sí la nota. Medido el 2026-08-23: el
// resumer despertaba puntual, lanzaba `claude --resume` sin
// CLAUDE_CODE_OAUTH_TOKEN y contestaba «Not logged in · Please run /login».
//
// No pisa nada: `process.loadEnvFile` respeta lo que ya viene en el entorno
// (comprobado), así que lo heredado gana, luego `.env`, luego los secretos de
// máquina. Y nunca lanza: quedarse sin un token es un problema del que lo use,
// no un motivo para no arrancar.

import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Raíz del coordinador: la que nos pasó el bot, o la deducida de este fichero. */
export const COORD_HOME =
  process.env.COORD_HOME || resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Los dos sitios, en orden de prioridad decreciente. */
export function ficherosDeSecretos() {
  return [join(COORD_HOME, '.env'), join(homedir(), '.config', 'dev-secrets.env')];
}

/**
 * Carga los dos ficheros si existen. Devuelve los que sí cargó, para poder
 * decirlo en un diagnóstico.
 */
export function cargarSecretos() {
  const cargados = [];
  for (const fichero of ficherosDeSecretos()) {
    if (!existsSync(fichero)) continue;
    try {
      process.loadEnvFile(fichero);
      cargados.push(fichero);
    } catch (err) {
      // Un fichero ilegible o mal formado se avisa y se sigue: puede que el
      // token que hace falta esté en el otro.
      console.error(`[secretos] no pude leer ${fichero}: ${err?.message ?? err}`);
    }
  }
  return cargados;
}

/**
 * ¿El error de `claude` es de autenticación? Sirve para añadir al mensaje lo
 * único que hace falta saber para arreglarlo, en vez de repetir «Not logged in»
 * a alguien que está en el móvil y no puede correr `/login`.
 */
export function pareceFalloDeLogin(texto) {
  return /not logged in|please run \/login|invalid api key|unauthorized/i.test(String(texto || ''));
}

/** Qué mirar cuando `claude` dice que no hay sesión. */
export function pistaDeLogin() {
  const tiene = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
  return [
    '',
    'Esto es autenticación de claude, no del bot.',
    `CLAUDE_CODE_OAUTH_TOKEN en este proceso: ${tiene ? 'presente (¿caducado?)' : 'AUSENTE'}.`,
    `Se lee de: ${ficherosDeSecretos().join('  y  ')}`,
    tiene
      ? 'Si está presente y falla, el token caducó: renuévalo y vuelve a enviarlo con `push-secret`.'
      : 'Falta el token en esta máquina. Envíalo desde la lanzadora con:\n' +
        '  python3 scripts/do_droplet.py push-secret CLAUDE_CODE_OAUTH_TOKEN --name <maquina>',
  ].join('\n');
}
