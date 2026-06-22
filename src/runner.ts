import { spawn, type ChildProcess } from 'node:child_process';
import { COMMAND_TIMEOUT_MS } from './config.js';

export interface RunResult {
  ok: boolean;
  output: string;
}

/** Mata el proceso y TODO su árbol de hijos (clave en Windows con shell:true). */
function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL'); // mata el grupo de procesos
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ya murió */
      }
    }
  }
}

/**
 * Ejecuta una plantilla de comando en el shell del sistema.
 * - Si la plantilla contiene `{{input}}`, se sustituye el texto de entrada ahí.
 * - Si no, el texto de entrada se pasa por stdin.
 * Nunca lanza excepciones: los errores se devuelven en `output` con ok=false.
 */
export function runCommand(
  template: string,
  input: string,
  extraEnv?: Record<string, string>,
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const usesPlaceholder = template.includes('{{input}}');
    const cmd = usesPlaceholder ? template.split('{{input}}').join(input) : template;

    let child: ChildProcess;
    try {
      child = spawn(cmd, {
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32', // grupo propio en POSIX para matarlo entero
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      });
    } catch (err) {
      resolvePromise({ ok: false, output: `No se pudo iniciar el comando: ${String(err)}` });
      return;
    }

    let settled = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(r);
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish({
        ok: false,
        output: `⏱️ Tiempo de espera agotado (${COMMAND_TIMEOUT_MS} ms). Comando cancelado.`,
      });
    }, COMMAND_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      finish({ ok: false, output: err.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true, output: stdout.trim() || '(sin salida)' });
      } else {
        finish({ ok: false, output: (stderr || stdout || `exit code ${code}`).trim() });
      }
    });

    if (!usesPlaceholder && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin?.end();
    }
  });
}
