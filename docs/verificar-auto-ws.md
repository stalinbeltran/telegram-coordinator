# Verificar «el primer mensaje de un tema decide su workspace» — EN VIVO

**Estado: 6 de 7 pasos VERDES el 2026-08-28.** Los temas 2 y 438 escribieron su primer
mensaje a las 21:30 y 21:31 y montaron los suyos, y a las 22:23 un ejecutor del tema 438
confirmó que corre **en la copia**: el ciclo entero está visto en vivo. Falta sólo el
**paso 6** (`/ws off`), que lo dispara un mensaje. Lo que salió, abajo en cada paso.

Los tests (`tests/auto-workspace.test.mjs`, `tests/git-pendiente.test.mjs`) prueban la
decisión y la política de git sin Telegram de por medio. Lo que **no** pueden probar es el
ciclo entero: que el bot monta de verdad al recibir el primer mensaje de un tema, que tarda
lo que debe, y que el freno no se queda en rojo.

### ⚠ Hallazgo ABIERTO: un montaje que falla A MITAD deja el tema en un bucle sin salida

Encontrado revisando el 2026-08-28, **no** por un fallo en vivo. `--nuevo` clona los cinco
repos **antes** de escribir `WORKSPACE.json`, así que un montaje cortado a mitad —un `git
clone` que falla por red, disco lleno, o un reinicio del bot— deja el directorio a medias y
**sin identidad**. A partir de ahí las dos mitades se bloquean entre sí:

| Quién | Qué hace con `~/ws/tema-<id>` a medias | Comprobado |
|---|---|---|
| `resolverWorkspace()` | lo **RECHAZA**: «existe pero no es un workspace: no tiene WORKSPACE.json» | ✅ 2026-08-28 |
| `workspace.mjs --nuevo` | lo **RECHAZA**: «Ya existe … Elige otro nombre o bórralo a mano» (código 1) | ✅ 2026-08-28 |

Como el fallo de montaje **no escribe decisión** —a propósito, para que se reintente—, el
tema reintenta en **cada mensaje** y falla **siempre igual**. No es silencioso (el aviso sale
en cada mensaje y nombra `/ws off` como salida), pero es un reintento que **nunca puede
funcionar**, y el texto que ve el usuario dice «elige otro nombre», que aquí no es el arreglo.

**Alcance:** sólo tras un montaje interrumpido. Un montaje limpio tarda 5,5 s (medido) y no
pasa por aquí. **Las dos salidas de hoy** son `/ws off` en ese tema, o `rm -rf ~/ws/tema-<id>`
en la máquina.

**Sin arreglar, a propósito**, porque toca la ruta que decide el árbol de un tema y pide su
test (R17). La salida más limpia es que `--nuevo` distinga «existe y está sano» de «existe a
medias» y pueda **retomar** el segundo, en vez de que el único estado reintentable sea el que
no existe.

**Esta lista se corre en cuanto se le mande el primer mensaje a Claude tras desplegar esto.**
Va en git y no en `~/.claude/` por lo de siempre: la máquina se rehace y esa memoria no
sobrevive justo al evento que tiene que sobrevivir.

---

## ⚠ ANTES DE NADA: el primer mensaje elige el tema por defecto

El **primer** tema que escriba después de reiniciar el bot se queda con el árbol del
coordinador (`~/src`) y **no monta nada**. Es deliberado y es como el usuario lo elige: no hay
configuración, se elige escribiendo ahí primero.

> **Manda el primer mensaje en el tema que quieras como principal.** Si te equivocas: `/ws off`
> en el tema que lo pilló y borra `data/ws/<tema>.json`, o átalo a mano con `/ws <nombre>`.

Y si `data/ws/` ya tiene ficheros de antes (este server ya venía usándose), **el defecto puede
estar pillado ya**. Míralo antes:

```bash
ls -la ~/src/telegram-coordinator/data/ws/
grep -l '"modo": *"defecto"' ~/src/telegram-coordinator/data/ws/*.json 2>/dev/null
```

---

## La lista

### 1. Los tests pasan en esta máquina ✅ 2026-08-28

```bash
cd ~/src/telegram-coordinator && npm test
```

Esperado: `# fail 0`, con los ficheros nuevos incluidos.

