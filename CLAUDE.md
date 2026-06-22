# CLAUDE.md — Guía del proyecto para Claude

Este archivo explica **qué es este proyecto, cómo está pensado y qué reglas
respetar**. Léelo antes de proponer cambios. Si una petición choca con la
filosofía de aquí, dilo en vez de romperla en silencio.

## Qué es

Un **coordinador** de Telegram: un proceso Node.js que recibe mensajes del dueño
por Telegram, los enruta a programas **ejecutores** (uno por sesión), pasa la
salida a **encargados** que devuelven comandos, y el coordinador ejecuta esos
comandos (correr algo en el shell, o responder al usuario por Telegram).

Caso de uso: operar la máquina (o un droplet) a distancia desde Telegram,
incluyendo conversar con `claude` con memoria por conversación.

## Filosofía de funcionamiento (NO romper)

1. **El coordinador es inmutable; los ejecutores/encargados son dinámicos.**
   Añadir o cambiar ejecutores/encargados **nunca** debe requerir recompilar ni
   reempaquetar el coordinador. Son **datos** (archivos JSON en `data/`), no
   código. El código de `src/` es genérico y estable.

2. **Todo ejecutor/encargado es una plantilla de comando de shell.** No hay
   "tipos especiales" cableados en el coordinador. La lógica nueva se agrega
   definiendo comandos (o pequeños scripts en `scripts/`), no editando el
   enrutado.

3. **Los errores nunca tumban el coordinador.** Cualquier fallo de un comando se
   captura y se reporta **a Telegram y a la terminal** (`console.error`), con el
   mismo texto en ambos lados (ver `fail()` en `orchestrator.ts` y el logging en
   `runner.ts`/`index.ts`). El proceso sigue vivo.

4. **El dueño manda comandos como si estuviera en la máquina.** Es ejecución
   remota de comandos por diseño. La **única** barrera es la allowlist
   (`ALLOWED_USER_IDS`). Nunca debilites esa allowlist ni la hagas opcional.

5. **Multiplataforma.** Debe correr en la terminal de VS Code (Windows) y en
   Linux (droplet). Para lógica que dependa del SO, prefiere scripts en Node
   (`node ...`) porque Node siempre está presente; evita asumir bash o cmd.

## Flujo (una vuelta completa)

```
Tú (Telegram; un TEMA del grupo = una SESIÓN)
  → Coordinador  ── ¿comando de control? (/use /end /who /executors /whoami) → responde
  → EJECUTOR ligado a la sesión (comando shell)  → una salida de texto
  → cada ENCARGADO del ejecutor recibe esa salida → devuelve "comandos":
        >>USER <texto>   → enviar <texto> al usuario por Telegram
        >>SHELL <cmd>    → ejecutar <cmd> y enviar su salida
        (sin prefijo)    → equivale a >>USER con todo el texto
  → Coordinador ejecuta esos comandos y te responde en el MISMO tema
```

- El **input** al ejecutor/encargado se pasa por **stdin**; si la plantilla
  contiene `{{input}}`, se sustituye ahí en su lugar.
- Si el ejecutor falla, se reporta el error y **no** se corren los encargados.
- Si el ejecutor no tiene encargados, se devuelve su salida cruda.

## Sesiones

- Una **sesión** = un ejecutor ligado a un **tema de Telegram**
  (`sessionId = "<chatId>_<threadId>"`). Varios temas = varias sesiones en
  paralelo (mismo ejecutor en conversaciones distintas, p.ej. revisar carpetas
  distintas a la vez).
- Se abre con `/use <ejecutor>` y se cierra con `/end`. Persisten en
  `data/sessions/` (estado efímero, ignorado por git).
- El coordinador solo recuerda **qué ejecutor** está ligado. **No** mantiene la
  conversación interna del ejecutor: un ejecutor con estado (como `c`) debe
  guardar/leer su propio estado por sesión.

### Identidad de sesión expuesta a los comandos

El coordinador pasa estas variables de entorno a TODO comando (ejecutor,
encargado, `>>SHELL`), para habilitar ejecutores con estado sin cablear nada:

- `COORD_SESSION` (`<chatId>_<threadId>`), `COORD_CHAT`, `COORD_THREAD`.

## Conexión con Telegram

