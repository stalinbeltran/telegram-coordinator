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
import { join, dirname, resolve, basename } from 'node:path';
import { dentroDe, workspacesLocales } from './workspaces-locales.mjs';
import { razonesGit, IGNORA_AL_MONTAR } from './git-pendiente.mjs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const COORD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// El workspace se DECLARA (`COORD_WS`, que pone el coordinador con el del tema)
// y sólo se deduce del disco como defecto. Es R4: deducirlo del layout era la
// causa de que todos los temas compartieran un árbol -- ver src/workspaces.ts.
const WS = process.env.COORD_WS ? resolve(process.env.COORD_WS) : dirname(COORD);

/**
 * El árbol de CASA: donde vive el coordinador que corre de verdad.
 *
 * ⚠ NO es `dirname(COORD)`. Este script se copia con el workspace, y desde que
 * un tema de Telegram re-enraíza sus comandos, `/use cerrable` ejecuta LA COPIA
 * de `~/ws/tema-N/telegram-coordinator/scripts/`. Deducir casa de dónde está el
 * fichero es el antipatrón de la R4, y aquí el precio fue el peor posible:
 * preguntando desde un tema con workspace, `~/src` NO ENTRABA en la lista, así
 * que el trabajo sin empujar de casa era invisible. Medido el 2026-08-28, mismo
 * instante y con un cambio real sin commitear en ~/src/telegram-coordinator:
 * desde `~/src` daba 🔴 y desde `~/ws/tema-2` daba 🟢 — permiso para destruir.
 *
 * Se DECLARA con `COORD_HOME`, que el coordinador pasa a todo comando y que NO
 * se re-enraíza (`src/orchestrator.ts`), y sólo se deduce del disco cuando este
 * script no está dentro de un workspace montado — que es el caso de la consola.
 * Si corre desde una copia y nadie le dijo dónde está casa, no se lo inventa:
 * lo dice, y eso cae en NO SÉ. Entre un fallo ruidoso y uno silencioso, el
 * ruidoso.
 */
const enCopia = existsSync(join(dirname(COORD), 'WORKSPACE.json'));
const CASA = process.env.COORD_HOME
  ? dirname(resolve(process.env.COORD_HOME))
  : (enCopia ? null : dirname(COORD));

// El árbol de casa cuenta SIEMPRE; el de este script y el del tema también, por
// si `/ws` apunta fuera de `~/ws`.
const LOCALES = workspacesLocales([CASA, dirname(COORD), WS]);
/** Cómo se nombra un árbol en el informe: sólo estorba si hay uno solo. */
const donde = (raiz) => (LOCALES.length > 1 ? ` [${LOCALES.find((l) => l.raiz === raiz)?.nombre ?? basename(raiz)}]` : '');
const BREVE = process.argv.includes('--breve');
// El codigo de salida de este script es INFORMACION (0/1/2), no un fallo. Pero
// el coordinador lee cualquier codigo != 0 como "el ejecutor fallo" y entonces
// NO corre los encargados, o sea que la respuesta no llega a Telegram. Por eso
// el ejecutor lo llama con --exit0: el veredicto va en el texto, que es donde el
// usuario lo lee. Fuera de Telegram el codigo sigue sirviendo para encadenar.
const EXIT0 = process.argv.includes('--exit0');
// ⚠ `foveal-vision-data` va en la lista, y es el que MAS importa aqui: es donde
// viven los runs, los recorridos y los `windows.npz` que NO se pueden re-derivar.
// Faltaba (esta lista es anterior a la separacion de datos del 2026-08-27) y el
// fallo era del peor tipo: silencioso y creible. Medido el 2026-08-28 -- con dos
// informes de `patience` sin empujar en ese repo, esto imprimia
// "todo commiteado y empujado" y el veredicto salia VERDE, o sea permiso para
// destruir la maquina. Es exactamente la perdida que costo el `r20260824` y la
// comparabilidad de 20 runs ya pagados.
//
// ⚠ Y `estudios-redes-neuronales` es el SEXTO desde el 2026-08-29: es el repo
// central, donde viven los reportes y `ESTADO.md`, o sea el veredicto de todo lo
// que ya se pagó. Va en la lista por lo mismo que `foveal-vision-data`: un
// reporte escrito y sin empujar se pierde con la máquina, y con él la única
// contabilidad de lo que costó cada barrido.
// Este bucle salta los repos que no están en disco, así que añadirlo no rompe
// ninguna máquina que no lo tenga.
const REPOS = ['foveal-vision', 'foveal-vision-data', 'telegram-coordinator',
               'digital-ocean-dropplet-auto-launching', 'image-text-sample-generator',
               'estudios-redes-neuronales'];