**Salió:** `# tests 111 · # pass 111 · # fail 0`. Repetido el 2026-08-28 **dentro de un
workspace automático** (`~/ws/tema-438`): los mismos 111.

⚠ **Desde el arreglo del freno son 117**, con los seis de `tests/cerrable-casa.test.mjs`. Las
dos medidas de arriba son de antes de ese commit, y se dejan con su número: un número medido no
se reescribe, se fecha.

⚠ **Pero ahí hay que instalar antes, y `--nuevo` no lo dice.** Un workspace recién montado no
tiene `node_modules` —`workspace.mjs --nuevo` clona y nada más—, así que `npm test` en la copia
falla con `Cannot find package 'tsx'`, que **parece** un fallo del código y es una dependencia
que falta. Medido el 2026-08-28 en `~/ws/tema-438`: 13/13 ficheros de test rojos antes de
instalar, 111/111 verdes después.

```bash
cd ~/ws/tema-<id>/telegram-coordinator && npm install && npm test
```

Es el mismo hueco que el venv de `foveal-vision`, con la diferencia de que aquél **sí** sale en
lo que `--nuevo` imprime al terminar («lo que falta, y por qué no lo hago yo») y éste no.

### 2. El tema principal se queda con el defecto, y NO monta ✅ 2026-08-28

**Salió**, y en vivo por Telegram sin que nadie lo provocara: el bot arrancó a las 21:18:05
UTC y el primer mensaje del tema principal, a las 21:21:02, dejó en el log

```
[WS] -1004383895505_main se queda con el árbol del coordinador (primer tema que escribe)
```

con `data/ws/-1004383895505_main.json` en `"modo": "defecto"`, `"ws": null`, y `~/ws`
**sin crear**.

Manda cualquier mensaje en el tema que quieras como principal.

| Qué pasa | Qué significa |
|---|---|
| responde normal, sin mencionar ningún workspace | ✅ se quedó con `~/src` |
| dice que está montando algo | ❌ el defecto ya estaba pillado por otro tema |

Comprobar:

```bash
cat ~/src/telegram-coordinator/data/ws/*_main.json     # → "modo": "defecto", "ws": null
ls ~/ws 2>/dev/null                                    # → no debería haber nada nuevo
```

### 3. Un tema NUEVO monta el suyo, y lo dice ✅ 2026-08-28

**Salió, dos veces y por Telegram.** Del log del bot, con el reloj:

| tema | primer mensaje | atado | tardó |
|---|---|---|---|
| 2 | 21:30:38 | 21:30:44 | **6 s** |
| 438 | 21:31:07 | 21:31:13 | **6 s** |

Los dos avisaron antes (`🧰 Primer mensaje de este tema: le monto su propio workspace…`) y
después (`🧰 Workspace propio montado y atado: /home/deploy/ws/tema-N`).

Y el montaje es correcto en las cinco cosas que `--nuevo` promete:

- `WORKSPACE.json` con `nombre`, `rama` y **prefijo derivado del tema** — `t2-` y `t438-`,
  distintos por construcción, que es lo único que separa las máquinas de pago de dos temas;
- los **cinco** repos clonados, y los cinco en la rama del workspace;
- `data/fuentes.json` apuntando **sólo** a su propio árbol;
- el estado efímero por tema (`sessions`, `claude-sessions`, `shell-cwd`, `ws`) **borrado** en
  la copia — sin eso, dos coordinadores creerían los dos que mandan sobre la misma conversación;
- `data/ws/<tema>.json` en `"modo": "atado"`.

⚠ **El campo `sesion` queda en `<quien>`, y aquí es lo correcto**: quien monta es el bot, que no
es una sesión de Claude. Revisando esto salió que **tampoco se rellenaba cuando sí lo era**
(`workspace.mjs` leía `CLAUDE_SESSION_ID`, que está vacía; la que existe es
`CLAUDE_CODE_SESSION_ID`). Arreglado en el mismo commit que esta nota.

Abre un tema nuevo y manda cualquier cosa (p. ej. `hola`).

Esperado: un aviso de que está montando, y a los pocos segundos que quedó atado a
`~/ws/tema-<id>`. **Medido el 2026-08-28: clonar los cinco repos tarda 6 s** (78 MB), así que
si tarda mucho más, mirar la red antes que el código.

