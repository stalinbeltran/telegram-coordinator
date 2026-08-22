# Ejecutores federados: que los comandos estén siempre disponibles, en cualquier máquina

**Fecha:** 2026-08-22. **Estado:** propuesta, no implementada.
**Origen:** la [revisión de commits de agosto](revision-2026-08-22.md), patrón F.

El coordinador dice que un ejecutor es **dato, no código**, y que añadir uno no
debe requerir tocar nada. Es verdad a medias: hoy hay **cuatro** caminos distintos
para que un ejecutor llegue a una máquina, tres de ellos con un paso manual, y
ninguno cubre el caso que más se usa —un comando que vive en **otro** repo—.

Este documento describe el problema con lo que costó, la propuesta, y por qué es
un cambio pequeño.

---

## 1. Cómo llega hoy un ejecutor a una máquina

| # | Camino | Quién lo usa | Qué hace falta |
|---|---|---|---|
| 1 | **Sembrado en código** (`seedBootKit` en `registry.ts`) | `shell`, `definer`, `echo` | recompilar/reempaquetar el coordinador |
| 2 | **Versionado en `data/executors/`** del coordinador | `c`, `creset`, `directorio`, `preflight`, `bench`, `barrido` | `git pull` del coordinador |
| 3 | **Declarado en el descriptor de servicio del lanzador** (bloque `files` de `services/telegram-launcher.json`) | `lanzar`, `actualizar`, `ejecutores`, `vast`, `datos`, `estado`, `apagar-vast`, `apagar-do`, `ayuda` | `git pull` del lanzador **+** `do_droplet.py install-executors` **+** reinicio |
| 4 | **Creado desde el móvil** con `definer` | los que inventes sobre la marcha | nada — y por eso **se pierden con la máquina** |

El camino 1 contradice la filosofía del repo pero es necesario para arrancar. El
4 es la comodidad que hace útil al `definer`. Los que duelen son el **2** y el
**3**, y por motivos opuestos.

### El camino 3 tiene un argumento correcto y un mecanismo malo

`b35a0cb` razona bien por qué los ejecutores del lanzador viven en el lanzador:

> *«Viven en ESTE repo y no en el del coordinador a propósito: llaman a comandos
> de aquí, y separados una de las dos mitades quedaría desfasada sin avisar.»*

**Ese argumento hay que conservarlo entero.** Un ejecutor que invoca
`vast_instance.py sweep` tiene que viajar con `vast_instance.py`; si no, el día
que cambie un flag el síntoma será un ejecutor que falla con un error de
argumentos y nadie sabrá por qué.

Lo que está mal no es **dónde viven**: es **cómo llegan**. Llegan **copiándose**:
`install-executors` lee el descriptor y escribe ficheros dentro de
`telegram-coordinator/data/executors/`. Y una copia tiene precio:

- **Un paso manual más.** `git pull` trae el código pero no los ejecutores, así
  que hacen falta dos mensajes (`actualizar`, luego `ejecutores`) y hay que
  acordarse del segundo.
- **Un huevo y gallina.** `ejecutores` **es** un ejecutor, así que la primera vez
  en una máquina nueva no existe y hay que teclear desde el móvil:
  `shell   cd ~/src/digital-ocean-dropplet-auto-launching && python3 scripts/do_droplet.py install-executors --service telegram-launcher`.
- **Código nuevo que puede fallar.** Y falló en su primera ejecución real
  (`f7c2849`: `TypeError` en `run_local`, y un contador global que reiniciaba
  servicios que no habían cambiado).
- **Un reinicio que no hace falta.** `getExecutor()` lee el disco **en cada
  mensaje** (`registry.ts` no cachea nada), así que un ejecutor nuevo está vivo
  en cuanto el fichero existe. `install-executors` reinicia el servicio de todos
  modos.
- **Un catálogo paralelo.** El coordinador no sabe describir un ejecutor, así que
  la descripción va en un bloque `ayuda` aparte, y hace falta un comando
  (`do_droplet.py executors`) y un ejecutor (`ayuda`) para imprimirlo. Están en el
  mismo fichero para que no diverjan, que es un buen apaño para un problema que no
  debería existir.

