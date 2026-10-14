// La memoria de Claude sobrevive al dev porque vive en git: restaurar al nacer, guardar al cerrar.
// Las reglas que fija: (1) restaurar no pisa lo local; (2) guardar copia lo local y une el índice sin duplicar;
// (3) una memoria con forma de secreto NO se guarda; (4) el slug es el de Claude Code; (5) el hook sale con 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { restaurar, guardar, unirIndice, slug } from '../scripts/memoria.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'memoria.mjs');
const callado = () => {};
function caja() { const d = mkdtempSync(join(tmpdir(), 'memoria-')); const repo = join(d, 'memoria'), local = join(d, 'memory'); mkdirSync(repo); mkdirSync(local); return { d, repo, local }; }

test('restaurar copia lo que falta y NO pisa lo local; une el índice sin duplicar', () => {
  const { repo, local } = caja();
  writeFileSync(join(repo, 'a.md'), 'A del repo'); writeFileSync(join(repo, 'b.md'), 'B del repo'); writeFileSync(join(repo, 'MEMORY.md'), '- [A](a.md) — a\n- [B](b.md) — b\n');
  writeFileSync(join(local, 'a.md'), 'A local, más nueva'); writeFileSync(join(local, 'MEMORY.md'), '- [A](a.md) — a\n');
  const r = restaurar(repo, local, callado);
  assert.equal(r.copiados, 1); assert.equal(readFileSync(join(local, 'a.md'), 'utf8'), 'A local, más nueva');
  assert.equal(readFileSync(join(local, 'b.md'), 'utf8'), 'B del repo');
  assert.equal(readFileSync(join(local, 'MEMORY.md'), 'utf8'), '- [A](a.md) — a\n- [B](b.md) — b\n');
  assert.deepEqual(restaurar(repo, local, callado), { copiados: 0, indice: false }, 'repetir no cambia nada');
});

test('guardar copia lo local encima, une el índice, y sin git no toca nada más', () => {
  const { repo, local } = caja();
  writeFileSync(join(repo, 'a.md'), 'vieja'); writeFileSync(join(repo, 'MEMORY.md'), '- [A](a.md) — a\n');
  writeFileSync(join(local, 'a.md'), 'nueva'); writeFileSync(join(local, 'c.md'), 'C'); writeFileSync(join(local, 'MEMORY.md'), '- [A](a.md) — a\n- [C](c.md) — c\n');
  const g = guardar(repo, local, { git: false, log: callado });
  assert.equal(g.cambiados, 3); assert.equal(readFileSync(join(repo, 'a.md'), 'utf8'), 'nueva'); assert.equal(readFileSync(join(repo, 'c.md'), 'utf8'), 'C');
  assert.equal(readFileSync(join(repo, 'MEMORY.md'), 'utf8'), '- [A](a.md) — a\n- [C](c.md) — c\n');
});

test('una memoria con forma de secreto NO se guarda, y se dice cuál', () => {
  const { repo, local } = caja(); const avisos = [];
  writeFileSync(join(local, 'ok.md'), 'nada raro'); writeFileSync(join(local, 'mala.md'), 'el token es ghp_' + 'A'.repeat(36));
  const g = guardar(repo, local, { git: false, log: (m) => avisos.push(m) });
  assert.deepEqual(g.rechazados, ['mala.md']); assert.ok(!existsSync(join(repo, 'mala.md'))); assert.ok(existsSync(join(repo, 'ok.md')));
  assert.ok(avisos.some((m) => m.includes('mala.md') && m.includes('secreto')));
});

test('guardar con git commitea SÓLO memoria/ y empuja a un remoto', () => {
  const d = mkdtempSync(join(tmpdir(), 'memoria-git-')); const remoto = join(d, 'remoto.git'), clon = join(d, 'clon'), local = join(d, 'memory'); mkdirSync(local);
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q', '--bare', '--initial-branch=main', remoto], d); git(['clone', '-q', remoto, clon], d);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'raíz'], clon); git(['push', '-q', '-u', 'origin', 'main'], clon);
  git(['config', 'user.email', 't@t'], clon); git(['config', 'user.name', 't'], clon);
  writeFileSync(join(clon, 'otro.txt'), 'trabajo a medias que NO debe entrar');
  writeFileSync(join(local, 'x.md'), 'X'); writeFileSync(join(local, 'MEMORY.md'), '- [X](x.md) — x\n');
  guardar(join(clon, 'memoria'), local, { git: true, log: callado });
  assert.equal(git(['status', '--porcelain'], clon).trim(), '?? otro.txt', 'lo ajeno sigue sin commitear');
  assert.match(git(['log', '--oneline', 'origin/main', '-1'], clon), /memoria: guardado automático/);
  assert.equal(git(['show', 'origin/main:memoria/x.md'], clon), 'X');
});

test('el slug es el de Claude Code, y el hook sale con 0 aunque no haya nada', () => {
  assert.equal(slug('/home/deploy/src/telegram-coordinator'), '-home-deploy-src-telegram-coordinator');
  const { d } = caja();
  const r = execFileSync('node', [SCRIPT, '--restaurar', '--hook'], { env: { ...process.env, MEMORIA_REPO: join(d, 'no-existe'), MEMORIA_DIR: join(d, 'memory') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r, '');
  assert.equal(unirIndice('', '- a\n- b\n'), '- a\n- b\n'); assert.equal(unirIndice('- a\n', '- a\n- b\n'), '- a\n- b\n');
});
