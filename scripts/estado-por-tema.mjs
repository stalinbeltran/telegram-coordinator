#!/usr/bin/env node
// El ESTADO POR TEMA viaja al almacén y vuelve al nacer el dev.
//
//   node scripts/estado-por-tema.mjs --foto      [--seco] [--sin-git]  lo de esta máquina → repo de datos
//   node scripts/estado-por-tema.mjs --restaurar [--seco]              lo del almacén → data/ de esta máquina
//   node scripts/estado-por-tema.mjs --estado                          qué hay aquí y qué hay allí
//
// POR QUÉ EXISTE. Pedido por el dueño el 2026-10-07 («quiero poder revisar la conversación en
// claude web» después de destruir el dev). La web de lectura (claude-code-webapp-mobile) no lee
// las conversaciones de claude: lee data/mensajes/<tema>.jsonl, el log que escribe mensajes.mjs,
// y ese log moría con la máquina. Los transcripts de claude ya viajaban redactados al almacén
// (guardar-conversacion.mjs); esto hace lo mismo con lo que la web enseña. El análisis entero,
// con lo medido, en docs/conversaciones-sobreviven-al-dev-2026-10-06.md.
//
// QUÉ VIAJA Y QUÉ NO es una LISTA DECLARADA (R14); un test falla si aparece en .gitignore una
// carpeta de data/ sin clasificar:
//   viajan     mensajes/ (el historial de la web) y claude-profile/ (el #modelo por tema).
//   no viajan  sessions/ (el bot lo lee al ARRANCAR, src/sessions.ts: restaurarlo después haría
//              que la web enseñara un ejecutor ligado que el bot no tiene); ws/ (workspaces.ts
//              carga el MODO aunque ~/ws/tema-N no exista y un tema decidido no se vuelve a
//              decidir: trabajaría en ~/src junto al principal sin avisar); shell-cwd/ (el cd
//              puede no existir aquí); claude-sessions/ (la memoria de claude: sería A+, que el
//              dueño no pidió); buffer/ y repeticiones/ (texto SIN redactar); entrada/ (lo que la
//              web deja para que el coordinador lo atienda).
//
// LAS SEIS DECISIONES QUE HAY QUE RESPETAR SI SE TOCA, y las seis tienen test:
//  1. La foto pasa la REJILLA del archivador línea a línea. mensajes.mjs redacta al escribir,
//     pero más flojo: sin rejilla final, y si redactar() lanza escribe el texto crudo. Una línea
//     que siga casando un patrón se sustituye por un marcador visible; nunca viaja.
//  2. Cada máquina escribe en SU carpeta, nombrada por el id del droplet (R16: un dato
//     comprobable, el mismo que usa cerrable.mjs), nunca por el hostname `dev`, que se repite en
//     cada vida. Así dos máquinas vivas (staging) nunca escriben el mismo fichero.
//  3. La restauración se NIEGA antes de escribir nada (R2) si origin es GitHub o el fetch falla,
//     y lee origin/main con `git show`, sin depender del árbol de trabajo: funciona aunque el
//     clon esté divergido, que es como nació este dev el 2026-10-07.
//  4. Fusiona por `id` y NUNCA quita una línea local. A lo que trae le aplica la ventana de la
//     purga (DIAS), y si el total pasa de TOPE_MENSAJES quita lo RESTAURADO más viejo.
//  5. Deja una LÍNEA FRONTERA de `sistema` entre lo viejo y lo nuevo: la web enseñaría una
//     conversación que claude ya no tiene, y eso es «peor que no enseñar nada»
//     (docs/log-de-mensajes.md). Su id es determinista, así que repetir la restauración no la
//     duplica: correrla otra vez sólo añade lo que falte.
//  6. Escribe como la purga: temporal, comprobar que el original no creció, rename. El bot puede
//     estar escribiendo en ese mismo instante.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync,
  writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loQueSigueSiendoSecreto, redactar, valoresSecretos } from './redactar.mjs';
