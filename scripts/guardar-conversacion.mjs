#!/usr/bin/env node
// Archiva las conversaciones de Claude Code en el repo de DATOS, redactadas.
//
//   node scripts/guardar-conversacion.mjs            todas las que falten
//   node scripts/guardar-conversacion.mjs --hook     desde SessionEnd (nunca falla)
//   node scripts/guardar-conversacion.mjs --seco     dice qué haría y no escribe
//   node scripts/guardar-conversacion.mjs --sin-git  guarda pero no commitea
//
// POR QUÉ EXISTE
// --------------
// Pedido por el dueño el 2026-08-31: «contar con data útil en caso de necesitarlo
// para depurar». Estas conversaciones son el único sitio donde queda el PORQUÉ de
// cada decisión con su contexto — los commits guardan el qué y la razón corta, no
// las tres alternativas que se descartaron ni el número que las descartó.
//
// Y este servidor es efímero: `~/.claude/projects/` se destruye con la máquina.
// Lo que no se empuja, no existe.
//
// ⚠⚠ LA PUERTA ES LA REDACCIÓN, Y NO ES OPCIONAL
// -----------------------------------------------
// El repo de datos es **PÚBLICO** (comprobado el 2026-08-31: la API de GitHub lo
// devuelve sin token). Y el CLAUDE.md de este repo dice que YA PASÓ UNA VEZ que
// un token acabara dentro de una conversación:
//
//     «Un mensaje a `c` pidiendo leer `.env` filtró el token una vez; si vuelve
//      a pasar, avisa al usuario para rotarlo.»
//
// Un transcript crudo en un repo público publica cualquier secreto que haya
// aparecido, y **git no olvida**: borrarlo después deja el objeto en el
// historial. Así que aquí se redacta SIEMPRE, por dos vías que se complementan:
//
//   1. por VALOR EXACTO — se leen los ficheros de secretos de esta máquina
//      (`.env`, `~/.config/dev-secrets.env`) y se sustituye cada valor donde
//      aparezca. Es infalible para los secretos que tenemos, que son los que de
//      verdad se pueden filtrar aquí.
//   2. por PATRÓN — formas conocidas (tokens de Telegram, `sk-ant-`, `ghp_`,
//      `dop_v1_`, claves privadas...). Cubre lo que no está en esos ficheros.
//
// ⚠ Y si tras redactar QUEDA algo que casa con un patrón de secreto, **no se
// guarda esa conversación** y se dice cuál y por qué. Guardar a medias en un
// repo público es peor que no guardar: no se puede deshacer.
//
// ⚠ La redacción es una red, no una garantía. Un secreto con una forma que nadie
// ha visto pasa. Por eso el README de la carpeta pide mirar el índice de vez en
// cuando, y por eso está escrito que si un día se filtra algo, se ROTA — no se
// borra del historial y se hace como que no pasó.

import { execFileSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { loQueSigueSiendoSecreto, redactar, valoresSecretos } from './redactar.mjs';

const HOOK = process.argv.includes('--hook');
const SECO = process.argv.includes('--seco');
const SIN_GIT = process.argv.includes('--sin-git');
const CASA = process.env.COORD_HOME || dirname(new URL('.', import.meta.url).pathname);

const MESES = ['01-enero', '02-febrero', '03-marzo', '04-abril', '05-mayo', '06-junio',
  '07-julio', '08-agosto', '09-septiembre', '10-octubre', '11-noviembre', '12-diciembre'];


/** Un resumen legible para el índice, sin volcar la conversación. */
function resumir(texto) {
  const lineas = texto.split('\n').filter(Boolean);
  let primero = null, mensajes = 0, desde = null, hasta = null;
  for (const l of lineas) {
    let d;
    try { d = JSON.parse(l); } catch { continue; }
    if (d.timestamp) { desde ??= d.timestamp; hasta = d.timestamp; }
    if (d.type !== 'user') continue;
    const c = d.message?.content;
    const t = typeof c === 'string' ? c
      : Array.isArray(c) ? (c.find((x) => x.type === 'text')?.text ?? '') : '';
    // los mensajes del sistema (hooks, recordatorios, resultados) no son del
    // usuario aunque viajen como `user`: no cuentan y no sirven de titular
    if (!t || t.startsWith('<') || t.includes('system-reminder')) continue;
    mensajes++;
    primero ??= t.replace(/\s+/g, ' ').slice(0, 90);
  }
  return { primero: primero ?? '(sin mensajes de usuario)', mensajes, desde, hasta };
}

function sh(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120000,
                                     stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return { error: (e.stderr || e.message || '').toString().trim() }; }
}

function repoDeDatos() {
  // La misma indirección que `fv.settings.data_root`: el repo hermano si está.
  const cand = join(dirname(CASA), 'foveal-vision-data');
  return existsSync(cand) ? cand : null;
}

