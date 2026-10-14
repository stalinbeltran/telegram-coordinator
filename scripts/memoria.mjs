#!/usr/bin/env node
// La MEMORIA de Claude (~/.claude/projects/<slug>/memory/) sobrevive al dev — porque vive en GIT.
//
//   node scripts/memoria.mjs --restaurar [--hook]   repo memoria/ → ~/.claude/…/memory/  (SessionStart)
//   node scripts/memoria.mjs --guardar   [--hook]   ~/.claude/…/memory/ → repo memoria/, commit y push  (SessionEnd y SessionStart)
//   node scripts/memoria.mjs --estado                qué hay en cada lado y qué difiere
//
// POR QUÉ (el dueño, 2026-10-15): «esta máquina se descarta; si la memoria vive en el server, tenerla en memoria no
// sirve». `~/.claude/` muere con el droplet (CLAUDE.md ya lo decía para las notas). La única cosa de aquí que sobrevive
// es lo empujado, así que la memoria se trata como el archivo de conversaciones: se guarda en el repo y se restaura al
// nacer. En el repo del COORDINADOR —no en el de datos— porque es el que todo dev clona y donde viven los hooks.
//
// Reglas:
//  1. Al RESTAURAR nunca se pisa un fichero local: lo local es lo más reciente (lo escribió esta sesión). Se copia lo
//     que falta y el índice MEMORY.md se UNE línea a línea (sin duplicar).
//  2. Al GUARDAR lo local manda (se copia encima) y el índice se une igual. Sólo se commitea `memoria/`, nunca `-A`.
//  3. REJILLA: una memoria que contenga forma de secreto (redactar.mjs) NO se guarda y se dice. Git no olvida.
//  4. Un hook nunca impide trabajar: con --hook sale siempre con 0 y, si no puede, lo dice por stderr.
//  5. Dónde está la memoria local se DECLARA (MEMORIA_DIR) o se deduce de CLAUDE_PROJECT_DIR / cwd con la regla de
//     Claude Code (la ruta con todo lo que no es [A-Za-z0-9] → '-'). El repo se declara con MEMORIA_REPO (tests).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { loQueSigueSiendoSecreto } from './redactar.mjs';

const CASA = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const HOOK = args.includes('--hook');
const REPO = process.env.MEMORIA_REPO || join(CASA, 'memoria');

export function slug(ruta) { return ruta.replace(/[^A-Za-z0-9]/g, '-'); }
export function dirLocal() {
  if (process.env.MEMORIA_DIR) return process.env.MEMORIA_DIR;
  const proy = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return join(homedir(), '.claude', 'projects', slug(resolve(proy)), 'memory');
}
const md = (d) => existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').sort() : [];
const leer = (p) => existsSync(p) ? readFileSync(p, 'utf8') : '';

export function unirIndice(a, b) {
  // líneas de `b` que no estén en `a`, al final; sin duplicados; se conservan las vacías de `a`
  const vistas = new Set(a.split('\n').map((l) => l.trim()).filter(Boolean)); const out = a.replace(/\s+$/, '');
  const nuevas = b.split('\n').filter((l) => l.trim() && !vistas.has(l.trim()));
  return (out ? out + '\n' : '') + (nuevas.length ? nuevas.join('\n') + '\n' : '');
}

export function restaurar(repo = REPO, local = dirLocal(), log = console.error) {
  if (!existsSync(repo)) { log(`memoria: no hay ${repo} en el repo: nada que restaurar`); return { copiados: 0, indice: false }; }
  mkdirSync(local, { recursive: true }); let copiados = 0;
  for (const f of md(repo)) {
    if (existsSync(join(local, f))) continue;                        // regla 1: lo local no se pisa
    writeFileSync(join(local, f), leer(join(repo, f))); copiados++;
  }
  const antes = leer(join(local, 'MEMORY.md')); const unido = unirIndice(antes, leer(join(repo, 'MEMORY.md')));
  const indice = unido !== antes; if (indice) writeFileSync(join(local, 'MEMORY.md'), unido);
  log(`memoria: restaurada del repo: ${copiados} fichero(s) nuevo(s)${indice ? ', índice unido' : ''} → ${local}`);
  return { copiados, indice };
}

