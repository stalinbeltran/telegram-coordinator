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
| `claude-watch` | encargado | vigila el límite de uso de Claude y programa la reanudación automática (ver abajo). Es mudo: no te escribe. |
| `directorio` | ejecutor | ejemplo mínimo (`dir`): lista el directorio del coordinador. Solo Windows. |

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

Hereda `BOT_TOKEN` y `COORD_CHAT`/`COORD_THREAD` de quien lo lanzó (el
coordinador los pasa a todo comando); fuera de una sesión, se le indican con
`--chat` y `--thread`. Salidas: `0` enviado, `1` no se pudo enviar, `2` mal
invocado o sin configuración. Reintenta los fallos de red y los 5xx, **no** los
4xx (un chat inexistente no se arregla esperando), y el token no aparece nunca
en sus mensajes de error.

> **El aviso es una comodidad, no la fuente de verdad.** Puede fallar —red caída,
> tema borrado— y entonces solo queda constancia en el log del propio trabajo, que
> nadie está mirando. Di siempre dónde queda el resultado.

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
  limit-detect.mjs     detección del límite de uso + hora de reinicio
  claude-watch.mjs     encargado que dispara la reanudación
  claude-resumer.mjs   proceso desacoplado que espera, reanuda y avisa por Telegram
  shell-cwd.mjs        shell con directorio de trabajo persistente (ejecutor `shell`)
  notify.mjs           avisa al tema de Telegram desde un proceso desacoplado
  test-executor.mjs    harness para depurar un ejecutor SIN Telegram
tests/
  limit-detect.test.mjs
  claude-watch.test.mjs
  notify.test.mjs
data/
  executors/*.json        { name, command, encargados: [], timeoutMs? }
  encargados/*.json       { name, command, timeoutMs? }
  sessions/*.json         (efímero, ignorado por git)
  claude-sessions/*.json  (markers de claude por sesión, ignorado por git)
  shell-cwd/*.json        (directorio actual por sesión, ignorado por git)
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