import { DIAS, TOPE_MENSAJES, componerId, msDeId, raizDatos } from './mensajes.mjs';

const CASA = process.env.COORD_HOME || resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Las carpetas de data/ que viajan, y las que no. Lo que no esté en ninguna lista es un error. */
export const VIAJAN = ['mensajes', 'claude-profile'];
export const NO_VIAJAN = ['sessions', 'ws', 'shell-cwd', 'claude-sessions', 'buffer', 'repeticiones', 'entrada'];
/** La carpeta del repo de datos donde vive todo esto. */
export const CARPETA = 'coordinador';

/** El repo de datos: se DECLARA con COORD_DATOS (R4); el defecto es el repo hermano. */
export function repoDeDatos() {
  const r = process.env.COORD_DATOS || join(dirname(CASA), 'foveal-vision-data');
  return existsSync(join(r, '.git')) ? r : null;
}

/**
 * Quién soy, como DATO (R16): el id del droplet, o el machine-id. Nunca el hostname.
 * `COORD_MAQUINA_ID` lo fija en los tests. Sin ninguno de los tres, no hay foto: una
 * carpeta inventada acabaría compartida por dos máquinas, que es lo que hay que evitar.
 */
export function maquinaId() {
  if (process.env.COORD_MAQUINA_ID) return process.env.COORD_MAQUINA_ID;
  const r = spawnSync('curl', ['-s', '-m', '2', 'http://169.254.169.254/metadata/v1/id'], { encoding: 'utf8' });
  const id = (r.stdout ?? '').trim();
  if (r.status === 0 && /^\d+$/.test(id)) return `do-${id}`;
  try {
    const m = readFileSync('/etc/machine-id', 'utf8').trim();
    if (m) return `mid-${m.slice(0, 12)}`;
  } catch { /* sin machine-id */ }
  return null;
}

