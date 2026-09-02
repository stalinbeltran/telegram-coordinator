# El freno dejó de contar una flota viva, y dijo que era «de otro server»

**Hallazgo ABIERTO, 2026-09-01.** Estado: **diagnosticado y medido, NO arreglado.** Este
documento existe porque el fallo toca `scripts/cerrable.mjs`, que es lo único que impide
destruir un server con máquinas facturando — y porque la salida que parecía obvia (dar
identidad al árbol de casa) **empeora el fallo**, cosa que sólo se ve midiéndola.

---

## 1. Qué pasó, en vivo

El 2026-09-01 a las 21:43 UTC se lanzó una flota de 44 runs sobre 11 máquinas de Vast con
`estudio_flota.py --prefijo dr-`, desde una sesión **sin workspace** (`~/src`, el árbol de
casa). A los pocos minutos el freno las contaba bien:

```
🟡 NO SÉ — 13 máquinas Vast (0.8126 $/h) · 1 trabajo(s) vivo(s): estudio_flota.py
```

**Una hora después, con las mismas máquinas facturando, decía lo contrario:**

```
🟡 NO SÉ — 1 trabajo(s) vivo(s): estudio_flota.py · 25 cambio(s) sin empujar
...
  ok Vast: nada de esta máquina (11 instancia(s) de otro server, no cuentan)
```

**Eran las nuestras.** Lo que cambió en esa hora no fue la flota: fue que **se automontó
`~/ws/tema-2`** (otro tema de Telegram escribió su primer mensaje), y ese workspace **sí
trae** `WORKSPACE.json` con `prefijo: "t2-"`.

## 2. Por qué — la causa raíz

`cerrable.mjs` deduce «mis prefijos» de los `WORKSPACE.json` de los árboles locales
(`scripts/workspaces-locales.mjs`), y filtra así (`cerrable.mjs:173-175`):

```js
const mias = prefijosLocales.length
  ? filas.filter((f) => prefijosLocales.some((p) => f.etiqueta.startsWith(p)))
  : filas;                       // sin ningún prefijo conocido, cuentan TODAS
```

Mientras no había **ningún** workspace con identidad, caía en la rama segura: *cuentan
todas*. En cuanto apareció **uno solo** —de otro tema—, pasó a filtrar; y `dr-c1` no empieza
por `t2-`, así que la flota entera se volvió invisible.

⚠ **El dato que falta no es un fichero: es el prefijo con el que se alquiló.** Ése es un
argumento libre de `estudio_flota.py --prefijo`, o sea **un hecho del proceso**, y el freno
lo estaba deduciendo del **layout del disco**. Es exactamente el antipatrón de la **R4** que
la propia cabecera de `cerrable.mjs` cita para explicar por qué `COORD_HOME` se declara.

### 2.1 Y hay una segunda mitad, peor: una afirmación que no se puede sostener

`cerrable.mjs:185`:

```js
limpio.push(`Vast: nada de esta máquina (${ajenas} instancia(s) de otro server, no cuentan)`);
```

**«No casa con ningún prefijo que conozco» no es «es de otro server».** Va a `limpio`, o sea
que se presenta como una comprobación superada. Debería ser una **duda**: es justo el tipo de
fallo silencioso que este script existe para no cometer.

## 3. La salida que parecía obvia — y por qué NO sirve

La pregunta natural es: *¿y si `~/src` tuviera su propio `WORKSPACE.json`?* Se midió el
2026-09-01 simulando las dos configuraciones con el código real, sin tocar el sistema:

