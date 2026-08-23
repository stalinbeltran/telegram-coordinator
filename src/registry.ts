import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, sep, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR, COORD_HOME } from './config.js';

/** De dónde salió una definición. Lo rellena el registry al cargar. */
export interface Origen {
  /** Ruta del JSON que la define. */
  fichero: string;
  /** Raíz del repo que la declara: el cwd por defecto de sus comandos. */
  raiz: string;
  /** Ficheros del mismo nombre en fuentes posteriores, que éste pisa. */
  pisados: string[];
}

export interface Executor {
  name: string;
  command: string;
  encargados: string[];
  /** Límite de ejecución en ms. Ausente = global; <= 0 = sin timeout. */
  timeoutMs?: number;
  /** Una línea para `/executors`. */
  descripcion?: string;
  /** Entradas de ejemplo; se muestran al abrir sesión con `/use`. */
  ejemplos?: string[];
  /**
   * Directorio de trabajo. En el JSON, relativo a la raíz de su fuente (o
   * absoluto). Ya cargado, siempre absoluto: lo resuelve el registry.
   */
  cwd?: string;
  /**
   * Binarios que este comando necesita en el PATH. La federación hace que un
   * ejecutor llegue con su repo, pero hay comandos que además dependen de algo
   * INSTALADO: `c` no sirve de nada sin `claude`, y su repo —el del propio
   * coordinador— está en TODAS las máquinas con bot, así que sin esto el mini
   * ofrecía un comando que sólo podía fallar. Ausente = no se comprueba.
   */
  requiere?: string[];
  /** Relleno al cargar; NO se escribe en el JSON. */
  origen?: Origen;
  /** Relleno al cargar: cuáles de `requiere` NO están. NO se escribe en el JSON. */
  falta?: string[];
}

export interface Encargado {
  name: string;
  command: string;
  /** Límite de ejecución en ms. Ausente = global; <= 0 = sin timeout. */
  timeoutMs?: number;
  descripcion?: string;
  cwd?: string;
  requiere?: string[];
  origen?: Origen;
  falta?: string[];
}

/** Directorio de una fuente y la raíz desde la que corren sus comandos. */
export interface Fuente {
  dir: string;
  raiz: string;
}

const execDir = join(DATA_DIR, 'executors');
const encDir = join(DATA_DIR, 'encargados');
const fuentesFile = join(DATA_DIR, 'fuentes.json');

const FUENTES_POR_DEFECTO = ['~/src/*/telegram'];

function expandirTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Patrones extra a escanear, además de `DATA_DIR`. Son DATO: salen de
 * `data/fuentes.json`, o de `COORD_FUENTES` en el entorno (separados por `,`).
 * Nunca lanza: una lista rota deja el coordinador con sus fuentes de siempre.
 */
async function patronesExtra(): Promise<string[]> {
  const delEntorno = (process.env.COORD_FUENTES ?? '').trim();
  if (delEntorno) {
    return delEntorno.split(',').map((s) => s.trim()).filter(Boolean);
  }
  try {
    const raw = JSON.parse(await readFile(fuentesFile, 'utf8')) as { fuentes?: unknown };
    if (!Array.isArray(raw?.fuentes)) {
      console.error(`⚠️  ${fuentesFile} no tiene un array "fuentes": se ignora.`);
      return [];
    }
    return raw.fuentes.filter((f): f is string => typeof f === 'string' && f.trim() !== '');
  } catch (err) {
    // Que no exista es normal (kit de arranque sin sembrar todavía).
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error(`⚠️  No se pudo leer ${fuentesFile}: ${String(err)}`);
    }
    return [];
  }
}

/**
 * Expande un patrón a directorios existentes. Admite UN `*` dentro de un
 * segmento (`~/src/*​/telegram`); lo relativo se resuelve contra COORD_HOME.
 * El orden es alfabético, para que dos máquinas con los mismos repos resuelvan
 * las colisiones igual.
 */
