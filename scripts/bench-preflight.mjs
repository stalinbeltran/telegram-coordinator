#!/usr/bin/env node
// ¿Tiene esta máquina lo que hace falta para correr el benchmark de vCPU?
//
// Existe porque la respuesta ha sido "no" varias veces seguidas, y de formas
// que no se ven hasta que ya has empezado: el droplet es nuevo, el dataset no
// está, el token tampoco, y lo que se descubre a mitad de un encargo se
// resuelve improvisando. Esto lo pregunta TODO de golpe, antes de nada, y para
// cada cosa que falta dice el comando exacto que la arregla.
//
//   node scripts/bench-preflight.mjs          comprueba y lista lo que falta
//   node scripts/bench-preflight.mjs --fix    además arregla lo que puede solo
//
// Sale con código 0 sólo si se puede medir ya. Lo que no puede arreglarse desde
// dentro (que el lanzador no haya enviado el token) se dice con el comando que
// hay que correr FUERA, en la máquina lanzadora.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = process.argv.includes('--fix');
const HOME = homedir();

// El árbol de repos es el PADRE de este coordinador, no `~/src` a secas.
//
// Con un solo árbol las dos cosas coinciden y esto no cambia nada; con varios
// workspaces (`~/ws/<linea>/`, § «Varias sesiones a la vez») no coinciden, y
// cablear `~/src` hacía que el preflight de un workspace comprobara —y con
// `--fix`, ARREGLARA— los repos de OTRO. Un preflight que mira el árbol
// equivocado es peor que ninguno: da luz verde sobre algo que no es tuyo.
const SRC = dirname(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const LANZADOR = join(SRC, 'digital-ocean-dropplet-auto-launching');
const DO_API = 'https://api.digitalocean.com/v2';
const VOLUMEN = process.env.BENCH_VOLUME || 'bench-data';
const MNT = `/mnt/${VOLUMEN}`;

// Lo que el volumen tiene que contener para que un droplet de medición pueda
// ponerse a entrenar sin generar nada.
const ARTEFACTOS = [
  'window-datasets/bench-dirty1000-16/windows.npz',
  'FINGERPRINT.json',
];

const resultados = [];
let bloqueado = false;

function anota(estado, que, detalle, remedio = '') {
  resultados.push({ estado, que, detalle, remedio });
  if (estado === 'FALTA') bloqueado = true;
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function intenta(cmd, opts = {}) {
  try {
    return { ok: true, salida: sh(cmd, opts) };
  } catch (e) {
    return { ok: false, salida: ((e.stdout || '') + (e.stderr || '')).trim() || String(e.message) };
  }
}

async function api(ruta, opciones = {}) {
  const token = process.env.DO_TOKEN || process.env.DIGITALOCEAN_TOKEN || '';
  const r = await fetch(`${DO_API}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opciones.headers || {}),
    },
  });
  const texto = await r.text();
  const cuerpo = texto ? JSON.parse(texto) : {};
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${ruta}: ${texto.slice(0, 300)}`);
  return cuerpo;
}

// La API de metadatos sólo responde dentro de un droplet. Fuera (una laptop),
// que no responda es la respuesta: aquí no se lanza nada.
async function metadatos() {
  try {
    const r = await fetch('http://169.254.169.254/metadata/v1.json', {
      signal: AbortSignal.timeout(3000),
    });
    return await r.json();
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------- checks

async function main() {
  console.log('Comprobando lo que hace falta para el benchmark de vCPU…\n');

  // 1. ¿Estamos en un droplet, y en cuál?
  const meta = await metadatos();
  if (meta) {
    anota('OK', 'esta máquina', `droplet ${meta.droplet_id} · ${meta.region} · ${meta.hostname}`);
  } else {
    anota('AVISO', 'esta máquina', 'no responde la API de metadatos: no parece un droplet');
  }
  const region = meta?.region || 'nyc1';

  // 2. El token. Sin él no hay nada que hacer, y no se puede arreglar desde aquí.
  const token = process.env.DO_TOKEN || process.env.DIGITALOCEAN_TOKEN || '';
  if (!token) {
    anota(
      'FALTA',
      'DO_TOKEN',
      'no está en el entorno (debería venir de ~/.config/dev-secrets.env)',
      'Desde la máquina LANZADORA, no desde aquí:\n' +
        `      python scripts/do_droplet.py push-do-token ${meta?.hostname || '<droplet>'}\n` +
        '    o relanzar el droplet con --make-launcher, que lo envía junto con lo demás.',
    );
  } else {
    try {
      const cuenta = await api('/account');
      anota(
        'OK',
        'DO_TOKEN',
        `válido · límite de ${cuenta.account.droplet_limit} droplets · ${cuenta.account.email}`,
      );
    } catch (e) {
      anota('FALTA', 'DO_TOKEN', `presente pero la API lo rechaza: ${e.message}`,
        'Rótalo desde la lanzadora: python scripts/do_droplet.py push-do-token <droplet>');
    }
  }

  // 3. El repo del lanzador: es el programa que sabe crear y destruir droplets.
  if (existsSync(join(LANZADOR, 'scripts', 'do_droplet.py'))) {
    anota('OK', 'repo del lanzador', LANZADOR);
  } else if (FIX) {
    const r = intenta(
      `git clone -q https://github.com/stalinbeltran/digital-ocean-dropplet-auto-launching.git ${LANZADOR}`,
    );
    if (r.ok) anota('ARREGLADO', 'repo del lanzador', `clonado en ${LANZADOR}`);
    else anota('FALTA', 'repo del lanzador', r.salida, 'clónalo a mano en ~/src');
  } else {
    anota('FALTA', 'repo del lanzador', `no está en ${LANZADOR}`,
      'node scripts/bench-preflight.mjs --fix   (lo clona)');
  }

  // 4. La clave SSH. El token deja CREAR droplets; entrar en ellos es otra cosa,
  //    y es la que se olvida: sin par propio registrado en la cuenta, las
  //    máquinas que lances existen, facturan y no las puedes tocar.
  const clave = join(HOME, '.ssh', 'do_droplet');
  let claveOk = existsSync(clave);
  if (!claveOk && FIX) {
    const r = intenta(`ssh-keygen -t ed25519 -f ${clave} -N "" -C "bench-${meta?.hostname || 'local'}"`);
    claveOk = r.ok;
    if (!r.ok) anota('FALTA', 'clave SSH', r.salida, 'ssh-keygen -t ed25519 -f ~/.ssh/do_droplet -N ""');
  }
  if (claveOk && token) {
    const publica = readFileSync(`${clave}.pub`, 'utf8').trim();
    const material = publica.split(/\s+/)[1];
    try {
      const { ssh_keys: claves } = await api('/account/keys?per_page=200');
      const ya = claves.find((k) => k.public_key.split(/\s+/)[1] === material);
      if (ya) {
        anota('OK', 'clave SSH', `~/.ssh/do_droplet registrada en la cuenta como '${ya.name}'`);
      } else if (FIX) {
        const nombre = `lanzador-${meta?.hostname || 'bench'}`;
        const { ssh_key } = await api('/account/keys', {
          method: 'POST',
          body: JSON.stringify({ name: nombre, public_key: publica }),
        });
        anota('ARREGLADO', 'clave SSH', `registrada en la cuenta como '${ssh_key.name}'`);
      } else {
        anota('FALTA', 'clave SSH', 'existe pero NO está registrada en la cuenta',
          'node scripts/bench-preflight.mjs --fix   (la registra)\n' +
          '    Ojo: sólo la aceptarán los droplets creados DESPUÉS de registrarla.');
      }
    } catch (e) {
      anota('FALTA', 'clave SSH', `no pude consultar las claves de la cuenta: ${e.message}`);
    }
  } else if (!claveOk) {
    anota('FALTA', 'clave SSH', 'no existe ~/.ssh/do_droplet',
      'node scripts/bench-preflight.mjs --fix   (la genera y la registra)');
  }

  // 5. Los repos del trabajo.
  //
  //    `foveal-vision-data` no es "uno más": es DONDE SE GUARDA lo medido.
  //    `fv.settings.data_root()` lo busca como hermano de `foveal-vision` y, si
  //    no está, cae al propio repo de código -- donde `runs/`, `sweeps/` y
  //    `studies/` están en .gitignore desde que se vació el legado. O sea que
  //    sin él un estudio corre entero, escribe sus resultados y no los commitea
  //    en ninguna parte: se van con el droplet, sin un solo error por el camino.
  //    Medido el 2026-08-27 en una máquina recién rehecha. Por eso bloquea.
  for (const [repo, dir] of [
    ['stalinbeltran/foveal-vision', 'foveal-vision'],
    ['stalinbeltran/image-text-sample-generator', 'image-text-sample-generator'],
    ['stalinbeltran/foveal-vision-data', 'foveal-vision-data'],
  ]) {
    const ruta = join(SRC, dir);
    if (existsSync(join(ruta, '.git'))) {
      const rama = intenta('git rev-parse --abbrev-ref HEAD', { cwd: ruta });
      anota('OK', `repo ${dir}`, `${ruta} (${rama.ok ? rama.salida : '?'})`);
    } else if (FIX) {
      const r = intenta(`git clone -q https://github.com/${repo}.git ${ruta}`);
      if (r.ok) anota('ARREGLADO', `repo ${dir}`, `clonado en ${ruta}`);
      else anota('FALTA', `repo ${dir}`, r.salida);
    } else {
      anota('FALTA', `repo ${dir}`, `no está en ${ruta}`,
        'node scripts/bench-preflight.mjs --fix   (lo clona)');
    }
  }

  // 5 bis. El venv de `foveal-vision`, que es la diferencia entre "el repo está"
  //    y "el repo puede correr".
  //
  //    ⚠ Ésta es exactamente la regla 5 del proyecto ("un preflight comprueba
  //    estado utilizable, no presencia") aplicada al fallo que la destapó otra
  //    vez. Medido el 2026-08-28 en esta máquina, lanzada con `lanzar launch
  //    dev`: los cuatro repos estaban, el token estaba, el dataset había llegado
  //    por git... y el preflight imprimía **"Todo listo: se puede medir"** con
  //    `foveal-vision/.venv` inexistente. `cloud-init` clona los repos pero no
  //    crea venvs, así que en un dev recién hecho NUNCA está.
  //
  //    Y falla tarde y feo: `estudio_flota.py`, `bench_fleet.py` y
  //    `estudio_*.py` se invocan todos como `.venv/bin/python ...` (así están
  //    escritos los ejecutores de Telegram y los planes), así que desde Telegram
  //    el síntoma es un `No such file or directory` sin más contexto.
  //
  //    Se comprueba IMPORTANDO, no mirando si el directorio existe: un venv a
  //    medias (creado y con el `pip install` cortado) tiene `bin/python` y no
  //    tiene torch, y ése es el estado que se descubre a mitad.
  const fvVenv = join(SRC, 'foveal-vision', '.venv', 'bin', 'python');
  const cmdVenv = `${fvVenv} -c "import torch, numpy, yaml; import sys; ` +
    `sys.path.insert(0, 'src'); import fv; print(torch.__version__)"`;
  const venvOk = existsSync(fvVenv)
    && intenta(cmdVenv, { cwd: join(SRC, 'foveal-vision') });
  if (venvOk && venvOk.ok) {
    anota('OK', 'venv de foveal-vision', `torch ${venvOk.salida.trim()} · fv importable`);
  } else {
    const comoArreglarlo =
      'cd ~/src/foveal-vision && python3 -m venv .venv \\\n' +
      '  && .venv/bin/python -m pip install -q --index-url https://download.pytorch.org/whl/cpu torch \\\n' +
      '  && .venv/bin/python -m pip install -q -e ".[api,dev]"';
    if (FIX) {
      // Tarda minutos (torch son ~900 MB descomprimidos). El índice CPU es
      // deliberado: la rueda por defecto arrastra CUDA (~2,5 GB) y aquí se
      // entrena en CPU o no se entrena -- quien entrena de verdad es la máquina
      // alquilada, que se monta su propio entorno.
      const r = intenta(comoArreglarlo, { cwd: SRC, timeout: 900000 });
      if (r.ok) anota('ARREGLADO', 'venv de foveal-vision', 'creado con torch CPU');
      else anota('FALTA', 'venv de foveal-vision', r.salida, comoArreglarlo);
    } else {
      anota('FALTA', 'venv de foveal-vision',
        existsSync(fvVenv)
          ? 'existe .venv pero no importa torch/numpy/fv (instalación a medias)'
          : 'no existe ~/src/foveal-vision/.venv',
        comoArreglarlo);
    }
  }

  // 6. El volumen del dataset del benchmark de vCPU.
  //
  //    ⚠ Desde el 2026-08-27 esto YA NO BLOQUEA, y el motivo importa: el dato
  //    vive en git (`foveal-vision-data/window-datasets/`) y `bench_fleet.py`
  //    lo publica desde ahí, así que se puede medir sin volumen ninguno. El
  //    volumen quedó como caché para máquinas que lo tengan montado.
  //
  //    Un preflight que bloquea por algo que no impide medir enseña a saltarse
  //    el preflight, y entonces deja de servir para lo que sí bloquea.
  const dsEnGit = existsSync(join(SRC, 'foveal-vision-data', 'window-datasets'))
    && intenta(`ls ${join(SRC, 'foveal-vision-data', 'window-datasets')}/*/windows.npz`).ok;
  const nivelVolumen = dsEnGit ? 'AVISO' : 'FALTA';
  let volumen = null;
  if (token) {
    try {
      const { volumes } = await api('/volumes?per_page=200');
      volumen = volumes.find((v) => v.name === VOLUMEN) || null;
    } catch (e) {
      anota('AVISO', 'volumen', `no pude listar volúmenes: ${e.message}`);
    }
  }

  const montado = existsSync(MNT) && intenta(`mountpoint -q ${MNT}`).ok;
  const artefactosOk = ARTEFACTOS.every((a) => existsSync(join(MNT, a)));

  if (montado && artefactosOk) {
    let huella = '?';
    try {
      huella = JSON.parse(readFileSync(join(MNT, 'FINGERPRINT.json'), 'utf8')).sha256_windows_npz.slice(0, 12);
    } catch { /* el fichero está, su contenido ya lo dirá quien lo use */ }
    const tam = (statSync(join(MNT, ARTEFACTOS[0])).size / 1e6).toFixed(1);
    anota('OK', 'dataset', `${MNT} montado, windows.npz ${tam} MB, huella ${huella}…`);
  } else if (montado) {
    anota(nivelVolumen, 'dataset', `${MNT} está montado pero vacío o incompleto`,
      'Generarlo una vez (tarda, usa Chromium):\n' +
      '      cd ~/src/foveal-vision && python3 scripts/bench_dataset.py');
  } else if (volumen && volumen.droplet_ids?.length && meta && volumen.droplet_ids.includes(meta.droplet_id)) {
    anota(nivelVolumen, 'dataset', `el volumen '${VOLUMEN}' está conectado pero no montado`,
      `cd ~/src/digital-ocean-dropplet-auto-launching && python3 scripts/do_droplet.py volume attach ${VOLUMEN}`);
  } else if (volumen) {
    anota(nivelVolumen, 'dataset', `el volumen '${VOLUMEN}' existe (${volumen.size_gigabytes} GB en ${volumen.region.slug}) pero no está en esta máquina`,
      `cd ~/src/digital-ocean-dropplet-auto-launching && python3 scripts/do_droplet.py volume attach ${VOLUMEN} --droplet ${meta?.hostname || '<este droplet>'}`);
  } else {
    anota(nivelVolumen, 'dataset', `no existe el volumen '${VOLUMEN}' en la cuenta`,
      (dsEnGit ? 'Opcional: el dato ya está en git y bench_fleet lo publica desde ahí.\n    ' : '') +
      'cd ~/src/digital-ocean-dropplet-auto-launching\n' +
      `      python3 scripts/do_droplet.py volume create ${VOLUMEN} --size-gb 10 --region ${region}\n` +
      `      python3 scripts/do_droplet.py volume attach ${VOLUMEN} --droplet ${meta?.hostname || '<este droplet>'}\n` +
      '    y luego generarlo:  cd ~/src/foveal-vision && python3 scripts/bench_dataset.py');
  }

  // 7. Los datasets de ESTUDIO, que no son los del benchmark de vCPU y no
  //    viven en el volumen: viven en git, dentro del repo de datos.
  //
  //    Se comprueba que estén COMMITEADOS, no que estén en disco, y la
  //    diferencia es justo la que costó el `r20260824`: estaba en disco, se
  //    midió con él, y desapareció al rehacer la máquina porque no estaba en
  //    ningún git. Reconstruirlo no lo devuelve -- está medido que da OTRO dato
  //    (`repro-chk`, 2026-08-26), así que lo medido antes deja de ser
  //    comparable. Ver foveal-vision/CLAUDE.md § «El dataset de ventanas».
  //
  //    AVISA, no bloquea: se puede medir sin ellos (el benchmark de vCPU usa el
  //    suyo), y un preflight que se niega por algo que no impide medir es un
  //    preflight que se aprende a ignorar.
  {
    const datos = join(SRC, 'foveal-vision-data');
    const wd = join(datos, 'window-datasets');
    if (!existsSync(join(datos, '.git'))) {
      // ya lo dijo el bloque 5; aquí no se repite
    } else if (!existsSync(wd)) {
      anota('AVISO', 'datasets de estudio', 'no hay window-datasets/ en el repo de datos',
        'Si vas a continuar un estudio, el dataset tiene que estar en git:\n' +
        `      cd ${datos} && git add window-datasets && git commit -m 'data: dataset' && git push`);
    } else {
      const r = intenta('git ls-files -- window-datasets', { cwd: datos });
      const guardados = new Set(
        (r.ok ? r.salida.split('\n') : []).filter((f) => f.endsWith('/windows.npz'))
          .map((f) => f.split('/')[1]));
      const enDisco = intenta(`ls ${wd}`).salida.split('\n').filter(Boolean);
      const sinGuardar = enDisco.filter((d) => !guardados.has(d)
        && existsSync(join(wd, d, 'windows.npz')));
      if (guardados.size && !sinGuardar.length) {
        anota('OK', 'datasets de estudio',
          `${guardados.size} con windows.npz commiteado (de ${enDisco.length} descritos)`);
      } else if (sinGuardar.length) {
        anota('AVISO', 'datasets de estudio',
          `${sinGuardar.length} con windows.npz SIN commitear: ${sinGuardar.join(', ')}`,
          'Está en disco pero no en git: se pierde al rehacer la máquina, y\n' +
          '    reconstruirlo da OTRO dato. Guárdalo:\n' +
          `      cd ${datos} && git add window-datasets && git commit -m 'data: dataset' && git push`);
      } else {
        anota('AVISO', 'datasets de estudio',
          `${enDisco.length} descritos, NINGUNO con windows.npz (sólo manifest/split)`,
          'Sólo está la descripción, no el dato. Para continuar un estudio hay que\n' +
          '    generarlo y commitearlo -- y será un dataset NUEVO, no el de antes.');
      }
    }
  }

  // 7 bis. Los estudios YA MEDIDOS: que se puedan ENCONTRAR, no que estén.
  //
  //    Es la distinción de siempre aquí, y esta vez costó un estudio entero: los
  //    runs de `do-t` estaban en git, commiteados y empujados, y aun así se
  //    escribieron en la raíz plana del repo de datos en vez de en
  //    `<año>/<mes>/`, porque el mes se buscaba por un directorio de estudio que
  //    los `estudio_*.py` no crean nunca (medido el 2026-08-28; el detalle en
  //    foveal-vision/CLAUDE.md § «El agujero que dejó todo un estudio en la raíz
  //    plana»). Nada falló, nada avisó, y quien lo mirara en el repo veía dos
  //    formas conviviendo sin saber cuál es la buena.
  //
  //    Así que se pregunta lo que de verdad importa a una sesión nueva: ¿cuántos
  //    recorridos y runs RESUELVE `fv` por su nombre, y queda algo sin fechar?
  //    Resolver por nombre es lo que hacen `estudio_informe.py` y
  //    `estudio_progreso.py`; contar directorios no probaría lo mismo.
  //
  //    AVISA, no bloquea: lo plano se sigue leyendo (la cascada lo mira primero),
  //    así que no impide medir nada -- sólo hay que recogerlo.
  {
    const datos = join(SRC, 'foveal-vision-data');
    const fv = join(SRC, 'foveal-vision');
    const py = join(fv, '.venv', 'bin', 'python');
    if (!existsSync(join(datos, '.git')) || !existsSync(py)) {
      // sin repo de datos o sin venv ya lo han dicho los bloques 5 y 5 bis
    } else {
      const guion = [
        'import sys, json; sys.path.insert(0, "src")',
        'from fv import artefactos, settings',
        'from fv.training.registry import RunStore',
        'raiz = settings.data_root()',
        'recs = artefactos.nombres("sweeps", raiz / "sweeps")',
        'runs = artefactos.nombres("runs", raiz / "runs")',
        'rs = RunStore()',
        'malos = [n for n in runs if not (rs.path(n) / "config.json").exists()]',
        'plano = [d for d in ("runs", "sweeps", "studies") if (raiz / d).is_dir()]',
        'print(json.dumps({"recs": len(recs), "runs": len(runs), '
        + '"malos": malos[:3], "n_malos": len(malos), "plano": plano}))',
        // `; ` y no un salto de línea: `JSON.stringify` escapa el salto como
        // `\n`, y dentro de las comillas dobles del shell eso llega a python
        // como barra-ene literal -- SyntaxError. Todas son sentencias simples.
      ].join('; ');
      const r = intenta(`${py} -c ${JSON.stringify(guion)}`, { cwd: fv });
      let d = null;
      try { d = JSON.parse(r.salida.split('\n').pop()); } catch { /* abajo */ }
      if (!d) {
        anota('AVISO', 'estudios medidos', `no pude preguntárselo a fv: ${r.salida.slice(-200)}`,
          'Sin esto no sé si lo ya medido se puede encontrar por su nombre.\n' +
          `      cd ${fv} && .venv/bin/python scripts/estudio_progreso.py --sweep <recorrido>`);
      } else if (d.n_malos) {
        anota('AVISO', 'estudios medidos',
          `${d.n_malos} run(s) NO resuelven por nombre (p.ej. ${d.malos.join(', ')})`,
          'Están listados pero su config.json no aparece donde la cascada mira.\n' +
          '    Es dato medido que ningún informe va a leer.');
      } else if (d.plano.length) {
        anota('AVISO', 'estudios medidos',
          `${d.recs} recorridos · ${d.runs} runs · ⚠ sin fechar en la raíz: ${d.plano.join(', ')}`,
          'Se lee, pero conviven dos formas. Recógelo (simula sin --aplicar):\n' +
          `      cd ${fv} && .venv/bin/python scripts/recoger_planos.py`);
      } else {
        anota('OK', 'estudios medidos',
          `${d.recs} recorridos · ${d.runs} runs resuelven por nombre · nada sin fechar`);
      }
    }
  }

  // 7. Herramientas que usa la orquestación.
  for (const [bin, para] of [
    ['python3', 'el lanzador'],
    ['ssh', 'entrar en los droplets de medición'],
    ['scp', 'copiarles el dataset'],
    ['git', 'guardar los reportes'],
  ]) {
    const r = intenta(`command -v ${bin}`);
    if (r.ok) anota('OK', bin, r.salida);
    else anota('FALTA', bin, `no está en el PATH (hace falta para ${para})`, `sudo apt-get install -y ${bin}`);
  }

  // ------------------------------------------------------------------ informe
  console.log('');
  const ancho = Math.max(...resultados.map((r) => r.que.length));
  for (const r of resultados) {
    const marca = { OK: '  ok  ', FALTA: ' FALTA', AVISO: ' aviso', ARREGLADO: 'puesto' }[r.estado];
    console.log(`[${marca}] ${r.que.padEnd(ancho)}  ${r.detalle}`);
  }

  const faltan = resultados.filter((r) => r.estado === 'FALTA');
  if (faltan.length) {
    console.log(`\n${faltan.length === 1 ? 'Falta una cosa' : `Faltan ${faltan.length} cosas`}:\n`);
    for (const r of faltan) {
      console.log(`  ${r.que}: ${r.detalle}`);
      if (r.remedio) console.log(`    → ${r.remedio}`);
      console.log('');
    }
    if (!FIX) console.log('Varias se arreglan solas con:  node scripts/bench-preflight.mjs --fix');
  }

  // Los avisos no bloquean, pero SU REMEDIO también se imprime: un aviso que
  // dice qué pasa y se calla cómo arreglarlo obliga a ir a buscarlo, que es
  // exactamente lo que este script existe para evitar.
  const avisos = resultados.filter((r) => r.estado === 'AVISO' && r.remedio);
  if (avisos.length) {
    console.log(`\n${avisos.length === 1 ? 'Un aviso' : `${avisos.length} avisos`} (no impide${avisos.length === 1 ? '' : 'n'} medir):\n`);
    for (const r of avisos) {
      console.log(`  ${r.que}: ${r.detalle}`);
      console.log(`    → ${r.remedio}`);
      console.log('');
    }
  }

  if (!faltan.length) {
    console.log('\nTodo listo: se puede medir. El siguiente paso es');
    console.log('  cd ~/src/foveal-vision && python3 scripts/bench_fleet.py --sizes 2,4,8');
  }
  process.exit(bloqueado ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nERROR inesperado en el preflight: ${e.stack || e.message}`);
  process.exit(2);
});