// Lo que, si está vivo, significa que hay trabajo en curso que se perdería.
//
// ⚠ Los `fv-*` entraron el 2026-08-30, y faltaban desde el principio. Un
// entrenamiento lanzado por consola —que es LA forma documentada de entrenar
// (`foveal-vision/docs/entrenar.md`)— no casaba con ninguno de los patrones de
// arriba, que son todos de la flota y del benchmark. Medido ese día: un
// `fv-train` llevaba 1 h 17 min vivo (PID 30928) y el freno decía «nada de
// trabajo corriendo en esta máquina» — el falso verde, otra vez, y esta vez
// sobre lo único que estaba corriendo.
//
// Es el mismo agujero que se tapó por el otro lado el 2026-08-29: aquello no
// tenía proceso propio (vive en un hilo de la web app), y esto lo tiene pero con
// un nombre que nadie había apuntado. La lección es la de siempre aquí: esta
// lista NO se deduce, se declara — así que **cada entrada nueva de
// `foveal-vision/pyproject.toml` que pueda tardar hay que añadirla aquí**.
//
// ⚠ `fv-api` y `web_app.py` NO están, y no es un olvido: son el SERVICIO, vivo
// por definición desde que la máquina arranca. Contarlos dejaría el veredicto en
// 🔴 permanente, que es el aviso que sale siempre y se deja de leer (patrón B).
// Lo que corre DENTRO de ese proceso se pregunta aparte, en el bloque 2 bis.
// Tampoco están `fv-resize` ni `fv-publish-source`: son cortos y rehacerlos
// cuesta segundos. `fv-extract` sí, porque lo que produce (`windows.npz`) está
// MEDIDO que no se re-deriva igual (R9).
// ⚠ `entrenar_vast.py` entró el 2026-08-31 y es el caso que más caro sale si falta:
// alquila UNA máquina de Vast y la destruye en un `finally` de ESE proceso. La
// máquina sí se veía por la API de Vast, pero el proceso que la recoge no se
// contaba — así que el veredicto podía decir «nada corriendo» con un
// entrenamiento de horas vivo, y apagar el server dejaba la instancia
// facturando sin nadie que la destruyera.
const TRABAJOS = /estudio_flota\.py|entrenar_vast\.py|vigilante_avance\.py|vigilante_prioridades\.py|bench_fleet\.py|bench_dataset\.py|bench_speed\.py|knob_min_size\.py|estudio_lote\.py|fv-train|fv-continue|fv-sweep|fv-oat|fv-study|fv-extract/;

const razones = [];   // por qué NO cerrar
const dudas = [];     // lo que no se pudo comprobar
if (CASA === null) {
  dudas.push(
    'corro desde una copia dentro de un workspace y nadie me pasó COORD_HOME: ' +
    'NO sé dónde está el árbol de casa del coordinador, así que no puedo mirar ' +
    'si le queda algo sin empujar');
}
const limpio = [];    // lo que sí está en orden

function sh(cmd, cwd, env) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 60000,
                           stdio: ['ignore', 'pipe', 'ignore'], env: env ?? process.env }).trim();
  } catch { return null; }
}