### El camino 2 tiene el problema simétrico

`bench` y `barrido` viven en el coordinador y **conocen la disposición interna de
otros repos**:

```
"command": "... cd \"$HOME/src/foveal-vision\" || exit 1;
            if [ -d /mnt/bench-data ]; then BENCH_VOLUME=/mnt/bench-data;
            else BENCH_VOLUME=\"$HOME/bench-data\"; fi; ...
            python3 scripts/bench_fleet.py {{input}} ..."
```

Tres suposiciones ajenas en una línea: que el repo está en `~/src/foveal-vision`,
que se llama `bench_fleet.py` y que lee `BENCH_VOLUME`. `1c100bb` es exactamente
esa deuda cobrándose: la ruta del dataset se había cableado al punto de montaje
del volumen, y en una máquina sin volumen fallaba con el dato construido y
verificado delante.

**El coordinador no puede saber que se rompió, y `foveal-vision` no puede saber
que alguien depende de él.** Es el acoplamiento que `b35a0cb` evita para el
lanzador… y que el propio coordinador tiene con los otros dos repos.

### El coste, resumido

| síntoma | commit | coste |
|---|---|---|
| `apagar-vast` llegó **1 h 08 min** después de poder alquilar máquinas | `b35a0cb` | capacidad de gastar sin freno desde el móvil |
| `install-executors` falló al primer uso real | `f7c2849` | una vuelta |
| El ejecutor `bench` buscaba el dataset donde no estaba | `1c100bb` | una vuelta, y un fallo con el dato bueno delante |
| El huevo y gallina del arranque en frío | `c22293c` | un comando largo tecleado desde el móvil, cada máquina nueva |
| Ejecutores del `definer` perdidos al destruir la máquina | README del lanzador | se documentó el rodeo («haz push antes de destruir») |

Y el patrón de fondo: **cuando añadir un ejecutor cuesta un descriptor ajeno, un
comando y un reinicio, se pospone.** Por eso el freno llegó después del acelerador.

---

## 2. La propuesta: descubrir, no copiar

Que cada repo declare sus propios ejecutores, y que el coordinador **los lea donde
están** en vez de que se los copien.

### 2.1 Convención

Un repo que quiera aportar comandos al bot crea:

```
<repo>/telegram/executors/*.json      ejecutores
<repo>/telegram/encargados/*.json     encargados (si necesita alguno propio)
```

Nada más. Se commitea con el código al que llama, como pide `b35a0cb`, y llega a
cualquier máquina con `git clone` o `git pull`.

### 2.2 La lista de fuentes es dato

`data/fuentes.json` en el coordinador, versionado:

```json
{
  "fuentes": [
    "data",
    "~/src/*/telegram"
  ]
}
```

Cada entrada es un directorio que contiene `executors/` y/o `encargados/`. Se
admite **un** `*` de un nivel. `data` va primero a propósito: lo local siempre
puede pisar a lo descubierto, que es la salida cuando algo de otro repo estorba.

Sobreescribible con `COORD_FUENTES` en `.env` para casos raros (Windows, repos
fuera de `~/src`). Sigue siendo dato: **no hay ninguna ruta cableada en `src/`**.

Es una lista **explícita**, no un escaneo del disco: la superficie de lo que el
bot puede ejecutar tiene que ser algo que se lea de un fichero, no algo que
dependa de qué haya clonado alguien.

### 2.3 Tres campos opcionales en el JSON del ejecutor

```json
{
  "name": "bench",
  "descripcion": "Mide s/época en droplets de distinta capacidad de vCPU. Tarda decenas de minutos y avisa al terminar.",
  "ejemplos": ["--vcpus 2,4,8", "--vcpus 2 --dry-run"],
  "command": "scripts/desacoplar.sh sh -c '... python3 scripts/bench_fleet.py {{input}} ...'",
  "encargados": ["echo"],
  "timeoutMs": 60000
}
```

