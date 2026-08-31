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
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOOK = process.argv.includes('--hook');
const SECO = process.argv.includes('--seco');
const SIN_GIT = process.argv.includes('--sin-git');
const CASA = process.env.COORD_HOME || dirname(new URL('.', import.meta.url).pathname);

const MESES = ['01-enero', '02-febrero', '03-marzo', '04-abril', '05-mayo', '06-junio',
  '07-julio', '08-agosto', '09-septiembre', '10-octubre', '11-noviembre', '12-diciembre'];

// Formas de secreto conocidas. Se usan para redactar Y como REJILLA FINAL: si
// después de redactar sigue casando alguna, la conversación no se guarda.
const PATRONES = [
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, 'TOKEN-TELEGRAM'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'CLAVE-ANTHROPIC'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/g, 'TOKEN-GITHUB'],
  [/dop_v1_[a-f0-9]{64}/g, 'TOKEN-DIGITALOCEAN'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'CLAVE-PRIVADA'],
  [/AKIA[0-9A-Z]{16}/g, 'CLAVE-AWS'],
];

function ficherosDeSecretos() {
  return [join(CASA, '.env'), join(homedir(), '.config', 'dev-secrets.env')];
}

// Qué NOMBRE de variable contiene una credencial. Es la convención de siempre, y
// hace falta porque la longitud NO basta: medido el 2026-08-31, filtrar sólo por
// «>= 12 caracteres» redactaba `CLAUDE_PERMISSION_MODE` (= `bypassPermissions`),
// que es CONFIGURACIÓN y aparece 18 veces en una conversación normal. Redactarlo
// destroza texto útil justo en el archivo que existe para poder leerlo después.
const NOMBRE_ES_SECRETO = /TOKEN|KEY|SECRET|PASS|PWD|CLAVE|CREDENTIAL|AUTH/;

// Longitud mínima para redactar por valor. Un valor corto aparece en cualquier
// texto por casualidad; una credencial real nunca es corta.
const MIN_VALOR = 12;

// Por encima de esto, un valor que NO se redacta se AVISA aunque su nombre no
// parezca de secreto: decidir en silencio en cualquiera de los dos sentidos es
// el fallo, así que lo dudoso lo mira una persona.
const AVISAR_DESDE = 20;

/** Los VALORES a redactar, con su nombre. No se imprimen nunca, sólo se buscan. */
function valoresSecretos() {
  const redactar = [], dudosos = [];
  for (const f of ficherosDeSecretos()) {
    if (!existsSync(f)) continue;
    for (const linea of readFileSync(f, 'utf8').split('\n')) {
      const m = linea.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, '');
      if (valor.length < MIN_VALOR) continue;
      if (NOMBRE_ES_SECRETO.test(m[1])) redactar.push([valor, m[1]]);
      else if (valor.length >= AVISAR_DESDE) dudosos.push([valor, m[1]]);
    }
  }
  return { redactar, dudosos };
}

function redactar(texto, secretos) {
  let n = 0;
  for (const [valor, nombre] of secretos) {
    if (!texto.includes(valor)) continue;
    // JSON escapa, así que se busca también la forma escapada del valor
    texto = texto.split(valor).join(`«REDACTADO:${nombre}»`);
    n++;
  }
  for (const [re, etiqueta] of PATRONES) {
    texto = texto.replace(re, () => { n++; return `«REDACTADO:${etiqueta}»`; });
  }
  return { texto, n };
}

/** Lo que queda casando un patrón DESPUÉS de redactar. Vacío = se puede guardar. */
function loQueSigueSiendoSecreto(texto) {
  const restos = [];
  for (const [re, etiqueta] of PATRONES) {
    const m = texto.match(re);
    if (m) restos.push(`${etiqueta} (${m.length})`);
  }
  return restos;
}

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

function destinoDe(t, datos) {
  const m = statSync(t.ruta).mtime;
  const fecha = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}-${String(m.getUTCDate()).padStart(2, '0')}`;
  const dir = join(datos, 'conversaciones', String(m.getUTCFullYear()), MESES[m.getUTCMonth()]);
  return { dir, fichero: join(dir, `${fecha}-${t.sesion.slice(0, 8)}.jsonl.gz`), fecha };
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

  const filas = [];
  let guardadas = 0, saltadas = 0, rechazadas = 0;

  for (const t of transcripts()) {
    const { dir, fichero, fecha } = destinoDe(t, datos);
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
    filas.push({ fecha, sesion: t.sesion.slice(0, 8), proyecto: t.proyecto,
                 kb: Math.round(gz.length / 1024), ...r,
                 // relativo AL README, que vive dentro de `conversaciones/`
                 rel: fichero.slice(join(datos, 'conversaciones').length + 1) });

    // Si ya está y no ha cambiado de tamaño, no se reescribe: una conversación
    // en curso se archiva muchas veces y cada versión sería un objeto de git.
    if (existsSync(fichero) && Math.abs(statSync(fichero).size - gz.length) < 64) {
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

  if (!SECO && filas.length) escribirIndice(datos, filas);
  console.log(`\n${guardadas} ${SECO ? 'se guardaría(n)' : 'guardada(s)'}, ${saltadas} sin cambios` +
    (rechazadas ? `, ⛔ ${rechazadas} RECHAZADA(S) por posible secreto` : ''));

  if (!SECO && !SIN_GIT && guardadas) empujar(datos);
  // ⚠ Un hook JAMÁS impide trabajar: pase lo que pase, sale con 0.
  return HOOK ? 0 : (rechazadas ? 2 : 0);
}

function escribirIndice(datos, filas) {
  filas.sort((a, b) => (a.fecha + a.sesion).localeCompare(b.fecha + b.sesion));
  const cab = readFileSync(join(datos, 'conversaciones', 'README.md'), 'utf8')
    .split('<!-- INDICE -->')[0];
  const tabla = ['<!-- INDICE -->', '',
    '| fecha | sesión | mensajes | tamaño | de qué fue |', '|---|---|---:|---:|---|',
    ...filas.map((f) => `| ${f.fecha} | [\`${f.sesion}\`](${f.rel}) | ${f.mensajes} | ` +
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
