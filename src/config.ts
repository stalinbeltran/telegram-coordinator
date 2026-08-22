import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Carga .env sin dependencias externas (Node >= 20.12).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Raíz del repo del coordinador, deducida de dónde vive este fichero y no del
 * cwd: desde que los ejecutores corren en el directorio del repo que los
 * declara, el cwd ya no es el del bot. Se expone a todo comando como
 * `COORD_HOME` para que un ejecutor de otro repo pueda llamar a `notify.mjs` o
 * a `desacoplar.sh` sin suponer que el coordinador está en `~/src`.
 */
export const COORD_HOME = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
export const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data');
export const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS ?? 30_000);
export const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter((n) => Number.isFinite(n));

if (!BOT_TOKEN) {
  console.error('❌ Falta BOT_TOKEN en .env (cópialo de .env.example).');
  process.exit(1);
}

if (ALLOWED_USER_IDS.length === 0) {
  console.warn(
    '⚠️  ALLOWED_USER_IDS está vacío: solo /whoami responderá. ' +
      'Envía /whoami al bot, copia tu id en .env y reinicia.',
  );
}
