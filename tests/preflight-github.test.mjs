// Tests de la comprobación del token de GitHub en `bench-preflight.mjs`.
//
// Por qué existe, y por qué es el caso caro (R10)
// ----------------------------------------------
// El preflight comprobaba `DO_TOKEN` a fondo —presencia Y validez contra la
// API— y de `GITHUB_TOKEN` no decía absolutamente nada. Medido el 2026-09-06 en
// una máquina recién lanzada con `lanzar launch dev`: el token había viajado
// bien (estaba en `~/.config/dev-secrets.env`, junto a un `DO_TOKEN` y un
// `VAST_AI_API_TOKEN` que daban 200) y GitHub lo rechazaba con 401.
//
// Consecuencias que nadie vio hasta que se buscaron:
//   · `foveal-vision-data` no se clonó (pide credenciales), y `provision` siguió con
//     código 0 tras un `AVISO: no pude clonar`. Sin ese repo, un estudio corre
//     entero y sus resultados no se commitean en ninguna parte.
//   · No se puede empujar nada, en una máquina que se rehace sin aviso.
//
// O sea el fallo silencioso que cuesta trabajo medido, que es la razón por la
// que esto BLOQUEA en vez de avisar.
//
// Lo que fijan estos tests:
//   1. sin token → FALTA;
//   2. token que GitHub rechaza (401) → FALTA, y se dice que está PRESENTE
//      («no está» mandaría a buscar el fallo en el envío, que sí funciona);
//   3. token válido pero sin permiso de escritura donde se guarda lo medido →
//      FALTA (validez no es utilidad: regla 5);
//   4. token válido que no ve el repo privado (404) → FALTA;
//   5. token válido y con push → ok, y no estorba;
//   6. sin poder preguntar a GitHub → AVISO, nunca «ok»: no saber no puede
//      leerse como que va bien (el mismo criterio que el `NO SÉ` de `cerrable`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);
const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const PREFLIGHT = join(RAIZ, 'scripts', 'bench-preflight.mjs');

/** Un GitHub de mentira. `rutas` mapea ruta -> [estado, cuerpo]. */
async function githubFalso(rutas) {
  const server = createServer((req, res) => {
    const [estado, cuerpo] = rutas[req.url.split('?')[0]] || [404, { message: 'Not Found' }];
    res.writeHead(estado, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return [`http://127.0.0.1:${server.address().port}`, () => new Promise((ok) => server.close(ok))];
}

/** Corre el preflight y devuelve la línea del resumen que habla de GITHUB_TOKEN. */
async function lineaGithub(env) {
  const r = await ejecutar(process.execPath, [PREFLIGHT], {
    cwd: RAIZ,
    // Sin DO_TOKEN el preflight se salta las llamadas a DigitalOcean: estos
    // tests son sobre GitHub y no tienen por qué depender de otra API.
    env: { ...process.env, DO_TOKEN: '', DIGITALOCEAN_TOKEN: '', ...env },
  }).catch((e) => e); // sale con 1 cuando algo falta, que es lo normal aquí
  const salida = (r.stdout || '') + (r.stderr || '');
  const linea = salida.split('\n').find((l) => /\bGITHUB_TOKEN\b/.test(l));
  assert.ok(linea, `el preflight no dijo nada de GITHUB_TOKEN.\n${salida}`);
  return linea;
}

const USUARIO = [200, { login: 'stalinbeltran' }];
const RUTA_DATOS = '/repos/stalinbeltran/foveal-vision-data';

test('sin token, bloquea', async () => {
  const linea = await lineaGithub({ GITHUB_TOKEN: '', GH_TOKEN: '' });
  assert.match(linea, /FALTA/);
});

test('token que GitHub rechaza: bloquea, y dice que está PRESENTE', async () => {
  const [url, cerrar] = await githubFalso({ '/user': [401, { message: 'Bad credentials' }] });
  try {
    const linea = await lineaGithub({ GITHUB_API: url, GITHUB_TOKEN: 'caducado' });
    assert.match(linea, /FALTA/);
    // Que diga «presente» es la mitad que importa: el envío del lanzador SÍ
    // funcionó, y un mensaje de «no está» manda a depurar el sitio equivocado.
    assert.match(linea, /presente/i);
    assert.match(linea, /401/);
  } finally { await cerrar(); }
});

test('token válido pero sin escritura donde se guarda lo medido: bloquea', async () => {
  const [url, cerrar] = await githubFalso({
    '/user': USUARIO,
    [RUTA_DATOS]: [200, { permissions: { pull: true, push: false } }],
  });
  try {
    const linea = await lineaGithub({ GITHUB_API: url, GITHUB_TOKEN: 'solo-lectura' });
    assert.match(linea, /FALTA/);
    assert.match(linea, /escritura/i);
  } finally { await cerrar(); }
});

test('token válido que no ve el repo de datos: bloquea', async () => {
  const [url, cerrar] = await githubFalso({ '/user': USUARIO }); // el repo cae al 404
  try {
    const linea = await lineaGithub({ GITHUB_API: url, GITHUB_TOKEN: 'sin-acceso' });
    assert.match(linea, /FALTA/);
    assert.match(linea, /404/);
  } finally { await cerrar(); }
});

test('token válido y con push: ok, y no estorba', async () => {
  const [url, cerrar] = await githubFalso({
    '/user': USUARIO,
    [RUTA_DATOS]: [200, { permissions: { push: true } }],
  });
  try {
    const linea = await lineaGithub({ GITHUB_API: url, GITHUB_TOKEN: 'bueno' });
    assert.doesNotMatch(linea, /FALTA/);
    assert.match(linea, /ok/);
    assert.match(linea, /stalinbeltran/);
  } finally { await cerrar(); }
});

test('sin poder preguntar a GitHub: AVISO, nunca ok', async () => {
  // Un puerto donde no escucha nadie: el fetch falla, que es «no sé».
  const [url, cerrar] = await githubFalso({});
  await cerrar();
  const linea = await lineaGithub({ GITHUB_API: url, GITHUB_TOKEN: 'da-igual' });
  assert.match(linea, /aviso/i);
  // Y no puede bloquear: sin red no se ha demostrado que el token esté mal.
  assert.doesNotMatch(linea, /FALTA/);
});
