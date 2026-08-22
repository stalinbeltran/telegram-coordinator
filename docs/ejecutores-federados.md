# Ejecutores federados: que los comandos estén siempre disponibles, en cualquier máquina

**Fecha:** 2026-08-22. **Estado: implementado** el mismo día, en las cuatro fases.
**Origen:** la [revisión de commits de agosto](revision-2026-08-22.md), patrón F.

> **Lo que cambió respecto a la propuesta, al construirlo** (el resto quedó igual):
>
> - `DATA_DIR` **no se declara** en `data/fuentes.json`: es implícita y va siempre
>   primera. Así una lista vacía, ausente o rota deja exactamente el
>   comportamiento de antes, y lo local siempre puede pisar lo descubierto.
> - Hizo falta una pieza que la propuesta no tenía: **`COORD_HOME`**, la raíz del
>   coordinador expuesta como variable de entorno a todo comando. Desde que un
>   ejecutor corre en el directorio de *su* repo, el cwd ya no apunta al
>   coordinador, y `bench` necesita encontrar `notify.mjs` y `desacoplar.sh`.
> - `preflight` y `barrido` **no** se movieron: llaman a scripts del coordinador
>   (`bench-preflight.mjs`, `vast-sweep.sh`), así que ya estaban en su repo. Sólo
>   se movió `bench`. La regla no es «de qué trata» sino «a qué llama».
> - `do_droplet.py executors` no se quedó sin uso: ahora lee la convención
>   (`~/src/*/telegram/executors/`) en vez del descriptor, así que sirve para
>   **todos** los repos y no sólo para el del lanzador.

El coordinador dice que un ejecutor es **dato, no código**, y que añadir uno no
debe requerir tocar nada. Era verdad a medias: había **cuatro** caminos distintos
para que un ejecutor llegue a una máquina, tres de ellos con un paso manual, y
ninguno cubría bien el caso que más se usa —un comando que vive en **otro** repo—.

Este documento describe el problema con lo que costó, el cambio que se hizo, y
por qué es pequeño.

---

## 1. Cómo llegaba un ejecutor a una máquina (hasta el 2026-08-22)

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

