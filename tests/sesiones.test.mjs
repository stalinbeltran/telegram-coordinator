// Tests del registro de sesiones (scripts/sesiones.mjs).
//
// Lo que se protege aquí es lo que falla EN SILENCIO y en la dirección cara:
// un falso «no hay nadie» es permiso para pisar el trabajo de otra sesión, y no
// se nota hasta que a alguien le fallan los números. Por eso hay un test por
// cada tramo de la regla de caducidad, uno para el caso «no puedo saberlo» y
// uno para el falso positivo del `pgrep` que ya mordió una vez hoy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESIONES = join(ROOT, 'scripts', 'sesiones.mjs');

/** Un mundo con su raíz de workspaces, su registro y sus transcripts. */
function mundo() {
  const base = mkdtempSync(join(tmpdir(), 'coord-ses-'));
  const registro = join(base, 'registro');
  const trs = join(base, 'transcripts');
  mkdirSync(trs, { recursive: true });
  return { base, registro, trs };
}

function workspace(m, nombre, prefijo) {
  const d = join(m.base, 'ws', nombre);
  mkdirSync(join(d, 'telegram-coordinator'), { recursive: true });
  writeFileSync(join(d, 'WORKSPACE.json'),
    JSON.stringify({ nombre, prefijo, rama: nombre }));
  return d;
}

/** Un transcript con una antigüedad dada, que es de donde sale la vida. */
function transcript(m, nombre, hace_min) {
  const p = join(m.trs, `${nombre}.jsonl`);
  writeFileSync(p, '{}\n');
  const t = new Date(Date.now() - hace_min * 60000);
  utimesSync(p, t, t);
  return p;
}

function registrar(m, { sesion, cwd, transcript: tr, hook = false }) {
  const args = ['--registrar', ...(hook ? ['--hook'] : [])];
  return execFileSync('node', [SESIONES, ...args], {
    input: JSON.stringify({ session_id: sesion, cwd, transcript_path: tr }),
    encoding: 'utf8',
    env: { ...process.env, COORD_SESIONES_DIR: m.registro, COORD_WS_RAIZ: join(m.base, 'ws') },
  });
}

test('una sesión sola en su workspace no ve a nadie', () => {
  const m = mundo();
  const ws = workspace(m, 'sola', 'so-');
  const out = registrar(m, {
    sesion: 'aaaa-1', cwd: join(ws, 'telegram-coordinator'),
    transcript: transcript(m, 'aaaa', 0),
  });
  assert.match(out, /workspace .*sola/);
  assert.match(out, /Nadie más trabaja aquí/);
});

test('dos sesiones en el MISMO workspace: se avisa, con el comando para separarse', () => {
  const m = mundo();
  const ws = workspace(m, 'compartido', 'co-');
  registrar(m, { sesion: 'aaaa-1', cwd: ws, transcript: transcript(m, 'aaaa', 2) });
  const out = registrar(m, { sesion: 'bbbb-2', cwd: ws, transcript: transcript(m, 'bbbb', 0) });
  assert.match(out, /HAY OTRA SESIÓN EN ESTE MISMO WORKSPACE/);
  assert.match(out, /aaaa/);
  assert.match(out, /--nuevo/);
});

test('dos sesiones en workspaces DISTINTOS no se molestan', () => {
  const m = mundo();
  const a = workspace(m, 'uno', 'un-');
  const b = workspace(m, 'dos', 'do-');
  registrar(m, { sesion: 'aaaa-1', cwd: a, transcript: transcript(m, 'aaaa', 1) });
  const out = registrar(m, { sesion: 'bbbb-2', cwd: b, transcript: transcript(m, 'bbbb', 0) });
  assert.match(out, /Nadie más trabaja aquí/);
});

test('el marcador CADUCA solo: sin latido reciente, no es un cerrojo', () => {
  // La regla 3 de CLAUDE.md: un cerrojo sin dueño vivo no es un cerrojo. Aquí
  // no hay heartbeat que refrescar -- la vida la da el mtime del transcript --,
  // así que una sesión muerta deja de contar sin que nadie limpie nada.
  const m = mundo();
  const ws = workspace(m, 'caduca', 'ca-');
  registrar(m, { sesion: 'vieja-1', cwd: ws, transcript: transcript(m, 'vieja', 5 * 60) });
  const out = registrar(m, { sesion: 'nueva-2', cwd: ws, transcript: transcript(m, 'nueva', 0) });
  assert.match(out, /Nadie más trabaja aquí/);

  // ...pero CALLADA (menos de 4 h) sí cuenta: hay un usuario detrás
  const m2 = mundo();
  const ws2 = workspace(m2, 'callada', 'cl-');
  registrar(m2, { sesion: 'quieta-1', cwd: ws2, transcript: transcript(m2, 'quieta', 90) });
  const out2 = registrar(m2, { sesion: 'nueva-2', cwd: ws2, transcript: transcript(m2, 'nueva', 0) });
  assert.match(out2, /HAY OTRA SESIÓN/);
  assert.match(out2, /callada desde hace 90 min/);
});