// ---------------------------------------------------------------- 1. lo que se paga
const prefijosLocales = LOCALES.map((l) => l.prefijo).filter(Boolean);
const sinIdentidad = LOCALES.filter((l) => !l.prefijo);

const lanzador = [WS, ...LOCALES.map((l) => l.raiz)]
  .map((r) => join(r, 'digital-ocean-dropplet-auto-launching'))
  .find(existsSync) ?? join(WS, 'digital-ocean-dropplet-auto-launching');
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
    // Mías = de CUALQUIER workspace de esta máquina. Sin ningún prefijo conocido
    // no se puede distinguir, así que cuentan todas: ante la duda, NO cerrable.
    const mias = prefijosLocales.length
      ? filas.filter((f) => prefijosLocales.some((p) => f.etiqueta.startsWith(p)))
      : filas;
    const ajenas = filas.length - mias.length;
    const gasto = (salida.match(/Gastando ahora:\s*([\d.,]+)\s*\$\/h/) ?? [])[1];
    if (mias.length) {
      razones.push({ tipo: 'vast', breve: `${mias.length} máquinas Vast${gasto ? ` (${gasto} $/h)` : ''}`,
        largo: `${mias.length} máquina(s) alquilada(s) en Vast${gasto ? ` (${gasto} $/h en total)` : ''}` +
               ` — si este server muere, siguen facturando y nadie las recoge`,
        etiquetas: mias.map((m) => m.etiqueta) });
    } else if (filas.length) {
      limpio.push(`Vast: nada de esta máquina (${ajenas} instancia(s) de otro server, no cuentan)`);
    }
    if (sinIdentidad.length && filas.length) {
      dudas.push(
        `sin \`prefijo\` en WORKSPACE.json de ${sinIdentidad.map((l) => l.nombre).join(', ')} ` +
        `no puedo distinguir esas máquinas de las de otro server`);
    }
  }
}

// ---------------------------------------------------------------- 2. trabajo en curso
// De quién es un proceso lo dice su CWD, no su línea de comando: la flota se
// lanza con ruta relativa (medido 2026-08-27).
// Yo no soy el trabajo, ni tampoco quien me lanzó. Un shell cuya línea MENCIONA
// el nombre de un trabajo casa igual que el trabajo: preguntar por él desde la
// consola (`pgrep -af fv-train`, o cualquier comando que lo nombre) sumaba un
// trabajo inventado, y el veredicto pasaba de «1 vivo» a «2 vivos» sin que nada
// hubiera cambiado en la máquina. Visto el 2026-08-30 mientras se depuraba esto
// mismo. Un número que baila se deja de creer, y este número es el freno.
//
// Se excluyen por PARENTESCO y no por una lista de palabras (`grep`, `pgrep`,
// `ps`...): esa lista habría que ir ampliándola cada vez que alguien invente una
// forma nueva de nombrar un trabajo, y el trabajo de verdad NUNCA puede ser
// antepasado de quien pregunta — el freno se lanza desde Telegram o desde una
// consola, jamás desde dentro de un entrenamiento.
const YO = new Set();
for (let pid = process.pid, i = 0; pid > 1 && i < 40; i++) {
  YO.add(String(pid));
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch { break; }
}
const vivos = (sh('ps -eo pid,args') ?? '').split('\n').slice(1)
  .filter((l) => TRABAJOS.test(l) && !/\bgrep\b/.test(l))
  .filter((l) => !YO.has(l.trim().split(/\s+/)[0]))
  .map((l) => {
    const pid = l.trim().split(/\s+/)[0];
    let cwd = null;
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* murió o no es Linux */ }
    const m = l.match(TRABAJOS);
    return { pid, cwd, que: m ? m[0] : '?' };
  })
  .filter((v) => v.cwd && LOCALES.some((l) => dentroDe(v.cwd, l.raiz)));
