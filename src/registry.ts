import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

export interface Executor {
  name: string;
  command: string;
  encargados: string[];
}

export interface Encargado {
  name: string;
  command: string;
}

const execDir = join(DATA_DIR, 'executors');
const encDir = join(DATA_DIR, 'encargados');

async function readJsonDir<T>(dir: string): Promise<T[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await readFile(join(dir, f), 'utf8')) as T);
    } catch (err) {
      console.error(`⚠️  No se pudo leer ${join(dir, f)}: ${String(err)}`);
    }
  }
  return out;
}

export async function listExecutors(): Promise<Executor[]> {
  return readJsonDir<Executor>(execDir);
}

export async function getExecutor(name: string): Promise<Executor | undefined> {
  return (await listExecutors()).find((e) => e.name === name);
}

export async function getEncargado(name: string): Promise<Encargado | undefined> {
  return (await readJsonDir<Encargado>(encDir)).find((e) => e.name === name);
}

/**
 * Siembra el kit mínimo de arranque la primera vez (es DATO, no código):
 *  - ejecutor `shell`: ejecuta literalmente lo que envíes.
 *  - encargado `echo`: reenvía la salida del ejecutor de vuelta a ti.
 */
export async function seedBootKit(): Promise<void> {
  await mkdir(execDir, { recursive: true });
  await mkdir(encDir, { recursive: true });

  if (!(await getExecutor('shell'))) {
    const shell: Executor = { name: 'shell', command: '{{input}}', encargados: ['echo'] };
    await writeFile(join(execDir, 'shell.json'), JSON.stringify(shell, null, 2) + '\n');
    console.log('🌱 Sembrado ejecutor "shell".');
  }

  if (!(await getEncargado('echo'))) {
    const echo: Encargado = {
      name: 'echo',
      command:
        `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write('>>USER '+s))"`,
    };
    await writeFile(join(encDir, 'echo.json'), JSON.stringify(echo, null, 2) + '\n');
    console.log('🌱 Sembrado encargado "echo".');
  }
}