```bash
mkdir -p /tmp/wstest/casa /tmp/wstest/ws/tema-2
echo '{"nombre":"tema-2","prefijo":"t2-"}' > /tmp/wstest/ws/tema-2/WORKSPACE.json
node --input-type=module -e '
import { workspacesLocales } from "'"$PWD"'/scripts/workspaces-locales.mjs";
import { writeFileSync } from "node:fs";
process.env.COORD_WS_RAIZ = "/tmp/wstest/ws";
const etiquetas = ["dr-c1","dr-sd-t-s1","t2-x1"];
const prueba = (t) => {
  const L = workspacesLocales(["/tmp/wstest/casa"]);
  const pref = L.map(l=>l.prefijo).filter(Boolean);
  const mias = pref.length ? etiquetas.filter(e=>pref.some(p=>e.startsWith(p))) : etiquetas;
  console.log(t, "prefijos:", pref, "MIAS:", mias,
              "sinIdentidad:", L.filter(l=>!l.prefijo).map(l=>l.nombre));
};
prueba("A)");
writeFileSync("/tmp/wstest/casa/WORKSPACE.json", `{"nombre":"casa","prefijo":"dr-"}`);
prueba("B)");
writeFileSync("/tmp/wstest/casa/WORKSPACE.json", `{"nombre":"casa","prefijo":"sc-"}`);
prueba("C)");'
```

| escenario | prefijos | máquinas contadas | `sinIdentidad` | veredicto |
|---|---|---|---|---|
| **A) hoy** — casa sin identidad | `[t2-]` | `[t2-x1]` ❌ | `[casa]` | 🟡 por la duda |
| **B)** casa con `prefijo: "dr-"` | `[t2-, dr-]` | **las 3** ✅ | `[]` | 🔴 correcto |
| **C)** casa con `"sc-"`, flota con `dr-` | `[t2-, sc-]` | `[t2-x1]` ❌ | **`[]`** | **🟢 CERRABLE** ⚠ |

### 3.1 El escenario C es la razón para NO hacerlo

**Hoy el fallo lleva una red debajo.** `sinIdentidad: [casa]` mete un `NO SÉ` que fuerza el
🟡 e **impide el verde**. Darle identidad a casa **quita esa red**: si el prefijo del
`WORKSPACE.json` no coincide con el `--prefijo` de la flota —y **nada obliga a que
coincidan**, porque un workspace tiene UN prefijo y los estudios se lanzan con el que haga
falta— el freno diría **🟢 CERRABLE con la flota facturando**.

**Hoy falla ruidosamente; con el workspace fallaría en silencio.** El proyecto ya tiene la
regla escrita: *entre un fallo ruidoso y uno silencioso, siempre el ruidoso*.

### 3.2 Y arrastra una regresión aparte

`WORKSPACE.json` marca el árbol como `montado: true`, y entonces `cerrable.mjs:363` aplica
`IGNORA_AL_MONTAR = ['data/fuentes.json']`. *Medido el 2026-09-01 sobre un repo de prueba con
un cambio real en ese fichero:*

```
montado=false (casa HOY):  1 fichero(s) sin commitear; la rama "main" no está en el remoto
montado=true:              la rama "main" no está en el remoto          ← se lo comió
```

Ignorar `fuentes.json` **en un workspace montado** es correcto: lo reescribe `--nuevo`. **En
casa un cambio ahí es un cambio de verdad**, y así está escrito en el `CLAUDE.md` (§ del
freno, decisión 5). Se perdería ese aviso.

### 3.3 Lo que sí es benigno, para no confundirlo con lo anterior

Que `~/src` tenga identidad **no viola ningún diseño**: `listarWorkspaces()` ya lo busca
(`src/workspaces.ts:250`, *«el árbol donde vive el propio coordinador cuenta si tiene
identidad»*). El único efecto sería que sale en `/ws`, que es coherente. El automontaje no
mira `WORKSPACE.json`, así que la regla «el primero que escribe se queda con `~/src`» no
cambia. **El problema no es dársela: es que no arregla lo que se quiere arreglar.**

## 4. Las dos propuestas

Las dos van en `scripts/cerrable.mjs` y se complementan: la primera cubre el caso normal, la
segunda el caso caro que la primera no puede cubrir.

### P1 · Los prefijos salen de los PROCESOS VIVOS, no del disco

Leer el `--prefijo` de la línea de comando de cada `estudio_flota.py` vivo y sumarlo a
`prefijosLocales`.

