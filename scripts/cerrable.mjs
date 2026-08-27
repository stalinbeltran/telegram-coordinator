#!/usr/bin/env node
// ¿Se puede APAGAR este server ahora mismo, o se pierde algo?
//
// Por qué existe
// --------------
// Estos servidores son efímeros y se rehacen sin aviso (CLAUDE.md). Apagar uno
// en el momento equivocado no da error: da una factura y un agujero.
//
//   1. Una FLOTA viva alquila máquinas en Vast. Si el server muere, el proceso
//      que las recoge muere con él -- y las máquinas NO. Siguen facturando, sin
//      nadie que las destruya y sin nadie que se entere. Es el único daño de
//      esta lista que crece solo mientras nadie mira.
//   2. Lo que no está empujado no existe: un clon limpio saca `main` del remoto
//      y punto. Commits locales, cambios sin commitear y ramas sin empujar se
//      pierden enteros.
//   3. Un trabajo largo desacoplado (dataset, medición) muere con la máquina y
//      hay que repetirlo.
//
//   node scripts/cerrable.mjs           # el informe entero
//   node scripts/cerrable.mjs --breve   # UNA línea, para pegar al final de un mensaje
//   node scripts/cerrable.mjs --exit0   # sale 0 siempre (lo usa el ejecutor de Telegram)
//
// Código de salida: 0 = se puede cerrar · 1 = NO cerrar · 2 = no se pudo saber.
//
// ⚠ Si algo no se puede comprobar (sin token, API caída), esto dice NO SÉ y sale
// con 2. Nunca dice "cerrable" por no haber podido mirar: un fallo silencioso
// que se lee como permiso es exactamente el que cuesta dinero.

import { readFileSync, existsSync, readlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const COORD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WS = dirname(COORD);
const BREVE = process.argv.includes('--breve');
// El codigo de salida de este script es INFORMACION (0/1/2), no un fallo. Pero
// el coordinador lee cualquier codigo != 0 como "el ejecutor fallo" y entonces
// NO corre los encargados, o sea que la respuesta no llega a Telegram. Por eso
// el ejecutor lo llama con --exit0: el veredicto va en el texto, que es donde el
// usuario lo lee. Fuera de Telegram el codigo sigue sirviendo para encadenar.
const EXIT0 = process.argv.includes('--exit0');
const REPOS = ['foveal-vision', 'telegram-coordinator',
               'digital-ocean-dropplet-auto-launching', 'image-text-sample-generator'];
// Lo que, si está vivo, significa que hay trabajo en curso que se perdería.
const TRABAJOS = /estudio_flota\.py|vigilante_avance\.py|vigilante_prioridades\.py|bench_fleet\.py|bench_dataset\.py|bench_speed\.py|knob_min_size\.py|estudio_lote\.py/;

const razones = [];   // por qué NO cerrar
const dudas = [];     // lo que no se pudo comprobar
const limpio = [];    // lo que sí está en orden

function sh(cmd, cwd, env) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 60000,
                           stdio: ['ignore', 'pipe', 'ignore'], env: env ?? process.env }).trim();
  } catch { return null; }
}

// ---------------------------------------------------------------- 1. lo que se paga
let ws = null;
try { ws = JSON.parse(readFileSync(join(WS, 'WORKSPACE.json'), 'utf8')); } catch { /* sin identidad */ }
const prefijo = ws?.prefijo ?? null;

const lanzador = join(WS, 'digital-ocean-dropplet-auto-launching');
if (!existsSync(lanzador)) {
  dudas.push('no está el repo del lanzador: no puedo preguntar qué hay alquilado');
} else {
  // Se reusa `vast_instance.py list` en vez de hablar con la API desde aquí: el
  // conocimiento de esa API vive en un sitio, y un segundo sitio acaba divergiendo.
  const salida = sh(`sh -c '. ~/.config/dev-secrets.env 2>/dev/null; python3 scripts/vast_instance.py list'`, lanzador);
  if (salida === null) {
    dudas.push('`vast_instance.py list` falló (¿token? ¿red?): NO sé qué hay alquilado');
  } else if (/No hay ninguna instancia viva/i.test(salida)) {
    limpio.push('Vast: nada alquilado');
  } else {
    const filas = salida.split('\n')
      .map((l) => l.match(/^\s*(\d{6,})\s+(\S+)/))
      .filter(Boolean)
      .map((m) => ({ id: m[1], etiqueta: m[2] }));
    const mias = prefijo ? filas.filter((f) => f.etiqueta.startsWith(prefijo)) : filas;
    const ajenas = filas.length - mias.length;
    const gasto = (salida.match(/Gastando ahora:\s*([\d.,]+)\s*\$\/h/) ?? [])[1];
    if (mias.length) {
      razones.push({ tipo: 'vast', breve: `${mias.length} máquinas Vast${gasto ? ` (${gasto} $/h)` : ''}`,
        largo: `${mias.length} máquina(s) alquilada(s) en Vast${gasto ? ` (${gasto} $/h en total)` : ''}` +
               ` — si este server muere, siguen facturando y nadie las recoge`,
        etiquetas: mias.map((m) => m.etiqueta) });
    } else if (filas.length) {
      limpio.push(`Vast: nada mío (${ajenas} instancia(s) de otro workspace, no cuentan)`);
    }
    if (!prefijo && filas.length) {
      dudas.push('sin `prefijo` en WORKSPACE.json no puedo distinguir mis máquinas de las de otra sesión');
    }
  }
}