async function expandir(patron: string): Promise<string[]> {
  const ruta = resolve(COORD_HOME, expandirTilde(patron));
  if (!ruta.includes('*')) return (await esDirectorio(ruta)) ? [ruta] : [];

  const partes = ruta.split(sep);
  const i = partes.findIndex((p) => p.includes('*'));
  const base = partes.slice(0, i).join(sep) || sep;
  const sufijo = partes.slice(i + 1);
  const re = new RegExp(
    '^' + partes[i]!.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/\\\\]*') + '$',
  );

  let entradas: string[];
  try {
    entradas = await readdir(base);
  } catch {
    return []; // La base no existe (p.ej. no hay ~/src): no es un error.
  }

  const out: string[] = [];
  for (const nombre of entradas.sort()) {
    if (!re.test(nombre)) continue;
    const cand = join(base, nombre, ...sufijo);
    if (await esDirectorio(cand)) out.push(cand);
  }
  return out;
}

async function esDirectorio(p: string): Promise<boolean> {
  try {
    await readdir(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Las fuentes en orden de prioridad. `DATA_DIR` va SIEMPRE primero y no se
 * declara: así lo local siempre puede pisar a lo descubierto, y una lista de
 * fuentes vacía (o rota) deja el comportamiento de toda la vida.
 */
export async function fuentes(): Promise<Fuente[]> {
  const out: Fuente[] = [{ dir: DATA_DIR, raiz: COORD_HOME }];
  for (const patron of await patronesExtra()) {
    for (const dir of await expandir(patron)) {
      if (out.some((f) => f.dir === dir)) continue;
      out.push({ dir, raiz: dirname(dir) });
    }
  }
  return out;
}

/**
 * ¿Está este binario en el PATH? Con caché de 30 s.
 *
 * La caducidad va escrita aquí al lado porque sin ella habría que elegir entre
 * dos males: mirar el disco en CADA mensaje (esto se llama desde `listExecutors`,
 * que se ejecuta por mensaje), o cachear para siempre y obligar a reiniciar el
 * bot después de instalar algo. 30 s es corto para lo segundo y largo para lo
 * primero: instalas `claude`, y medio minuto después `/executors` ya lo ve.
 */
const TTL_PATH_MS = 30_000;
const cachePath = new Map<string, { visto: number; hay: boolean }>();

function enPath(bin: string): boolean {
  const cacheado = cachePath.get(bin);
  const ahora = Date.now();
  if (cacheado && ahora - cacheado.visto < TTL_PATH_MS) return cacheado.hay;

  let hay = false;
  if (bin.includes('/') || bin.includes('\\')) {
    // Con separador ya es una ruta, no un nombre que buscar en el PATH.
    hay = existsSync(resolve(COORD_HOME, expandirTilde(bin)));
  } else {
    // En Windows un ejecutable es `nombre` + una de las extensiones de PATHEXT.
    const exts =
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
        : [''];
    for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      if (exts.some((ext) => existsSync(join(dir, bin + ext)))) {
        hay = true;
        break;
      }
    }
  }
  cachePath.set(bin, { visto: ahora, hay });
  return hay;
}

/**
 * Carga `<fuente>/<sub>/*.json` de todas las fuentes, en orden.
 *
 * Ante dos definiciones con el mismo `name` gana la primera fuente, y la
 * pisada queda anotada en `origen.pisados` para poder decirlo: un ejecutor que
 * hace otra cosa de la que crees es peor que uno que falta.
 *
 * Un JSON roto se salta con aviso y NO tumba la lista: un repo ajeno no puede
 * dejar al bot sin ejecutores.
 */
async function cargar<
  T extends { name: string; cwd?: string; requiere?: string[]; falta?: string[]; origen?: Origen },
>(sub: string): Promise<T[]> {
  const porNombre = new Map<string, T>();
  for (const { dir, raiz } of await fuentes()) {
    const carpeta = join(dir, sub);
    let files: string[];
    try {
      files = (await readdir(carpeta)).filter((f) => f.endsWith('.json')).sort();
    } catch {
      continue; // La fuente no aporta este tipo: normal.
    }
    for (const f of files) {
      const fichero = join(carpeta, f);
      let def: T;
      try {
        def = JSON.parse(await readFile(fichero, 'utf8')) as T;
      } catch (err) {
        console.error(`⚠️  No se pudo leer ${fichero}: ${String(err)}`);
        continue;
      }
      if (!def || typeof def.name !== 'string' || !def.name.trim()) {
        console.error(`⚠️  ${fichero} no declara "name": se ignora.`);
        continue;
      }
      const ya = porNombre.get(def.name);
      if (ya) {
        ya.origen!.pisados.push(fichero);
        continue;
      }
      def.cwd = def.cwd ? resolve(raiz, expandirTilde(def.cwd)) : raiz;
      def.falta = (def.requiere ?? []).filter((bin) => !enPath(bin));
      def.origen = { fichero, raiz, pisados: [] };
      porNombre.set(def.name, def);
    }
  }
  return [...porNombre.values()];
}

export async function listExecutors(): Promise<Executor[]> {
  return cargar<Executor>('executors');
}

export async function listEncargados(): Promise<Encargado[]> {
  return cargar<Encargado>('encargados');
}

export async function getExecutor(name: string): Promise<Executor | undefined> {
  return (await listExecutors()).find((e) => e.name === name);
}

export async function getEncargado(name: string): Promise<Encargado | undefined> {
  return (await listEncargados()).find((e) => e.name === name);
}

/** Nombre corto de una raíz, para decir de qué repo salió algo. */
export function repoDe(def: { origen?: Origen }): string {
  return def.origen ? (def.origen.raiz.split(/[\\/]/).pop() || def.origen.raiz) : '?';
}

/**
 * Imprime en la terminal de dónde va a leer el coordinador y qué encontró.
 * Las colisiones se avisan aquí porque es lo único que hace falta para
 * arreglarlas: dice qué fichero manda y cuál está pisado, o sea qué borrar.
 */
export async function reportarFuentes(): Promise<void> {
  const lista = await fuentes();
  console.log('📁 Fuentes de ejecutores/encargados (manda la primera):');
  for (const f of lista) console.log(`   ${f.dir}   → cwd ${f.raiz}`);

  const execs = await listExecutors();
  const encs = await listEncargados();
  console.log(`   ${execs.length} ejecutores, ${encs.length} encargados.`);

  for (const def of [...execs, ...encs]) {
    if (def.origen?.pisados.length) {
      console.error(`⚠️  "${def.name}" está definido más de una vez.`);
      console.error(`      manda : ${def.origen.fichero}`);
      for (const p of def.origen.pisados) console.error(`      pisado: ${p}`);
    }
    if (def.falta?.length) {
      console.error(
        `⚠️  "${def.name}" no se puede usar en esta máquina: falta ${def.falta.join(', ')} en el PATH.`,
      );
    }
  }
}

/**
 * Siembra el kit mínimo de arranque la primera vez (es DATO, no código):
 *  - `data/fuentes.json`: dónde buscar ejecutores además de aquí.
 *  - ejecutor `shell`: ejecuta lo que envíes, con `cd` persistente por sesión.
 *  - ejecutor `definer`: crea ejecutores/encargados desde texto simple.
 *  - encargado `echo`: reenvía la salida del ejecutor de vuelta a ti.
 *
 * Se mira si existe el FICHERO, no si existe el nombre: con varias fuentes, un
 * `shell` de otro repo no debe impedir que el kit de casa se siembre.
 */
export async function seedBootKit(): Promise<void> {
  await mkdir(execDir, { recursive: true });
  await mkdir(encDir, { recursive: true });

  const sembrar = async (ruta: string, contenido: unknown, que: string) => {
    try {
      await readFile(ruta, 'utf8');
      return;
    } catch {
      /* no existe: se siembra */
    }
    await writeFile(ruta, JSON.stringify(contenido, null, 2) + '\n');
    console.log(`🌱 Sembrado ${que}.`);
  };

  await sembrar(fuentesFile, { fuentes: FUENTES_POR_DEFECTO }, 'data/fuentes.json');

  await sembrar(
    join(execDir, 'shell.json'),
    {
      name: 'shell',
      descripcion: 'Ejecuta lo que le envíes, con el `cd` persistente por tema.',
      ejemplos: ['ls -la', 'cd ~/src && pwd'],
      command: 'node scripts/shell-cwd.mjs',
      encargados: ['echo'],
    } satisfies Executor,
    'ejecutor "shell"',
  );

  await sembrar(
    join(execDir, 'definer.json'),
    {
      name: 'definer',
      descripcion: 'Crea ejecutores y encargados desde texto simple, sin tocar código.',
      ejemplos: ['exec saludo echo\necho hola'],
      command: 'node scripts/define.mjs',
      encargados: ['echo'],
    } satisfies Executor,
    'ejecutor "definer"',
  );

  await sembrar(
    join(encDir, 'echo.json'),
    {
      name: 'echo',
      descripcion: 'Reenvía al usuario la salida del ejecutor.',
      command:
        `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write('>>USER '+s))"`,
    } satisfies Encargado,
    'encargado "echo"',
  );
}
