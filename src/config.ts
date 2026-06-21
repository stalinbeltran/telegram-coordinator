import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carga .env sin dependencias externas (Node >= 20.12).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

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