// ---------------------------------------------------------------- 2. trabajo en curso
// De quién es un proceso lo dice su CWD, no su línea de comando: la flota se
// lanza con ruta relativa (medido 2026-08-27).
const vivos = (sh('ps -eo pid,args') ?? '').split('\n').slice(1)
  .filter((l) => TRABAJOS.test(l) && !/\bgrep\b/.test(l))
  .map((l) => {
    const pid = l.trim().split(/\s+/)[0];
    let cwd = null;
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* murió o no es Linux */ }
    const m = l.match(TRABAJOS);
    return { pid, cwd, que: m ? m[0] : '?' };
  })
  .filter((v) => v.cwd?.startsWith(WS));
if (vivos.length) {
  const porQue = [...new Set(vivos.map((v) => v.que))].join(', ');
  razones.push({ tipo: 'proc', breve: `${vivos.length} proceso(s) vivo(s)`,
    largo: `${vivos.length} proceso(s) de trabajo vivo(s) (${porQue}) — morirían con el server` });
} else {
  limpio.push('nada de trabajo corriendo en este workspace');
}

// ---------------------------------------------------------------- 3. lo no empujado
for (const r of REPOS) {
  const p = join(WS, r);
  if (!existsSync(p)) continue;
  const sucio = sh('git status --porcelain', p);
  if (sucio === null) { dudas.push(`no pude leer el git de ${r}`); continue; }
  if (sucio) razones.push({ tipo: 'git', n: sucio.split('\n').length,
    largo: `${r}: ${sucio.split('\n').length} fichero(s) sin commitear` });
  const rama = sh('git branch --show-current', p);
  if (!rama) continue;
  const sinEmpujar = sh(`git log --oneline origin/${rama}..${rama}`, p);
  if (sinEmpujar === null) {
    // sin upstream: la rama entera es local y se pierde
    if (!sh(`git rev-parse --verify origin/${rama}`, p)) {
      razones.push({ tipo: 'git', n: 1, largo: `${r}: la rama "${rama}" no está en el remoto` });
    }
  } else if (sinEmpujar) {
    razones.push({ tipo: 'git', n: sinEmpujar.split('\n').length,
      largo: `${r}: ${sinEmpujar.split('\n').length} commit(s) sin empujar en "${rama}"` });
  }
}
if (!razones.some((r) => r.tipo === 'git')) limpio.push('todo commiteado y empujado');

// ---------------------------------------------------------------- el veredicto
const estado = dudas.length ? 'NO SÉ' : (razones.length ? 'NO CERRAR' : 'CERRABLE');
const icono = { 'NO CERRAR': '🔴', 'NO SÉ': '🟡', CERRABLE: '🟢' }[estado];

if (BREVE) {
  // Una linea CORTA: esto se pega al final de cada mensaje, asi que lo de git se
  // agrega en un solo numero en vez de una entrada por repo.
  const partes = [];
  for (const r of razones.filter((x) => x.tipo !== 'git')) partes.push(r.breve);
  const git = razones.filter((x) => x.tipo === 'git').reduce((a, x) => a + x.n, 0);
  if (git) partes.push(`${git} cambio(s) sin empujar`);
  const motivo = partes.length ? partes.join(' · ')
    : (dudas.length ? dudas.join(' · ') : 'nada alquilado, nada corriendo, todo empujado');
  console.log(`${icono} **${estado}** — ${motivo}`);
} else {
  console.log(`\n${icono}  ${estado}\n`);
  if (razones.length) {
    console.log('Se perdería / seguiría costando:');
    for (const r of razones) console.log(`  · ${r.largo}`);
  }
  if (dudas.length) {
    console.log('\nNo se pudo comprobar (por eso NO digo que sea cerrable):');
    for (const d of dudas) console.log(`  ? ${d}`);
  }
  if (limpio.length) {
    console.log('\nEn orden:');
    for (const l of limpio) console.log(`  ok ${l}`);
  }
  if (estado === 'CERRABLE') {
    console.log('\nNada que perder: este server se puede destruir.');
  } else if (estado === 'NO CERRAR') {
    console.log('\nAntes de cerrar: recoge las máquinas y empuja lo que falte.');
    const L = 'python3 ' + lanzador + '/scripts/vast_instance.py';
    console.log(`  ${L} list`);
    const et = razones.find((r) => r.tipo === 'vast')?.etiquetas ?? [];
    for (const e of et.slice(0, 3)) console.log(`  ${L} destroy ${e} --yes`);
    if (et.length > 3) console.log(`  ...y ${et.length - 3} más`);
    console.log(`  ⚠ NO uses "destroy --all": con varios workspaces destruiría`);
    console.log(`    también las máquinas de otra sesión. Destruye por etiqueta.`);
  }
}
process.exit(EXIT0 ? 0 : (dudas.length ? 2 : (razones.length ? 1 : 0)));