function git(datos, args, { timeout = 60_000 } = {}) {
  const r = spawnSync('git', ['-C', datos, ...args],
    { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const nombreTema = (tema) => {
  const i = tema.lastIndexOf('_');
  const hilo = i < 0 ? '' : tema.slice(i + 1);
  return hilo === 'main' ? 'Tema principal' : hilo ? `Tema ${hilo}` : tema;
};

// ------------------------------------------------------------------ la FOTO

const README = `# El estado por tema del coordinador, máquina a máquina

Lo escribe \`telegram-coordinator/scripts/estado-por-tema.mjs --foto\` en cada turno de \`c\`
(por el hook del archivador de conversaciones) y antes de destruir el dev (\`pre_destroy\`).
Lo lee \`--restaurar\` en el \`post\` de cada dev nuevo (\`types/dev.json\` del lanzador):
fusiona por \`id\`, nunca pisa lo local, y deja una línea frontera por tema.

    coordinador/<máquina>/mensajes/<tema>.jsonl      el historial que enseña la web de lectura (REDACTADO y pasado por la rejilla)
    coordinador/<máquina>/claude-profile/<x>.json    el #modelo por tema
    coordinador/<máquina>/meta.json                  quién y cuándo escribió la foto

\`<máquina>\` es el id del droplet (\`do-<id>\`), nunca el hostname: \`dev\` se repite en cada vida,
y dos máquinas vivas (staging) no pueden escribir el mismo fichero. El formato de cada línea es
el del log de mensajes: \`telegram-coordinator/docs/log-de-mensajes.md\`.
`;

/** Redacta otra vez y pasa la rejilla LÍNEA A LÍNEA. Devuelve el texto listo para viajar. */
export function limpiarLog(crudo, secretos) {
  const salida = [];
  let retenidas = 0, rotas = 0;
  for (const l of crudo.split('\n')) {
    if (!l.trim()) continue;
    let o;
    try { o = JSON.parse(l); } catch { rotas++; continue; }
    if (!o || typeof o !== 'object' || !o.id) { rotas++; continue; }
    o.texto = redactar(String(o.texto ?? ''), secretos).texto;
    const restos = loQueSigueSiendoSecreto(JSON.stringify(o));
    if (restos.length) {
      retenidas++;
      o.texto = `«LÍNEA RETENIDA al fotografiar: contenía algo con forma de secreto (${restos.join(', ')})»`;
    }
    salida.push(JSON.stringify(o));
  }
  return { texto: salida.length ? salida.join('\n') + '\n' : '', retenidas, rotas };
}

function escribirSiCambia(ruta, texto, seco) {
  if (existsSync(ruta) && readFileSync(ruta, 'utf8') === texto) return false;
  if (!seco) {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, texto, 'utf8');
  }
  return true;
}

/**
 * Copia el estado por tema de ESTA máquina a `<datos>/coordinador/<máquina>/`.
 * No commitea ni empuja: eso es `empujar()`. Nunca lanza por un fichero: lo cuenta.
 */
export function foto({ datos, seco = false, log = console.error } = {}) {
  const res = { cambiados: 0, ficheros: [], retenidas: 0, rotas: 0, maquina: null, motivo: null };
  if (!datos) { res.motivo = 'no encuentro el repo de datos (COORD_DATOS, o ../foveal-vision-data)'; return res; }
  const id = maquinaId();
  if (!id) {
    res.motivo = 'no sé qué máquina soy (sin COORD_MAQUINA_ID, sin metadatos de DO, sin /etc/machine-id): no hago la foto';
    return res;
  }
  res.maquina = id;
  let secretos = [];
  try { secretos = valoresSecretos().redactar; } catch { log('  ⚠ no pude leer los ficheros de secretos: la foto redacta sólo por patrón'); }
  const dataDir = raizDatos();
  const destino = join(datos, CARPETA, id);

  const dirM = join(dataDir, 'mensajes');
  if (existsSync(dirM)) {
    for (const f of readdirSync(dirM).filter((n) => n.endsWith('.jsonl')).sort()) {
      const { texto, retenidas, rotas } = limpiarLog(readFileSync(join(dirM, f), 'utf8'), secretos);
      res.retenidas += retenidas; res.rotas += rotas;
      if (!texto) continue;
      if (escribirSiCambia(join(destino, 'mensajes', f), texto, seco)) {
        res.cambiados++; res.ficheros.push(`${CARPETA}/${id}/mensajes/${f}`);
      }
    }
  }
  const dirP = join(dataDir, 'claude-profile');
  if (existsSync(dirP)) {
    for (const f of readdirSync(dirP).filter((n) => n.endsWith('.json')).sort()) {
      const txt = readFileSync(join(dirP, f), 'utf8');
      // Un perfil es {model, effort}; si trae algo con forma de secreto, no viaja y se dice.
      if (loQueSigueSiendoSecreto(txt).length) { res.retenidas++; continue; }
      if (escribirSiCambia(join(destino, 'claude-profile', f), txt, seco)) {
        res.cambiados++; res.ficheros.push(`${CARPETA}/${id}/claude-profile/${f}`);
      }
    }
  }
  if (res.cambiados) {
    // Sólo cuando cambió algo más: si no, el reloj de meta.json haría «cambiar» cada foto.
    const meta = { maquina: id, hostname: hostname(), escrita: new Date().toISOString(),
      viajan: VIAJAN, no_viajan: NO_VIAJAN };
    escribirSiCambia(join(destino, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', seco);
    escribirSiCambia(join(datos, CARPETA, 'README.md'), README, seco);
  }
  return res;
}

/**
 * Commit y push de SÓLO esas rutas del repo de datos. Lo comparten el archivador y la foto.
 *
 * Si el push es rechazado porque otra máquina empujó antes, se rebasa UNA vez sobre el
 * upstream y se reintenta. ⚠ Sólo si comparten historia: sin base común (el clon de GitHub
 * del 2026-10-07) rebasar replayaría cientos de commits sobre el almacén, así que ahí se
 * dice y se para: lo arregla `do_droplet.py almacen conectar`.
 */
export function empujar(datos, rutas, mensaje, log = console.error) {
  const existentes = rutas.filter((r) => existsSync(join(datos, r)));
  if (!existentes.length) return { hecho: false, motivo: 'nada que añadir' };
  let r = git(datos, ['add', '--', ...existentes]);
  if (!r.ok) { log(`  (git add falló: ${r.err})`); return { hecho: false, motivo: r.err }; }
  r = git(datos, ['diff', '--cached', '--name-only']);
  if (!r.ok || !r.out) return { hecho: false, motivo: 'sin cambios' };
  r = git(datos, ['commit', '-q', '-m', mensaje]);
  if (!r.ok) { log(`  (git commit falló: ${r.err})`); return { hecho: false, motivo: r.err }; }
  r = git(datos, ['push', '-q'], { timeout: 120_000 });
  if (r.ok) { log('  commiteado y empujado al repo de datos'); return { hecho: true }; }
  if (!/non-fast-forward|fetch first|rejected/i.test(r.err)) {
    log(`  (git push falló, queda commiteado: ${r.err.split('\n')[0]})`);
    return { hecho: false, motivo: r.err };
  }
  const upstream = git(datos, ['rev-parse', '--abbrev-ref', '@{u}']).out || 'origin/main';
  if (!git(datos, ['merge-base', 'HEAD', upstream]).ok) {
    log(`  (git push rechazado y el clon NO comparte historia con ${upstream}: queda commiteado. `
      + 'Lo arregla: python3 ~/src/digital-ocean-dropplet-auto-launching/scripts/do_droplet.py almacen conectar)');
    return { hecho: false, motivo: 'sin base común' };
  }
  const reb = git(datos, ['pull', '--rebase', '--autostash', '-q'], { timeout: 120_000 });
  if (!reb.ok) {
    git(datos, ['rebase', '--abort']);
    log(`  (otro empujó antes y el rebase falló, queda commiteado: ${reb.err.split('\n')[0]})`);
    return { hecho: false, motivo: reb.err };
  }
  r = git(datos, ['push', '-q'], { timeout: 120_000 });
  if (r.ok) { log('  commiteado y empujado al repo de datos (rebasado sobre lo que otra máquina empujó)'); return { hecho: true }; }
  log(`  (git push falló tras rebasar, queda commiteado: ${r.err.split('\n')[0]})`);
  return { hecho: false, motivo: r.err };
}

// ------------------------------------------------------------ la RESTAURACIÓN

const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** El log local, línea a línea, SIN tocar los bytes de lo que ya está. */
function leerLogLocal(ruta) {
  if (!existsSync(ruta)) return { lineas: [], rotas: [], bytes: 0 };
  const crudo = readFileSync(ruta, 'utf8');
  const lineas = [], rotas = [];
  for (const l of crudo.split('\n')) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      if (o?.id) lineas.push({ id: String(o.id), raw: l }); else rotas.push(l);
    } catch { rotas.push(l); }
  }
  return { lineas, rotas, bytes: Buffer.byteLength(crudo, 'utf8') };
}

/** La línea frontera de un tema: id DETERMINISTA (1 ms después de lo último restaurado). */
export function lineaFrontera(tema, ultimaRestaurada, maquina, ahora = Date.now()) {
  const ms = msDeId(ultimaRestaurada.id) + 1;
  const azar = createHash('sha1').update(`frontera:${maquina}:${tema}`).digest('hex').slice(0, 6);
  const fecha = new Date(ahora).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return {
    id: componerId(ms, 0, azar),
    ts: new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z'),
    sesion: tema, autor: 'sistema', origen: 'restaurar',
    texto: `⟂ Máquina rehecha (${fecha}, ${maquina}). Lo de arriba se restauró del almacén: es el `
      + 'historial del dev anterior y claude NO lo recuerda; su conversación aquí empieza en blanco. '
      + 'Para seguir hablando con claude: /use c',
  };
}

/** Escribe como la purga: temporal, comprobar que el original no creció, rename. */
export function escribirConCuidado(ruta, texto, bytesAntes) {
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = `${ruta}.restaurando`;
  writeFileSync(tmp, texto, 'utf8');
  const ahora = existsSync(ruta) ? statSync(ruta).size : 0;
  if (ahora !== bytesAntes) { unlinkSync(tmp); return false; }
  renameSync(tmp, ruta);
  return true;
}

/**
 * Lo que el almacén tiene de un tema (todas las máquinas), fusionado con lo local.
 * @returns {{anadidas: number, desde?: string, hasta?: string, texto?: string, bytesAntes: number}}
 */
export function fusionarTema(tema, delAlmacen, ruta, { maquina, ahora = Date.now() }) {
  const { lineas, rotas, bytes } = leerLogLocal(ruta);
  const idsLocales = new Set(lineas.map((x) => x.id));
  const limite = ahora - DIAS * 86_400_000;
  let nuevas = [...delAlmacen.values()]
    .filter((o) => !idsLocales.has(String(o.id)))
    .filter((o) => { const t = Date.parse(o.ts); return !Number.isFinite(t) || t >= limite; })
    .sort(porId);
  // El tope se aplica quitando lo RESTAURADO más viejo, nunca lo local.
  const sobran = lineas.length + nuevas.length - TOPE_MENSAJES;
  if (sobran > 0) nuevas = nuevas.slice(Math.min(sobran, nuevas.length));
  if (!nuevas.length) return { anadidas: 0, bytesAntes: bytes };
  const ultima = nuevas[nuevas.length - 1];
  const todas = [...lineas, ...nuevas.map((o) => ({ id: String(o.id), raw: JSON.stringify(o) }))];
  const frontera = lineaFrontera(tema, ultima, maquina, ahora);
  if (!idsLocales.has(frontera.id) && !delAlmacen.has(frontera.id)) {
    todas.push({ id: frontera.id, raw: JSON.stringify(frontera) });
  }
  todas.sort(porId);
  const texto = [...todas.map((x) => x.raw), ...rotas].join('\n') + '\n';
  return { anadidas: nuevas.length, desde: nuevas[0].ts, hasta: ultima.ts, texto, bytesAntes: bytes };
}

/**
 * Trae del almacén el estado por tema de las máquinas anteriores y lo fusiona en data/.
 * Se NIEGA antes de escribir nada si no puede leer origin/main del almacén (R2).
 */
export function restaurar({ datos, seco = false, ahora = Date.now() } = {}) {
  if (!datos) return { ok: false, motivo: 'no encuentro el repo de datos (COORD_DATOS, o ../foveal-vision-data)' };
  const url = git(datos, ['remote', 'get-url', 'origin']);
  if (!url.ok) return { ok: false, motivo: 'el repo de datos no tiene remoto `origin`' };
  if (/github\.com/i.test(url.out)) {
    return { ok: false, motivo: `origin apunta a GitHub (${url.out}), la copia congelada. Primero: `
      + 'python3 ~/src/digital-ocean-dropplet-auto-launching/scripts/do_droplet.py almacen conectar' };
  }
  const f = git(datos, ['fetch', '-q', 'origin'], { timeout: 120_000 });
  if (!f.ok) return { ok: false, motivo: `no pude hablar con el almacén (${url.out}): ${f.err.split('\n').pop() || '?'}` };
  const ref = 'origin/main';
  const ls = git(datos, ['ls-tree', '-r', '--name-only', ref, '--', CARPETA]);
  if (!ls.ok) return { ok: false, motivo: `no pude listar ${ref}:${CARPETA}/: ${ls.err.split('\n').pop() || '?'}` };

  const porTema = new Map();   // tema -> Map(id -> línea)
  const perfiles = new Map();  // fichero -> texto (gana la primera máquina que lo tenga)
  const maquinas = new Set();
  for (const ruta of ls.out.split('\n').filter(Boolean)) {
    const m = new RegExp(`^${CARPETA}/([^/]+)/(mensajes|claude-profile)/([^/]+)$`).exec(ruta);
    if (!m) continue;
    maquinas.add(m[1]);
    const contenido = git(datos, ['show', `${ref}:${ruta}`]).out;
    if (m[2] === 'mensajes' && m[3].endsWith('.jsonl')) {
      const tema = m[3].slice(0, -6);
      const mapa = porTema.get(tema) ?? new Map();
      for (const l of contenido.split('\n')) {
        if (!l.trim()) continue;
        try { const o = JSON.parse(l); if (o?.id && o?.autor && !mapa.has(String(o.id))) mapa.set(String(o.id), o); } catch { /* línea rota: no viaja */ }
      }
      porTema.set(tema, mapa);
    } else if (m[2] === 'claude-profile' && m[3].endsWith('.json') && !perfiles.has(m[3])) {
      perfiles.set(m[3], contenido.endsWith('\n') ? contenido : contenido + '\n');
    }
  }

  const dataDir = raizDatos();
  const maquina = maquinaId() ?? 'maquina-nueva';
  const temas = [];
  for (const [tema, mapa] of [...porTema.entries()].sort()) {
    const ruta = join(dataDir, 'mensajes', `${tema}.jsonl`);
    let r = null;
    for (let intento = 0; intento < 3; intento++) {
      r = fusionarTema(tema, mapa, ruta, { maquina, ahora });
      if (!r.anadidas || seco) break;
      if (escribirConCuidado(ruta, r.texto, r.bytesAntes)) break;
      r = { ...r, carrera: true };   // alguien escribió mientras fusionaba: se vuelve a leer
    }
    temas.push({ tema, nombre: nombreTema(tema), anadidas: r.anadidas, desde: r.desde, hasta: r.hasta,
      aplazado: Boolean(r.anadidas && r.carrera) });
  }
  let perfilesNuevos = 0, perfilesYa = 0;
  for (const [nombre, txt] of perfiles) {
    const ruta = join(dataDir, 'claude-profile', nombre);
    if (existsSync(ruta)) { perfilesYa++; continue; }
    if (!seco) { mkdirSync(dirname(ruta), { recursive: true }); writeFileSync(ruta, txt, 'utf8'); }
    perfilesNuevos++;
  }
  return { ok: true, seco, maquinas: [...maquinas].sort(), temas, perfilesNuevos, perfilesYa };
}

// --------------------------------------------------------------------- CLI

function usoYSalir() {
  console.log('Uso: node scripts/estado-por-tema.mjs --foto [--seco] [--sin-git] | --restaurar [--seco] | --estado');
  process.exit(2);
}

function cliFoto(datos, seco, sinGit) {
  const r = foto({ datos, seco, log: console.log });
  if (r.motivo) { console.log(`❌ ${r.motivo}`); return 2; }
  const aviso = (r.retenidas ? ` · ${r.retenidas} línea(s) retenida(s) por forma de secreto` : '')
    + (r.rotas ? ` · ${r.rotas} línea(s) ilegible(s) no viajan` : '');
  if (!r.cambiados) { console.log(`📸 Foto de ${r.maquina}: nada ha cambiado desde la última${aviso}.`); return 0; }
  console.log(`${seco ? '🧪 SECO — no escribo nada. Cambiaría' : '📸 Foto de ' + r.maquina + ':'} ${r.cambiados} fichero(s)${aviso}:`);
  for (const f of r.ficheros) console.log(`   ${f}`);
  if (!seco && !sinGit) empujar(datos, [CARPETA], 'estado por tema: foto', console.log);
  return 0;
}

function cliRestaurar(datos, seco) {
  const r = restaurar({ datos, seco });
  if (!r.ok) { console.log(`❌ NO restauro: ${r.motivo}`); return 2; }
  const conAlgo = r.temas.filter((t) => t.anadidas);
  if (!conAlgo.length && !r.perfilesNuevos) {
    console.log(`Nada que restaurar: el almacén (${r.maquinas.length} máquina(s) anteriores) no tiene nada que no esté ya aquí.`);
    return 0;
  }
  console.log(`${seco ? '🧪 SECO — no escribo nada. Restauraría' : '✅ Restaurado'} del almacén `
    + `(${r.maquinas.length} máquina(s) anteriores: ${r.maquinas.join(', ')}):`);
  for (const t of conAlgo) {
    const rango = t.desde && t.hasta ? ` (${t.desde.slice(0, 16).replace('T', ' ')} → ${t.hasta.slice(0, 16).replace('T', ' ')})` : '';
    console.log(`   ${t.nombre} (${t.tema}): +${t.anadidas} línea(s)${rango}${t.aplazado ? ' — ⚠ alguien escribía: lo dejo para la próxima' : ''}`);
  }
  if (r.perfilesNuevos || r.perfilesYa) console.log(`   #modelo por tema: ${r.perfilesNuevos} restaurado(s), ${r.perfilesYa} ya estaba(n)`);
  if (!seco) console.log('   Cada tema lleva una línea frontera: la web dice dónde empieza lo de esta máquina.');
  return 0;
}

function cliEstado(datos) {
  console.log(`máquina     ${maquinaId() ?? '(no sé: sin metadatos ni machine-id)'}`);
  console.log(`data/       ${raizDatos()}`);
  const dirM = join(raizDatos(), 'mensajes');
  const temas = existsSync(dirM) ? readdirSync(dirM).filter((n) => n.endsWith('.jsonl')) : [];
  for (const f of temas) {
    const n = readFileSync(join(dirM, f), 'utf8').split('\n').filter((l) => l.trim()).length;
    console.log(`            ${nombreTema(f.slice(0, -6))}: ${n} línea(s)`);
  }
  if (!temas.length) console.log('            sin historial local todavía');
  if (!datos) { console.log('repo datos  NO encontrado (COORD_DATOS, o ../foveal-vision-data)'); return 2; }
  const url = git(datos, ['remote', 'get-url', 'origin']).out;
  console.log(`repo datos  ${datos}\norigin      ${url}${/github\.com/i.test(url) ? '  ⚠ GitHub: la copia congelada, no el almacén' : ''}`);
  const f = git(datos, ['fetch', '-q', 'origin'], { timeout: 60_000 });
  if (!f.ok) { console.log(`almacén     no contesta: ${f.err.split('\n').pop()}`); return 2; }
  const ls = git(datos, ['ls-tree', '-r', '--name-only', 'origin/main', '--', CARPETA]).out.split('\n').filter(Boolean);
  // Sólo `coordinador/<máquina>/<algo>`: el README de la carpeta no es una máquina.
  const maquinas = [...new Set(ls.map((r) => r.split('/')).filter((t) => t.length >= 3).map((t) => t[1]))].sort();
  console.log(`almacén     ${maquinas.length} máquina(s) con foto en ${CARPETA}/`);
  for (const m of maquinas) {
    let meta = {};
    try { meta = JSON.parse(git(datos, ['show', `origin/main:${CARPETA}/${m}/meta.json`]).out); } catch { /* sin meta */ }
    const n = ls.filter((r) => r.startsWith(`${CARPETA}/${m}/mensajes/`)).length;
    console.log(`            ${m}${m === maquinaId() ? ' (ésta)' : ''}: ${n} tema(s), foto de ${meta.escrita ?? '?'}`);
  }
  return 0;
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const args = new Set(process.argv.slice(2));
  const modos = ['--foto', '--restaurar', '--estado'].filter((m) => args.has(m));
  if (modos.length !== 1) usoYSalir();
  const seco = args.has('--seco'), sinGit = args.has('--sin-git');
  const datos = repoDeDatos();
  let codigo = 2;
  try {
    if (modos[0] === '--foto') codigo = cliFoto(datos, seco, sinGit);
    else if (modos[0] === '--restaurar') codigo = cliRestaurar(datos, seco);
    else codigo = cliEstado(datos);
  } catch (e) {
    console.log(`❌ estado-por-tema: ${e.message}`);
  }
  process.exit(codigo);
}
