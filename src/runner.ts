import { spawn } from 'node:child_process';
import { COMMAND_TIMEOUT_MS } from './config.js';

export interface RunResult {
  ok: boolean;
  output: string;
}

/**
 * Ejecuta una plantilla de comando en el shell del sistema.
 * - Si la plantilla contiene `{{input}}`, se sustituye el texto de entrada ahí.
 * - Si no, el texto de entrada se pasa por stdin.
 * Nunca lanza excepciones: los errores se devuelven en `output` con ok=false.
 */
export function runCommand(template: string, input: string): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const usesPlaceholder = template.includes('{{input}}');
    const cmd = usesPlaceholder ? template.split('{{input}}').join(input) : template;

    let child;
    try {
      child = spawn(cmd, { shell: true, timeout: COMMAND_TIMEOUT_MS });
    } catch (err) {
      resolvePromise({ ok: false, output: `No se pudo iniciar el comando: ${String(err)}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      resolvePromise({ ok: false, output: err.message });
    });

    child.on('close', (code, signal) => {
      if (signal) {
        resolvePromise({ ok: false, output: `Comando terminado por señal ${signal} (¿timeout?).` });
      } else if (code === 0) {
        resolvePromise({ ok: true, output: stdout.trim() || '(sin salida)' });
      } else {
        resolvePromise({ ok: false, output: (stderr || stdout || `exit code ${code}`).trim() });
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
