// Registrar un error del COORDINADOR en el mismo log que el resto del sistema.
//
// Por que aqui y no un log propio
// --------------------------------
// El dueno pidio el log porque "si algo ocurre hoy y no salta a la vista nunca me
// entero". Dos logs separados serian dos sitios que mirar, o sea el problema del
// que se salio. El campo `origen` distingue quien escribio, y la pantalla de la
// web app YA facetea por el: los errores de aqui salen junto a los del API,
// filtrables con un clic, sin tocar una linea de interfaz.
//
// Por que se escribe el FICHERO y no se llama al API
// --------------------------------------------------
// Porque "el API no responde" es exactamente el error que mas interesa registrar,
// y por ese camino no se podria. Ademas el coordinador puede correr donde la web
// app ni siquiera esta instalada. El formato --JSONL, una linea por error-- es la
// interfaz; `fv/errores.py` es la implementacion de Python, no la definicion.
//
// Las tres reglas que hay que respetar si se toca
// -----------------------------------------------
// 1. ⚠⚠ REGISTRAR NO PUEDE TUMBAR EL COORDINADOR. Es la regla 3 de su CLAUDE.md
//    ("los errores nunca tumban el coordinador") aplicada al que registra
//    errores: si esto lanza, el fallo que se iba a reportar se convierte en una
//    caida. Todo va en try/catch y lo peor que pasa es un console.error.
// 2. Se REDACTA con `redactar.mjs`, el mismo modulo que el archivador de
//    conversaciones. Copiar la redaccion era la trampa conocida.
// 3. Se agrupan las repeticiones con VENTANA CRECIENTE, igual que en Python
//    (1 min -> 5 -> 15 -> 1 h): un ejecutor roto que se llama cada pocos
//    segundos no puede escribir una linea por intento.
//
// ⚠ Y si el coordinador corre en OTRA maquina que la web app, escribe en SU clon
// del repo de datos: los logs no se juntan hasta que alguien empuje y tire. El
// campo `maquina` los distingue; no se fusionan solos.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { execFileSync } from 'node:child_process';
import { redactar, valoresSecretos } from './redactar.mjs';

const CASA = process.env.COORD_HOME
  || join(new URL('.', import.meta.url).pathname, '..');
const MESES = ['01-enero', '02-febrero', '03-marzo', '04-abril', '05-mayo', '06-junio',
  '07-julio', '08-agosto', '09-septiembre', '10-octubre', '11-noviembre', '12-diciembre'];

// las mismas que fv/errores.py, y por el mismo motivo
const VENTANAS_MS = [60_000, 300_000, 900_000, 3_600_000];
const TOPE_TRAZA = 16_000;
const repes = new Map();
let secretos = null, version = null;

/** El repo de DATOS, o null si no esta clonado. Sin el NO se registra: escribir
 *  en el repo de codigo dejaria el log donde nadie lo mira y sin commitear. */
function raizErrores() {
  const cand = join(dirname(CASA), 'foveal-vision-data');
  return existsSync(join(cand, '.git')) ? join(cand, 'errores') : null;
}

function ficheroDelMes(d) {
  const raiz = raizErrores();
  if (!raiz) return null;
  const a = d.getUTCFullYear();
  return join(raiz, String(a), MESES[d.getUTCMonth()],
    `${a}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`);
}

function versionCodigo() {
  if (version === null) {
    try {
      version = execFileSync('git', ['-C', CASA, 'rev-parse', '--short', 'HEAD'],
        { encoding: 'utf8', timeout: 5000 }).trim() || '?';
    } catch { version = '?'; }
  }
  return version;
}

const red = (t) => {
  if (secretos === null) {
    try { secretos = valoresSecretos().redactar; } catch { secretos = []; }
  }
  try { return redactar(String(t ?? ''), secretos).texto; } catch { return String(t ?? ''); }
};

/**
 * Anade un error al log. NUNCA lanza; devuelve la linea escrita o null.
 * @param {string} code  identificador estable del fallo
 */
export function registrar(code, message, opciones = {}) {
  try {
    const { hint = '', nivel = 'error', origen = 'coordinador', donde = '',
      traza = '', extra = null } = opciones;
    const ahora = new Date();
    const fichero = ficheroDelMes(ahora);
    if (!fichero) return null;              // sin repo de datos, no se registra

    const linea = {
      cuando: ahora.toISOString().replace(/\.\d+Z$/, '+00:00'),
      nivel: nivel === 'rechazo' ? 'rechazo' : 'error',
      code: String(code).slice(0, 120),
      message: red(message).slice(0, 2000),
      hint: red(hint).slice(0, 1000),
      origen: String(origen).slice(0, 60),
      donde: red(donde).slice(0, 300),
      maquina: hostname().slice(0, 60),
      version: versionCodigo(),
      pid: process.pid,
    };
    if (traza) {
      // el FINAL, que es donde esta la causa; y si corta, lo dice
      let t = red(traza instanceof Error ? (traza.stack || String(traza)) : traza);
      if (t.length > TOPE_TRAZA) {
        t = `[... traza recortada: se guardan los ultimos ${TOPE_TRAZA} de ` +
            `${t.length} bytes ...]\n` + t.slice(-TOPE_TRAZA);
      }
      linea.traza = t;
    }
    if (extra) { try { linea.extra = JSON.parse(red(JSON.stringify(extra))); } catch { /* se omite */ } }

    const clave = `${linea.nivel}|${linea.code}|${linea.origen}|${linea.donde}`;
    const t = Date.now();
    const prev = repes.get(clave);
    let escalon = prev ? prev.escalon : 0;
    if (prev && t - prev.desde < VENTANAS_MS[escalon]) { prev.n += 1; return null; }
    if (prev && prev.n) {
      escribir({ ...prev.linea, cuando: linea.cuando,
        message: `y ${prev.n} vez/veces mas en ${VENTANAS_MS[escalon] / 1000} s: ` +
                 prev.linea.message,
        repeticiones: prev.n });
      escalon = Math.min(escalon + 1, VENTANAS_MS.length - 1);
    } else { escalon = 0; }
    repes.set(clave, { desde: t, n: 0, linea, escalon });
    escribir(linea);
    return linea;
  } catch (e) {
    console.error(`[errores] no pude registrar '${code}': ${e?.message ?? e}`);
    return null;
  }
}

/** Vuelca las repeticiones pendientes. Ver el porque en `cerrar_ventanas` de
 *  fv/errores.py: mientras la ventana esta abierta el contador va con retraso, y
 *  un reinicio limpio (SIGTERM) no tiene por que perder la multiplicidad. */
export function cerrarVentanas() {
  let n = 0;
  const ahora = new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
  for (const [, prev] of repes) {
    if (prev.n) {
      try {
        escribir({ ...prev.linea, cuando: ahora,
          message: `y ${prev.n} vez/veces mas (ventana cerrada al salir el ` +
                   `proceso): ${prev.linea.message}`,
          repeticiones: prev.n });
        n += 1;
      } catch { /* al salir no se puede hacer mas */ }
    }
    prev.n = 0;
  }
  return n;
}

// `exit` es sincrono y appendFileSync tambien, asi que aqui si da tiempo.
process.on('exit', () => { try { cerrarVentanas(); } catch { /* nada */ } });
// SIGTERM es lo que manda `systemctl restart`, y por defecto NO dispara `exit`
for (const s of ['SIGTERM', 'SIGINT']) {
  process.on(s, () => { try { cerrarVentanas(); } catch { /* nada */ } process.exit(0); });
}

function escribir(linea) {
  const f = ficheroDelMes(new Date());
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, JSON.stringify(linea) + '\n', 'utf8');
}
