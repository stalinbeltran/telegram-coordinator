import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

const dir = join(DATA_DIR, 'sessions');

// sessionId -> nombre del ejecutor ligado
const sessions = new Map<string, string>();

function sanitize(id: string): string {
  return id.replace(/[^\w.-]/g, '_');
}

export function sessionId(chatId: number, threadId?: number): string {
  return `${chatId}_${threadId ?? 'main'}`;
}

export async function loadSessions(): Promise<void> {
  await mkdir(dir, { recursive: true });
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await readFile(join(dir, f), 'utf8'));
      if (data?.id && data?.executor) sessions.set(data.id, data.executor);
    } catch {
      /* ignora archivos corruptos */
    }
  }
}

export function getSession(id: string): string | undefined {
  return sessions.get(id);
}

export async function setSession(id: string, executor: string): Promise<void> {
  sessions.set(id, executor);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sanitize(id)}.json`), JSON.stringify({ id, executor }, null, 2) + '\n');
}

export async function endSession(id: string): Promise<boolean> {
  const existed = sessions.delete(id);
  try {
    await unlink(join(dir, `${sanitize(id)}.json`));
  } catch {
    /* no existía el archivo */
  }
  return existed;
}
