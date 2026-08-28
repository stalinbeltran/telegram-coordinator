# Verificar «el primer mensaje de un tema decide su workspace» — EN VIVO

**Estado: 4 de 7 pasos VERDES el 2026-08-28. Faltan los 3 que necesitan un tema NUEVO**
(los pasos 3, 4 y 6: sólo los puede disparar un mensaje de Telegram, y este documento no
puede mandarse uno a sí mismo). Lo verificado y lo que salió, abajo en cada paso.

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

**Salió:** `# tests 111 · # pass 111 · # fail 0`.

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

### 3. Un tema NUEVO monta el suyo, y lo dice ⏳ PENDIENTE

Necesita que alguien escriba en un tema nuevo desde Telegram. Lo que **sí** está medido es la
parte cara, corriendo a mano el mismo comando que el automontaje lanza
(`--nuevo tema-99999 --prefijo t99999- --que "…"`): **5,5 s** para los cinco clones y
**78 MB** en disco — o sea que el «~6 s / ~78 MB» del paso 7 queda confirmado.

Abre un tema nuevo y manda cualquier cosa (p. ej. `hola`).

Esperado: un aviso de que está montando, y a los pocos segundos que quedó atado a
`~/ws/tema-<id>`. **Medido el 2026-08-28: clonar los cinco repos tarda 6 s** (78 MB), así que
si tarda mucho más, mirar la red antes que el código.

```bash
ls ~/ws/                                  # → tema-<id>
cat ~/ws/tema-<id>/WORKSPACE.json         # → nombre, prefijo t<id>-, rama
cat ~/src/telegram-coordinator/data/ws/*_<id>.json   # → "modo": "auto", ws apuntando ahí
```

### 4. Y de verdad corre allí ⏳ PENDIENTE

Depende del 3. El re-enraizado en sí ya salió verde para el `/ws` manual
([`verificar-ws-2026-08-28.md`](verificar-ws-2026-08-28.md) paso 4) y la atadura la escribe el
mismo `setWorkspace()` en los dos casos, así que lo que falta por ver es el camino automático,
no el mecanismo.

En ese tema:

```
/use workspace
(cualquier mensaje)
```

La primera línea tiene que decir `Workspace: /home/deploy/ws/tema-<id>`. Si dice
`/home/deploy/src`, el re-enraizado no está funcionando y ahí se para todo.

### 5. ⚠ EL FRENO — la parte que cuesta dinero ✅ 2026-08-28

**Salieron las dos mitades**, con un workspace montado con el comando del automontaje:

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

### 6. `/ws off` no se deshace solo ⏳ PENDIENTE

Depende del 3. Cubierto por test mientras tanto (`/ws off` es una DECISIÓN: el tema soltado no
se re-monta solo · soltar deja rastro en disco, no borra el fichero).

En un tema con workspace automático:

```
/ws off        → 🔓 Workspace soltado
(otro mensaje) → NO debe volver a montar nada
/ws            → «Este tema no está atado…»
```

Si al mensaje siguiente vuelve a montar, `/ws off` no sirve de nada y no hay salida de
emergencia.

### 7. Un tema que no escribe no cuesta nada ✅ 2026-08-28

**Salió:** con un solo tema escribiendo (el principal, que se queda con el defecto), `~/ws`
**no existe**. Y el tamaño de un workspace, medido a mano: **78 MB**.

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

## Lo que falta para cerrarlo, y es un mensaje

Los tres pasos que quedan (3, 4 y 6) los dispara **una sola acción**: escribir cualquier cosa
en un **tema nuevo** del grupo. Ahí se ven los tres seguidos — monta y lo dice (3), `/use
workspace` confirma el árbol (4), y `/ws off` no se deshace solo (6).

⚠ **El principal ya está pillado**, así que esto ya no puede robártelo: `-1004383895505_main`
tiene el `defecto` desde las 21:21 del 2026-08-28. Cualquier tema nuevo monta el suyo.

Cuando esos tres queden verdes, marcar este documento entero como verificado —igual que
[`verificar-ws-2026-08-28.md`](verificar-ws-2026-08-28.md)—, y seguir con lo que estaba
pendiente: **lanzar `do-v`** (§ «PENDIENTE AHORA MISMO» de [`../CLAUDE.md`](../CLAUDE.md)).