function transcripts() {
  const raiz = join(homedir(), '.claude', 'projects');
  if (!existsSync(raiz)) return [];
  const out = [];
  for (const proy of readdirSync(raiz)) {
    const d = join(raiz, proy);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) {
      if (f.endsWith('.jsonl')) out.push({ proyecto: proy, ruta: join(d, f), sesion: f.slice(0, -6) });
    }
  }
  return out;
}

/**
 * Lo que YA está archivado, leído del DISCO — que es lo que el índice describe.
 *
 * ⚠ Antes el índice se construía sólo de los transcripts vivos de
 * `~/.claude/projects/`, y eso lo hacía mentir en silencio: un transcript que
 * desaparece —sesión borrada, `~/.claude` limpiado, o la máquina rehecha, que
 * aquí es lo NORMAL y es justo el motivo por el que este script existe— dejaba
 * su `.gz` en git **sin ninguna fila que lo nombrara**. El fichero seguía ahí y
 * era inencontrable desde el único sitio que lo lista. Medido el 2026-09-02:
 * 7 ficheros archivados, 4 filas.
 */
function archivadas(datos) {
  const raiz = join(datos, 'conversaciones');
  const out = [];
  for (const anio of readdirSync(raiz)) {
    const da = join(raiz, anio);
    if (!/^\d{4}$/.test(anio) || !statSync(da).isDirectory()) continue;
    for (const mes of readdirSync(da)) {
      const dm = join(da, mes);
      if (!statSync(dm).isDirectory()) continue;
      for (const f of readdirSync(dm)) {
        const m = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]{8})(?:-\d+)?\.jsonl\.gz$/.exec(f);
        if (!m) continue;
        out.push({ ruta: join(dm, f), rel: join(anio, mes, f),
                   fecha: m[1], sesion: m[2], bytes: statSync(join(dm, f)).size });
      }
    }
  }
  return out;
}


/**
 * Dónde va una conversación: UN fichero, fechado el día en que EMPEZÓ.
 *
 * ⚠ Antes la fecha era el **mtime** del transcript, y eso partía una misma
 * conversación en un fichero por cada día que durase — cada uno conteniendo
 * entero al anterior. Medido el 2026-09-02: 7 ficheros para 4 conversaciones.
 * La fecha de inicio es un hecho del CONTENIDO (su primer `timestamp`) y no
 * cambia nunca; el mtime cambia cada vez que se escribe.
 *
 * Sin ningún `timestamp` en el transcript no hay fecha de inicio que leer: se
 * cae al mtime —que es lo que se hacía siempre— y se DICE, porque ese fichero
 * sí puede duplicarse al día siguiente.
 */
function destinoDe(t, datos, desde) {
  const d = desde ? new Date(desde) : null;
  const m = d && !Number.isNaN(d.getTime()) ? d : statSync(t.ruta).mtime;
  const fecha = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}-${String(m.getUTCDate()).padStart(2, '0')}`;
  const dir = join(datos, 'conversaciones', String(m.getUTCFullYear()), MESES[m.getUTCMonth()]);
  return { dir, fichero: join(dir, `${fecha}-${t.sesion.slice(0, 8)}.jsonl.gz`), fecha,
           derivada: !(d && !Number.isNaN(d.getTime())) };
}

/** La primera línea, que trae el uuid del primer mensaje. Identifica la conversación. */
const primeraLinea = (txt) => txt.slice(0, txt.indexOf('\n') + 1 || txt.length);

/**
 * El fichero libre para esta conversación, y si hay que avisar de una colisión.
 *
 * ⚠ `(id, fecha de inicio)` NO es único, y por una razón de este proyecto: el id
 * se DERIVA de `<tema>#<época>` (`claude-marker.mjs`), así que al rehacer la
 * máquina se pierde el marker, el tema vuelve a la época 0 y **el mismo id puede
 * empezar otra conversación** — el mismo día, incluso. Sin esta comprobación la
 * segunda pisaría a la primera **en silencio**, que es justo lo que este archivo
 * existe para que no pase.
 *
 * La identidad se decide por la PRIMERA LÍNEA (idéntica sólo si es la misma
 * conversación), no por «es prefijo»: un cambio en las reglas de redacción
 * cambia el texto entero y daría una colisión falsa.
 */
function sitioLibre(fichero, texto) {
  if (!existsSync(fichero)) return { fichero, colision: false, ya: null };
  const ya = gunzipSync(readFileSync(fichero)).toString('utf8');
  if (primeraLinea(ya) === primeraLinea(texto)) return { fichero, colision: false, ya };
  for (let i = 2; i < 100; i++) {
    const alt = fichero.replace(/\.jsonl\.gz$/, `-${i}.jsonl.gz`);
    if (!existsSync(alt)) return { fichero: alt, colision: basename(fichero), ya: null };
    const otra = gunzipSync(readFileSync(alt)).toString('utf8');
    if (primeraLinea(otra) === primeraLinea(texto)) return { fichero: alt, colision: false, ya: otra };
  }
  return { fichero, colision: basename(fichero), ya };   // 99 colisiones: algo va muy mal
}