- **`cwd`** *(implícito)*: el comando corre en la **raíz del repo que declara el
  ejecutor** (el padre de `telegram/`). Hoy `runner.ts` no fija `cwd` y todo hereda
  el del bot, y por eso las nueve plantillas del lanzador empiezan por
  `cd "$HOME/src/digital-ocean-dropplet-auto-launching" &&`. Con esto desaparecen
  las nueve, **y con ellas la suposición de que los repos viven en `~/src`**. Un
  campo `cwd` explícito queda disponible para los casos que no encajen.
- **`descripcion`**: una línea. `/executors` la imprime.
- **`ejemplos`**: lista de cadenas. `/use <nombre>` las muestra al abrir la sesión,
  que es justo cuando hacen falta.

Esto **absorbe** el bloque `ayuda` del descriptor, el comando
`do_droplet.py executors` y el ejecutor `ayuda`. El objetivo declarado de aquel
apaño era «que no puedan divergir»; aquí no pueden porque **es el mismo objeto**.

### 2.4 Colisiones: nunca en silencio

Dos repos pueden declarar `estado`. Regla: **gana la primera fuente en el orden de
`fuentes.json`**, se avisa por consola al arrancar y `/executors` marca el nombre
duplicado diciendo de dónde salió cada uno. Un ejecutor que hace otra cosa de la
que crees es peor que un ejecutor que falta.

### 2.5 Qué desaparece

- El **huevo y gallina**: no queda ningún paso de aplicación. `actualizar` —que ya
  hace `git pull` en todos los repos de `~/src`— es suficiente.
- El segundo mensaje (`ejecutores`) y el reinicio innecesario.
- `install-executors` como camino normal (puede quedarse como reliquia; ya no hay
  motivo para llamarlo).
- El bloque `files`/`ayuda` de `services/telegram-launcher.json`, que se muda a
  `digital-ocean-dropplet-auto-launching/telegram/executors/*.json`.
- Los nueve `cd "$HOME/src/…" &&` y las rutas ajenas cableadas en `bench` y
  `barrido`.

### 2.6 Qué NO cambia

- **El coordinador sigue siendo genérico.** No aprende nada de benchmarks, de Vast
  ni de `foveal-vision`: aprende a leer **más de un directorio**, que es la misma
  operación que ya hace. Cero lógica de dominio en `src/`.
- **Los ejecutores siguen siendo plantillas de comando de shell**, con `{{input}}`
  y stdin igual que hoy.
- **La allowlist no se toca.** Y el modelo de amenaza tampoco cambia: quien puede
  escribir en `~/src/<repo>/telegram/` ya puede escribir hoy en
  `~/src/telegram-coordinator/data/executors/`. El proyecto ya asume que quien
  tiene acceso al grupo de Telegram tiene shell.
- **El `definer` sigue funcionando** y sigue escribiendo en `data/executors/`.

---

## 3. La propiedad que esto compra: el tipo de máquina decide los comandos

Ésta es la parte que responde a «que los comandos estén siempre disponibles en un
mini u otro».

`types/bench-control.json` ya declara qué repos clona la máquina. Con
descubrimiento, **eso mismo decide qué sabe hacer el bot de esa máquina**:

```
lanzar   launch bench-control
```

…y el bot de la máquina nueva trae, sin un solo paso más:

| repo clonado | ejecutores que aparecen |
|---|---|
| `telegram-coordinator` | `shell`, `c`, `creset`, `definer` |
| `digital-ocean-dropplet-auto-launching` | `lanzar`, `actualizar`, `vast`, `datos`, `estado`, `apagar-vast`, `apagar-do` |
| `foveal-vision` | `bench`, `preflight`, `barrido` |
| `image-text-sample-generator` | los suyos, si algún día los tiene |

Una máquina de trabajo sin el lanzador clonado **no tiene** `apagar-do`, y está
bien: no puede destruir droplets. La capacidad y el comando llegan juntos, que es
la versión operativa del argumento de `b35a0cb`.

Y resuelve el caso incómodo del README del lanzador —*«los ejecutores que crees
desde el móvil viven en el droplet; si quieres conservarlos, haz `git push` antes
de destruirlo»*—: hoy hay que acordarse de empujar desde el repo del coordinador,
donde ese ejecutor probablemente no pinta nada. Extensión natural, para otro día:
que `definer` acepte un destino (`definer --en foveal-vision …`) y el ejecutor
nazca ya en el repo donde se va a commitear.