```bash
ls ~/ws/                                  # → tema-<id>
cat ~/ws/tema-<id>/WORKSPACE.json         # → nombre, prefijo t<id>-, rama
cat ~/src/telegram-coordinator/data/ws/*_<id>.json   # → "modo": "atado", ws apuntando ahí
```

⚠ **`modo` NO distingue el montaje automático del `/ws` a mano**, y este documento decía
`"auto"`, que **no existe**: `setWorkspace()` escribe `"atado"` por los dos caminos
(`src/workspaces.ts:144-149`) y los únicos modos son `atado`, `suelto` y `defecto`. Lo que sí
los distingue son el `que` del `WORKSPACE.json` —`tema <sid> de Telegram`, que sólo escribe
`src/index.ts:80`— y el aviso en el log del bot. Corregido el 2026-08-28: el mismo paso 3 ya
decía `"atado"` cuatro líneas más arriba, o sea que el documento se contradecía a sí mismo.

### 4. Y de verdad corre allí ✅ 2026-08-28

**Salió, por Telegram y por el camino automático.** A las 22:23 se abrió sesión con `/use c` en
el tema 438 —que tenía workspace automático desde las 21:31— y el ejecutor recibió del
coordinador:

```
COORD_WS      = /home/deploy/ws/tema-438
COORD_SESSION = -1004383895505_438
cwd           = /home/deploy/ws/tema-438/telegram-coordinator
```

Y desde ahí `node scripts/workspace.mjs` imprime `Workspace: /home/deploy/ws/tema-438` con los
cinco repos en la rama `tema-438` y código 0. O sea: un ejecutor de verdad, atado por el
**automontaje** y no por un `/ws` a mano, corriendo **en la copia**.

⚠ **Y la decisión 4 se sostiene también aquí**:
`DATA_DIR = /home/deploy/src/telegram-coordinator/data`, absoluto y apuntando al árbol del
coordinador. El estado por tema —el `cd` de `shell`, la conversación de `claude`— **no** se
mudó con el workspace, que es lo que impide que atar un tema parezca borrarle las dos cosas.

Antes de esto ya estaba cubierta la lógica: `cwdEnWorkspace()`, alimentado con las ataduras
**reales** cargadas del disco, manda cada tema a su árbol y no se equivoca de ninguno:

```
-1004383895505_main   ws=(ninguno)   foveal-vision -> /home/deploy/src/foveal-vision
-1004383895505_2      ws=~/ws/tema-2    foveal-vision -> /home/deploy/ws/tema-2/foveal-vision
-1004383895505_438    ws=~/ws/tema-438  foveal-vision -> /home/deploy/ws/tema-438/foveal-vision
```

Tres temas, tres árboles, incluido el del propio coordinador.

Para repetirlo en otro tema:

```
/use workspace
(cualquier mensaje)
```

La primera línea tiene que decir `Workspace: /home/deploy/ws/tema-<id>`. Si dice
`/home/deploy/src`, el re-enraizado no está funcionando y ahí se para todo.

⚠ Y vale la trampa de siempre: **no lo compruebes con `shell` + `pwd`** si ese tema ya tenía un
`cd` guardado, porque el `cd` gana sobre el workspace y parece que no hizo nada.

### 5. ⚠ EL FRENO — la parte que cuesta dinero ✅ 2026-08-28

**Repetido con el escenario de verdad**, ya con los **dos** workspaces automáticos montados —10
repos en 10 ramas locales y dos `fuentes.json` reescritos—: `🟢 CERRABLE`, código 0. Que es el
punto entero del arreglo: sin él serían diez avisos por dos árboles donde no se ha hecho nada.

Y antes, las dos mitades sobre un workspace montado con el comando del automontaje:

| Estado del workspace | Veredicto | |
|---|---|---|
| recién montado, sin tocar | `🟢 CERRABLE` (código 0) | ✅ el arreglo se aplicó |
| 1 fichero sin commitear | `🔴 NO CERRAR` · `foveal-vision [tema-99999]: 1 fichero(s) sin commitear` | ✅ no se pasó de frenada |
| ese fichero **commiteado**, árbol limpio | `🔴 NO CERRAR` · `la rama "tema-99999" no está en el remoto` | ✅ la regla afloja la rama vacía, no la que tiene trabajo |

