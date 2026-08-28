# Verificar «el primer mensaje de un tema decide su workspace» — EN VIVO

**Estado: PENDIENTE.** Los tests (`tests/auto-workspace.test.mjs`,
`tests/git-pendiente.test.mjs`) prueban la decisión y la política de git sin Telegram de por
medio. Lo que **no** pueden probar es el ciclo entero: que el bot monta de verdad al recibir
el primer mensaje de un tema, que tarda lo que debe, y que el freno no se queda en rojo.

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

### 1. Los tests pasan en esta máquina

```bash
cd ~/src/telegram-coordinator && npm test
```

Esperado: `# fail 0`, con los ficheros nuevos incluidos.

### 2. El tema principal se queda con el defecto, y NO monta

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

### 3. Un tema NUEVO monta el suyo, y lo dice

Abre un tema nuevo y manda cualquier cosa (p. ej. `hola`).

Esperado: un aviso de que está montando, y a los pocos segundos que quedó atado a
`~/ws/tema-<id>`. **Medido el 2026-08-28: clonar los cinco repos tarda 6 s** (78 MB), así que
si tarda mucho más, mirar la red antes que el código.

```bash
ls ~/ws/                                  # → tema-<id>
cat ~/ws/tema-<id>/WORKSPACE.json         # → nombre, prefijo t<id>-, rama
cat ~/src/telegram-coordinator/data/ws/*_<id>.json   # → "modo": "auto", ws apuntando ahí
```

### 4. Y de verdad corre allí

En ese tema:

```
/use workspace
(cualquier mensaje)
```

La primera línea tiene que decir `Workspace: /home/deploy/ws/tema-<id>`. Si dice
`/home/deploy/src`, el re-enraizado no está funcionando y ahí se para todo.

### 5. ⚠ EL FRENO — la parte que cuesta dinero

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

### 6. `/ws off` no se deshace solo

En un tema con workspace automático:

```
/ws off        → 🔓 Workspace soltado
(otro mensaje) → NO debe volver a montar nada
/ws            → «Este tema no está atado…»
```

Si al mensaje siguiente vuelve a montar, `/ws off` no sirve de nada y no hay salida de
emergencia.

### 7. Un tema que no escribe no cuesta nada

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

## Cuando esto quede verde

Marcar este documento como verificado con su fecha y lo que salió —igual que
[`verificar-ws-2026-08-28.md`](verificar-ws-2026-08-28.md)—, y seguir con lo que estaba
pendiente: **lanzar `do-v`** (§ «PENDIENTE AHORA MISMO» de [`../CLAUDE.md`](../CLAUDE.md)).