if (vivos.length) {
  // Se cuentan TRABAJOS, no procesos. Un mismo trabajo aparece varias veces en
  // `ps`: `desacoplar.sh` lo envuelve en `sudo … systemd-run … sh -c '…'` y cada
  // envoltorio lleva la línea entera del hijo, así que casa igual. Contando
  // procesos, un solo entrenamiento salía como «3 proceso(s) vivo(s)» (medido el
  // 2026-08-30) — y un número que no cuadra con lo que hay se deja de creer.
  //
  // ⚠ Se AGRUPA, no se descartan los envoltorios: entre que arranca el `sh -c` y
  // que existe su hijo hay un hueco en el que el envoltorio es lo único que hay,
  // y descartarlo diría «no corre nada» justo cuando acaba de empezar. El que no
  // deja leer su `/proc/<pid>/cwd` ya se cayó antes, en el filtro de arriba.
  const trabajos = [...new Set(vivos.map((v) => `${v.que}\t${v.cwd}`))];
  const porQue = [...new Set(vivos.map((v) => v.que))].join(', ');
  const arboles = [...new Set(vivos.map((v) => donde(LOCALES.find((l) => dentroDe(v.cwd, l.raiz))?.raiz)))]
    .filter(Boolean).join('');
  // ⚠ La línea BREVE también dice QUÉ corre, y eso no es adorno: es la que se pega
  // al final de cada mensaje y la única que se lee desde el móvil. Decía sólo
  // «1 trabajo(s) vivo(s)», así que el dueño leía un 🔴 sin poder saber de qué —
  // y con la cuenta de Vast vacía, la conclusión razonable era «esto está roto».
  // Pasó el 2026-08-30. Un freno que no se puede contrastar se acaba ignorando,
  // que es exactamente lo que no puede pasarle a un freno.
  razones.push({ tipo: 'proc', breve: `${trabajos.length} trabajo(s) vivo(s): ${porQue}`,
    largo: `${trabajos.length} trabajo(s) vivo(s) (${porQue})${arboles} — morirían con el server` });
} else {
  limpio.push('nada de trabajo corriendo en esta máquina');
}

// ------------------------------------------- 2 bis. lo que corre DENTRO de la web app
// Desde que la web app de `foveal-vision` corre como servicio (2026-08-29), un
// entrenamiento, un recorrido o un estudio se lanzan desde el navegador — y ese
// trabajo vive en un HILO del proceso `fv.api` (`JobQueue`, max_workers=1), no
// en un proceso propio. O sea que la lista de arriba NO PUEDE verlo: casa líneas
// de comando, y aquí no hay ninguna que casar. Un barrido lanzado desde el móvil
// se perdería con el veredicto en 🟢, que es el fallo caro de este script.
//
// Se le pregunta a ella, que es la única que lo sabe: `/api/jobs` desde
// 127.0.0.1, que la puerta deja pasar sin token a propósito (`fv/api/web.py`).
const WEB_PORT = Number(process.env.FV_WEB_PORT ?? 8010);
const jobsWeb = (() => {
  // Dos rutas porque hay dos formas de servirla: con el front (`--web`: el API
  // cuelga de `/api`) y sin él (el API en la raíz, que es como se levanta a mano
  // para probar). Preguntar sólo por una daba «no sé» con la otra delante.
  for (const ruta of ['/api/jobs', '/jobs']) {
    const cruda = sh(`curl -s -m 3 http://127.0.0.1:${WEB_PORT}${ruta}`);
    if (cruda === null) return null;      // nadie escucha (o no hay curl)
    try {
      const j = JSON.parse(cruda);
      if (Array.isArray(j.jobs)) return j.jobs;
    } catch { /* no es JSON: puede ser el index.html del front, sigue probando */ }
  }
  return 'desconocido';
})();
if (jobsWeb === null) {
  // Nadie contesta. Eso sólo es raro —y por tanto una duda— si el servicio dice
  // estar vivo: si no está instalado, no hay web app y no hay nada que perder.
  // El nombre del servicio se puede fijar por entorno para que esta rama tenga
  // test: sin eso, «está activo pero no contesta» sólo se ejercita en una
  // máquina que ya lo tenga instalado, o sea nunca (R17).
  const unidad = process.env.FV_WEB_UNIT ?? 'foveal-vision-web';
  if (sh(`systemctl is-active --quiet ${unidad}`) !== null) {
    dudas.push(`el servicio \`foveal-vision-web\` está activo pero no contesta en :${WEB_PORT}: ` +
      'NO sé si tiene un entrenamiento dentro');
  }
} else if (jobsWeb === 'desconocido') {
  dudas.push(`algo escucha en :${WEB_PORT} y no contesta como la web app: ` +
    'NO sé si tiene trabajo dentro');
} else {
  const activos = jobsWeb.filter((j) => j.status === 'running' || j.status === 'queued');
  if (activos.length) {
    const kinds = [...new Set(activos.map((j) => j.kind).filter(Boolean))].join(', ');
    razones.push({ tipo: 'web', breve: `${activos.length} trabajo(s) en la web app`,
      largo: `${activos.length} trabajo(s) corriendo DENTRO de la web app` +
             `${kinds ? ` (${kinds})` : ''} — viven en el proceso, así que mueren con ` +
             'el server y no dejan ni un proceso que delate la pérdida' });
  } else {
    limpio.push('web app: sin trabajo dentro');
  }
}