- **Bot API con long polling** (grammY). Sin IP pública, webhook ni túneles.
  No cambiar a webhook salvo necesidad real (sería más configuración).
- Solo puede correr **una** instancia haciendo polling a la vez (un segundo
  proceso da error 409). Al reiniciar, detén el anterior.

## Kit de arranque (sembrado automático en `data/` al primer arranque)

- Ejecutor **`shell`** (`{{input}}`): ejecuta lo que envíes.
- Ejecutor **`definer`** (`node scripts/define.mjs`): crea ejecutores/encargados
  con parámetros simples (encabezado + comando). Ver README.
- Ejecutor **`c`** (`node scripts/claude-session.mjs`): conversa con `claude`
  con **memoria por tema** (continuidad nativa `--session-id`/`--resume`).
- Encargado **`echo`**: reenvía la salida del ejecutor al usuario (`>>USER`).

Con `shell`/`definer` + `echo` puedes construir todo lo demás desde Telegram sin
tocar código.

## Estructura

```
src/
  index.ts         bot, allowlist, comandos de control, logging IN/OUT, troceo
  config.ts        carga .env (process.loadEnvFile, sin dependencias) + validación
  registry.ts      cargar/guardar ejecutores y encargados + sembrado del kit
  sessions.ts      sesiones por tema (en memoria + persistidas)
  runner.ts        ejecución de shell: timeout que MATA el árbol de procesos,
                   captura de errores, env extra, nunca lanza
  protocol.ts      parseo de >>USER / >>SHELL
  orchestrator.ts  flujo ejecutor → encargados → comandos; fail() loguea+devuelve
scripts/
  define.mjs           crea ejecutores/encargados desde texto simple
  claude-session.mjs   wrapper de claude con continuidad por sesión
  test-executor.mjs    harness para depurar un ejecutor SIN Telegram
data/
  executors/*.json     { name, command, encargados: [] }
  encargados/*.json     { name, command }
  sessions/*.json       (efímero, ignorado por git)
  claude-sessions/*.json (markers de claude por sesión, ignorado por git)
```

## Detalles técnicos que importan

- **Timeout de comandos** (`COMMAND_TIMEOUT_MS`, 30s por defecto): en Windows con
  `shell:true`, matar solo el shell deja vivos a los hijos y el comando se cuelga
  para siempre. Por eso `runner.ts` mata **todo el árbol** (`taskkill /T /F` en
  Windows, kill de grupo en POSIX). No reintroduzcas el `timeout` de `spawn`.
- **`claude -p` es sin estado** por invocación: la continuidad la da
  `claude-session.mjs` con un UUID estable derivado de `COORD_SESSION`.
- **Permisos de claude** (`CLAUDE_PERMISSION_MODE`): `default` (pide permiso,
  suele bloquear en `-p`), `acceptEdits`, o `bypassPermissions` (⚠️ autonomía
  total). Tras cambiarlo, reiniciar el bot.

## Seguridad (tratar con seriedad)

- La allowlist `ALLOWED_USER_IDS` es la única defensa. No la elimines ni la
  hagas permisiva por conveniencia.
- Con `bypassPermissions`, el ejecutor `c` puede hacer **cualquier cosa** en la
  máquina. Asume que quien tenga acceso al grupo de Telegram tiene shell.
- **Nunca** imprimas el `BOT_TOKEN` ni el contenido de `.env` en respuestas,
  logs ni al chat. (Un mensaje a `c` pidiendo leer `.env` filtró el token una
  vez; si vuelve a pasar, avisa al usuario para rotarlo.)
- `.env` y los datos efímeros están en `.gitignore`. No los commitees.

## Cómo trabajar en este repo

- Para verificar tipos: `npx tsc --noEmit`. Se ejecuta con `tsx` (sin build).
- Para depurar un ejecutor sin Telegram:
  `npx tsx scripts/test-executor.mjs <ejecutor> "<texto>"` (muestra cada paso:
  comando resuelto, exit, stdout/stderr, encargados, acciones y respuesta final).
- Para ver qué recibe el bot en vivo: arráncalo y mira el log `[IN]/[OUT]/[BLOCKED]`.
- Arrancar: `npm run start` (o `npm run dev` con recarga). Recuerda la regla de
  una sola instancia de polling.
- Comentarios y mensajes al usuario: en **español**, como el resto del proyecto.
```