Y una tercera que la lista no pedía: el `data/fuentes.json` que se ignora **sólo** se ignora
dentro de un workspace. Tocando el del **coordinador** (`~/src/telegram-coordinator`) el aviso
sale igual (`telegram-coordinator [src]: 1 fichero(s) sin commitear`), que es lo que impide que
el permiso se extienda al árbol de verdad (`scripts/cerrable.mjs:156`).

Con uno o dos workspaces automáticos montados y **sin haber hecho nada en ellos**:

```bash
node ~/src/telegram-coordinator/scripts/cerrable.mjs
```

| Qué sale | Qué significa |
|---|---|
| `🟢 CERRABLE` | ✅ un workspace vacío ya no es «trabajo que se perdería» |
| `🔴 NO CERRAR — N cambio(s) sin empujar` | ❌ la política de git no se aplicó: el freno queda inservible desde el primer día |

Y la otra mitad, que es la que **no** se puede aflojar. Haz un cambio de verdad y comprueba
que **sí** avisa:

```bash
echo x > ~/ws/tema-<id>/foveal-vision/borrame.txt
node ~/src/telegram-coordinator/scripts/cerrable.mjs | grep tema-
rm ~/ws/tema-<id>/foveal-vision/borrame.txt
```

Esperado: `foveal-vision [tema-<id>]: 1 fichero(s) sin commitear`. **Si no avisa, el arreglo se
pasó de frenada y el freno esconde trabajo real** — que es el fallo caro de los dos.

### 6. `/ws off` no se deshace solo ⏳ PENDIENTE — es lo único que queda

Ya se puede correr: el tema 2 y el 438 tienen workspace automático. Cubierto por test mientras
tanto (`/ws off` es una DECISIÓN: el tema soltado no se re-monta solo · soltar deja rastro en
disco, no borra el fichero), pero el test no prueba que el bot lo respete de mensaje a mensaje.

⚠ **Da igual en cuál de los dos**: con el paso 4 ya cerrado, soltar uno no deja nada sin
comprobar. Lo que sí conviene es **volver a atarlo después** (`/ws <nombre>`), o ese tema se
queda trabajando en el árbol del coordinador — el automontaje no lo remonta, que es justo lo
que este paso comprueba.

En un tema con workspace automático:

```
/ws off        → 🔓 Workspace soltado
(otro mensaje) → NO debe volver a montar nada
/ws            → «Este tema no está atado…»
```

Si al mensaje siguiente vuelve a montar, `/ws off` no sirve de nada y no hay salida de
emergencia.

### 7. Un tema que no escribe no cuesta nada ✅ 2026-08-28

**Salió, y ahora con temas de verdad:** en `~/ws` hay **exactamente** `tema-2` y `tema-438`, los
dos que escribieron, y ni uno más — el grupo tiene más temas y ninguno ha costado un fichero.
Antes de que escribieran, `~/ws` no existía siquiera. **78 MB** cada uno (medido).

```bash
ls ~/ws/          # sólo los temas que HAN escrito, ni uno más
du -sh ~/ws/      # ~78 MB por workspace (medido 2026-08-28), sin contar venvs
```

---

## Si algo falla

Distinguir «el código no llegó» de «el código está mal»:

```bash
git -C ~/src/telegram-coordinator log --oneline -3
cd ~/src/telegram-coordinator && npm test          # si pasa, el código está bien
journalctl -u telegram-coordinator -n 50 --no-pager
```

## Lo que falta para cerrarlo: un mensaje

```
en el tema 2 o en el 438     /ws off  +  otro mensaje  +  /ws     → paso 6
```

El paso 4 se cerró solo, con el ejecutor que ya estaba corriendo en el tema 438, así que ya no
hay que reservarle un tema atado a nada.

Cuando ese quede verde, marcar este documento entero como verificado —igual que
[`verificar-ws-2026-08-28.md`](verificar-ws-2026-08-28.md)—, y seguir con lo que estaba
pendiente: **lanzar `do-v`** (§ «PENDIENTE AHORA MISMO» de [`../CLAUDE.md`](../CLAUDE.md)).