test('sin transcript legible dice NO SÉ, no "no hay nadie"', () => {
  // Entre un fallo ruidoso y uno silencioso, el ruidoso: un falso «está libre»
  // es permiso para pisar el trabajo de otro.
  const m = mundo();
  const ws = workspace(m, 'dudoso', 'du-');
  registrar(m, { sesion: 'fantasma-1', cwd: ws, transcript: join(m.trs, 'no-existe.jsonl') });
  const out = registrar(m, { sesion: 'nueva-2', cwd: ws, transcript: transcript(m, 'nueva', 0) });
  assert.match(out, /NO SÉ/);
  assert.match(out, /HAY OTRA SESIÓN/);
});

test('fuera de un workspace lo dice, y da el comando para crear uno', () => {
  // ⚠ Hay que correr el script desde una COPIA que tampoco esté en un
  // workspace. `registrar` cae al workspace del propio coordinador cuando el
  // cwd no está en ninguno -- y eso es lo correcto en producción, porque el
  // hook es del proyecto y la sesión lo está usando. El aviso «ninguno» es
  // para cuando no hay workspace por ningún lado, que es como estaba esta
  // máquina antes de que WORKSPACE.json existiera.
  const m = mundo();
  const suelto = join(m.base, 'sin-identidad');
  mkdirSync(join(suelto, 'scripts'), { recursive: true });
  copyFileSync(SESIONES, join(suelto, 'scripts', 'sesiones.mjs'));
  const out = execFileSync('node', [join(suelto, 'scripts', 'sesiones.mjs'), '--registrar'], {
    input: JSON.stringify({
      session_id: 'aaaa-1', cwd: suelto, transcript_path: transcript(m, 'aaaa', 0),
    }),
    encoding: 'utf8',
    env: { ...process.env, COORD_SESIONES_DIR: m.registro },
  });
  assert.match(out, /no está dentro de un workspace/);
  assert.match(out, /--nuevo/);
});

test('--hook devuelve la envoltura que el harness sabe leer', () => {
  const m = mundo();
  const ws = workspace(m, 'enganche', 'en-');
  const crudo = registrar(m, {
    sesion: 'aaaa-1', cwd: ws, transcript: transcript(m, 'aaaa', 0), hook: true,
  });
  const j = JSON.parse(crudo);
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(j.hookSpecificOutput.additionalContext, /Nadie más trabaja aquí/);
  // sin choque NO se molesta al usuario: un aviso que sale siempre se ignora
  assert.equal(j.systemMessage, undefined);

  // con choque, sí
  registrar(m, { sesion: 'bbbb-2', cwd: ws, transcript: transcript(m, 'bbbb', 1) });
  const j2 = JSON.parse(registrar(m, {
    sesion: 'cccc-3', cwd: ws, transcript: transcript(m, 'cccc', 0), hook: true,
  }));
  assert.match(j2.systemMessage, /HAY OTRA SESIÓN/);
});

test('el hook nunca puede impedir que arranque una sesión', () => {
  // Un hook que revienta con stdin basura tiene que salir 0 igualmente: el
  // precio de equivocarse aquí es no poder abrir Claude en esta máquina.
  const m = mundo();
  const r = execFileSync('node', [SESIONES, '--registrar', '--hook'], {
    input: 'esto no es json',
    encoding: 'utf8',
    env: { ...process.env, COORD_SESIONES_DIR: m.registro },
  });
  assert.ok(r.length > 0);
});

test('el registro se escribe donde dice, y una vez por sesión', () => {
  const m = mundo();
  const ws = workspace(m, 'idem', 'id-');
  const tr = transcript(m, 'aaaa', 0);
  registrar(m, { sesion: 'aaaa-1', cwd: ws, transcript: tr });
  registrar(m, { sesion: 'aaaa-1', cwd: ws, transcript: tr });   // reanudada
  assert.ok(existsSync(join(m.registro, 'aaaa-1.json')));
  assert.equal(readdirSync(m.registro).length, 1);
});

test('--tomar muda la sesión de workspace sin abrir otra', () => {
  // El cwd de una sesión es donde ARRANCÓ, no donde acaba trabajando: ésta
  // empezó en ~/src y a los diez minutos su trabajo estaba en ~/ws/fechado. Sin
  // mudanza, el registro avisa de un choque que ya no existe y calla el que sí.
  const m = mundo();
  const viejo = workspace(m, 'origen', 'or-');
  const nuevo = workspace(m, 'destino', 'de-');
  const tr = transcript(m, 'aaaa', 0);
  registrar(m, { sesion: 'aaaa-1', cwd: viejo, transcript: tr });

  const out = execFileSync('node', [SESIONES, '--tomar', nuevo], {
    encoding: 'utf8',
    env: {
      ...process.env, COORD_SESIONES_DIR: m.registro,
      CLAUDE_CODE_SESSION_ID: 'aaaa-1',
    },
  });
  assert.match(out, /dueña de .*destino/);

  // el marcador apunta al nuevo, conserva su transcript, y no se duplica
  const marca = JSON.parse(readFileSync(join(m.registro, 'aaaa-1.json'), 'utf8'));
  assert.equal(marca.workspace, nuevo);
  assert.equal(marca.transcript, tr);
  assert.equal(readdirSync(m.registro).length, 1);

  // ...y el workspace de origen queda libre para otra sesión
  const otra = registrar(m, { sesion: 'bbbb-2', cwd: viejo, transcript: transcript(m, 'bbbb', 0) });
  assert.match(otra, /Nadie más trabaja aquí/);
});