// ---------------------------------------------------------------- 3. lo no empujado
for (const { raiz, montado } of LOCALES) {
  for (const r of REPOS) {
    const p = join(raiz, r);
    if (!existsSync(p)) continue;
    const eti = `${r}${donde(raiz)}`;
    // ⚠ `--nuevo` reescribe el `data/fuentes.json` de la COPIA para apuntarla a
    // sí misma, así que en un workspace ese fichero sale modificado sin que
    // nadie haya trabajado. En el árbol del coordinador NO se ignora: ahí un
    // cambio en fuentes.json sí es un cambio.
    //
    // ⚠⚠ La condición es «este árbol es un workspace MONTADO» (tiene
    // WORKSPACE.json), y NO «este árbol no es desde donde pregunto», que es lo
    // que decía antes (`raiz !== dirname(COORD)`). Las dos coinciden sólo si
    // preguntas desde `~/src` — y desde que un tema de Telegram re-enraíza sus
    // comandos, `cerrable` corre DENTRO del workspace del tema en cada `/use
    // cerrable`. Ahí la vieja se daba la vuelta entera y el veredicto pasaba a
    // depender de DÓNDE preguntas, que es lo que un freno no puede hacer.
    // Medido el 2026-08-28, mismo instante y misma máquina:
    //   · desde ~/src        → 🔴 (bien)   · desde ~/ws/tema-2 → 🟢 (¡permiso!)
    //     con un cambio real sin commitear en ~/src/telegram-coordinator
    //   · y al revés, el `fuentes.json` del propio montaje daba 🔴 desde dentro.
    // El falso 🟢 es el caro: se lee como permiso para destruir la máquina.
    const ignorar = r === 'telegram-coordinator' && montado ? IGNORA_AL_MONTAR : [];
    const { duda, razones: rs } = razonesGit(p, { ignorar });
    if (duda) { dudas.push(`no pude leer el git de ${eti}`); continue; }
    for (const x of rs) razones.push({ tipo: 'git', n: x.n, largo: `${eti}: ${x.texto}` });
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
  // Lo de git sí se agrega en un número: son hasta seis repos y la línea tiene que
  // caber. Pero si el pendiente está en UN solo repo, se nombra — que es el caso
  // normal, y saber dónde mirar cuesta lo mismo que no saberlo.
  const gits = razones.filter((x) => x.tipo === 'git');
  const git = gits.reduce((a, x) => a + x.n, 0);
  const repos = [...new Set(gits.map((x) => x.largo.split(':')[0]))];
  if (git) partes.push(`${git} cambio(s) sin empujar${repos.length === 1 ? ` en ${repos[0]}` : ''}`);
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