## 2. El cambio: descubrir, no copiar

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
    "~/src/*/telegram"
  ]
}
```

Cada entrada es un directorio que contiene `executors/` y/o `encargados/`. Se
admite **un** `*` dentro de un segmento. Lo relativo se resuelve contra la raíz
del coordinador; `~` se expande.

**`DATA_DIR` no se declara: es la fuente 0, implícita y siempre primera.** Dos
razones, y las dos importan: lo local siempre puede pisar a lo descubierto (la
salida cuando algo de otro repo estorba), y una lista vacía, ausente o rota deja
el comportamiento de toda la vida en vez de dejar al bot sin ejecutores.

Sobreescribible con `COORD_FUENTES` en `.env` (separado por comas) para casos
raros: Windows, repos fuera de `~/src`, o pruebas. Sigue siendo dato: **no hay
ninguna ruta cableada en `src/`**.

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
  que es justo cuando hacen falta, y `/executors <nombre>` da la ficha entera
  (descripción, ejemplos, encargados, timeout, cwd y el fichero que lo define).

Y una pieza que la propuesta no tenía y el primer intento pidió: **`COORD_HOME`**,
la raíz del coordinador, expuesta como variable de entorno a todo comando junto a
`COORD_SESSION`/`COORD_CHAT`/`COORD_THREAD`. Desde que cada ejecutor corre en el
directorio de su propio repo, el cwd ya no apunta al coordinador; `COORD_HOME` es
como un ejecutor de fuera sigue encontrando `notify.mjs` o `desacoplar.sh` sin
suponer que el coordinador está en `~/src`. Viaja también por `desacoplar.sh`, que
lo añade a su lista de variables no sensibles.

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
- `install-executors` como camino normal. Se queda, pero avisando: si un servicio
  no declara `files` lo dice y explica dónde viven ahora los ejecutores, en vez de
  contestar «nada que cambiar» y dejarte adivinando.
- Los ejecutores `ejecutores` y `ayuda`, que existían sólo para dar esos dos
  rodeos.
- El bloque `files`/`ayuda` de `services/telegram-launcher.json`, mudado a
  `digital-ocean-dropplet-auto-launching/telegram/executors/*.json`.
- Los ocho `cd "$HOME/src/…" &&` de los ejecutores del lanzador y las rutas ajenas
  cableadas en `bench`.

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

## 3. Lo que esto compra: el tipo de máquina decide los comandos

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

Y deja a tiro el caso incómodo del README del lanzador —*«los ejecutores que crees
desde el móvil viven en el droplet; si quieres conservarlos, haz `git push` antes
de destruirlo»*—: hay que acordarse de empujar desde el repo del coordinador,
donde ese ejecutor probablemente no pinta nada. Extensión natural, pendiente: que
`definer` acepte un destino (`definer --en foveal-vision …`) y el ejecutor nazca
ya en el repo donde se va a commitear.

---

## 4. Lo que costó, y lo que hay que comprobar

Todo el cambio del coordinador vive en cinco ficheros, y ninguno toca el
protocolo ni las sesiones:

| fichero | cambio | líneas |
|---|---|---|
| `src/registry.ts` | leer N fuentes en vez de 1; resolver `fuentes.json` (con `~` y un `*`); recordar de dónde salió cada definición; anotar y avisar de colisiones | +150 |
| `src/index.ts` | `/executors` con descripción y repo; `/executors <nombre>` con la ficha; `/use` con los ejemplos; informe de fuentes al arrancar | +45 |
| `src/config.ts` | `COORD_HOME`, deducido de dónde vive el fichero y no del cwd | +10 |
| `src/orchestrator.ts` | pasar el `cwd` de cada definición a `runCommand`, y `COORD_HOME` en el entorno | +15 |
| `src/runner.ts` | `cwd` opcional, con un error legible si no existe | +12 |

Más `data/fuentes.json` (sembrado por `seedBootKit`), `COORD_HOME` en la lista de
variables no sensibles de `scripts/desacoplar.sh`, y `scripts/test-executor.mjs`,
que ahora imprime las fuentes, el fichero que define el ejecutor y su cwd —porque
con varias fuentes, «qué ejecutor es éste» deja de ser obvio—.

### Las cuatro fases, tal como se aplicaron

1. **Fase 0.** `data/fuentes.json` ausente o vacío → `DATA_DIR` es la única fuente
   y el cwd de todo sigue siendo la raíz del coordinador: **cero cambios
   observables**. Es el caso que fija el último test.
2. **Fase 1.** `~/src/*/telegram` en la lista. Nada se mueve; los ejecutores de
   siempre siguen donde estaban.
3. **Fase 2.** `bench` → `foveal-vision/telegram/executors/`, sin `cd` y sin la
   ruta a `~/src/foveal-vision`. `preflight` y `barrido` **se quedan**: llaman a
   scripts del coordinador, así que ya estaban en el repo correcto.
4. **Fase 3.** Los siete del lanzador → `digital-ocean-dropplet-auto-launching/
   telegram/executors/`, con `descripcion` y `ejemplos` sacados del bloque
   `ayuda`. Fuera el bloque `files` del descriptor, y fuera los ejecutores
   `ejecutores` y `ayuda`, que sólo servían para dar los rodeos que esto quita.

### Comprobado al hacerlo

- Descubrimiento real de tres repos a la vez: 15 ejecutores, 0 pasos de copia
  (`test-executor.mjs` imprime las fuentes y el fichero de cada uno).
- `bench` de punta a punta desde `foveal-vision`: el trabajo desacoplado encontró
  `scripts/bench_fleet.py` sin `cd`, y `COORD_HOME` cruzó `desacoplar.sh`
  (comprobado con `--help`, que escribe en el log y no alquila nada).
- `lanzar` desde el repo del lanzador, sin `cd` (`types --help`).
- 40 tests (30 de antes + 10 nuevos del registry) y `npx tsc --noEmit` limpio.
- Los casos que se fijan en tests porque romperían en silencio: orden de las
  fuentes, un repo sin `telegram/` que se salta, colisión (gana `DATA_DIR` y la
  pisada queda anotada), cwd heredado del repo, cwd declarado resuelto contra su
  raíz, un JSON roto que **no** se lleva por delante a sus vecinos, uno sin
  `name` que se ignora, y la Fase 0 como no-op.

### Al desplegar en una máquina que ya venía funcionando

Los ejecutores que `install-executors` copió en su día siguen en
`data/executors/` de esa máquina, y **pisan** a los descubiertos (`DATA_DIR` manda).
No rompen nada —son los mismos comandos con `cd`— pero conviene borrarlos: el
arranque del bot y `/executors` dicen exactamente qué fichero manda y cuál está
pisado, que es todo lo que hace falta para saber qué quitar.

## 5. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Dejarlo como está y acordarse** | Ya se probó: el freno llegó 1 h 08 min tarde y el arranque en frío pide un comando largo tecleado desde el móvil |
| **Mover todos los ejecutores al coordinador** | Rompe el argumento correcto de `b35a0cb`: las dos mitades quedan desfasadas sin avisar, y ya mordió una vez (`1c100bb`) |
| **Que `install-executors` corra solo en cada `git pull`** | Arregla el segundo mensaje pero deja la copia, el reinicio, el huevo y gallina y el catálogo paralelo. Es más código para el mismo mecanismo |
| **Un enlace simbólico de `data/executors/` a cada repo** | No es multiplataforma, y no hay forma de que sea dato: hay que crearlos a mano en cada máquina, o sea otro `install-executors` disfrazado |
| **Un registro central (un repo de ejecutores)** | Vuelve a separar el ejecutor del comando que llama, que es el fallo que `b35a0cb` evitó |

---

## 6. Estado

**Implementado el 2026-08-22**, las cuatro fases. Toca `src/` del coordinador —que
este proyecto trata como inmutable— y el cambio se justifica precisamente por eso:
lo que se añade es genérico (leer más de un directorio), y lo que se quita es
lógica de despliegue que vivía en otro repo. Después de esto no hay nada en `src/`
que sepa de benchmarks, de Vast ni de `foveal-vision`.

Lo que queda pendiente, y es cómodo más que necesario: que `definer` acepte un
destino (`definer --en foveal-vision …`) para que un ejecutor inventado desde el
móvil nazca ya en el repo donde se va a commitear, en vez de en `data/`, que se
pierde con la máquina.
