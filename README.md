# Coordinador de Telegram

Coordinador **inmutable** que recibe mensajes tuyos por Telegram y los enruta a
**ejecutores** y **encargados** definidos dinámicamente (sin recompilar).

```
Tú (Telegram, un tema = una sesión)
  → Coordinador → Ejecutor (comando shell) → salida de texto
                → Encargados (comandos shell) → comandos para el coordinador:
                     >>USER <texto>   te responde por Telegram
                     >>SHELL <cmd>    ejecuta y te envía la salida
```

## Conceptos

- **Ejecutor**: una plantilla de comando shell. Eliges uno por sesión. Recibe tu
  texto (por `{{input}}` si la plantilla lo contiene, o por `stdin`).
- **Encargado**: comando shell asociado a un ejecutor. Recibe la salida del
  ejecutor y devuelve "comandos" (ver protocolo) que el coordinador ejecuta.
- **Sesión**: un ejecutor ligado a un tema de Telegram. Identificada por
  `chatId + message_thread_id`, así varios temas corren en paralelo.

## Puesta en marcha (≈5 min)

1. Crea un bot con [@BotFather](https://t.me/BotFather) → `/newbot` → copia el token.
2. `cp .env.example .env` y pega el token en `BOT_TOKEN`.
3. `npm install`
4. `npm run dev` (con recarga al editar; para producción, `npm run start`).
   Solo puede correr **una** instancia a la vez: ver Notas.
5. Escríbele `/whoami` al bot, copia tu user id en `ALLOWED_USER_IDS` del `.env`
   y reinicia. **Sin esto el bot ignora a todos** (es ejecución remota de comandos:
   la allowlist es tu única protección).
6. (Recomendado) Crea un **grupo**, actívale **Temas/Topics**, añade el bot como
   admin. Cada tema será una sesión independiente.

## Uso

```
/use shell        abre sesión con el ejecutor "shell" en este tema
ls -a             (con sesión abierta) se ejecuta en el sistema
/who              ejecutor activo en este tema
/executors        lista de ejecutores
/end              cierra la sesión
/ws               en qué árbol de repos trabaja este tema
/whoami           tu id de Telegram
```

## Kit de arranque (sembrado automático)

El coordinador siembra esto en `data/` la primera vez que arranca, si no existe
([registry.ts](src/registry.ts)):

- Ejecutor **`shell`** → ejecuta lo que envíes, con `cd` **persistente** por tema
  ([ver abajo](#ejecutor-shell-el-cd-persiste-por-tema)).
- Ejecutor **`definer`** → crea ejecutores/encargados con parámetros simples.
- Encargado **`echo`** → reenvía la salida del ejecutor de vuelta a ti.

Con esto basta para crear todo lo demás desde Telegram.

### Además, ya versionados en el repo

Estos **no** los siembra el código: son archivos JSON commiteados en `data/`, así
que vienen con el clon y puedes borrarlos o cambiarlos sin tocar `src/`.

| Nombre | Tipo | Qué hace |
| --- | --- | --- |
| `c` | ejecutor | conversa con `claude` con memoria por tema (ver abajo). Sin timeout (`timeoutMs: 0`) y con encargados `echo` + `claude-watch`. |
| `creset` | ejecutor | reinicia la conversación de `c` **en este tema** (ver abajo). Sin encargados: responde él mismo. |
| `preflight` | ejecutor | comprueba si esta máquina tiene con qué medir; `--fix` arregla lo que puede solo. |
| `barrido` | ejecutor | barrido de velocidad en Vast.ai, desacoplado ([ver abajo](#barrido-el-patrón-entero-aplicado)). |
| `claude-watch` | encargado | vigila el límite de uso de Claude y programa la reanudación automática (ver abajo). Es mudo: no te escribe. |
| `directorio` | ejecutor | ejemplo mínimo (`dir`): lista el directorio del coordinador. Solo Windows. |

## Cada repo trae sus ejecutores (y el bot los descubre)

Un ejecutor que llama a `scripts/loquesea.py` de otro proyecto tiene que viajar
**con** ese proyecto: si viven separados, el día que cambie un flag una de las dos
mitades queda desfasada y el síntoma es un ejecutor que falla con un error de
argumentos. Así que no se copian a `data/`: **se declaran en su repo y el
coordinador los descubre ahí.**

Un repo aporta comandos al bot creando:

```
<repo>/telegram/executors/*.json      sus ejecutores
<repo>/telegram/encargados/*.json     sus encargados (si necesita alguno)
```

Y ya está: con que el repo esté clonado, sus ejecutores salen en `/executors`. No
hay paso de instalación, ni que reiniciar el bot (el registry relee el disco en
cada mensaje).

**Dónde busca** lo dice [`data/fuentes.json`](data/fuentes.json), que es dato y
está versionado:

```json
{ "fuentes": ["~/src/*/telegram"] }
```

Se admite un `*` dentro de un segmento, `~` se expande y lo relativo se resuelve
contra la raíz del coordinador. `COORD_FUENTES` en `.env` (separado por comas) la
pisa, para Windows o repos fuera de `~/src`.

`data/` es la **fuente 0**: implícita, siempre primera y no hace falta declararla.
Por eso lo local siempre puede pisar a lo descubierto, y una lista vacía o rota
deja el comportamiento de siempre en vez de dejarte sin ejecutores.

**El cwd de cada comando es la raíz del repo que lo declara**, así que un ejecutor
de fuera se escribe como si estuvieras dentro de su repo:

```json
{
  "name": "bench",
  "descripcion": "Mide s/época en droplets de distinta capacidad de vCPU.",
  "ejemplos": ["--vcpus 2,4,8", "--reap"],
  "command": "python3 scripts/bench_fleet.py {{input}}",
  "encargados": ["echo"],
  "timeoutMs": 60000
}
```

Sin `cd ~/src/loquesea &&` delante. Si necesitas otro directorio, el campo `cwd`
se resuelve contra esa misma raíz. Y para llamar a algo del coordinador desde
fuera (por ejemplo `notify.mjs` al terminar un trabajo largo) tienes
**`COORD_HOME`** en el entorno, que es su raíz: nadie tiene que suponer dónde está
clonado.

`descripcion` y `ejemplos` viven en el **mismo** JSON que el ejecutor, así que no
pueden divergir. Los imprimen `/executors` (la lista, con el repo de cada uno),
`/executors <nombre>` (la ficha entera) y `/use <nombre>` (los ejemplos, justo
cuando vas a escribir la entrada).

**Si dos repos declaran el mismo nombre**, gana la primera fuente y se avisa: en
el arranque del bot y en `/executors`, diciendo qué fichero manda y cuál queda
pisado. Nunca en silencio.

### Cuando el comando además necesita algo instalado

Tener el repo no siempre basta: `c` no sirve sin el binario `claude`, y su repo
—el del propio coordinador— está en **todas** las máquinas con bot. Para eso está
`requiere`:

```json
{ "name": "c", "requiere": ["claude"], "command": "node scripts/claude-session.mjs" }
```

El bot comprueba el PATH y **marca** lo que falte (`⛔ falta claude`) en
`/executors` y al abrir sesión. **Marca, no esconde**: un comando escondido no se
distingue de un repo sin clonar, y así sabes si lo que toca es instalar o clonar.
`/use` avisa pero deja continuar, para que un falso negativo no te bloquee una
sesión que sí funciona.

El detalle completo —por qué se hizo, qué había antes y qué costó— está en
[`docs/ejecutores-federados.md`](docs/ejecutores-federados.md).

## Definir ejecutores/encargados (forma fácil: `definer`)

`/use definer` y envía un mensaje donde la **1ra línea es el encabezado** y el
**resto es el comando** (literal, puede ser multilínea):

```
exec <nombre> [encargado1 encargado2 ...]
<comando>
```
```
enc <nombre>
<comando>
```

- En `exec`, si no listas encargados se asigna **`echo`** por defecto.
  Para no asignar ninguno: `exec <nombre> -`.
- El comando puede contener `{{input}}` (se sustituye por tu texto) o leer `stdin`.

**Ejemplo — crear un ejecutor `grep`:**

```
exec grep
grep -n {{input}}
```

Luego `/end`, `/use grep`, y manda `"patron" archivo.txt`.

> Alternativa manual: en sesión con `shell` puedes escribir directamente los
> archivos JSON en `data/executors/` o `data/encargados/`.

### Protocolo de comandos (salida de un encargado)

```
>>USER <texto>    enviar <texto> al usuario por Telegram
>>SHELL <cmd>     ejecutar <cmd> y enviar su salida
(sin prefijo)     equivale a >>USER con todo el texto
```

## Timeouts (también son dato, no código)

Todo comando corre con un timeout que, al vencer, mata **el árbol completo** de
procesos (en Windows, matar solo el shell dejaba hijos vivos y el comando colgado
para siempre).

- **Global**: `COMMAND_TIMEOUT_MS` en `.env` (30 s por defecto).
- **Por ejecutor/encargado**: el campo `timeoutMs` en su JSON gana al global.
  - ausente → usa el global
  - `0` o negativo → **sin timeout** (corre hasta terminar)

Así un ejecutor de tareas largas no necesita excepciones cableadas en el
coordinador. Con `definer` se fija en el encabezado con el token `timeout=<ms>`:

```
exec c echo claude-watch timeout=0
node scripts/claude-session.mjs
```

## Un workspace por tema (`/ws`): dos temas, dos copias de los repos

Un **workspace** es una copia de los **cinco** repos hermanos juntos, con rama y
prefijo propios, bajo `~/ws/<línea-de-trabajo>`. Sirve para que **dos líneas de
trabajo que tocan los mismos ficheros a la vez** —dos estudios, dos ramas— no se
pisen.

### Se hace solo: el primer mensaje de un tema decide su árbol

No hay que montar nada a mano. Al llegar el **primer** mensaje de un tema:

| Si es… | Qué pasa |
|---|---|
| **el primer tema que escribe** en esta máquina | se queda con el árbol del coordinador (`~/src`) y **no monta nada** |
| **cualquier otro tema** | le monta su propio `~/ws/tema-<id>` (~6 s, los cinco repos) y lo ata |

⚠ **El tema por defecto lo eliges tú escribiendo ahí primero.** No hay
configuración: tras reiniciar el bot, el primer mensaje que llegue se lleva
`~/src`. Si te equivocas de tema, `/ws off` en el que lo pilló.

Un tema que nunca escribe **no cuesta nada**: no se montan workspaces por
adelantado. Y si prefieres nombres con significado en vez de `tema-7`, montas el
tuyo (`--nuevo dropout`) y lo atas con `/ws dropout`, como siempre.

⚠ **Y si lo que quieres es un repo distinto por tema, no necesitas nada de
esto**: cada ejecutor ya corre en la raíz del repo que lo declara, y `shell`
recuerda su `cd` por tema.

⚠ **Los cinco, aunque uses uno.** Los scripts se buscan entre ellos por el
directorio padre (`bench_dataset.py` busca el generador en `ROOT.parent`), así
que una copia con un repo suelto **no falla al empezar: falla a mitad**.

### Los comandos, que son los de siempre

```
/ws               en qué workspace trabaja este tema, y cuáles hay montados
/ws <nombre>      ata este tema a ~/ws/<nombre>
/ws off           lo suelta: vuelve al árbol del coordinador
/use workspace    el ejecutor que MONTA uno, y que comprueba si está sano
```

### La receta entera, de cero

**Montar es una acción de la máquina; atar es del tema.** Por eso son dos cosas
y no una: montas una vez, y atas los temas que quieras.

```
(en cualquier tema)
/use workspace
--nuevo patience --que "tanteo pa-t"    ← SIN barra: es un mensaje al ejecutor

    Creando /home/deploy/ws/patience
      prefijo "pa-"  ·  rama "patience"
      clonando foveal-vision… ok (patience)
      ...los cinco...
    Listo: /home/deploy/ws/patience

(en el tema que quieras mudar)
/ws patience      → ✅ Este tema trabaja ahora en: /home/deploy/ws/patience
/use c            → y ya hablas con claude, pero dentro de esa copia
```

`--nuevo` elige un **prefijo libre** comprobado contra los workspaces que ya
existen, pone rama propia en los cinco repos, escribe `WORKSPACE.json` y deja el
`fuentes.json` de la copia apuntando ahí. No arranca ningún bot, y dice por qué.

### Comprobar que de verdad corre allí

```
/use workspace
(cualquier mensaje)

    Workspace: /home/deploy/ws/patience  (patience)
    [  ok  ] repo   foveal-vision en "patience"      ← si dice "main", no ataste
    ...
```

### Lo que conviene saber

- **`/use` y `/ws` son ortogonales.** `/use` dice **qué programa** te atiende;
  `/ws` dice **en qué árbol** corre. Cambiar uno no toca el otro.
- **La atadura sobrevive a `/end`**: vive en `data/ws/`, que `/end` no borra.
  Cerrar la sesión suelta el ejecutor, no te muda de árbol.
- **`/ws off` es una decisión, no una ausencia.** Un tema soltado a propósito
  **no** se re-monta en el mensaje siguiente: por eso soltar deja rastro en
  `data/ws/` en vez de borrar el fichero. Es la salida de emergencia, y no
  puede depender de un estado que se borra.
- **El estado por tema NO se muda con el workspace.** Tu `cd` de `shell` y tu
  conversación con `c` siguen donde estaban: son del tema, no del árbol.
- **Si el repo no está en el workspace, el ejecutor se niega antes de correr**, y
  te dice las dos salidas: clonar el repo, o `/ws off`. No cae al árbol original,
  que sería correr con otra rama sin avisar.
- **Un tema sin atar sigue en `~/src`**, y no pasa nada: no hace falta un
  workspace por tema.

### Límites conocidos (medidos el 2026-08-28)

- **El `cd` guardado de `shell` gana sobre el workspace.** Si ese tema ya tenía un
  `cd`, seguirás ahí después de atar y parecerá que `/ws` no hizo nada. Es
  coherente —el `cd` es explícito y más específico—, pero por eso la comprobación
  se hace con `workspace` y no con `shell` + `pwd`.
- **`/ws` sólo lista árboles que tengan `WORKSPACE.json`**, así que el del propio
  coordinador no sale si no tiene identidad. No falta nada.
- **La atadura es efímera**: `data/ws/` está en `.gitignore`, así que al rehacer
  la máquina se pierde (igual que el `cd` y los markers de `claude`). Lo que
  sobrevive es el **id del tema**; por eso `/ws` acepta el **nombre**, y remontar
  el workspace con el mismo nombre **re-ata el tema solo** al siguiente arranque.
- **Un workspace montado deja `cerrable` en 🔴 mientras exista**, aunque no haya
  nada a medias: su rama no está en el remoto. Es correcto —nombra qué se
  perdería—, pero un workspace de trabajo nunca deja la máquina en verde.
- **`/executors` es único para todo el bot**: se descubre desde `~/src`. Un
  ejecutor que exista **sólo** dentro de un workspace no aparece.
- **No arranques un segundo bot en la copia**: sólo una instancia puede hacer
  polling por token (error 409). Un workspace se copia para trabajar en el
  código, no para servir.
- **El `.venv` de `foveal-vision` hay que rehacerlo por copia** (`/use preflight`
  → `--fix` con el tema ya atado). Los repos son ~80 MB; el venv es lo caro.

### La regla que manda sobre todas

Si ves algo roto que pertenece a **otro** workspace: **dilo, no lo arregles**. No
edites fuera del tuyo, no mates procesos que no lanzaste (`pkill -f estudio_flota`
mata los de todos los workspaces) y no destruyas máquinas cuya etiqueta no sea tu
prefijo. No es un conflicto de git recuperable: es trabajo destruido en caliente,
sin síntoma hasta que a alguien le fallan los números.

## Ejecutor `shell`: el `cd` persiste por tema

Un shell "a pelo" ignora el `cd` entre mensajes: cada uno corre en un `spawn`
nuevo y un proceso hijo no puede cambiar el directorio de su padre, así que el
`cd` muere con el shell que lo ejecutó y el mensaje siguiente vuelve a empezar en
la carpeta del coordinador.

Por eso `shell` no es `{{input}}` a secas, sino
[scripts/shell-cwd.mjs](scripts/shell-cwd.mjs), que trata el directorio como
**estado de sesión** igual que `c` trata la conversación: lo guarda en
`data/shell-cwd/<sesión>.json` y ejecuta cada comando ahí. Los comandos que
mandas son los mismos de siempre.

```
/use shell
pwd            → 📁 C:\Desarrollo\telegram-coordinator
cd src         → 📁 C:\Desarrollo\telegram-coordinator\src
dir /b         → lista src, no la raíz
cd ..          → 📁 C:\Desarrollo\telegram-coordinator
```

- Reconoce `cd <ruta>`, `cd ..`, `cd ~`, `cd -` (vuelve al anterior),
  `cd "ruta con espacios"`, `cd /d X:\...` y `D:` a secas (cambio de unidad).
- `cd` sin argumentos, `pwd` o un mensaje vacío responden el directorio actual.
- Si la carpeta no existe, te lo dice y **no** te mueve.
- Cada tema tiene su propio directorio: dos temas pueden trabajar en carpetas
  distintas a la vez.
- Si la carpeta guardada desaparece, vuelve a la del coordinador en lugar de
  fallar.

Límites conocidos: en `cd x && dir` el `cd` lo hace el shell, no el script, así
que el comando funciona pero el cambio **no** persiste (para moverte, manda el
`cd` solo); y en Linux `cd` sin argumentos imprime el directorio en vez de ir a
`$HOME` (usa `cd ~`). Si alguna vez quieres el shell sin estado, es un `definer`
de dos líneas: `exec crudo` + `{{input}}`.

## Ejecutor `c`: conversar con claude (con memoria por tema)

El ejecutor `c` usa [scripts/claude-session.mjs](scripts/claude-session.mjs), un
wrapper que mantiene **una conversación de claude independiente por cada tema de
Telegram** (continuidad nativa: `--session-id` el primer mensaje, `--resume` los
siguientes). Así puedes tener varias charlas en paralelo, una por tema.

```
/use c
Recuerda el número 7
¿Qué número te dije?      → responde 7
```

### Modelo y esfuerzo (perfiles como dato)

El perfil se declara en la **plantilla del ejecutor**, no en el coordinador:

```
node scripts/claude-session.mjs --model <alias|nombre> --effort <nivel>
```

- `--model` — alias (`fable`, `opus`, `sonnet`) o nombre completo (`claude-opus-5`).
- `--effort` — `low`, `medium`, `high`, `xhigh`, `max`.
- Sin flags, claude usa sus propios valores por defecto.

El ejecutor `c` viene con `--model opus --effort max`.

Crear variantes no requiere tocar código: desde Telegram, con `definer`,

```
exec c-barato echo claude-watch timeout=0
node scripts/claude-session.mjs --model sonnet --effort low
```

Y como el hilo de claude se deriva del **tema** (`COORD_SESSION`), no del
ejecutor, puedes cambiar de perfil a mitad de conversación sin perder contexto:
`/end` y `/use c-barato` en el mismo tema continúan la misma charla.

### Empezar de cero sin cambiar de tema (`/use creset`)

El id de la conversación **no se guarda: se deriva** del tema. Eso da la memoria
por tema, pero también significaba que dentro de un tema la conversación era la
misma para siempre y crecía sin techo. **Nada la cortaba**: ni `/end` (que solo
suelta la atadura con el ejecutor), ni reiniciar el bot, ni cambiar de perfil, ni
chocar con el límite de uso. La única salida era abrir un tema nuevo — y perder
con él el `cd` del shell y todo lo demás del hilo.

`creset` la corta sin salir del tema:

```
/use creset
ya                → 🔄 Conversación de claude reiniciada en este tema (época 0 → 1).
/use c
¿Qué número te dije?   → no lo sabe: es una conversación nueva
```

El texto que mandes da igual, solo hace falta *algo* para que el ejecutor corra
(`/use` liga la sesión, no ejecuta nada por sí solo).

Cómo funciona, sin romper la derivación: el marker del tema guarda una **época**,
y el uuid sale de `<tema>#<época>` ([claude-marker.mjs](scripts/claude-marker.mjs)).
Subir la época da un uuid que claude no ha visto nunca. La época 0 se deriva del
tema a secas, así que las conversaciones que ya existían siguen siendo las mismas.

- **No borra nada**: la charla anterior se queda en el almacén de claude, solo
  deja de usarse.
- **El reset es por tema**: los demás temas siguen intactos.
- La época vive en `data/` (efímero, ignorado por git). Si se pierde al rehacer la
  máquina se vuelve a la época 0 y se empieza en blanco, que es lo que ya pasaba.

### Identidad de sesión para ejecutores con estado

El coordinador expone a TODO comando (ejecutor, encargado y `>>SHELL`) estas
variables de entorno, para que un ejecutor pueda guardar/leer estado por sesión:

- `COORD_SESSION` — id de la sesión (`<chatId>_<threadId>`)
- `COORD_CHAT`, `COORD_THREAD`

### Permisos de claude

Controlado por `CLAUDE_PERMISSION_MODE` en `.env`:

- `default` — claude pide permiso (en `-p` suele **bloquear** acciones).
- `acceptEdits` — auto-aprueba edición de archivos, no shell.
- `bypassPermissions` — ⚠️ claude ejecuta **cualquier cosa** sin preguntar.

Tras cambiarlo, reinicia el bot.

## Reanudación automática al agotar el límite de Claude

Si `claude` corta a mitad de una tarea porque se acabaron los tokens, no tienes
que estar pendiente: el ejecutor `c` **se reanuda solo** cuando el límite se
restablece, y te avisa por el mismo tema.

Reparto de responsabilidades (cada encargado hace **una** cosa; solo `echo` habla
con el usuario):

```
c (claude-session.mjs)  ── banner del límite por stdout, exit 0 ──┐
                                                                  ├→ echo         te reenvía la salida
                                                                  └→ claude-watch detecta el límite y
                                                                                  lanza el resumer (mudo)
claude-resumer.mjs (proceso DESACOPLADO, fuera del coordinador)
  1. te avisa a Telegram a qué hora reanudará
  2. espera hasta el reinicio de tokens
  3. reinyecta un "continúa" a claude-session.mjs (--resume: no pierde el contexto)
  4. si el límite sigue activo, recalcula y reintenta
  5. te entrega el resultado en el mismo tema
```

Piezas ([scripts/](scripts/)):

- [limit-detect.mjs](scripts/limit-detect.mjs) — decide si un texto es un banner
  de límite y calcula cuánto falta para el reinicio. Dos capas: frases
  inequívocas, y una detección ponderada por señales para variantes nuevas sin
  disparar falsos positivos cuando claude menciona "rate limit" de pasada.
  También parsea la hora de reinicio (`in 2 hours`, `resets 3pm`, `15:00`, con
  zona horaria IANA opcional).
- [claude-watch.mjs](scripts/claude-watch.mjs) — el encargado. Solo decide y
  lanza; emite un `>>USER` vacío (el orquestador descarta los `>>USER` sin
  texto) para no duplicar la voz de `echo`.
- [claude-resumer.mjs](scripts/claude-resumer.mjs) — se lanza `detached`, así
  que **sobrevive al timeout del coordinador**, y por eso se manda los mensajes a
  Telegram él mismo por la Bot API, heredando `BOT_TOKEN` y `COORD_*` del
  entorno. Usa un cerrojo por sesión para no duplicar reanudaciones.

Detalle de diseño: ante un límite, `claude-session.mjs` sale con **código 0** a
propósito (vuelca el banner por stdout). Con exit ≠ 0 el orquestador se salta los
encargados y `claude-watch` nunca vería el límite. Tampoco crea una sesión nueva
en ese caso: la conversación sigue intacta y reiniciarla perdería el contexto.

Ajustes (todos opcionales, en `.env`):

| Variable | Def. | Para qué |
| --- | --- | --- |
| `CLAUDE_RETRY_MAX` | `5` | reintentos máximos si el límite sigue activo. |
| `CLAUDE_RETRY_RUN_TIMEOUT_MS` | `600000` | timeout de cada llamada a claude del resumer. |
| `CLAUDE_CONTINUE_PROMPT` | (ver script) | el "continúa" que se reinyecta. |
| `CLAUDE_DETECTION_PRECISION` | `0.7` | umbral 0..1 de la detección ponderada. |
| `CLAUDE_RETRY_MARGIN_SECONDS` | `30` | margen extra tras la hora de reinicio. |
| `CLAUDE_RETRY_FALLBACK_HOURS` | `5` | espera si no se logra leer la hora. |

## Avisar cuando termine algo largo (`notify.mjs`)

**Un mensaje es un proceso que muere al responder**, y se lleva todo lo que lanzó.
Un trabajo de 10 minutos hay que desacoplarlo (`setsid`, o `detached`+`unref`) o
muere a medias — pero entonces tampoco queda nadie vivo para avisar de que
terminó. [scripts/notify.mjs](scripts/notify.mjs) es ese "alguien": corre
desacoplado y se manda el mensaje él mismo por Bot API.

```sh
setsid sh -c '<trabajo largo>; node scripts/notify.mjs "terminó: <dónde está el resultado>"' &
```

También lee de stdin, así que la salida de algo se manda tal cual (troceada si
pasa de 4000 caracteres):

```sh
setsid sh -c 'npm run bench > bench.log 2>&1; tail -20 bench.log | node scripts/notify.mjs' &
```

Y para **despertar la conversación** además de avisar no hace falta nada nuevo:
`claude-session.mjs` lee el prompt por stdin y escribe la respuesta por stdout,
así que se componen con una tubería.

```sh
setsid sh -c '<trabajo>; echo "mira bench.log y resume" | node scripts/claude-session.mjs | node scripts/notify.mjs' &
```

Hereda `COORD_CHAT`/`COORD_THREAD` de quien lo lanzó (el coordinador los pasa a
todo comando); fuera de una sesión, se le indican con `--chat` y `--thread`.
Salidas: `0` enviado, `1` no se pudo enviar, `2` mal invocado o sin
configuración. Reintenta los fallos de red y los 5xx, **no** los 4xx (un chat
inexistente no se arregla esperando), y el token no aparece nunca en sus mensajes
de error.

**El `BOT_TOKEN` lo carga de disco por ruta absoluta**
([`cargar-secretos.mjs`](scripts/cargar-secretos.mjs)), no del `.env` del
directorio actual. ⚠ Hasta el 2026-09-04 lo hacía relativo al cwd, y como un
trabajo desacoplado corre en el directorio de **su** repo, el aviso moría con
«Falta BOT_TOKEN» sin llegar a intentarlo — sólo funcionaba si lo llamabas desde
este repo.

### Si nadie dice a qué tema, lo busca

Un `cron`, un `ssh` o un script a mano no tienen `COORD_CHAT`. Antes eso perdía
el aviso; ahora [`destino-telegram.mjs`](scripts/destino-telegram.mjs) lo deduce
del estado que el coordinador guarda **por tema** —el nombre del fichero *es* la
identidad del tema— con tres reglas en este orden:

1. sólo los **vivos**: su estado se tocó hace menos de **7 días**;
2. entre ésos gana el **principal**: el que no está atado a un workspace;
3. y si no se distingue, el de **actividad más reciente**.

Si no queda ninguno, falla con `2` como siempre: **inventarse un destino es peor
que no avisar**. Es un respaldo, no un atajo — con `--chat` o `COORD_CHAT`, manda
ése. Y el mensaje **dice** que llegó por esta vía, porque un aviso en un tema al
que nadie lo dirigió tiene que explicar por qué está ahí.

> **El aviso es una comodidad, no la fuente de verdad.** Puede fallar —red caída,
> tema borrado— y entonces solo queda constancia en el log del propio trabajo, que
> nadie está mirando. Di siempre dónde queda el resultado.
>
> **Y no puede tumbar el trabajo**: en un comando desacoplado va con `|| true`.
> Sin eso, una unidad con `Restart=on-failure` convierte un aviso fallido en un
> bucle (medido: 62 reinicios el 2026-09-04).

### `barrido`: el patrón entero, aplicado

El ejecutor `barrido` mide velocidad en máquinas alquiladas en Vast.ai. Es el
ejemplo completo de todo lo de arriba, y por eso vale como plantilla para
cualquier trabajo largo:

```
/use barrido
--cpus 2,4,8,16
```

Contesta al instante («lanzado, tarda decenas de minutos») y avisa al terminar.
Por dentro son dos piezas, y la separación es deliberada:

- **El ejecutor** ([data/executors/barrido.json](data/executors/barrido.json)) es
  una sola línea: `desacoplar.sh` + el script + un `echo`. No sabe nada del
  benchmark.
- **El trabajo** ([scripts/vast-sweep.sh](scripts/vast-sweep.sh)) hace tres cosas
  en orden, y las tres tienen que pasar aunque el turno muera a mitad:
  1. **medir** — `vast_instance.py sweep` alquila una máquina por nivel de vCPU,
     mide y la destruye;
  2. **publicar** — commit y push de los JSON de `results/`. Si la rama no es
     `main`, lo dice: un clon limpio no lo vería;
  3. **barrer** — comprobar que no queda nada facturando. El `finally` del
     barrido ya destruye lo suyo, pero *comprobarlo* es distinto de *confiar*.
     Lo que sobreviva con etiqueta `sweep-*`/`bench-*` se cierra; lo demás se
     reporta y **no se toca**, que puede ser algo tuyo.

Vive en `scripts/` y no dentro del JSON porque un ejecutor es una plantilla de
comando, no un sitio donde escribir cien líneas: así se lee, se versiona y se
prueba sin Telegram ni gastar un céntimo.

```sh
VAST_SWEEP_LOG=/dev/stdout sh scripts/vast-sweep.sh --dry-run
```

Necesita el repo del lanzador en `~/src/digital-ocean-dropplet-auto-launching`
(o `VAST_LANZADOR` apuntando a él) y `VAST_AI_API_TOKEN` en `.env` o en
`~/.config/dev-secrets.env` — de disco, porque `desacoplar.sh` no deja pasar
secretos a propósito.

> **`sweep` coge siempre la oferta más barata del rango, así que un host roto es
> pegajoso.** Un nivel que falla dos veces seguidas suele ser eso, no mala
> suerte: reintentar sin cambiar nada vuelve a caer en la misma máquina. Se sale
> estrechando la búsqueda (`--min-ram 8`), no cableando una lista de ofertas
> prohibidas.

## Depurar un ejecutor (sin Telegram)

Prueba cualquier ejecutor que hayas creado y mira cada paso (comando resuelto,
exit code, stdout/stderr, encargados y la respuesta final):

```bash
npx tsx scripts/test-executor.mjs <ejecutor> "<texto de entrada>"
# ejemplos:
npx tsx scripts/test-executor.mjs directorio
npx tsx scripts/test-executor.mjs shell "echo hola"
npx tsx scripts/test-executor.mjs c "resume este repo"
```

El harness imprime el `COORD_SESSION` que va a usar. **Míralo antes de probar algo
que toque estado.** Por defecto es `debug-session`, pero la variable se *hereda* si
ya venía puesta — y viene puesta cuando el propio coordinador te lanzó (un `c`
depurándose a sí mismo). En ese caso el harness trabaja sobre el tema de verdad, y
con `creset` eso significa reiniciar la conversación real. Para forzar otra:

```bash
COORD_SESSION=pruebas npx tsx scripts/test-executor.mjs creset "x"
```

El harness respeta el `timeoutMs` del propio ejecutor, así que `c` (que trae
`timeoutMs: 0`) corre sin límite y no hay que tocar nada. Para un ejecutor tuyo
que sí use el timeout global y resulte lento, súbelo solo para esa prueba:

```powershell
$env:COMMAND_TIMEOUT_MS="120000"; npx tsx scripts/test-executor.mjs mi-ejecutor "..."
```

(Y de forma permanente, en `.env`: `COMMAND_TIMEOUT_MS=120000`. O mejor, dale a
ese ejecutor su propio `timeoutMs`.)

## Tests y tipos

```powershell
npm test              # node --test sobre tests/**/*.test.mjs
npx tsc --noEmit      # verificación de tipos (el proyecto corre con tsx, sin build)
```

Los tests cubren la detección de límite de uso y el encargado `claude-watch`, que
son la parte con más lógica propia y la más fácil de romper en silencio.

## Estructura

```
src/
  index.ts         bot, allowlist, comandos de control, troceo de mensajes
  config.ts        carga de .env y validación
  registry.ts      ejecutores/encargados + sembrado del kit de arranque
  sessions.ts      sesiones por tema (persistidas)
  runner.ts        ejecución de shell con timeout (mata el árbol) y captura de errores
  protocol.ts      parseo de >>USER / >>SHELL
  orchestrator.ts  flujo ejecutor → encargados → comandos
scripts/
  define.mjs           crea ejecutores/encargados desde texto simple (ejecutor `definer`)
  claude-session.mjs   wrapper de claude con continuidad por sesión (ejecutor `c`)
  claude-marker.mjs    estado por tema de esa conversación (época + uuid)
  claude-reset.mjs     sube la época: conversación nueva sin cambiar de tema (`creset`)
  limit-detect.mjs     detección del límite de uso + hora de reinicio
  claude-watch.mjs     encargado que dispara la reanudación
  claude-resumer.mjs   proceso desacoplado que espera, reanuda y avisa por Telegram
  shell-cwd.mjs        shell con directorio de trabajo persistente (ejecutor `shell`)
  notify.mjs           avisa al tema de Telegram desde un proceso desacoplado
  destino-telegram.mjs a QUE tema, si nadie lo dijo (principal > mas reciente)
  cargar-secretos.mjs  carga .env + ~/.config/dev-secrets.env (procesos desacoplados)
  desacoplar.sh        corre un comando en su propio cgroup (sobrevive al restart)
  vast-sweep.sh        barrido de velocidad en Vast.ai (ejecutor `barrido`)
  test-executor.mjs    harness para depurar un ejecutor SIN Telegram
tests/
  registry.test.mjs
  cargar-secretos.test.mjs
  limit-detect.test.mjs
  claude-watch.test.mjs
  notify.test.mjs
data/
  fuentes.json            dónde buscar ejecutores además de aquí (dato)
  executors/*.json        { name, command, encargados: [], timeoutMs?,
                            descripcion?, ejemplos?, cwd?, requiere? }
  encargados/*.json       { name, command, timeoutMs?, descripcion?, cwd? }
  sessions/*.json         (efímero, ignorado por git)
  claude-sessions/*.json  (markers de claude por sesión, ignorado por git)
  shell-cwd/*.json        (directorio actual por sesión, ignorado por git)
docs/
  revision-2026-08-22.md  repaso de los commits de agosto de 2026 (este repo y
                          el del lanzador): qué cambió, qué vueltas se dieron
                          dos y tres veces, y qué documentación las evita
  ejecutores-federados.md propuesta: que cada repo declare sus ejecutores en
                          `telegram/executors/` y el coordinador los descubra,
                          en vez de que se los copien (NO implementada)
```

## Notas

- **Una sola instancia**: Telegram solo admite un proceso haciendo long polling
  por bot. Si arrancas un segundo, da **error 409**. Antes de reiniciar, detén el
  anterior.
- **Multiplataforma**: el shell por defecto es `cmd.exe` (Windows) o `/bin/sh`
  (Linux). Las plantillas que dependan del SO defínelas según dónde corra el
  coordinador. Los helpers de arranque usan `node -e` para funcionar en ambos.
- **Node ≥ 20.12**: `.env` se carga con `process.loadEnvFile`, sin dependencias.
- **Los errores nunca tumban el coordinador**: cualquier fallo de un comando se
  reporta a Telegram y a la terminal con el mismo texto, y el proceso sigue vivo.
- **Despliegue** (p.ej. droplet de DigitalOcean): usa long polling, no necesita
  IP pública ni puertos abiertos. Corre con un gestor de procesos (pm2/systemd).

### Variables de entorno

| Variable | Def. | Para qué |
| --- | --- | --- |
| `BOT_TOKEN` | — | **obligatoria**, la da @BotFather. Sin ella el proceso sale. |
| `ALLOWED_USER_IDS` | vacío | ids autorizados, separados por coma. Vacío = solo responde `/whoami`. |
| `DATA_DIR` | `data` | dónde viven ejecutores, encargados y sesiones. |
| `COMMAND_TIMEOUT_MS` | `30000` | timeout global por comando (lo puede anular `timeoutMs`). |
| `CLAUDE_PERMISSION_MODE` | `acceptEdits` | permisos del ejecutor `c`. |

Las de la reanudación automática (`CLAUDE_RETRY_*`, `CLAUDE_DETECTION_PRECISION`,
`CLAUDE_CONTINUE_PROMPT`) están en su propia sección más arriba.

## Seguridad

Esto es **ejecución remota de comandos por diseño**. Tenlo presente:

- `ALLOWED_USER_IDS` es la única defensa. Quien esté en esa lista tiene shell en
  tu máquina. No la dejes vacía ni la hagas permisiva por comodidad.
- Con `CLAUDE_PERMISSION_MODE=bypassPermissions`, el ejecutor `c` puede hacer
  **cualquier cosa** sin preguntar.
- `.env` no está versionado y **nunca** debe aparecer en respuestas, logs ni en
  el chat. Si alguna vez se filtra el `BOT_TOKEN`, rótalo con @BotFather.
```
