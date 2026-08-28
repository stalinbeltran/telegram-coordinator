# Verificar «un workspace por TEMA» tras relanzar el server (2026-08-28)

**Por qué existe este documento.** El server del 28-ago se destruyó **a propósito** para probar
`/ws` en una máquina limpia. Lo único que no se pudo comprobar antes de destruirlo es justo lo que
necesita un bot arrancado de cero, y `~/.claude/` no sobrevive: por eso la lista está **en git** y
no en la memoria de Claude.

Commit que se verifica: **`d93a3c9` — «workspaces: un workspace por TEMA»**.

---

## ✅ RESULTADO: los ocho pasos, verdes (2026-08-28, 18:31→19:12 UTC)

Corrido sobre el server nacido a las 18:07 UTC con `2b5b059`, **sin `~/ws`**. El detalle y lo que se
aprendió está en [`../CLAUDE.md`](../CLAUDE.md) § «✅ VERIFICADO el 2026-08-28».

| Paso | Resultado |
|---|---|
| 0 · `/ws` responde | ✅ el bot arrancó con el código nuevo |
| 1 · `npm test` | ✅ `# pass 93` · `# fail 0` |
| 2 · `--nuevo prueba` en máquina sin `~/ws` | ✅ 5 repos en rama `prueba`, prefijo `pr-`, `fuentes.json` apuntando ahí, estado efímero limpio |
| 3 · `/ws prueba` | ✅ y la atadura quedó en `data/ws/`, no en `data/sessions/` |
| **4 · el ejecutor corre AHÍ** | ✅ **la que justificaba relanzar**: repos en rama `prueba` y `fuentes.json` de la copia |
| 5 · `/ws /tmp` se niega | ✅ y la atadura **sobrevivió intacta** a la negativa (`updated` sin tocar) |
| 6 · el freno R11 | ✅ `foveal-vision [prueba]: 1 fichero(s) sin commitear` |
| 7 · `/ws off` + `rm -rf ~/ws/prueba` | ✅ `data/ws/` vacío y la máquina de vuelta en `🟢 CERRABLE` |

Dos comprobaciones **extra**, que no estaban en la lista y ahora están medidas: **dos temas del mismo
bot en dos árboles a la vez**, y la **decisión 4** en vivo (`echo $DATA_DIR` desde el tema atado sigue
dando el árbol del coordinador).

⚠ **Y un hallazgo abierto**, sin arreglar: un `--tomar` no sobrevive a `--cerrar` + `--registrar`
—el traspaso explícito se pierde y cae al workspace deducido del cwd, en silencio—. Está en
`CLAUDE.md`, misma sección, con lo que se reprodujo y lo que no.

⚠ **Lo que costó tiempo aquí y no era un fallo:** el paso 4 salió `/home/deploy/src` porque **se
saltó el paso 3**. Sin atadura, correr en el árbol del coordinador es lo correcto — y es idéntico al
síntoma del fallo que este paso busca. Mira `data/ws/` antes de dar nada por roto.

---

## Qué SÍ quedó verificado antes de destruir (no hace falta repetirlo)

Medido el 2026-08-28 en la máquina anterior:

- `npx tsc --noEmit` limpio y **93/93 tests** (12 nuevos en `tests/workspaces.test.mjs` y
  `tests/runner.test.mjs`).
- Re-enraizado del cwd **a través del orquestador real**, no sólo del arnés: un ejecutor de un tema
  atado corrió en `<workspace>/telegram-coordinator` y recibió `COORD_WS`.
- La **negativa** de R2: con el repo ausente del workspace, el ejecutor se niega **antes de correr**
  y dice las dos salidas (clonar, o `/ws off`).
- El **freno de R11**: `cerrable.mjs` nombra el trabajo sin commitear de **otro** workspace
  (`foveal-vision [dropout]: 1 fichero(s) sin commitear`).
- El `EPIPE` de `runner.ts` que tumbaba el coordinador: reproducido en el código original y
  arreglado con test.

## Lo que NO se pudo verificar, y es todo el motivo de relanzar

1. Que **el bot arranca** con el código nuevo (`loadWorkspaces()` al inicio, `/ws` registrado).
2. Que **`/ws` responde por Telegram**.
3. Que el ciclo entero funciona en una máquina **sin `~/ws`**, que es como nace un dev.

---

## La lista, en orden