// ---------------------------------------------------------------------------

function main() {
  const datos = repoDeDatos();
  if (!datos) {
    console.error('no encuentro el repo de datos (foveal-vision-data): no guardo nada');
    return HOOK ? 0 : 1;
  }
  const { redactar: secretos, dudosos } = valoresSecretos();
  if (!secretos.length) {
    // No es fatal --los patrones siguen-- pero SÍ hay que decirlo: es la mitad
    // fuerte de la redacción, la que no depende de adivinar formas.
    console.error('⚠ no pude leer ningún fichero de secretos: sólo redacto por patrón');
  }

  // Una fila por FICHERO archivado, indexada por su ruta relativa.
  const filas = new Map();
  let guardadas = 0, saltadas = 0, rechazadas = 0, recuperadas = 0;

  for (const t of transcripts()) {
    const crudo = readFileSync(t.ruta, 'utf8');
    const { texto, n } = redactar(crudo, secretos);
    // Lo dudoso NO se redacta (su nombre no dice que sea credencial) pero se
    // NOMBRA si aparece: entre decidir en silencio y preguntar, se pregunta.
    for (const [valor, nombre] of dudosos) {
      if (texto.includes(valor)) {
        console.error(`  ⚠ ${nombre} (${valor.length} chars) aparece en ` +
          `${t.sesion.slice(0, 8)} y NO se redacta: su nombre no parece de ` +
          `credencial. Si lo es, renómbrala con TOKEN/KEY/SECRET en el nombre.`);
      }
    }
    const restos = loQueSigueSiendoSecreto(texto);
    if (restos.length) {
      // ⚠ NO se guarda. En un repo público, a medias es peor que nada.
      console.error(`⛔ ${t.sesion.slice(0, 8)}: sigue habiendo algo con forma de ` +
        `secreto tras redactar (${restos.join(', ')}). NO la guardo.`);
      console.error('   Míralo a mano; si es un secreto de verdad, RÓTALO — no basta ' +
        'con borrarlo, git no olvida.');
      rechazadas++;
      continue;
    }
    const gz = gzipSync(Buffer.from(texto, 'utf8'), { level: 9 });
    const r = resumir(texto);
    // El destino se decide DESPUÉS de resumir: la fecha sale del contenido.
    const d0 = destinoDe(t, datos, r.desde);
    const { fichero, colision, ya } = sitioLibre(d0.fichero, texto);
    const { dir, fecha, derivada } = d0;
    if (colision) {
      console.error(`  ⚠ ${basename(fichero)}: otra conversación distinta ya ocupaba ` +
        `${colision} (mismo id y misma fecha de inicio). Las dos se guardan.`);
    }
    if (derivada) {
      console.error(`  ⚠ ${t.sesion.slice(0, 8)}: sin ningún timestamp; la fecho por su ` +
        `mtime, así que puede duplicarse mañana.`);
    }
    // relativo AL README, que vive dentro de `conversaciones/`
    const rel = fichero.slice(join(datos, 'conversaciones').length + 1);
    filas.set(rel, { fecha, sesion: t.sesion.slice(0, 8), proyecto: t.proyecto,
                     kb: Math.round(gz.length / 1024), ...r, rel });

    // Si ya está y no ha cambiado, no se reescribe: una conversación en curso se
    // archiva muchas veces y cada versión sería un objeto de git para siempre.
    // ⚠ Se compara el TEXTO, no el tamaño del .gz. El tamaño era una heurística
    // con tolerancia de 64 bytes, y dos versiones distintas de una conversación
    // corta comprimen casi igual: la segunda no se guardaba. Aquí no cuesta
    // nada porque `sitioLibre` ya ha tenido que descomprimir para saber si es la
    // misma conversación.
    if (ya === texto) {
      saltadas++;
      continue;
    }
    console.log(`  ${fecha} ${t.sesion.slice(0, 8)}  ${String(Math.round(gz.length / 1024)).padStart(5)} KB` +
      `  ${n ? `${n} redactado(s)` : 'sin secretos'}  ${r.mensajes} mensajes`);
    guardadas++;
    if (SECO) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(fichero, gz);
  }

  // Segunda pasada: los ficheros archivados que NINGÚN transcript vivo explica.
  // Normalmente cuesta cero (todo lo de disco tiene su transcript); cuando cuesta
  // algo es justo el caso que antes se perdía, y entonces vale lo que sea.
  // ⚠ Si algún día duele, la caché va aquí y su clave es (rel, bytes) — la misma
  // regla que ya decide más arriba si un fichero se reescribe.
  // La pasada SÍ corre en seco: `--seco` dice qué haría, y cuántas filas se
  // recuperan es justo lo que hay que poder mirar antes de escribir nada.
  for (const a of archivadas(datos)) {
    if (filas.has(a.rel)) continue;
    const r = resumir(gunzipSync(readFileSync(a.ruta)).toString('utf8'));
    filas.set(a.rel, { fecha: a.fecha, sesion: a.sesion, proyecto: '(sin transcript)',
                       kb: Math.round(a.bytes / 1024), ...r, rel: a.rel });
    recuperadas++;
  }
  if (!SECO) escribirIndice(datos, [...filas.values()]);
  console.log(`\n${guardadas} ${SECO ? 'se guardaría(n)' : 'guardada(s)'}, ${saltadas} sin cambios` +
    (recuperadas ? `, ${recuperadas} ya archivada(s) sin transcript vivo` : '') +
    (rechazadas ? `, ⛔ ${rechazadas} RECHAZADA(S) por posible secreto` : ''));

  if (!SECO && !SIN_GIT && guardadas) empujar(datos);
  // ⚠ Un hook JAMÁS impide trabajar: pase lo que pase, sale con 0.
  return HOOK ? 0 : (rechazadas ? 2 : 0);
}

