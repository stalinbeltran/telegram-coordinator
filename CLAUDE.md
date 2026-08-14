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

- Ejecutor **`shell`** (`node scripts/shell-cwd.mjs`): ejecuta lo que envíes, con
  el directorio de trabajo (`cd`) persistente por tema.
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
  shell-cwd.mjs        shell con directorio de trabajo persistente por sesión
  notify.mjs           aviso a Telegram desde un proceso desacoplado
  test-executor.mjs    harness para depurar un ejecutor SIN Telegram
data/
  executors/*.json     { name, command, encargados: [], timeoutMs? }
  encargados/*.json     { name, command, timeoutMs? }
  sessions/*.json       (efímero, ignorado por git)
  claude-sessions/*.json (markers de claude por sesión, ignorado por git)
  shell-cwd/*.json      (directorio actual por sesión, ignorado por git)
```

## Detalles técnicos que importan

- **Timeout de comandos** (`COMMAND_TIMEOUT_MS`, 30s por defecto): en Windows con
  `shell:true`, matar solo el shell deja vivos a los hijos y el comando se cuelga
  para siempre. Por eso `runner.ts` mata **todo el árbol** (`taskkill /T /F` en
  Windows, kill de grupo en POSIX). No reintroduzcas el `timeout` de `spawn`.
- **Timeout por ejecutor/encargado (es DATO, no código):** cada JSON puede
  declarar `timeoutMs`. Ausente = usa el global; `0` o negativo = **sin timeout**
  (corre hasta terminar). Así los ejecutores con tareas largas (p.ej. `c` →
  `claude`, ya viene con `timeoutMs: 0`) no se cancelan a los 30s, sin cablear
  excepciones en el coordinador; el resto conserva la red de seguridad del
  timeout global. Se puede fijar al crear con `definer` usando el token
  `timeout=<ms>` en el encabezado (`exec c echo claude-watch timeout=0`).
- **`claude -p` es sin estado** por invocación: la continuidad la da
  `claude-session.mjs` con un UUID estable derivado de `COORD_SESSION`.
- **El `cd` tampoco sobrevive entre mensajes** (cada comando es un `spawn` nuevo;
  un hijo no puede cambiar el cwd de su padre). Mismo patrón de solución: el
  ejecutor `shell` es `scripts/shell-cwd.mjs`, que guarda el directorio por sesión
  en `data/shell-cwd/` y ejecuta cada comando con ese `cwd`. No hay nada cableado
  en el coordinador: el estado vive en el script, como en `claude-session.mjs`.
- **Un mensaje = un proceso que muere al responder, y se lleva todo lo que lanzó.**
  `claude-session.mjs` hace `spawn('claude', ['-p', …])`: el proceso existe para producir
  *una* respuesta y sale. Todo lo que ese proceso haya arrancado en segundo plano muere con
  él. Hay dos consecuencias, y la segunda se olvida:
  1. **El trabajo largo hay que desacoplarlo.** `setsid`/`detached: true` + `unref()` le da
     grupo propio y sobrevive. Es lo que ya hace `claude-watch.mjs` al lanzar
     `claude-resumer.mjs` («grupo propio: no muere con este encargado»).
  2. **El vigilante también muere — así que nadie avisa de nada.** Un watcher armado dentro
     del turno (cualquier cosa que espere a que termine el trabajo) se muere al acabar la
     respuesta, y entre un mensaje y el siguiente **no queda nada vivo que pueda mandar un
     aviso**. Medido el 2026-08-14 con un benchmark de 11 min en `foveal-vision`: el trabajo,
     relanzado con `setsid`, sobrevivió y terminó bien; los tres vigilantes armados para
     avisar murieron los tres con su turno, y el aviso prometido no llegó nunca. El usuario
     tuvo que preguntar «¿cómo va?» para que se mirara el resultado.

  **Regla práctica**: desacopla el trabajo **y el aviso**. Lo que no puede hacerse es
  esperar dentro del turno.

  **El aviso lo da `scripts/notify.mjs`** (existe desde 2026-08-14; antes esto no se podía
  cumplir y la regla era «no prometas un aviso»). Corre desacoplado y se manda el mensaje él
  mismo por Bot API con lo que heredó del entorno (`BOT_TOKEN`, `COORD_CHAT`, `COORD_THREAD`),
  que es lo que `claude-resumer.mjs` ya hacía para su caso particular:

  ```sh
  setsid sh -c '<trabajo largo>; node scripts/notify.mjs "terminó: <dónde está el resultado>"' &
  ```

  Y para **despertar la conversación** además de avisar, sin nada nuevo: `claude-session.mjs`
  lee el prompt por stdin y escribe la respuesta por stdout, así que se componen con una
  tubería.

  ```sh
  setsid sh -c '<trabajo>; echo "<qué mirar>" | node scripts/claude-session.mjs | node scripts/notify.mjs' &
  ```

  Aun así, **di siempre dónde queda el resultado** (fichero, log, directorio) y compruébalo al
  principio del turno siguiente: el aviso puede fallar —red caída, hilo borrado— y `notify.mjs`
  solo puede dejar constancia del fallo en su propio log, que nadie está mirando. El aviso es
  una comodidad; el artefacto en disco es la fuente de verdad.
- **Modelo y esfuerzo de claude son DATO, no código:** `claude-session.mjs`
  acepta `--model <alias|nombre>` y `--effort <low|medium|high|xhigh|max>` y los
  reenvía a `claude`. Se declaran en la plantilla del ejecutor (`c` trae
  `--model opus --effort max`), así que las variantes se crean con `definer` sin
  tocar el coordinador. Sin flags, manda el default de claude. El hilo depende del tema
  (`COORD_SESSION`), no del ejecutor: cambiar de variante en el mismo tema
  **conserva** la conversación.
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