test('--tomar se niega a lo que no es un workspace, y a no saber quién es', () => {
  const m = mundo();
  const suelto = join(m.base, 'no-es-workspace');
  mkdirSync(suelto, { recursive: true });
  const correr = (env, arg) => {
    try {
      execFileSync('node', [SESIONES, '--tomar', arg], {
        encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, COORD_SESIONES_DIR: m.registro, ...env },
      });
      return null;
    } catch (e) { return (e.stderr || '') + (e.stdout || ''); }
  };
  assert.match(correr({ CLAUDE_CODE_SESSION_ID: 'aaaa-1' }, suelto), /no es un workspace/);
  // sin id de sesión no se inventa uno: pisaría el marcador de otra
  const sinId = { ...process.env };
  delete sinId.CLAUDE_CODE_SESSION_ID; delete sinId.CLAUDE_SESSION_ID;
  const ws = workspace(m, 'algo', 'al-');
  try {
    execFileSync('node', [SESIONES, '--tomar', ws], {
      encoding: 'utf8', stdio: 'pipe',
      env: { ...sinId, COORD_SESIONES_DIR: m.registro, CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '' },
    });
    assert.fail('debería haberse negado');
  } catch (e) {
    assert.match((e.stderr || '') + (e.stdout || ''), /No sé qué sesión soy/);
  }
});

test('un --tomar SOBREVIVE a que la sesión se reanude', () => {
  // MEDIDO el 2026-08-28 con el hook ya en marcha: esta sesión hizo `--tomar`,
  // se reanudó, y el `--registrar` del SessionStart reescribió el marcador con
  // el workspace deducido del cwd -- borrando la mudanza en silencio. Una
  // decisión explícita no la pisa una inferida.
  const m = mundo();
  const origen = workspace(m, 'donde-arranque', 'da-');
  const real = workspace(m, 'donde-trabajo', 'dt-');
  const tr = transcript(m, 'aaaa', 0);

  registrar(m, { sesion: 'aaaa-1', cwd: origen, transcript: tr });
  execFileSync('node', [SESIONES, '--tomar', real], {
    encoding: 'utf8',
    env: { ...process.env, COORD_SESIONES_DIR: m.registro, CLAUDE_CODE_SESSION_ID: 'aaaa-1' },
  });

  // ...la sesión se reanuda: el hook vuelve a registrar con el cwd VIEJO
  const out = registrar(m, { sesion: 'aaaa-1', cwd: origen, transcript: tr });
  assert.match(out, /donde-trabajo/);
  assert.match(out, /tomado a mano/);
  assert.equal(JSON.parse(readFileSync(join(m.registro, 'aaaa-1.json'), 'utf8')).workspace, real);

  // y una sesión que NO tomó nada sí sigue el cwd
  const out2 = registrar(m, { sesion: 'bbbb-2', cwd: origen, transcript: transcript(m, 'bbbb', 0) });
  assert.match(out2, /donde-arranque/);
});

test('--cerrar libera el workspace, pero NO es de lo que depende la caducidad', () => {
  const m = mundo();
  const ws = workspace(m, 'cierre', 'ce-');
  const tr = transcript(m, 'aaaa', 0);
  registrar(m, { sesion: 'aaaa-1', cwd: ws, transcript: tr });

  // otra sesión la ve mientras está viva
  assert.match(
    registrar(m, { sesion: 'bbbb-2', cwd: ws, transcript: transcript(m, 'bbbb', 0) }),
    /HAY OTRA SESIÓN/);

  execFileSync('node', [SESIONES, '--cerrar'], {
    input: JSON.stringify({ session_id: 'aaaa-1' }),
    encoding: 'utf8',
    env: { ...process.env, COORD_SESIONES_DIR: m.registro },
  });
  assert.ok(!existsSync(join(m.registro, 'aaaa-1.json')));

  // ⚠ y lo que NO puede pasar: que SIN --cerrar quede bloqueado para siempre.
  // Una sesión matada a SIGKILL (o la máquina rehecha) nunca corre su
  // SessionEnd, así que la caducidad por transcript sigue siendo EL mecanismo;
  // esto sólo la adelanta. Mundo aparte para que no lo enturbie nadie más.
  const m2 = mundo();
  const ws2 = workspace(m2, 'muerta-sin-cerrar', 'ms-');
  registrar(m2, { sesion: 'zombi-1', cwd: ws2, transcript: transcript(m2, 'zombi', 9 * 60) });
  assert.ok(existsSync(join(m2.registro, 'zombi-1.json')));   // su marcador SIGUE ahí
  assert.match(
    registrar(m2, { sesion: 'nueva-2', cwd: ws2, transcript: transcript(m2, 'nueva', 0) }),
    /Nadie más trabaja aquí/);
});
