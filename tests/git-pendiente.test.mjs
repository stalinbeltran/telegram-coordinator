// Tests de la POLÍTICA de «¿qué se pierde de git si apago este server?»
// (scripts/git-pendiente.mjs, que usa cerrable.mjs).
//
// Por qué existe, y por qué justo estos casos (R10: el esfuerzo de prueba se
// reparte por consecuencia del fallo):
//
//   · Un workspace recién montado deja una rama local en CADA uno de los cinco
//     repos, y ninguna está en el remoto. Con la regla anterior eso daba cinco
//     avisos de «se perdería» por un árbol donde no se había hecho NADA. Con un
//     workspace por tema eso multiplica: el freno que se lee desde el móvil se
//     queda en 🔴 para siempre y se deja de leer. Un aviso que sale siempre no
//     es un freno, es un adorno.
//   · Pero aflojarlo de más es el fallo CARO: esconder trabajo real se paga con
//     datos que no se pueden re-derivar (ya costó el `r20260824` y 20 runs).
//     Por eso la regla es «una rama SIN commits propios no es trabajo» —que es
//     demostrable— y NO «ignora las ramas de los workspaces».
//   · Y si no se puede leer el git, es DUDA, nunca «todo bien»: mismo criterio
//     que el `NO SÉ` de cerrable.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const G = 'git -c user.email=t@test -c user.name=test -c init.defaultBranch=main';
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Un remoto con un commit y un clon suyo: es como nace cada repo aquí. */
function repoClonado() {
  const raiz = mkdtempSync(join(tmpdir(), 'coord-git-'));
  const origen = join(raiz, 'origen.git');
  const semilla = join(raiz, 'semilla');
  const copia = join(raiz, 'copia');
  sh(`${G} init --bare -q ${origen}`, raiz);
  sh(`${G} clone -q ${origen} ${semilla}`, raiz);
  mkdirSync(join(semilla, 'data'), { recursive: true });
  writeFileSync(join(semilla, 'data', 'fuentes.json'), '{"fuentes":["~/src/*/telegram"]}\n');
  writeFileSync(join(semilla, 'README.md'), '# repo de prueba\n');
  sh(`${G} add -A`, semilla);
  sh(`${G} commit -qm inicial`, semilla);
  sh(`${G} push -q origin main`, semilla);
  sh(`${G} clone -q ${origen} ${copia}`, raiz);
  return copia;
}

const mod = () => import('../scripts/git-pendiente.mjs');

// ------------------------------------------------------- lo que NO debe avisar
test('un repo recién clonado y sin tocar no da NINGUNA razón', async () => {
  const { razonesGit } = await mod();
  const r = razonesGit(repoClonado());
  assert.equal(r.duda, false);
  assert.deepEqual(r.razones, []);
});

test('una rama local SIN commits propios no es trabajo: es lo que deja --nuevo', async () => {
  const { razonesGit } = await mod();
  const repo = repoClonado();
  sh(`${G} checkout -q -b dropout`, repo);
  const r = razonesGit(repo);
  assert.equal(r.duda, false);
  assert.deepEqual(r.razones, [], 'una rama vacía es idéntica a main: no se pierde nada');
});

test('el data/fuentes.json que reescribe --nuevo se puede ignorar', async () => {
  const { razonesGit } = await mod();
  const repo = repoClonado();
  sh(`${G} checkout -q -b dropout`, repo);
  writeFileSync(join(repo, 'data', 'fuentes.json'), '{"fuentes":["~/ws/dropout/*/telegram"]}\n');
  const r = razonesGit(repo, { ignorar: ['data/fuentes.json'] });
  assert.deepEqual(r.razones, []);
});

// ------------------------------------------------------- lo que SÍ debe avisar
test('la misma rama CON un commit propio sí avisa: eso ya es trabajo', async () => {
  const { razonesGit } = await mod();
  const repo = repoClonado();
  sh(`${G} checkout -q -b dropout`, repo);
  writeFileSync(join(repo, 'resultado.md'), 'lo medido\n');
  sh(`${G} add -A`, repo);
  sh(`${G} commit -qm "el resultado"`, repo);
  const r = razonesGit(repo);
  assert.equal(r.razones.length, 1);
  assert.match(r.razones[0].texto, /rama "dropout" no está en el remoto/);
});

test('un fichero sin commitear avisa', async () => {
  const { razonesGit } = await mod();
  const repo = repoClonado();
  writeFileSync(join(repo, 'medicion.json'), '{}\n');
  const r = razonesGit(repo);
  assert.equal(r.razones.length, 1);
  assert.match(r.razones[0].texto, /1 fichero\(s\) sin commitear/);
});

test('ignorar fuentes.json NO tapa los demás cambios del mismo repo', async () => {
  const { razonesGit } = await mod();
  const repo = repoClonado();
  writeFileSync(join(repo, 'data', 'fuentes.json'), '{"fuentes":[]}\n');
  writeFileSync(join(repo, 'medicion.json'), '{}\n');
  const r = razonesGit(repo, { ignorar: ['data/fuentes.json'] });
  assert.equal(r.razones.length, 1);
  assert.match(r.razones[0].texto, /1 fichero\(s\) sin commitear/);
});

test('un commit sin empujar en una rama QUE SÍ está en el remoto sigue avisando', async () => {
  const { razonesGit } = await mod();
  const repo = repoClonado();
  writeFileSync(join(repo, 'otra.md'), 'x\n');
  sh(`${G} add -A`, repo);
  sh(`${G} commit -qm "sin empujar"`, repo);
  const r = razonesGit(repo);
  assert.equal(r.razones.length, 1);
  assert.match(r.razones[0].texto, /1 commit\(s\) sin empujar en "main"/);
});

// ------------------------------------------------------------------- la duda
test('lo que no se puede leer es DUDA, nunca «todo bien»', async () => {
  const { razonesGit } = await mod();
  const r = razonesGit(mkdtempSync(join(tmpdir(), 'coord-nogit-')));
  assert.equal(r.duda, true, 'sin git no se sabe qué se perdería: eso NO es cerrable');
});