/**
 * Una fila por FICHERO, nunca por sesión — y el motivo es de este proyecto:
 * el id de una conversación del bot no es aleatorio, se DERIVA de `<tema>#<época>`
 * (`claude-marker.mjs`). Al rehacer la máquina se pierde el marker, el tema
 * vuelve a la época 0 y **el mismo id vuelve a salir** para una conversación
 * completamente distinta. Agrupar por id daría una sola fila y escondería una de
 * las dos.
 *
 * El precio: mientras una conversación sigue viva deja un fichero por día (el
 * nombre lleva el mtime del transcript), así que salen varias filas del mismo id
 * que son SNAPSHOTS de lo mismo — comprobado el 2026-09-02: el fichero del día
 * siguiente contiene al anterior como prefijo exacto. Se ven porque comparten
 * titular, y la cabecera del README lo explica.
 */
function escribirIndice(datos, filas) {
  filas.sort((a, b) => (a.fecha + a.sesion).localeCompare(b.fecha + b.sesion));
  const cab = readFileSync(join(datos, 'conversaciones', 'README.md'), 'utf8')
    .split('<!-- INDICE -->')[0];
  // La fecha de la fila es la de INICIO. `hasta` va aparte porque, desde que un
  // fichero es UNA conversación entera, la fecha del nombre ya no dice cuándo se
  // tocó por última vez — y eso es lo primero que se mira para depurar.
  const tabla = ['<!-- INDICE -->', '',
    '| empezó | sesión | última actividad | mensajes | tamaño | de qué fue |',
    '|---|---|---|---:|---:|---|',
    ...filas.map((f) => `| ${f.fecha} | [\`${f.sesion}\`](${f.rel}) | ` +
      `${(f.hasta ?? '').slice(0, 16).replace('T', ' ') || '—'} | ${f.mensajes} | ` +
      `${f.kb} KB | ${f.primero.replace(/\|/g, '\\|')} |`)].join('\n');
  writeFileSync(join(datos, 'conversaciones', 'README.md'), cab + tabla + '\n');
}

function empujar(datos) {
  // ⚠ SÓLO la carpeta de conversaciones. Un `git add -A` automático arrastraría
  // el trabajo a medias de quien esté editando el repo de datos en ese momento y
  // lo commitearía sin que nadie lo pidiera. Esto es lo único que este script
  // tiene permiso para tocar.
  const r1 = sh('git', ['add', 'conversaciones'], datos);
  if (r1?.error) return console.error(`  (git add falló: ${r1.error})`);
  const pend = sh('git', ['diff', '--cached', '--name-only'], datos);
  if (!pend || pend.error || !pend.length) return;
  const r2 = sh('git', ['commit', '-m', 'conversaciones: archivo automático'], datos);
  if (r2?.error) return console.error(`  (git commit falló: ${r2.error})`);
  const r3 = sh('git', ['push'], datos);
  if (r3?.error) {
    // No es fatal y no se reintenta aquí: el commit está hecho y el siguiente
    // archivado (o `cerrable.mjs`) lo verá como pendiente de empujar.
    console.error(`  (git push falló, queda commiteado: ${r3.error.split('\n')[0]})`);
  } else {
    console.log('  commiteado y empujado al repo de datos');
  }
}

try {
  process.exit(main());
} catch (e) {
  console.error(`guardar-conversacion: ${e.message}`);
  process.exit(HOOK ? 0 : 1);   // un hook nunca impide trabajar
}