### 0. ¿Arrancó el bot con el código nuevo?

Desde Telegram, en cualquier tema:

```
/ws
```

| Qué pasa | Qué significa |
|---|---|
| responde con el workspace del tema y la lista de montados | ✅ el bot tiene el código nuevo |
| **silencio** | ❌ el comando no existe: el bot no arrancó con este commit. Un `/` no reconocido no contesta nada, a propósito |

Si hay silencio, antes de nada:

```bash
git -C ~/src/telegram-coordinator log --oneline -1     # tiene que decir "workspaces: un workspace por TEMA"
systemctl status telegram-coordinator --no-pager | tail -20
```

### 1. La suite pasa en esta máquina

```bash
cd ~/src/telegram-coordinator && npm test
```

Esperado: `# pass 93` · `# fail 0`. Tarda ~30 s.

### 2. Montar un workspace desde Telegram

`~/ws` **no existe** en un dev recién nacido: eso es parte de lo que se prueba.

```
/use workspace
--nuevo prueba --que "verificar /ws tras relanzar"
```

Clona los **cinco** repos (≈80 MB), elige un prefijo libre, escribe `WORKSPACE.json` y deja el
`fuentes.json` de la copia apuntando ahí. Tarda un par de minutos. **No arranca ningún bot**, y dice
por qué (un segundo polling daría error 409).

### 3. Atar el tema

```
/ws prueba
```

Esperado: `✅ Este tema trabaja ahora en: /home/deploy/ws/prueba`.

### 4. Comprobar que un ejecutor corre AHÍ — la prueba de verdad

```
/use workspace
```
...y mandar un mensaje vacío (o cualquier cosa). La **primera línea** tiene que decir:

```
Workspace: /home/deploy/ws/prueba  (prueba)
```

⚠ Si dice `/home/deploy/src`, **el re-enraizado no está funcionando** y ahí se para la verificación.

⚠ **No uses `shell` + `pwd` para esta comprobación si el tema ya tenía un `cd`.** Medido el
2026-08-28: `shell-cwd.mjs` guarda un directorio por tema y **ese `cd` gana** sobre el workspace.
Es coherente —el `cd` es explícito y más específico— pero hace parecer que `/ws` no hizo nada.
Sin `cd` previo, `shell` sí sale bajo el workspace.

### 5. Que la negativa sigue negando (R2)

```
/ws /tmp
```

Esperado: se **niega** porque `/tmp` no tiene `WORKSPACE.json`, y explica que sin identidad no hay
prefijo. No debe atar nada.

### 6. El freno (R11) — la parte que cuesta dinero

```bash
echo basura > ~/ws/prueba/foveal-vision/borrame.txt
node ~/src/telegram-coordinator/scripts/cerrable.mjs | grep prueba
rm ~/ws/prueba/foveal-vision/borrame.txt
```

Esperado: `foveal-vision [prueba]: 1 fichero(s) sin commitear`.

⚠ Si **no** nombra el otro workspace, el freno está roto: `cerrable` diría `🟢 CERRABLE` con el
trabajo (o la flota) de otro tema colgando. Es el fallo silencioso que este script existe para no
cometer.

### 7. Soltar y dejarlo limpio

```
/ws off
```

Esperado: `🔓 Workspace soltado.` Y si el workspace de prueba ya no hace falta:

```bash
rm -rf ~/ws/prueba
```

⚠ Mira antes que no haya nada tuyo ahí dentro sin empujar: `node scripts/cerrable.mjs`.

---

## Si algo falla

Lo primero es distinguir **«el código no llegó»** de **«el código está mal»**:

```bash
git -C ~/src/telegram-coordinator log --oneline -3
cd ~/src/telegram-coordinator && npm test          # si esto pasa, el código está bien
npx tsx scripts/test-executor.mjs workspace ""     # el arnés, sin Telegram de por medio
```

El arnés ya honra el workspace del tema (`COORD_SESSION=<tema>`), así que reproduce lo mismo que
verías por Telegram sin depender de que el bot esté arriba.

## Y cuando esto quede verde

Sigue lo que ya estaba pendiente: **lanzar `do-v`**, el estudio completo de `dropout`
(§ «PENDIENTE AHORA MISMO» de [`../CLAUDE.md`](../CLAUDE.md)). 20 runs · ≈1,1 $ · ~3,5 h.