export function guardar(repo = REPO, local = dirLocal(), { git = true, log = console.error } = {}) {
  if (!existsSync(local)) { log(`memoria: no hay memoria local en ${local}: nada que guardar`); return { cambiados: 0, rechazados: [] }; }
  mkdirSync(repo, { recursive: true }); let cambiados = 0; const rechazados = [];
  for (const f of md(local)) {
    const txt = leer(join(local, f)); const sec = loQueSigueSiendoSecreto(txt);   // devuelve una LISTA: vacía = limpio
    if (sec.length) { rechazados.push(f); log(`memoria: ⛔ ${f} NO se guarda: tiene forma de secreto (${sec.join(', ')}). Rótalo y quítalo de la memoria.`); continue; }
    if (leer(join(repo, f)) !== txt) { writeFileSync(join(repo, f), txt); cambiados++; }
  }
  const antes = leer(join(repo, 'MEMORY.md')); const unido = unirIndice(antes, leer(join(local, 'MEMORY.md')));
  if (unido !== antes) { writeFileSync(join(repo, 'MEMORY.md'), unido); cambiados++; }
  if (cambiados && git) empujar(repo, log);
  log(`memoria: guardada en el repo: ${cambiados} fichero(s) cambiado(s)${rechazados.length ? `, ${rechazados.length} rechazado(s)` : ''}`);
  return { cambiados, rechazados };
}

function sh(args, cwd) {
  try { return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, out: (e.stderr || e.message || '').toString().trim() }; }
}
function empujar(repo, log) {
  // sólo `memoria/`; si otra máquina empujó antes, un `pull --rebase` y otro intento; si falla, se dice y se queda
  // commiteado (se reintenta en el siguiente hook). Nunca `-A`, nunca `--force`.
  const raiz = sh(['rev-parse', '--show-toplevel'], repo); if (!raiz.ok) { log(`memoria: ${repo} no está en un repo git: no empujo`); return; }
  const rel = repo.slice(raiz.out.length + 1) || '.';
  sh(['add', '--', rel], raiz.out);
  if (!sh(['diff', '--cached', '--quiet', '--', rel], raiz.out).ok) {
    const c = sh(['commit', '-q', '-m', 'memoria: guardado automático de la memoria de Claude', '--', rel], raiz.out);
    if (!c.ok) { log(`memoria: commit falló: ${c.out}`); return; }
  }
  let p = sh(['push', '-q'], raiz.out);
  if (!p.ok) { sh(['pull', '--rebase', '-q'], raiz.out); p = sh(['push', '-q'], raiz.out); }
  if (!p.ok) log(`memoria: push falló (queda commiteado, se reintenta): ${p.out.split('\n').slice(-1)[0]}`);
}

function estado(repo = REPO, local = dirLocal()) {
  const r = md(repo), l = md(local);
  console.log(`repo  ${repo}: ${r.length} memoria(s)\nlocal ${local}: ${l.length} memoria(s)`);
  for (const f of new Set([...r, ...l])) {
    const a = leer(join(repo, f)), b = leer(join(local, f));
    console.log(`  ${!a ? 'sólo local ' : !b ? 'sólo repo  ' : a === b ? 'igual      ' : 'DIFIEREN   '} ${f}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (args.includes('--restaurar')) restaurar();
    else if (args.includes('--guardar')) guardar(undefined, undefined, { git: !args.includes('--sin-git') });
    else if (args.includes('--estado')) estado();
    else { console.error('uso: memoria.mjs --restaurar | --guardar [--sin-git] | --estado  [--hook]'); process.exit(2); }
  } catch (e) { console.error(`memoria: ${e.message}`); process.exit(HOOK ? 0 : 1); }
}