- **Por qué es el correcto:** el prefijo con el que se alquila es un hecho comprobable del
  proceso que alquiló (**R16**: la identidad la da un dato comprobable, no una convención de
  nombres). Deja de depender de que alguien acierte a poner el mismo string en dos sitios.
- **El dato ya está a mano:** `cerrable.mjs` ya recorre `/proc/<pid>/cmdline` para contar los
  trabajos vivos y su `cwd`. No hace falta fuente nueva.
- **No añade estado en disco**, y eso es deliberado: un fichero de prefijos sería un marcador
  más con su regla de caducidad, y el proyecto ya pagó una vez por un `.resume.lock` que
  nadie limpiaba.

⚠ **Su límite, que hay que escribir junto a ella:** si el proceso muere, su prefijo
desaparece — y ése es justo el momento en que las máquinas quedan huérfanas. Por eso hace
falta la P2.

### P2 · Una instancia que nadie reclama es una DUDA, no «de otro server»

Cambiar `cerrable.mjs:185` para que las instancias que no casan con ningún prefijo conocido
**y** que ningún proceso vivo reclama vayan a `dudas` (🟡 `NO SÉ`) en vez de a `limpio`.

- **Por qué:** es la única lectura que el script puede sostener con lo que sabe. Hoy afirma
  una pertenencia que no ha comprobado, y lo hace en la columna de «comprobaciones
  superadas».
- **Cubre el hueco de la P1:** proceso muerto + máquinas vivas = exactamente el estado que el
  aviso `⚠ N máquina(s) Vast SIN VIGILANTE` ya intenta cubrir por otro lado.
- ⚠ **El precio, y hay que aceptarlo a propósito:** una máquina de verdad ajena (otro server,
  misma cuenta) pasaría a dar 🟡 en vez de 🟢. Es el intercambio correcto: un 🟡 de más cuesta
  una comprobación a mano; un 🟢 de más cuesta una factura que crece sola.

### Lo que NO hay que hacer

- **No dar `WORKSPACE.json` a `~/src`** como arreglo de esto (§3).
- **No obligar a que `--prefijo` case con el del workspace.** Es una convención de nombres
  entre dos ficheros que nadie puede comprobar en el momento de lanzar — y cuando se rompa,
  se romperá en silencio.
- **No quitar la rama segura** *«sin ningún prefijo conocido, cuentan todas»*. Es lo que
  salvó este caso de ser un 🟢.

## 5. Al implementarlo (R17: una comprobación que no corre sola no existe)

Van con sus tests, en `tests/cerrable-prefijos.test.mjs`, y **al menos estos cinco casos —
tres de los cuales fallan con el código de hoy**:

1. flota viva con `--prefijo dr-` y un workspace ajeno con `t2-` → **cuenta las `dr-`** ❌ hoy
2. instancias `dr-` sin ningún proceso vivo que las reclame → **`NO SÉ`**, no «de otro server» ❌ hoy
3. casa con identidad y prefijo que no casa → **no puede salir 🟢** ❌ hoy (escenario C)
4. sin ningún prefijo conocido → cuentan todas ✅ (fija lo que ya funciona)
5. instancias que casan con el prefijo de un workspace local → siguen contando ✅ (ídem)

⚠ **Y el freno se prueba con el freno parado:** tocar `cerrable.mjs` mientras hay una flota
viva significa que, si el cambio se rompe, el error cae justo sobre lo único que vigila el
gasto. Se implementa **con la cuenta de Vast vacía**.

## 6. Mientras tanto — cómo se comprueba a mano

La fuente de verdad no es el freno, es la cuenta:

```bash
cd ~/src/digital-ocean-dropplet-auto-launching && python3 scripts/vast_instance.py list
```

Si el freno dice `Vast: nada de esta máquina (N instancia(s) de otro server)` y hay un
`estudio_flota.py` vivo en esta máquina, **no te lo creas**: mira la lista.