---

## 4. Coste de implementarlo

Todo el cambio vive en tres ficheros del coordinador, y ninguno toca el protocolo,
las sesiones ni el runner de forma incompatible:

| fichero | cambio | tamaño |
|---|---|---|
| `src/registry.ts` | `readJsonDir` sobre N directorios en vez de 1; resolver `fuentes.json` (con `~` y un `*`); recordar de qué fuente salió cada ejecutor; avisar de colisiones | ~50 líneas |
| `src/runner.ts` | aceptar `cwd` opcional en `spawn` | ~3 líneas |
| `src/index.ts` | `/executors` imprime `descripcion`; `/use` imprime `ejemplos` | ~10 líneas |
| `src/orchestrator.ts` | pasar el `cwd` del ejecutor a `runCommand` | ~2 líneas |

Más un `data/fuentes.json` sembrado por `seedBootKit`.

### Migración, en cuatro pasos que no rompen nada

1. **Fase 0.** `data/fuentes.json` con `["data"]` únicamente → comportamiento
   **idéntico** al de hoy. Se puede empujar y desplegar sin tocar nada más.
2. **Fase 1.** Añadir `~/src/*/telegram` a la lista. Nada se mueve todavía; los
   ejecutores actuales siguen donde están y siguen funcionando.
3. **Fase 2.** Mover `bench`, `preflight` y `barrido` a
   `foveal-vision/telegram/executors/` (y el `barrido` a donde corresponda),
   quitándoles el `cd` y las rutas ajenas.
4. **Fase 3.** Mudar el bloque `files` de `services/telegram-launcher.json` a
   `digital-ocean-dropplet-auto-launching/telegram/executors/`, con `descripcion`
   y `ejemplos` tomados del bloque `ayuda`. `install-executors` y el ejecutor
   `ayuda` quedan sin uso.

Cada fase es un commit desplegable por separado, y en ninguna hay un momento en
que falte un ejecutor.

### Lo que hay que comprobar al hacerlo

- Un repo **sin** `telegram/` no molesta (el escaneo lo salta sin ruido).
- Un JSON roto en un repo ajeno **no tumba** la lista entera: `readJsonDir` ya
  captura por fichero y avisa por consola; hay que conservar ese comportamiento.
- El glob `~/src/*/telegram` no se cuelga si `~/src` no existe.
- En Windows la ruta por defecto no aplica: `fuentes.json` es lo que manda, y el
  `.env` puede pisarla.
- Colisión de nombres: se avisa, gana el primero, y `/executors` lo dice.

---

## 5. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Dejarlo como está y acordarse** | Ya se probó: el freno llegó 1 h 08 min tarde y el arranque en frío pide un comando largo tecleado desde el móvil |
| **Mover todos los ejecutores al coordinador** | Rompe el argumento correcto de `b35a0cb`: las dos mitades quedan desfasadas sin avisar, y ya mordió una vez (`1c100bb`) |
| **Que `install-executors` corra solo en cada `git pull`** | Arregla el segundo mensaje pero deja la copia, el reinicio, el huevo y gallina y el catálogo paralelo. Es más código para el mismo mecanismo |
| **Un enlace simbólico de `data/executors/` a cada repo** | No es multiplataforma, y no hay forma de que sea dato: hay que crearlos a mano en cada máquina, o sea otro `install-executors` disfrazado |
| **Un registro central (un repo de ejecutores)** | Vuelve a separar el ejecutor del comando que llama, que es el fallo que `b35a0cb` evitó |

---

## 6. Decisión

**No implementado.** El cambio es pequeño y de bajo riesgo, pero toca `src/` del
coordinador —que este proyecto trata como inmutable a propósito— y la Fase 3 mueve
ficheros del otro repo. Queda escrito con el detalle suficiente para que
implementarlo sea mecánico.

Si se aprueba, el orden natural es Fase 0+1 en un commit (no cambia nada
observable), y luego 2 y 3 por separado, comprobando cada una desde Telegram con
`/executors` antes de seguir.
