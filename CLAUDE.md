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
   reempaquetar el coordinador. Son **datos** (archivos JSON), no código. El
   código de `src/` es genérico y estable: no sabe de benchmarks, de proveedores
   de nube ni de ningún proyecto en concreto.

   **Y no viven sólo aquí: cada repo trae los suyos.** El coordinador escanea las
   fuentes de `data/fuentes.json` (por defecto, `~/src/*/telegram`), así que un
   repo que declare `telegram/executors/*.json` aporta sus comandos al bot con
   sólo estar clonado. Nada que copiar, nada que aplicar, nada que reiniciar. Ver
   [`docs/ejecutores-federados.md`](docs/ejecutores-federados.md).

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
  → Coordinador  ── ¿comando de control? (/use /end /who /ws /executors /whoami) → responde
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
- `COORD_HOME`: la raíz del repo del coordinador. Hace falta desde que cada
  ejecutor corre en el directorio de **su** repo: el cwd ya no apunta aquí, y es
  así como un ejecutor de fuera encuentra `notify.mjs` o `desacoplar.sh` sin
  suponer que el coordinador está en `~/src`. Viaja también por `desacoplar.sh`.

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
- Ejecutor **`creset`** (`node scripts/claude-reset.mjs`): corta la conversación
  de `c` en **este** tema y empieza otra en blanco. Ver más abajo.
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
  workspaces.ts    QUÉ WORKSPACE usa cada tema; re-enraíza el cwd de los
                   comandos bajo él. `/ws` lo ata, y sobrevive a `/end`
  runner.ts        ejecución de shell: timeout que MATA el árbol de procesos,
                   captura de errores, env extra, nunca lanza
  protocol.ts      parseo de >>USER / >>SHELL
  orchestrator.ts  flujo ejecutor → encargados → comandos; fail() loguea+devuelve
scripts/
  define.mjs           crea ejecutores/encargados desde texto simple
  claude-session.mjs   wrapper de claude con continuidad por sesión
  claude-marker.mjs    estado por tema de esa conversación (época + uuid)
  claude-reset.mjs     sube la época: conversación nueva sin cambiar de tema
  shell-cwd.mjs        shell con directorio de trabajo persistente por sesión
  notify.mjs           aviso a Telegram desde un proceso desacoplado
  cargar-secretos.mjs  los DOS ficheros de secretos, para lo desacoplado
  desacoplar.sh        corre algo en su PROPIO cgroup (sobrevive al restart)
  workspace.mjs        ¿en qué copia estoy y está sana? · `--nuevo` MONTA una
  sesiones.mjs         ¿quién más trabaja aquí AHORA? (lo corre el hook al abrir)
  workspaces-locales.mjs  qué workspaces hay en ESTA máquina; lo comparten
                       `cerrable.mjs` y `workspace.mjs` (dos copias divergen)
  cerrable.mjs         ¿se puede APAGAR este server, o se pierde algo?
  test-executor.mjs    harness para depurar un ejecutor SIN Telegram
  bench-preflight.mjs  ¿tiene esta máquina con qué medir? (--fix arregla)
  vast-sweep.sh        barrido en Vast: medir + publicar + no dejar nada vivo
data/
  fuentes.json         dónde buscar ejecutores ADEMÁS de aquí (es dato)
  executors/*.json     { name, command, encargados: [], timeoutMs?,
                         descripcion?, ejemplos?, cwd?, requiere? }
  encargados/*.json     { name, command, timeoutMs?, descripcion?, cwd?,
                         requiere? }
  sessions/*.json       (efímero, ignorado por git)
  claude-sessions/*.json (markers de claude por sesión, ignorado por git)
  shell-cwd/*.json      (directorio actual por sesión, ignorado por git)
  ws/*.json             (workspace de cada tema, ignorado por git)

  ...y en CUALQUIER otro repo de ~/src (ver data/fuentes.json):
  <repo>/telegram/executors/*.json    sus ejecutores, junto al código que llaman
  <repo>/telegram/encargados/*.json   sus encargados
docs/
  WORKSPACE.ejemplo.json    plantilla de identidad de un workspace
  revision-2026-08-22.md    qué se hizo en agosto y qué documentación
                            habría ahorrado las vueltas (los ocho patrones)
  reglas-de-diseno.md       las 19 reglas de DISEÑO de aplicaciones, por
                            disparador: al partir en piezas, al conectarlas,
                            al decidir dónde vive un artefacto...
  agentes.md                los tres agentes (revisor/arquitecto/verificador)
                            y el triage que OBLIGA a llamarlos
  ejecutores-federados.md   propuesta: que cada repo traiga sus ejecutores
                            y el coordinador los descubra (NO implementada)
reportes/
  README.md                 el INDICE: la tabla cronologica de todos los
                            barridos, con horas, instancias y coste real
  <año>/<mes>/<fecha>-<estudio>.md   un reporte por barrido terminado
                            (p. ej. 2026/08-agosto/2026-08-25-bs-alto-tanteo.md)
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
- **Los ejecutores se DESCUBREN, no se copian, y cada uno corre en su repo.**
  `registry.ts` lee varias fuentes en orden; `data/` es la fuente 0, implícita y
  siempre primera, y las demás salen de `data/fuentes.json` (o de
  `COORD_FUENTES`, separado por comas). Cuatro cosas que hay que respetar si se
  toca esto, y las cuatro tienen test:
  1. **`data/` manda.** Lo local siempre puede pisar a lo descubierto, y una
     lista de fuentes vacía, ausente o rota deja el comportamiento de siempre en
     vez de dejar al bot sin ejecutores.
  2. **El cwd de un ejecutor es la raíz del repo que lo declara** (el padre de
     `telegram/`), o `cwd` si lo declara, resuelto contra esa raíz. Por eso los
     ejecutores de otros repos ya no empiezan por `cd "$HOME/src/…"` — y por eso
     el coordinador deja de suponer dónde está clonado nada.
  3. **Las colisiones se avisan, nunca se resuelven en silencio**: gana la
     primera fuente, la pisada queda en `origen.pisados`, y lo dicen tanto el
     arranque del bot como `/executors`. Un ejecutor que hace otra cosa de la que
     crees es peor que uno que falta.
  4. **Un JSON roto de un repo ajeno no puede tumbar la lista.** Se salta con
     aviso, como ya se hacía por fichero.

  La descripción va en el **mismo JSON** que el ejecutor (`descripcion`,
  `ejemplos`), y la imprimen `/executors`, `/executors <nombre>` y `/use`. Antes
  hacía falta un catálogo aparte en otro repo, con dos sitios que podían divergir.

  **La federación ata un comando a un REPO; `requiere` cubre lo que depende de un
  BINARIO.** `c` vive en `data/executors/` de este repo, que en una máquina con el
  bot **siempre** está —es el propio servicio—, así que salía en `/executors`
  aunque `claude` no estuviera instalado: pasa en el mini, donde
  `cloud-init.mini.yaml` no lleva Claude Code porque no cabe en 512 MB. Un JSON
  puede declarar `requiere: ["claude"]` y el registry rellena `falta` con los que
  no estén en el PATH.

  Tres decisiones que hay que respetar si se toca:
  1. **Se MARCA, no se esconde** (`⛔ falta claude` en `/executors`). Un comando
     escondido no se distingue de un repo sin clonar, y entonces no sabes si
     instalar algo o clonar algo.
  2. **`/use` avisa pero NO bloquea.** La comprobación mira el PATH de *este*
     proceso; un falso negativo que impidiera abrir una sesión que sí funciona
     sería peor que el aviso. Si de verdad falta, el ejecutor falla con su error.
  3. **La caché del PATH caduca a los 30 s**, y la regla va escrita junto a ella:
     esto se llama por mensaje, así que sin caché se mira el disco cada vez, y con
     caché eterna habría que reiniciar el bot tras instalar algo.

  Qué va en cada máquina está en
  [`digital-ocean-dropplet-auto-launching/docs/reparto-mini-dev.md`](https://github.com/stalinbeltran/digital-ocean-dropplet-auto-launching/blob/main/docs/reparto-mini-dev.md).
- **El shell de un comando es `/bin/sh`, y en Ubuntu eso es `dash`, no bash.**
  `runner.ts` y `shell-cwd.mjs` lanzan con `spawn(cmd, { shell: true })`, que en
  POSIX usa `/bin/sh`. Así que **no** hay expansión de llaves (`{a,b}.json` llega
  literal y `rm` se queja de un fichero con ese nombre), ni `[[ ]]`, ni arrays, ni
  `source`. Mordió al escribir el comando de limpieza de los ejecutores copiados
  (2026-08-22): se veía correcto y fallaba en la máquina. Escribe los nombres
  sueltos o un `for`, y si necesitas bash de verdad, pídelo explícito
  (`bash -c '…'`). Es la parte concreta de la regla 5 de la filosofía.
- **`claude -p` es sin estado** por invocación: la continuidad la da
  `claude-session.mjs` con un UUID estable derivado de `COORD_SESSION`.
- **Ese UUID no se guarda, se DERIVA — y por eso hace falta `/use creset`.** Al
  derivarse del tema, dentro de un tema la conversación era la misma *para
  siempre*: crecía sin techo y nada la cortaba. Ni `/end` (que solo suelta la
  atadura con el ejecutor, `sessions.ts`), ni reiniciar el bot, ni cambiar de
  variante de modelo, ni chocar con el límite de uso (ahí no cortar es
  deliberado: conservar el contexto). La única salida era abrir un tema nuevo,
  perdiendo con él el `cd` del shell y todo el hilo.

  La solución no rompe la derivación, la **parametriza**: el marker guarda una
  **época** y el uuid sale de `<tema>#<época>` (`scripts/claude-marker.mjs`).
  `creset` sube la época → uuid que claude no ha visto → conversación en blanco,
  mismo tema, sin tocar el coordinador. La época 0 se deriva del tema a secas, así
  que las conversaciones anteriores a esto siguen siendo las mismas.

  La conversación vieja **no se borra**: deja de estar referenciada. Y la época
  vive en `data/` (efímero): si se pierde con la máquina se vuelve a la 0, que es
  el mismo precio que ya se paga al rehacer el servidor.

  Al crear/reanudar, si un modo falla se prueba el contrario: marker y almacén de
  claude pueden desincronizarse en **los dos** sentidos (borrar el marker con
  `~/.claude` intacta, o rehacer `data/` sin rehacer `~/.claude`). Se reporta el
  error del modo que *tocaba*, que es el que explica algo.
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

     **Pero «grupo propio» no es «cgroup propio», y contra `systemctl` manda el cgroup.**
     `setsid` cambia la sesión y el grupo de procesos; el cgroup se hereda y no se toca.
     El servicio es `KillMode=control-group` (el default), así que un `systemctl restart`
     mata **todo** lo que haya en `/system.slice/telegram-coordinator.service`, incluido lo
     que se creía a salvo. Comprobado: un `setsid sleep` acaba con `ppid=1`, sesión y pgid
     propios… y exactamente el mismo cgroup que el bot.

     Medido el 2026-08-19: el resumer esperó sus 220 min, despertó puntual a las 22:00:32 y
     arrancó `claude --resume`; a las 22:05:36 se reinició el coordinador para darle el
     `DO_TOKEN` y lo mató con la respuesta a medias. Nunca llegó nada a Telegram.

     **La solución es `scripts/desacoplar.sh`**: mete el comando en su propio cgroup con
     `systemd-run --scope`, y cae a `setsid` donde no se pueda (sin sudo, sin systemd,
     Windows). Ya lo usan `claude-watch.mjs` para el resumer y el ejecutor `bench` para la
     flota. Para trabajo largo nuevo, lánzalo por ahí en vez de `setsid` a pelo.

     **No cambies el `KillMode` del unit**, que es la salida obvia y aquí es una trampa: el
     `MainPID` es `npm start` y el que hace polling es un **nieto**, así que
     `KillMode=process` dejaría vivo al viejo mientras arranca el nuevo → dos instancias
     haciendo polling → **error 409**, justo el fallo que rompe la comunicación.

     **Y no le pases secretos**: `sudo` escribe la lista entera de `--preserve-env` en claro
     en el journal, así que `BOT_TOKEN`/`DO_TOKEN` por ahí acaban en disco en cada
     lanzamiento. Solo viaja lo que no es credencial (`COORD_*`, `HOME`, `PATH`) y el
     **cwd**, que es lo que permite a cada trabajo cargar los suyos de disco.

     **Y son DOS ficheros, no uno.** Ésta es la parte que costó: `.env` (configuración del
     servicio: `BOT_TOKEN`) y `~/.config/dev-secrets.env` (secretos de la máquina:
     `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN`, los de las nubes). El bot no nota la
     diferencia porque su unit arranca con `bash -lc` y `.bashrc` carga el segundo; **un
     proceso desacoplado sí la nota**. Para eso está `scripts/cargar-secretos.mjs`: cárgalo
     al principio de cualquier script que pueda correr desacoplado, siempre y sin
     condiciones (`loadEnvFile` no pisa lo que ya está en el entorno, así que es gratis).

     Medido el 2026-08-23: el resumer despertaba puntual, lanzaba `claude --resume` sin
     `CLAUDE_CODE_OAUTH_TOKEN` y contestaba **«Not logged in · Please run /login»**. Llevaba
     un `if (!process.env.BOT_TOKEN) loadEnvFile('.env')`, o sea **el guard sobre la variable
     equivocada**: `BOT_TOKEN` sí se recuperaba, así que la carga nunca llegaba a
     ejecutarse — y el token que faltaba estaba en el otro fichero. Un guard que pregunta
     por A para cargar B es un fallo que sólo aparece cuando A está y B no.

     **Y el reanudador tenía SU PROPIO reloj, más corto que el trabajo.** Medido el
     2026-08-23: el límite saltó a las 21:22 con un estudio a medias, el resumer despertó
     puntual a las 22:40, reinyectó el «continúa»… y a las **22:50:31 —exactamente 10
     minutos después— mató la llamada**. Era su `CLAUDE_RETRY_RUN_TIMEOUT_MS`, 600.000 ms
     por defecto. El trabajo duraba una hora (alquilar nueve máquinas, entrenar, recogerlas)
     y **se completó entero**: lo único que se perdió fue la **entrega**. Desde Telegram se
     vio como «nunca me respondiste», que es el peor síntoma posible — indistinguible de que
     no se hubiera hecho nada.

     Tres cosas que dejar escritas, porque las tres se pueden repetir:

     1. **El tope del reanudador contradecía al propio proyecto.** El ejecutor `c` lleva
        `timeoutMs: 0` precisamente porque las tareas de claude son largas; el resumer existe
        para **continuar una de esas**, y traía 10 minutos. Un límite puesto en dos sitios con
        criterios opuestos gana siempre el más corto, y en silencio. Ahora son 6 h — y **no 0**,
        a propósito: el resumer tiene el cerrojo de la sesión, y uno colgado para siempre
        bloquearía las reanudaciones siguientes.
     2. **Matar el envoltorio no es matar el trabajo.** El `child.kill()` mataba
        `claude-session.mjs` y dejaba a `claude` **huérfano**, gastando tokens contra una
        tubería que ya no leía nadie. Es la misma lección que `runner.ts` aprendió en Windows,
        y la solución es la misma: `detached` + matar el **grupo**.
     3. **Un corte propio se anuncia como propio.** El caso caía en el «error desconocido»
        genérico, así que ni el usuario ni el siguiente turno podían distinguir «claude falló»
        de «lo maté yo y el trabajo quizá esté hecho». Ahora el aviso dice quién cortó, cuánto
        esperó, y **que hay que mirar el disco antes de repetir nada**.
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

## Estos servidores son efímeros: lo que no está empujado, no existe

La máquina se rehace sin aviso y de ella solo sobrevive lo que está en el remoto.
Por eso el push no es el cierre del encargo, es parte de cada cambio: **cambio o
documentación terminada → commit → push**, el mismo día, sin acumular.

Y hay que mirar **a qué rama llega**: un clon limpio saca `main`, así que un commit
parado en `dev` es invisible para la máquina siguiente. Mientras el merge esté
pendiente, el trabajo no existe para nadie más.

Medido el 2026-08-14: el droplet apareció recién restaurado (clon limpio, sin
`.venv` ni datos). El procedimiento para reconstruir el dato del benchmark del
proyecto hermano **sí estaba commiteado y empujado —pero a `dev` del generador, sin
fusionar a `main`—**, así que aquí no había ni rastro: se dio por imposible lo que sí
estaba escrito, y se gastó una corrida de benchmark sobre la fuente equivocada.

Vale igual para lo que no es código: un reporte o una medición que merezca conservarse
se commitea. Lo que queda en `/tmp` o en un directorio ignorado, se pierde.

## ¿Se puede apagar este server? — dilo al FINAL DE CADA MENSAJE

**Regla de comportamiento, no opcional: cada respuesta al usuario termina con una línea que
dice si este server se puede cerrar o no.** El usuario opera desde el móvil y destruye
droplets a mano; sin esa línea, apagar en el momento equivocado es cuestión de tiempo.

```bash
node scripts/cerrable.mjs --breve     # la línea que se pega al final
node scripts/cerrable.mjs             # el informe entero, con qué se perdería
```

Sale así, y se pega **tal cual**:

```
🔴 **NO CERRAR** — 20 máquinas Vast (1,3864 $/h) · 2 proceso(s) vivo(s) · 29 cambio(s) sin empujar
🟢 **CERRABLE** — nada alquilado, nada corriendo, todo empujado
🟡 **NO SÉ** — `vast_instance.py list` falló (¿token? ¿red?): NO sé qué hay alquilado
```

Desde Telegram: `/use cerrable` (el ejecutor está en `data/executors/cerrable.json`).

### Qué mira, y por qué esas tres cosas

| Qué | Por qué se pierde al apagar |
|---|---|
| **Máquinas de Vast vivas** | **El daño que crece solo.** El proceso que las recoge muere con el server; **las máquinas no**. Siguen facturando, sin nadie que las destruya y sin nadie que se entere |
| **Procesos de trabajo** | Flotas, vigilantes, datasets, mediciones: mueren con la máquina y hay que repetirlos |
| **Lo no commiteado / no empujado** | «Lo que no está empujado, no existe»: un clon limpio saca `main` del remoto y punto |

### Las tres decisiones que hay que respetar si se toca

1. **Ante la duda dice `NO SÉ` y sale con 2, nunca «cerrable».** Si falta el token o la API no
   contesta, no se puede saber qué hay alquilado — y un fallo silencioso que se lee como
   permiso es justo el que cuesta dinero. Es la misma regla que el cerrojo sin dueño vivo:
   entre un fallo ruidoso y uno silencioso, el ruidoso.

2. **Cuenta lo de TODOS los workspaces de ESTA máquina, no sólo el del que pregunta.** La
   pregunta es *«¿se puede apagar este SERVER?»*, y todo lo que muera con él cuenta: la cuenta de
   Vast es una sola (ver § «Varias sesiones a la vez») y desde que cada TEMA puede tener su
   workspace (`/ws`), un mismo bot alquila con **varios prefijos** desde una máquina. Filtrar por
   el prefijo del que pregunta decía `🟢 CERRABLE` con la flota de otro tema facturando — el fallo
   silencioso que este script existe para no cometer. Lo que sí sigue siendo ajeno es lo que no
   casa con **ningún** prefijo local: eso es de otro server. Y por eso la pista para recogerlas
   destruye **por etiqueta** y avisa en voz alta de **no usar `destroy --all`**, que se llevaría
   por delante las de la otra sesión.

3. **De quién es un proceso lo dice su CWD, no su línea de comando.** La flota se lanza con
   ruta relativa, así que filtrar por la salida de `ps` da por ajenos los procesos propios
   (medido el 2026-08-27). Se resuelve con `/proc/<pid>/cwd`.

4. **El veredicto NO puede depender de desde dónde preguntes** — y dependía. `cerrable.mjs` se
   **copia con el workspace**, así que desde que un tema re-enraíza sus comandos, `/use cerrable`
   ejecuta la copia de `~/ws/tema-N/telegram-coordinator/scripts/`. El script deducía de su propia
   ubicación en disco (el antipatrón de la **R4**) las dos cosas que decide, y las dos se daban la
   vuelta al correr desde una copia. Medido el 2026-08-28, mismo instante y misma máquina, con un
   cambio real sin commitear en `~/src/telegram-coordinator`:

   | Se pregunta desde | Decía | |
   |---|---|---|
   | `~/src` | `🔴 NO CERRAR` | correcto |
   | `~/ws/tema-2` | **`🟢 CERRABLE`** | **permiso para destruir la máquina** |

   - **Qué árboles mira:** `dirname(COORD)` pasaba a ser el workspace, así que **el árbol de casa
     no entraba en la lista** y su trabajo sin empujar era invisible. Es el falso verde, o sea el
     único fallo de este script que cuesta dinero.
   - **Qué ignora:** el `data/fuentes.json` que reescribe `--nuevo` se ignoraba si el árbol «no era
     desde donde preguntas». Desde dentro dejaba de ignorarse (🔴 permanente por un árbol vacío: el
     aviso que sale siempre y se deja de leer) y en cambio **sí** se ignoraba el de casa, donde un
     cambio ahí es un cambio de verdad.

   Casa se **declara** con `COORD_HOME` —que el coordinador pasa a todo comando y **no**
   re-enraíza (`src/orchestrator.ts`)— y sólo se deduce del disco cuando el script no está dentro
   de un workspace montado. Si corre desde una copia y nadie se lo dijo, **dice `NO SÉ`** en vez de
   inventárselo. Y lo que se ignora es «este árbol es un workspace **montado**» (tiene
   `WORKSPACE.json`), que no cambia según quién pregunte. Seis tests en
   `tests/cerrable-casa.test.mjs`; cinco de los seis fallan con el código anterior.

   ⚠ **Y la lección general, que es la que se repite:** todo script que se copie con el workspace
   y hable del **conjunto** de la máquina tiene este fallo latente. `dirname(COORD)` es «dónde
   estoy», nunca «dónde está casa».

⚠ **El ejecutor lo llama con `--exit0`** porque el coordinador lee cualquier código ≠ 0 como
«el ejecutor falló» y entonces no corre los encargados: la respuesta no llegaría a Telegram.
El veredicto va en el **texto**, que es donde se lee. Fuera de Telegram el código de salida
(0 cerrable · 1 no cerrar · 2 no sé) sigue sirviendo para encadenar.

## Todo barrido o estudio que termine deja su reporte en `reportes/`

**Regla, y no es opcional: cuando un barrido o un estudio termina, el encargo no está
cerrado hasta que su reporte está escrito en `reportes/` y commiteado.** Va en el mismo
commit o en el siguiente, el mismo día — la regla de arriba (`cambio terminado → commit
→ push`) se aplica entera.

Dónde y cómo, con el detalle completo, en [`reportes/README.md`](reportes/README.md).
En corto:

```
reportes/<año>/<mes>/<fecha>-<nombre-del-estudio>.md
   └─ p. ej. reportes/2026/08-agosto/2026-08-25-bs-alto-tanteo.md
```

Y **se añade su fila al final de la tabla de `reportes/README.md`**, sin tocar las
anteriores. La tabla va en orden cronológico y es de sólo-añadir: reescribir filas viejas
es perder el histórico que la hace útil.

### Qué lleva siempre, y por qué estos campos y no otros

**Inicio y fin (UTC), instancias alquiladas, coste real.** No son adorno: son las cuatro
columnas que no se pueden reconstruir después. Y si un dato no existe, **se escribe que no
existe** — un hueco se lee como cero, y «no registrado» se lee como lo que es.

Medido al escribir los ocho primeros reportes (2026-08-25): de las ocho corridas, la de
`bench_fleet.py` sobre droplets de DO **no dejó ni coste ni hora de fin** porque su reporte
no guarda ninguno de los dos, y el barrido de Vast de `foveal-cpu` sólo permite dar un
**suelo** de coste, porque las máquinas que fallan antes de medir no dejan JSON. Las dos
son irrecuperables. Las seis corridas de `estudio_flota.py` sí traen todo, porque su
`flota.json` guarda `cuando`, `reloj_min`, `usd` y `maquinas_alquiladas`.

⚠ **«Instancias» son las ALQUILADAS, no las que trabajaron.** Sumar sólo los lotes que
terminaron da un número más bonito y más bajo que la factura. `flota.json` ya distingue las
dos cosas (`maquinas` contra `maquinas_alquiladas`); el reporte también tiene que hacerlo.

⚠ **Y las horas del log son mejores que las derivadas.** `cuando − reloj_min` da el inicio
con un error de ±3 s (comprobado el 2026-08-25 contra las cuatro corridas que sí dejaron log
en `/tmp`), así que sirve — pero si el log existe, se lee del log y no se deriva. **`/tmp` no
sobrevive a rehacer la máquina**: lo que haya que conservar de un log, va al reporte.

### El reporte resume y enlaza; NO copia el veredicto

El dato vive donde lo dejó quien lo produjo (`sweeps/*/flota.json`, `results/*/`) y el
**veredicto** de un estudio vive en el documento de plan que escribió su criterio *antes* de
mirar. Es la regla de siempre aquí: una cosa que cruza repos se escribe donde se dispara y
desde el otro se enlaza, nunca se copia, que es como nacen las dos mitades desfasadas. Un
reporte contesta *qué se corrió, cuándo, con cuántas máquinas, qué costó y qué salió*, y
para el resto apunta.

Y lleva un apartado de **«lo que quedó pendiente»**, que es la parte que más se pierde: un
barrido incompleto que no dice qué le falta es indistinguible de uno terminado.

## Quién revisa cada petición: el triage OBLIGA, los agentes JUZGAN

Las reglas de aquí abajo están escritas y aun así se rompen, porque una regla escrita compite con
otras 1.400 líneas. Por eso hay dos capas, y la distinción entre ellas es todo el diseño
([`docs/agentes.md`](docs/agentes.md)):

- **`scripts/triage.mjs`** corre en el hook `UserPromptSubmit` de `.claude/settings.json`, o sea
  **en cada mensaje y lo dispara el harness, no el modelo**. Clasifica la petición —gasto ·
  destructivo · estructura · implementación— y dice **a qué agente hay que pasarla**. No razona:
  casa patrones. Pone la **obligación**.
- **Los agentes de `.claude/agents/`** ponen el **juicio**: `revisor` (¿esta petición se sostiene?
  ¿contradice algo ya medido?), `arquitecto` (¿dónde va y cómo se conecta?, aplicando las 19
  reglas) y `verificador` (¿es verdad lo que voy a decir que hice?).

⚠ **Una consulta normal no dispara nada, y es deliberado**: un aviso que sale siempre se deja de
leer en una semana (patrón B). Lo que pasa por revisión es cada petición que **puede hacer daño**,
no cada petición.

⚠ **El hook obliga pero no impide.** `UserPromptSubmit` inyecta contexto; el que puede **negar** una
llamada concreta es `PreToolUse`, y **no está puesto**. Está escrito en `docs/agentes.md` § «Lo que
este diseño NO puede hacer» para que no se dé por hecho un freno que no existe.

## Cómo se DISEÑA aquí: las 19 reglas, y se entra por el disparador

Antes de proponer una estructura nueva —un repo, un módulo, una interfaz entre dos piezas, o
dónde se guarda algo que el sistema produce— **se leen las reglas que apliquen** de
[`docs/reglas-de-diseno.md`](docs/reglas-de-diseno.md). No se lee entero: su § 0 es una tabla
que va de la **acción que estás a punto de hacer** a las reglas que la gobiernan.

Salen del [análisis de arquitectura del 2026-08-28](reportes/2026/08-agosto/2026-08-28-analisis-arquitectura.md),
que revisó los cinco repos como un solo sistema. Cada regla trae **cómo se comprueba**, y la mitad
están ilustradas con algo que este proyecto **incumple hoy** —el grafo cíclico de repos, `scripts/`
adelantando a `src/`, los reportes en el repo del transporte, cero CI— porque una regla que sólo se
ilustra con aciertos no se distingue de un eslogan.

⚠ **Si una regla choca con lo que ibas a hacer, dilo y explica el choque**; no la rompas en
silencio ni la des por inaplicable sin decirlo. Si el usuario confirma, se hace como pide y **la
excepción se anota con su motivo** donde se aplique. Y el documento **crece con cada fallo**, como
un preflight: una decisión de estructura que salga mal deja allí su regla en el mismo commit que
el arreglo.

## Cómo se escribe aquí (y por qué estas cinco reglas y no otras)

Salen de repasar los commits de agosto de 2026 en este repo y en el del lanzador:
cada una es una vuelta que se dio **más de una vez**, con lo que costó anotado. El
repaso entero está en [`docs/revision-2026-08-22.md`](docs/revision-2026-08-22.md);
aquí queda sólo lo que hay que respetar al escribir.

1. **«Sobrevive» siempre lleva complemento.** Nunca escribas que algo sobrevive sin
   decir **a qué** y **por qué mecanismo**. «`setsid` le da grupo propio y sobrevive»
   era verdad —al tree-kill del runner— y se leyó como garantía general; contra
   `systemctl restart` no sobrevive, porque el cgroup se hereda. Costó seis commits
   en seis días y un aviso que no llegó nunca (2026-08-19). Si no sabes a qué **no**
   sobrevive, escribe «no comprobado contra X».

2. **Todo número lleva su procedencia**: medido (con fecha y el comando) o estimado
   (marcado como tal). Un número sin procedencia se lee siempre como medido. Vale
   igual para lo que se afirme de una API ajena: `medido 2026-08-20 con: …` o
   `leído del OpenAPI, NO comprobado`. Escribir de memoria es deuda que se descubre
   tarde (el OpenAPI de Vast documenta campos que no devuelve, y la primera versión
   imprimía «0 modelos» sin fallar: silencioso y creíble).

3. **Todo cerrojo o marcador en disco lleva su regla de caducidad escrita al lado.**
   El proceso que lo puso puede morir por SIGKILL sin correr su `cleanup`: un
   `existsSync` a secas convierte un fallo de una tarde en una función muerta en
   silencio para siempre (pasó con `.resume.lock`). Sin dueño vivo, no hay cerrojo.
   Y entre un fallo ruidoso y uno silencioso, siempre el ruidoso.

4. **Terminado = el comando existe Y se puede invocar desde Telegram.** Si un
   comando nuevo puede **empezar o parar un gasto**, su ejecutor va en el **mismo
   commit**: el freno nunca llega después del acelerador. El 2026-08-20 hubo 1 h 08
   min con capacidad de alquilar máquinas por segundo y sin forma de apagarlas desde
   el móvil, que es desde donde se opera cuando no hay portátil delante.

5. **Un preflight comprueba estado utilizable, no presencia**, y **crece con cada
   fallo**: cada vez que algo se descubra a mitad, la comprobación se añade a
   `bench-preflight.mjs` en el mismo commit que el arreglo. «El repo está» ≠ «el repo
   puede correr» — faltaban los venvs, y eso se supo media hora después de escribir
   el preflight.

Y dos sobre **dónde** se escribe, porque documentar no basta si no llega:

- Una lección que **cruza repos** se escribe en el repo donde se **dispara** (el que
  tiene el comando) y desde el otro se **enlaza**; nunca se copia, que es como nacen
  las dos mitades desfasadas. «El token deja crear droplets, pero no entrar en ellos»
  se escribió aquí el 19 de agosto y se volvió a aprender en el lanzador el 20.
- Una trampa se indexa por **la acción que la dispara**, no por su primera víctima.
  «Nos pasó con `DO_TOKEN`» se lee como historia y se lee una vez; «al añadir un token
  nuevo hay que mandarlo a sus **dos** destinos» se lee cada vez que toca hacerlo.
  Escrita como historia, volvió a morder con el token de Vast.

## ✅ VERIFICADO el 2026-08-28: `/ws` funciona en una máquina limpia

**El motivo por el que se destruyó el server anterior queda cerrado.** Se corrieron los ocho pasos de
[`docs/verificar-ws-2026-08-28.md`](docs/verificar-ws-2026-08-28.md) sobre este server —nacido a las
18:07 UTC con `2b5b059` y **sin `~/ws`**, que es como nace un dev— y salieron los ocho.

Lo que de verdad se buscaba es el paso 4: con el tema atado a `~/ws/prueba`, el ejecutor corrió **en
la copia** —los cinco repos en rama `prueba`, no `main`, y el `fuentes.json` del workspace—. El
re-enraizado funciona a través del bot real, no sólo del arnés.

Y dos cosas que la lista no pedía y ahora están medidas:

- **Dos temas del mismo bot en dos árboles a la vez.** El tema principal (sin atar) corrió en
  `~/src` mientras el tema 2 corría en `~/ws/prueba`. Es justo lo que un solo coordinador no podía
  hacer antes, y con un tema solo no se ve.
- **La decisión 4, en vivo:** desde el tema atado, `echo $DATA_DIR` dio
  `/home/deploy/src/telegram-coordinator/data`. El estado por tema **no** se muda con el workspace,
  así que atar un tema no le borra el `cd` ni la conversación.

⚠ **Y el freno (paso 6) nombró el trabajo del otro workspace**, que es lo que cuesta dinero si falla:
`foveal-vision [prueba]: 1 fichero(s) sin commitear`.

### Lo que hay que saber la próxima vez que se monte un workspace

- **Un workspace montado fija el `🔴 NO CERRAR` mientras exista**, aunque no haya nada a medias: su
  rama no está en el remoto y `--nuevo` deja `data/fuentes.json` modificado en la copia. Es la regla
  aplicada bien —nombra qué se perdería—, pero conviene saberlo: un workspace de trabajo **nunca**
  deja la máquina en verde.
- **El aviso del documento («si dice `/home/deploy/src`, el re-enraizado no funciona») sólo vale
  DESPUÉS de atar.** Sin `/ws <nombre>`, correr en el árbol del coordinador es lo correcto — y se
  parece exactamente a un fallo. Pasó en esta verificación: se saltó el paso 3 y el 4 se leyó como
  roto. `data/ws/` y el log del bot (`journalctl -u telegram-coordinator`) distinguen las dos cosas
  en un segundo: sin fichero de atadura, no hay nada que re-enraizar.

### ⚠ Hallazgo ABIERTO: un `--tomar` no sobrevive a cerrar y reabrir la sesión

`scripts/sesiones.mjs:119-131` conserva el traspaso explícito cuando la sesión se **reanuda**, y eso
funciona. Pero `--cerrar` **borra** el marcador, así que el `registrar` siguiente no tiene de quién
heredar y cae al workspace deducido del cwd, **en silencio**.

Reproducido el 2026-08-28 con una sesión de prueba:

| Secuencia | Resultado |
|---|---|
| `--registrar` sin cierre previo (reanudar) | `workspace=~/ws/prueba` · `tomado=true` ✅ |
| `--cerrar` y luego `--registrar` | `workspace=null` · `tomado=false` ❌ |

**Dónde muerde:** cualquier cierre limpio de la sesión, y en una sesión de Telegram —que es un
proceso `claude` por mensaje— eso puede ocurrir sin que nadie lo pida. Visto en vivo el 2026-08-28: el
marcador de esta sesión decía `prueba` a las 18:47 y a las 18:58 se había **recreado** con
`workspace: null` y un `desde` nuevo, o sea borrado y vuelto a crear.

⚠ **Lo que NO está establecido es cada cuánto pasa.** El traspaso sobrevivió de 18:31 a 18:47, o sea
varios mensajes, así que **no** es «uno por mensaje» y qué disparó ese `--cerrar` concreto no se
aisló. Lo reproducido es el mecanismo, no su frecuencia.

**Alcance:** sólo importa cuando el workspace tomado **no coincide** con el que se deduce del cwd, o
sea el caso «me mudé a mitad de sesión». Un tema atado con `/ws` no lo sufre: su ejecutor ya corre
dentro del workspace y la deducción acierta.

**Sin arreglar, a propósito.** La salida más limpia sería que `--cerrar` no borre cuando
`tomado: true` sino que marque el marcador como cerrado —el listado lo ignora, así que un cierre
limpio sigue liberando ya— y que `registrar` pueda recuperar la decisión explícita si vuelve la misma
sesión. Toca el mecanismo que evita que dos sesiones se pisen, así que pide su test (R17).

### Las dos trampas de la verificación, que siguen valiendo

⚠ **No verifiques con `shell` + `pwd`** si el tema ya tenía un `cd`: el `cd` guardado gana sobre el
workspace y parece que `/ws` no hizo nada. Medido el 2026-08-28.

⚠ **`/ws` sólo lista árboles que tengan `WORKSPACE.json`**, así que el del coordinador no sale si no
tiene identidad. No falta nada: está escrito así en `src/workspaces.ts:155`.

## ⚠ AUTOMONTAJE: 6 de 7 pasos verdes (2026-08-28). Falta `/ws off` y una comprobación

**Implementado (`231d9ac`, tests en `4c33d72`) y verificado por Telegram el 2026-08-28.** El
ciclo entero está visto en vivo: los temas 2 y 438 escribieron su primer mensaje y montaron su
`~/ws/tema-N` en **6 s** cada uno, con prefijos `t2-`/`t438-`, los cinco repos en su rama y el
estado efímero borrado en la copia. El tema principal se quedó con el defecto **sin montar
nada**, y **el freno sigue en `🟢` con los dos workspaces montados** — que era el punto del
arreglo de `git-pendiente.mjs`. Tests 111/111.

Falta el paso **6** (`/ws off` de mensaje a mensaje, cubierto por test pero no visto por el
bot) y, del **4**, verlo por Telegram: `cwdEnWorkspace()` manda cada tema a su árbol con las
ataduras reales, pero falta un ejecutor corriendo allí. Los dos pasos son un mensaje cada uno y
están escritos en el documento.

⚠ **Y hay un hallazgo ABIERTO**: un montaje cortado a mitad deja el tema reintentando en cada
mensaje **sin poder funcionar nunca** (`--nuevo` dice «ya existe», `resolverWorkspace` dice «no
tiene WORKSPACE.json»). Salidas: `/ws off`, o `rm -rf ~/ws/tema-<id>`. Detalle y por qué no se
arregló todavía, en [`docs/verificar-auto-ws.md`](docs/verificar-auto-ws.md).

Desde ese commit, el
**primer mensaje de un tema decide en qué árbol trabaja**: el primer tema que escriba se queda
con `~/src` y no monta nada; los demás montan su `~/ws/tema-<id>` (~6 s) y quedan atados.

⚠ **Y por eso esto va antes que nada: el primer mensaje que llegue tras reiniciar el bot se
lleva el árbol del coordinador.** No hay configuración —se elige escribiendo ahí primero—, así
que **mándalo en el tema que quieras como principal**. Si se equivoca de tema: `/ws off` en el
que lo pilló.

La lista está en **[`docs/verificar-auto-ws.md`](docs/verificar-auto-ws.md)** y son siete pasos.
El que importa es el 5, que es el que cuesta dinero:

```bash
node scripts/cerrable.mjs     # con workspaces automáticos vacíos: tiene que salir 🟢
```

Porque el otro lado de este cambio es que **`cerrable` dejó de contar como pérdida una rama sin
commits propios** (`scripts/git-pendiente.mjs`). Sin eso, cada tema metía 6 líneas de alarma por
un árbol donde no se había hecho nada, y el veredicto que se lee desde el móvil se quedaba en 🔴
para siempre. **Pero aflojarlo de más es el fallo caro**, así que el paso 5 comprueba las dos
mitades: que un workspace vacío no avise, **y que uno con trabajo de verdad siga avisando**.

⚠ **El bot necesita reinicio para tener este código** (corre con `tsx`, sin build), y **no se
puede reiniciar desde un mensaje de Telegram**: el servicio es `KillMode=control-group` y el
`claude` que atiende el mensaje vive en ese cgroup, así que se mataría a sí mismo a media
respuesta. Hazlo desde otro tema con `shell`, o desde la máquina.

## ⚠ PENDIENTE AHORA MISMO (dejado el 2026-08-28): lanzar `do-v`, el estudio de `dropout`

**Si estás en un server recién lanzado, esto es lo primero.** El server anterior se descartó con
el tanteo ya hecho y el estudio completo **creado, commiteado y sin lanzar**. Es un comando.

Va aquí y no en la memoria de Claude a propósito: `~/.claude/` se destruye con la máquina, así que
una nota allí no sobrevive justo al evento que tiene que sobrevivir. **Lo que no está empujado, no
existe.**

```bash
node scripts/bench-preflight.mjs --fix     # el venv de foveal-vision NUNCA está en un dev nuevo
cd ~/src/foveal-vision
.venv/bin/python scripts/estudio_progreso.py --sweep do-v --tabla   # ¿queda algo por correr?
"$COORD_HOME/scripts/desacoplar.sh" sh -c '
set -a; [ -f "$COORD_HOME/.env" ] && . "$COORD_HOME/.env"
[ -f "$HOME/.config/dev-secrets.env" ] && . "$HOME/.config/dev-secrets.env"; set +a
.venv/bin/python scripts/estudio_flota.py --sweep do-v --cpu E5-26 --criba 2 \
    --git --horas-max 8 --prefijo dr- --yes > /tmp/estudio-dropout-completo.log 2>&1
node "$COORD_HOME/scripts/notify.mjs" "estudio completo de dropout (do-v) terminado"' &
```

**20 runs · ≈1,1 $ · ~3,5 h** al ritmo real medido (53 s/época; los 40 estimados se quedaron
cortos). Al terminar: `estudio_informe.py --sweep do-v --vigente 0.0`, y el reporte a
`reportes/` con su fila (regla de siempre).

### Los valores del tanteo `do-t`, ya medidos — **no hay que repetirlos**

Corrido el 2026-08-28 01:30→04:51 UTC, 8/8 runs, 5 máquinas, **0,3626 $**, dataset
`dirty1000-80px-16px-r20260827`, base `ws16-p2-d2-L4`. Detalle en el reporte
[#17](reportes/2026/08-agosto/2026-08-28-dropout-tanteo.md) y el criterio en
[`foveal-vision/docs/plan-dropout-2026-08-28.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-dropout-2026-08-28.md).

| `dropout` | f1 (media) | épocas | **brecha val/train** |
|---:|---:|---:|---:|
| **0,0** *(vigente, gana)* | **0,9315** | 47 · 54 | **+29,5 %** |
| 0,25 | 0,9282 | 46 · 59 | −4,4 % |
| 0,5 | 0,9274 | 73 · 82 | −15,7 % |
| **0,1** *(el peor)* | **0,9129** | 34 · 35 | −2,6 % |

**Lo que hay que llevarse de aquí, que no es el ranking:**

1. **La brecha val/train de +28 % que motivaba todo esto queda CONFIRMADA** de forma independiente
   sobre un dataset nuevo: **+29,5 %** con `dropout` = 0,0. La premisa era buena.
2. **`dropout` cierra esa brecha ENTERA ya con 0,1** (+29,5 % → −2,6 %) y con 0,5 la invierte.
   Regulariza exactamente como se diseñó. **Y el f1 baja igual, en los tres valores.** O sea: el
   sobreajuste **no era el cuello de botella**; `patience` ya lo estaba recogiendo. Es el desenlace
   que el plan escribió **antes** de mirar.
3. **El `train_loss` casi se dobla** (0,0793 → 0,1480 con 0,1): la red no redistribuye capacidad,
   **la pierde**. Con 167.852 parámetros sobre este dato no sobra red, falta.
4. Con `weight_decay` (#14), **los dos mandos de regularización quedan cerrados** — y ahora con un
   mecanismo medido detrás en vez de una conjetura.
5. ⚠ **`patience` = 10 NO es neutral en este eje** (34 a 82 épocas, factor 2,4): `dropout` mete
   ruido, la `val_loss` mejora a tirones y una `patience` fija corta antes. Parte de lo medido es
   eso, y es la explicación más plausible de que el eje **no sea monótono**. Es un estudio propio
   (`dropout` × `patience`) y **no se ha hecho**.

⚠ **Y `do-v` NO es repetir el tanteo.** Aporta el punto **`0,05`**, que nadie ha mirado y es donde
podría quedar una ganancia, y **5 semillas**, que bajan el `p` mínimo alcanzable de 0,333 a
**0,0079** — lo que convierte «el vigente gana» en una declaración al 5 % en vez de una impresión.
El rango `{0 · 0,05 · 0,1 · 0,2}` **no se elige ahora**: lo fijó la tabla que el plan escribió
antes de mirar, y vive en `TABLA_PICO` dentro de `foveal-vision/scripts/estudio_dropout.py`.

### Y DETRÁS DE `do-v`: el estudio de `patience`, empezando por el tanteo

**Pendiente, anotado el 2026-08-28.** Va **después** de `do-v` y **empieza por un tanteo** — con
la expectativa explícita de que **lo más probable es que se quede ahí**. Por qué, y qué habría que
mirar exactamente:

#### Lo que YA está medido, y no hay que volver a pagar

`patience` **sí se barrió** en el #14, dos veces, {5 · 10 · 20}. ⚠ **Pero la tabla de
`reportes/README.md` lo resumía como «ninguno mueve el vigente», y eso escondía la mitad
interesante.** Los números, leídos hoy de `pat-t` e `pat-v`:

| `patience` | `pat-t` (semillas 1-2) | `pat-v` (semillas 4-5) | épocas |
|---:|---:|---:|---|
| 5 | 0,9166 | 0,9323 | 15 · 36 · 27 · 43 |
| **10** *(vigente)* | 0,9271 | 0,9364 | 40 · 47 · 48 · 66 |
| **20** | **0,9299** | **0,9391** | 84 · 85 · 58 · 92 |

1. **`20` gana las DOS veces**, con una diferencia notablemente consistente (**+0,0028** y
   **+0,0027** sobre el vigente), y el eje sube **monótono**. **`20` es el techo del rango: el eje
   NO está acotado por arriba y nadie ha mirado más allá.**
2. **Pero ninguna de las dos declara**: `p` = 0,667 y 1,000, y con 2 semillas el suelo alcanzable
   es 0,333. **Y +0,0027 está por debajo de δ**, así que por la regla del proyecto no movería el
   vigente ni con `p` bueno.
3. ⚠ **`pat-v` NUNCA TERMINÓ: 6/9.** Le falta **la semilla 3 entera** (los tres valores). Estaba
   diseñado como semillas 3-5 para *sumar* a las 1-2 de `pat-t` y llegar a 5 — y **nunca se
   sumaron**, porque `estudio_informe.py` trabaja sobre **un** recorrido. O sea que hay **4
   semillas pagadas que nadie ha analizado juntas**.
4. ⚠ **Y las cuatro están sobre `r20260826`, que se perdió.** No se pueden extender ni sumar: un
   estudio nuevo **re-mide desde cero** sobre `r20260827`.

#### El tanteo que hay que correr: `pa-t`

**`patience` ∈ {10 · 20 · 40}**, 2 semillas = **6 runs**. Estimado **≈0,5 $ y ~4 h** *(estimado,
no medido: sale de 47 + 85 + ~150 épocas por semilla a los 53 s/época del tanteo de dropout)*.

- **El `5` NO entra.** Pierde en las dos medidas (−0,0105 y −0,0041) y confirma el mínimo de 8
  medido indirectamente sobre 70 runs. Pagar por re-confirmar al perdedor es justo donde un
  tanteo no debe gastar.
- **El `40` es el punto del estudio.** `20` gana dos veces **y es el borde del rango**: es el mismo
  caso que `borde-ancho`, y se resuelve mirando más allá, no repitiendo lo de dentro.

⚠ **DOS cosas que hay que fijar ANTES de lanzarlo, o el estudio nace inválido:**

1. **`epochs` tiene que subir a 300.** Con `patience` = 20 los runs llegaron a **84-92 épocas**;
   con 40 es plausible que pasen de 150, que es el tope actual. **Un run que para por el tope
   falla R1** — mide presupuesto, no calidad — y entonces el punto que más interesa es justo el
   que no se puede leer. Es la misma razón por la que `bs-alto-*` subió el tope a 300.
2. **Este eje NO es cost-neutral, y es el único así.** Más `patience` = más épocas = **más
   dinero**, casi lineal: un run de `patience` 40 cuesta ~2× uno de 10. La comparación tiene que
   sopesar la ganancia **contra su coste**, como en `border_reduce` y a diferencia de `dropout`.

#### El criterio para QUEDARSE en el tanteo — escrito antes de mirar

**`patience` se queda en 10 y el estudio se cierra en el tanteo** si se cumple **cualquiera**:

1. la amplitud entre `{10, 20, 40}` **no llega a 0,010** (el doble del ruido típico entre
   semillas, el mismo umbral que el bloque B del #14) — entonces la meseta es plana y `patience`
   es un mando de **coste**, no de calidad: se queda el más barato, que es 10; **o**
2. **`40` no mejora a `20`** — el eje satura o se da la vuelta, y entonces las dos medidas ya
   existentes («20 supera a 10 por +0,0027») son toda la historia, y ese número **está por debajo
   de δ**: no mueve un vigente.

**Sólo se sube a 5 semillas si se cumplen LAS DOS**: algún punto supera al vigente por **más de
1 SE** *y* la amplitud pasa de 0,010.

⚠ **Y lo más probable es quedarse.** Las dos medidas que ya hay dan +0,0027, muy por debajo del
umbral de 0,010. Escribir esto antes es justamente lo que permite que «no hubo señal» sea un
resultado y no una decepción.

#### La pregunta grande que este tanteo NO contesta

**`patience` es un CONFOUND a lo largo de los demás ejes, y eso es otro estudio.** Medido en el
tanteo de `dropout` (#17): las épocas fueron de **34** (dropout 0,1) a **82** (dropout 0,5), factor
**2,4**. Con una `patience` fija, cada brazo de un eje recibe **un presupuesto de entrenamiento
distinto**, así que parte de lo que mide *cualquier* barrido es eso. Atacarlo pide un diseño 2-D
(`dropout` × `patience`) o cambiar la regla de comparación (escalar `patience`, o rankear a
épocas igualadas). **Un tanteo 1-D de `patience` no lo toca**, y conviene no confundir las dos
cosas: la primera pregunta es *«¿cuánto conviene esperar?»* y la segunda es *«¿estoy comparando
en igualdad de condiciones?»*.

---

## ✅ RESUELTO el 2026-08-28: el dataset SÍ llegó solo, por git

La verificación que dejó el server del 27-ago **salió bien**. En una máquina nueva, que no
renderizó nada, el preflight dio `[  ok  ] datasets de estudio  2 con windows.npz commiteado`, y
el tanteo de `dropout` entrenó sobre `dirty1000-80px-16px-r20260827` sin tocar un render. **El
`windows.npz` en git funciona**, que era justo lo que había que comprobar.

Lo de abajo se conserva porque los **tres caminos** por los que un server recibe el dato siguen
teniendo que estar en pie, y si alguno se rompe, se rompe en silencio.

```bash
node scripts/bench-preflight.mjs        # la línea «datasets de estudio»
ls -la ~/src/foveal-vision-data/window-datasets/*/windows.npz
```

| Qué tiene que salir | Qué significa |
|---|---|
| `[  ok  ] datasets de estudio   2 con windows.npz commiteado` | ✅ **funcionó**: el dato viajó por git a una máquina que nunca renderizó nada |
| `[ aviso] … NINGUNO con windows.npz (sólo manifest/split)` | ❌ el `.npz` no llegó al remoto — mirar si el commit del dato se empujó |

Los dos que tienen que estar, empujados el 2026-08-28 (~2,2 MB cada uno):
`bench-dirty1000-16-r20260827` (benchmark de vCPU) y `dirty1000-80px-16px-r20260827`
(estudios). Y el preflight entero debe salir con **código 0** — el volumen `bench-data` ya
**no** bloquea, porque el dato viene de git.

⚠ **Los `-r20260827` llevan la época de render porque son datos NUEVOS.** Al reconstruir,
`bench_dataset.py build` **abortó solo**: la huella recién construida no coincidía con la del
manifest commiteado (`6268a2f5…` contra `c2b51245…`). Es la tercera confirmación independiente
de que reconstruir no devuelve el dataset. El `r20260826` se queda con su manifest y **sin npz**:
ese dato se perdió y no vuelve.

Y las tres comprobaciones que lo cierran del todo:

```bash
cd ~/src/foveal-vision
.venv/bin/python -c "import sys;sys.path.insert(0,'src');from fv import settings;print(settings.window_datasets_root())"
#   -> ~/src/foveal-vision-data/window-datasets   (NO el repo de código)

.venv/bin/python -m pytest -q tests/test_stride.py -k "repo_de_datos or payload or guardado"
#   -> la indirección, el contrato con la máquina alquilada y el freno de "sin commitear"
```

### Los tres caminos por los que un server creado desde aquí recibe el dato

Los tres tienen que seguir en pie; si alguno se rompe, se rompe en silencio.

| Server | Cómo recibe el dato |
|---|---|
| **Vast** (`estudio_flota.py`) | dentro del **payload tar**, leído del repo de datos |
| **Droplet de medición** (`bench_fleet.py`) | `preparar_dataset()` **publica desde git** a una etapa temporal. El volumen quedó de respaldo |
| **Droplet nuevo** (`lanzar launch dev`) | `types/dev.json` **clona `foveal-vision-data`** |

⚠ **Y lo que NO hay que "simplificar":** sin repo de datos, `window_datasets_root()` cae a
`<código>/data/window-datasets` — que es **exactamente** donde el tar y el `scp` dejan el dato en
las máquinas alquiladas, que no tienen ese repo y no deben tenerlo. Origen y destino son distintos
**a propósito**; igualarlos rompe el lado remoto y se descubre con la flota facturando. Tiene test.

⚠ **Renderizar uno nuevo necesita Google Chrome, no el Chromium de Playwright.**
`cdn.playwright.dev` devuelve **403 «not available in your location»** desde `nyc1` (medido
2026-08-27, tres reintentos). Se instala el `.deb` de `dl.google.com` y se rinde con
`ITF_CHROMIUM_PATH=/usr/bin/google-chrome`; ~0,7 img/s, los mil renders ≈ 25-60 min según carga.
**Pero si el `.npz` está en git, una máquina nueva no necesita nada de esto** — que es justo el
punto de todo esto.

## Encargo en curso: medir velocidad de entrenamiento por vCPU

**Si estás leyendo esto en un servidor recién lanzado, empieza por aquí.** Este
encargo se ha reabierto varias veces y siempre se atascaba en el mismo sitio: se
descubría a mitad que faltaba algo (el dato, el token, la clave), y lo que se
descubre a mitad se resuelve improvisando. Por eso lo primero no es medir, es
preguntar qué falta:

```bash
node scripts/bench-preflight.mjs          # qué hay y qué falta
node scripts/bench-preflight.mjs --fix    # además arregla lo que puede solo
```

Sale con código 0 **sólo** si se puede medir ya. Para cada cosa que falta imprime
el comando exacto que la arregla, y distingue las que se arreglan aquí dentro de
la única que no: el token, que lo tiene que enviar la máquina lanzadora.

### Qué es «todo lo necesario» (esta es la definición)

| # | Qué | Quién lo pone | Si falta |
|---|---|---|---|
| 1 | `DO_TOKEN` en el entorno | el lanzador, con `--make-launcher` o `push-do-token` | **no se puede** crear ni destruir droplets. Es lo único que no se arregla desde dentro |
| 2 | Repo `~/src/digital-ocean-dropplet-auto-launching` | `--make-launcher`, o `--fix` | no hay con qué hablar con la API |
| 3 | Par de claves `~/.ssh/do_droplet` **registrado en la cuenta** | `--make-launcher`, o `--fix` | se crean droplets en los que no se puede entrar: existen, facturan y no sirven |
| 4 | Repos `~/src/foveal-vision` y `~/src/image-text-sample-generator` | `--repo` al lanzar, o `--fix` | no hay benchmark ni generador |
| 5 | Repo `~/src/foveal-vision-data` | `--repo` al lanzar, o `--fix` | **lo medido no se guarda en ninguna parte.** Ver abajo |
| 6 | Volumen `bench-data` montado en `/mnt/bench-data` con el dataset | `--volume bench-data` al lanzar | hay que regenerar el dato: ~15-20 min de renders. **Se puede**, no es un bloqueo |
| 7 | `python3`, `ssh`, `scp`, `git` | cloud-init | los trae el arranque; si falta alguno, `apt-get install` |

El punto 5 es el más nuevo y el más silencioso. Desde el 2026-08-27 los resultados de un
estudio (runs, recorridos, estudios) se guardan en el repo hermano
[`foveal-vision-data`](https://github.com/stalinbeltran/foveal-vision-data), no en
`foveal-vision`. La indirección es `fv.settings.data_root()`, que **cae al repo de código
cuando el de datos no está clonado** — un fallback deliberado, para que nada se rompa. Pero ahí
`runs/`, `sweeps/` y `studies/` están en `.gitignore`: el estudio corre entero, escribe sus
resultados y **no los commitea en ningún sitio**. Se van con el droplet, y por el camino no hay
un solo error. Medido el 2026-08-27 en esta misma máquina, recién rehecha.

Por eso el preflight lo trata como bloqueante, y por eso `estudio_flota.py --git` **aborta antes
de alquilar** si no encuentra dónde commitear. El detalle está donde se dispara, en
[`foveal-vision/CLAUDE.md` § «Dónde caen los datos de un estudio»](https://github.com/stalinbeltran/foveal-vision/blob/main/CLAUDE.md#dónde-caen-los-datos-de-un-estudio-en-foveal-vision-data).

El punto 3 es el que se olvida siempre: **el token deja CREAR droplets, pero no
ENTRAR en ellos**. Un droplet acepta las claves registradas en la cuenta en el
momento de nacer, así que la clave tiene que estar registrada *antes* de lanzar
nada. Los droplets creados antes de registrarla no la aceptarán nunca.

### Cómo se lanza este servidor para que no falte nada

**Lo normal es `lanzar launch dev` desde el Lanzador, y ya**: `types/dev.json` del
lanzador declara los repos (incluido `foveal-vision-data`), el servicio,
`make_launcher` y el `register-key` de Vast, así que el lanzamiento cabe en un
mensaje y no hay nada que recordar. Es a propósito: **si para que algo esté hay que
acordarse de un `--repo`, tarde o temprano no está**. El detalle está donde se
dispara, en
[`docs/reparto-mini-dev.md`](https://github.com/stalinbeltran/digital-ocean-dropplet-auto-launching/blob/main/docs/reparto-mini-dev.md).

⚠ Un tipo que cambia sólo llega a las máquinas creadas **después**, y sólo si el mini
tiene el repo del lanzador al día: es él quien lee `types/dev.json` al lanzar. Tras
tocar un tipo, `actualizar` en el Lanzador.

La versión larga y explícita, si hace falta lanzar sin tipo (desde la máquina
lanzadora, no desde aquí):

```bash
python scripts/do_droplet.py volume create bench-data --size-gb 10   # una vez en la vida
python scripts/do_droplet.py launch trabajo \
  --service telegram-coordinator \
  --make-launcher \
  --volume bench-data \
  --repo stalinbeltran/foveal-vision \
  --repo stalinbeltran/foveal-vision-data \
  --repo stalinbeltran/image-text-sample-generator
```

`--make-launcher` es lo que convierte a esta máquina en lanzadora: envía el
token, clona el repo del lanzador y le genera un par de claves propio con la
pública registrada en la cuenta. Las tres cosas van juntas porque pedidas por
separado se olvida una.

### El trabajo

Medir `seconds_per_epoch` en droplets de distinta capacidad de vCPU. Esta
máquina **no se mide a sí misma**: lanza una máquina por tamaño, le copia el
dato, mide, y **la destruye**. Ella sigue viva; las de medición son desechables.

```bash
python3 ~/src/foveal-vision/scripts/bench_fleet.py --vcpus 2,4,8
```

Tarda decenas de minutos, así que **no se corre dentro de un turno**: hay un
ejecutor `bench` que ya lo lanza desacoplado y avisa al terminar (`/use bench`,
luego `--vcpus 2,4,8`). Vive en **`foveal-vision/telegram/executors/bench.json`**,
junto al script que llama, y llega aquí porque el coordinador descubre los
ejecutores de cada repo clonado: si `foveal-vision` no está, `bench` no sale en
`/executors`, y es lo correcto. El aviso es una comodidad; la fuente de verdad son
`~/src/foveal-vision/benchmarks/vcpu_*.json` y el log en `/tmp/`, y **se miran al
principio del turno siguiente**.

El detalle completo —qué mide, de dónde sale el dato, qué se espera encontrar y
qué cuesta— está en
[`foveal-vision/docs/benchmark-vcpu.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/benchmark-vcpu.md).

### El dataset **se guarda**, porque regenerarlo NO da el mismo dato

⚠ **Esta sección decía lo contrario hasta el 2026-08-27, y lo que decía era la
mitad verdadera de una frase falsa.** Léela entera antes de dar por hecho que un
dataset se puede rehacer.

**Lo que sí reproduce:** los renders del generador. Los specs están congelados en
git (`specs.jsonl`, seed 1), y comprobado el 2026-08-19 en este mismo droplet,
renderizando dos veces el mismo spec los `sha256` de los **PNG** salen idénticos
byte a byte. Eso sigue siendo cierto.

**Lo que NO reproduce:** el `windows.npz`, que es sobre lo que se entrena.
Medido el 2026-08-26 con `repro-chk` —mismo punto, misma semilla, misma familia
de CPU, donde el entrenamiento sale idéntico bit a bit— y las curvas salieron
**distintas**. Veredicto escrito antes de mirar: *es otro dataset*. Por eso el de
hoy se llama `r20260826` y no `r20260824`.

**Lo que costó:** al rehacer la máquina, el `r20260824` desapareció —no estaba en
ningún git— y con él la comparabilidad de **20 runs ya pagados**, que hubo que
volver a medir enteros (barrido [#14](reportes/README.md)).

**La solución, desde el 2026-08-27: el `windows.npz` se commitea** en
`foveal-vision-data/window-datasets/`, ~3-6 MB por dataset. El detalle está donde
se dispara, en [`foveal-vision/CLAUDE.md` § «El dataset de ventanas también va
allí»](https://github.com/stalinbeltran/foveal-vision/blob/main/CLAUDE.md#el-dataset-de-ventanas-también-va-allí--y-su-windowsnpz-se-commitea).
`estudio_flota.py` avisa si el dataset no está commiteado y **con `--git` aborta
antes de alquilar**: estar en disco no es estar guardado.

```bash
cd ~/src/foveal-vision
python3 scripts/bench_dataset.py build                      # ~15-20 min
python3 scripts/bench_dataset.py publish --to /mnt/bench-data
```

Ese `build` es para el dataset del **benchmark de vCPU** (`bench-dirty1000-16`),
que además vive en un **volumen** para no repetir los 20 minutos en cada máquina
nueva: un volumen es lo único de la cuenta que sobrevive a su droplet. Los
datasets de **estudio** ya no dependen de eso: están en git. Los
droplets de medición **no** lo montan (un volumen va en una máquina a la vez, y
además hay que medir el disco local, no la red): se les copia el dato y se
verifica la huella SHA-256 **en el destino**, porque un dataset a medias daría un
número más rápido con exactamente la misma pinta que uno bueno.

### Coste, que es lo único irreversible aquí

Los droplets facturan por segundo mientras existan. Los de medición nacen con el
tag `bench-efimero` —que no usa nada más— y se destruyen en un `finally`. Si algo
se corta a mitad:

```bash
python3 ~/src/foveal-vision/scripts/bench_fleet.py --reap
```

## Varias sesiones a la vez: **un WORKSPACE por línea de trabajo**

Desde 2026-08-27 hay **más de una sesión de Claude trabajando a la vez**, cada una en su
copia de los repos. Esta sección es la que evita que se pisen. Léela **antes** de tocar
nada si no estás seguro de en qué copia estás.

### Regla 0, la que manda sobre todas: **no toques lo que no es de tu workspace**

Otra sesión está editando ficheros, corriendo flotas y haciendo commits **ahora mismo**.
Un cambio tuyo en su copia no es un conflicto de git: es trabajo destruido en caliente, y
sin ningún síntoma hasta que a alguien le fallan los números.

- **No edites** ficheros fuera de tu workspace, ni siquiera «para arreglar algo obvio».
- **No mates procesos** que no hayas lanzado tú (`pkill -f estudio_flota` mata los de
  todos: es una cadena de comando, no una ruta).
- **No destruyas máquinas** cuya etiqueta no sea la tuya (ver «el prefijo» abajo).
- Si ves algo roto en otro workspace, **dilo, no lo arregles**.

### Por qué un WORKSPACE y no «una copia del repo que toque»

Porque **los repos se buscan entre ellos por el directorio padre**, y una copia parcial
cambia en silencio a qué repo llega cada script. Medido el 2026-08-27:

```
foveal-vision/scripts/bench_dataset.py:46   GENERADOR = ROOT.parent / "image-text-sample-generator"
foveal-vision/scripts/estudio_flota.py:179  LANZADOR  = ROOT.parent / "digital-ocean-dropplet-auto-launching"
foveal-vision/scripts/vigilante_avance.py:106  LANZADOR = ROOT.parent / "digital-ocean-dropplet-auto-launching"
```

`~/dev/` tenía ese día `foveal-vision`, `telegram-coordinator` y el lanzador, pero **no**
`image-text-sample-generator`. O sea que `~/dev/foveal-vision` no puede reconstruir el
dataset: su `ROOT.parent` no tiene el generador. No falla al empezar — falla a mitad, que
es peor.

**Conclusión: los repos hermanos viajan juntos o no viajan.** La unidad que se copia es el
workspace entero, no un repo suelto.

### La estructura que cumplen todos

```
~/ws/<linea-de-trabajo>/          ← la unidad. UNA sesión de Claude, UNA línea de trabajo
    WORKSPACE.json                ← la identidad. Sin esto, el workspace no existe
    foveal-vision/
    telegram-coordinator/
    digital-ocean-dropplet-auto-launching/
    image-text-sample-generator/
```

El nombre del directorio es **la línea de trabajo**, no el repo ni la fecha: `~/ws/cierre/`,
`~/ws/stride/`, `~/ws/plana/`. Así el prompt del shell y cualquier ruta de un log dicen a qué
sesión pertenece sin tener que preguntar.

⚠ **Los cuatro repos, aunque no los uses.** Cuesta poco y quita la clase entera de fallos de
arriba. Un workspace incompleto es un workspace que funciona hasta que deja de hacerlo.

### `WORKSPACE.json`: la identidad, en un sitio y no en la cabeza de nadie

```json
{
  "nombre": "cierre",
  "prefijo": "ci-",
  "rama": "cierre-parametros",
  "creado": "2026-08-27",
  "que": "cerrar overlap_fovea_px y medir los ejes nunca barridos",
  "sesion": "claude-code #1"
}
```

Plantilla commiteada en [`docs/WORKSPACE.ejemplo.json`](docs/WORKSPACE.ejemplo.json) — cópiala
y rellénala. Va **en la raíz del workspace**, no dentro de un repo: describe el conjunto, y si
viviera dentro de uno se copiaría con él y mentiría (además de no ser commiteable, que es
correcto: es estado de la máquina, no del repo). Es lo primero que hay que leer al abrir sesión
y lo primero que hay que escribir al crear un workspace.

### Desde Telegram, **un workspace por TEMA**: `/ws`

Los workspaces de arriba separan **sesiones de Claude Code**. El coordinador no participaba, así
que **todos los temas compartían un árbol** —el del proceso— aunque en disco hubiera diez. La causa
era exactamente el antipatrón de la R4 (*el acoplamiento se declara, nunca se deduce del layout del
disco*):

```
scripts/workspace.mjs   const WS = dirname(COORD);   ← deducido del disco
scripts/cerrable.mjs    const WS = dirname(COORD);
```

Un coordinador vive en un directorio y sólo puede haber uno (error 409): un directorio, un
workspace, para todos los temas. Ahora se **declara**:

```
/ws               en qué workspace trabaja este tema, y cuáles hay montados
/ws <nombre>      lo ata a ~/ws/<nombre>  (o a una ruta)
/ws off           lo suelta: vuelve al árbol del coordinador
```

Atado el tema, **todo comando corre en el repo equivalente de ese árbol** y recibe `COORD_WS`.
`data/ws/<sesión>.json` guarda la atadura.

#### Las cinco decisiones que hay que respetar si se toca

1. **`/ws` es un comando de CONTROL, no un ejecutor** —y es lo único de esta lista que no cabía en
   la filosofía 2—. Los ejecutores se re-enraízan bajo el workspace del tema; si `/ws` fuera uno, la
   forma de salir de un workspace roto viviría **dentro** de ese workspace. Un comando de control
   corre en el proceso del bot y no se puede re-enraizar: **la salida de emergencia nunca depende de
   aquello de lo que quieres salir.**

2. **Si el repo no está en el workspace, se NIEGA antes de correr** (R2: o degrada con un defecto
   declarado, o falla *antes de empezar*; fallar a mitad no es una opción). Caer al árbol original
   sería correr con otra rama y otro prefijo **sin decirlo** — el fallo silencioso caro. El error
   dice las dos salidas: clonar el repo, o `/ws off`.

3. **La atadura sobrevive a `/end`**, y por eso no vive en `data/sessions/` —que `/end` borra— sino
   en `data/ws/`. Cerrar la sesión suelta el **ejecutor**, no te muda de árbol. Igual que el `cd` de
   `shell` y la conversación de `claude`. Tiene test.

4. **El estado por tema NO se muda con el workspace.** El coordinador pasa `DATA_DIR` absoluto a
   todo comando: sin eso, re-enraizar el cwd movería `data/shell-cwd/` y `data/claude-sessions/` a
   la copia del workspace, y atar un tema **parecería borrarle el `cd` y la conversación**.

5. **El descubrimiento sigue siendo ÚNICO: `fuentes.json` no se mira por tema.** Los cinco repos de
   cada workspace son clones del mismo sitio, así que `bench.json` es idéntico en todos: no hacen
   falta N definiciones descubiertas, hace falta **una** ejecutada en N directorios. Eso evita que
   `/executors` mezcle las copias.
   ⚠ El precio: un ejecutor que exista **sólo** en un workspace y no en el árbol del coordinador
   **no sale en `/executors`**. Si hace falta, se añade su árbol a `fuentes.json` — con las
   colisiones que eso trae (ver § *`fuentes.json` apunta a UN workspace*).

⚠ **La atadura es EFÍMERA** (`data/` está en `.gitignore`), y es a propósito: el mismo precio que ya
pagan los markers de claude. Lo que sobrevive a rehacer la máquina es el **id del tema**, que es un
hecho de Telegram; volver a atar es un `/ws <nombre>` por tema, y por eso `/ws` acepta el **nombre**
y no sólo una ruta. Si el workspace ya no está en disco, la atadura **no se carga**: el tema vuelve
al árbol del coordinador en vez de apuntar a una ruta muerta. Y el fichero no se borra, así que
remontar el workspace con el mismo nombre **re-ata el tema solo** al siguiente arranque.

⚠ **Y el freno va en el mismo commit (R11).** Con un workspace por tema, un mismo bot alquila con
**varios prefijos** desde una sola máquina, y `cerrable.mjs` filtraba por **uno**: habría dicho
`🟢 CERRABLE` con la flota de otro tema facturando. Ahora cuenta las máquinas, los procesos y lo no
empujado de **todos los workspaces de la máquina** —que es lo que la pregunta *«¿se puede apagar
este server?»* significa de verdad—, y los nombra: `foveal-vision [dropout]: 3 sin commitear`.

#### Dos alternativas descartadas, para no volver a discutirlas

- **Un coordinador por workspace.** Imposible sin un token por bot: sólo una instancia puede hacer
  polling (error 409). Es lo que obliga a que el workspace sea un dato **por tema** y no del proceso.
- **`git worktree` en vez de clones.** Sigue siendo la opción barata si llegan a hacer falta muchos
  workspaces: un solo `.git` por repo, un `fetch` sirve para todos, y git **impide** dos worktrees
  en la misma rama, o sea que «rama propia por workspace» dejaría de ser convención. No se hizo
  porque `--nuevo` con clones ya funciona y el disco no aprieta (los cinco repos son ~80 MB, medido
  el 2026-08-28, con 73 GB libres). **Lo caro no es el disco: es el venv de `foveal-vision`**, que
  hay que rehacer por copia y no está medido.

### Los cuatro recursos que **sí** son compartidos, y cómo se reparten

Copiar carpetas separa el disco. **No separa nada más.** Éstos son globales de la máquina o
de la cuenta, y cada uno necesita su regla:

| Recurso | Por qué es compartido | La regla |
|---|---|---|
| **La cuenta de Vast/DO** | Un token, una factura | **`--prefijo <pfx>` obligatorio** en toda flota. Es lo que hace que `vigilante_avance.py` diga *«ajena: no la toco»* en vez de destruir máquinas de otro |
| **El remoto de git** | Los cuatro repos empujan al mismo GitHub | **Rama propia por workspace.** A `main` sólo empuja el workspace que lo tenga declarado. **Nunca `--force`** sobre una rama compartida |
| **Los procesos de la máquina** | `pgrep`/`pkill` casan por cadena de comando, no por ruta | Filtra **siempre** por la ruta de tu workspace antes de matar nada |
| **El descubrimiento del coordinador** | `data/fuentes.json` es un patrón con comodín | Que apunte **a tu workspace y sólo a él** (ver abajo) |

#### El prefijo, que es lo que ya funcionó

Medido el 2026-08-27: la sesión de `stride-h01` lanzó su flota con `--prefijo st-`, y el
vigilante de la sesión de `cierre` clasificó sus máquinas como **ajenas** y no las tocó
—*«no sé de qué recorrido es 'stride-h01'; no la toco»*—. Sin prefijos distintos, un
vigilante habría destruido las máquinas del otro **creyendo que eran huérfanas suyas**.

El prefijo del workspace es el del `WORKSPACE.json`, y se usa **siempre**, aunque creas que
eres la única sesión viva. Es la comprobación de un dato, no una cortesía.

#### `fuentes.json` apunta a UN workspace

`data/fuentes.json` trae `["~/src/*/telegram"]`, un **comodín**. Con un solo árbol es lo que
hace la federación cómoda; con varios workspaces bajo el mismo padre es lo que hace que
`/executors` mezcle los ejecutores de todos, con colisiones de nombre — `bench.json`,
`estudio.json` y `vigilante.json` se llaman igual en todas las copias.

El coordinador **avisa** de la colisión (`origen.pisados`) y gana la primera fuente, así que
no es silencioso; pero *«gana la primera»* no es un criterio que quieras cuando la segunda es
otra línea de trabajo. **Cada coordinador apunta al suyo:**

```json
{ "fuentes": ["~/ws/cierre/*/telegram"] }
```

⚠ Y por lo mismo: **no metas workspaces bajo `~/src/`**, que es donde apunta el patrón por
defecto. `~/ws/` existe justo para no heredar ese comodín.

### Al abrir una sesión NO hay que acordarse de nada: lo dice el hook

Desde el 2026-08-28 hay un **hook `SessionStart`** (en `.claude/settings.json`, commiteado para
que viaje con el repo) que corre `scripts/sesiones.mjs --registrar --hook` y mete en el contexto
de la sesión, antes de que escribas nada:

```
Tu sesión: 57511e85 · workspace /home/deploy/ws/fechado (fechado)
Nadie más trabaja aquí. Adelante.
```

...o, si el workspace ya tiene dueño:

```
🔴 HAY OTRA SESIÓN EN ESTE MISMO WORKSPACE
   0c7762b3  activa desde hace 3 min
   → node scripts/workspace.mjs --nuevo <linea-de-trabajo>
```

**Por qué hace falta, y por qué `workspace.mjs` no bastaba:** aquél contesta *«qué PROCESOS
corren que no son míos»*, y **una sesión de Claude leyendo y escribiendo ficheros no deja ningún
proceso corriendo**. El 2026-08-28 dos sesiones trabajaron a la vez sobre los mismos repos; la
segunda sólo se enteró porque el usuario se lo dijo a mano, y el choque llegó igual (un reporte
citando rutas que la otra acababa de mover). **Que exista otra sesión tiene que ser un dato, no
algo que alguien recuerde mencionar.**

#### La regla de caducidad, que aquí no es opcional (regla 3 de escritura)

Una sesión **no puede** probar que está viva con un pid: el proceso que escribe el marcador es el
hook, que muere enseguida, y nadie va a refrescar un heartbeat. Pero **Claude Code añade a su
transcript en cada mensaje**, así que el `mtime` del `.jsonl` es un latido que ya existe y que
nadie tiene que mantener. El marcador guarda **dónde** está ese fichero; la vida se lee de él.

| tramo | qué significa |
|---|---|
| **ACTIVA** (< 30 min) | ha escrito hace poco: es la que de verdad puede pisarte |
| **CALLADA** (< 4 h) | abierta pero parada. **Sigue contando**: hay un usuario detrás |
| **VIEJA** | se da por muerta; su marcador se borra a los 7 días |
| **NO SÉ** | no se puede leer su transcript. **Cuenta como ocupada** |

Un marcador huérfano **caduca solo**: si la sesión murió, su transcript deja de crecer. Sin dueño
vivo, no hay cerrojo. Y el `NO SÉ` es deliberado — un falso *«no hay nadie»* es permiso para pisar
el trabajo de otro, que es el error caro de los dos.

⚠ **El hook nunca puede impedir que arranque una sesión**: sale con 0 pase lo que pase, y si no
puede comprobar nada lo dice. Tiene test.

#### Montar un workspace es UN comando

```bash
node scripts/workspace.mjs --nuevo <linea-de-trabajo> [--prefijo xx-] [--rama r] [--que "..."]
```

Hace los ocho pasos que antes se hacían a mano, y **olvidarse de uno no fallaba: fallaba a mitad
y en silencio**. Directorio bajo `~/ws` (no bajo `~/src`, que es donde apunta el comodín de
`fuentes.json`), los **cinco** repos, rama propia en cada uno, **prefijo libre comprobado contra
los workspaces que ya existen**, `WORKSPACE.json`, `fuentes.json` apuntando aquí, y borrado del
estado efímero por tema. No crea el venv ni arranca el bot, y dice por qué.

⚠ **Y si te mudas a mitad de sesión, dilo — o hazlo con `--nuevo`, que ya lo dice por ti.**
El cwd de una sesión es donde **arrancó**, no donde acaba trabajando: ésta empezó en
`~/src/telegram-coordinator` y a los diez minutos su trabajo estaba en `~/ws/fechado`. Un registro
que apunta al workspace que ya no tocas **avisa de un choque que no existe y calla el que sí**.

```bash
node scripts/sesiones.mjs --tomar ~/ws/<linea>     # esta sesión pasa a ser su dueña
```

`--nuevo` lo hace solo al terminar: quien acaba de crear un workspace es exactamente quien va a
trabajar en él. Se identifica por `CLAUDE_CODE_SESSION_ID`, y **si no sabe qué sesión es, se
niega** en vez de pisar el marcador de otra.

⚠ **Y el traspaso sobrevive a que la sesión se reanude.** Medido el 2026-08-28, con el hook ya
corriendo: esta sesión hizo `--tomar ~/ws/fechado`, se reanudó, y el `--registrar` del
`SessionStart` reescribió el marcador con el workspace deducido del cwd — **borrando la mudanza en
silencio**, con lo que el registro pasó a avisar del choque equivocado y a callar el bueno. El
marcador lleva ahora `tomado: true` y **una decisión explícita no la pisa una inferida**; el cwd sí
se refresca, porque eso es un dato. Tiene test.

#### Al cerrar: `SessionEnd` suelta el workspace — pero eso es la COMODIDAD, no la regla

Hay un segundo hook que borra el marcador al cerrar la sesión, para que un cierre limpio libere el
workspace **ya** en vez de dentro de 30 minutos.

⚠ **Y borra SÓLO la sesión que venga en el payload del hook, nunca la de
`CLAUDE_CODE_SESSION_ID`.** Medido el 2026-08-28: un `claude` anidado —que es lo que lanza el
ejecutor `c` del bot en cada mensaje— **hereda esa variable del padre**, así que con el fallback
puesto el `SessionEnd` del hijo **borraba el marcador del padre** y liberaba un workspace que
seguía ocupado, en silencio. Es exactamente el falso «no hay nadie» que este registro existe para
no dar. Borrar el marcador equivocado es peor que no borrar ninguno: lo que no se borre caduca
solo. Tiene test, y el mismo criterio vale para `--registrar --hook`.

⚠ **No es de lo que depende la caducidad, y no puede serlo.** Una sesión que muere por SIGKILL, al
cerrar la terminal o al rehacerse la máquina **nunca corre su `SessionEnd`**. Si el borrado
dependiera de él, un marcador huérfano bloquearía el workspace para siempre — que es exactamente
el fallo del `.resume.lock`. El mecanismo sigue siendo el latido del transcript; esto sólo lo
adelanta. Hay un test que lo fija: una sesión muerta **sin** `--cerrar`, con su marcador todavía en
disco, deja de contar igual.

Desde Telegram: `/use sesiones` y `/use workspace`.

### Las cuatro preguntas que contesta `workspace.mjs`

Las contesta las cuatro de una vez **`node scripts/workspace.mjs`**, que sale con código 0
sólo si el workspace es coherente y para cada fallo imprime el comando que lo arregla:

1. ¿en qué workspace estoy y cuál es mi prefijo? (`WORKSPACE.json`)
2. ¿está cada repo hermano, y en la rama de este workspace?
3. ¿`fuentes.json` apunta aquí y sólo aquí?
4. ¿qué hay corriendo, y qué de eso **no es mío**? — por `/proc/<pid>/cwd`, no por `ps`

⚠ **La 4 se contesta SIEMPRE, aunque no haya nada corriendo.** Callar cuando no hay procesos hace
que *«no lo miré»* y *«miré y no hay»* se lean igual — y en un SO sin `/proc` los descartaba todos
en silencio, o sea que habría respondido «nadie» para siempre. Mismo criterio que el `NO SÉ` de
`cerrable.mjs`.

⚠ **Y «mío» se compara por SEGMENTO de ruta, no con `startsWith`.** Estando en `~/ws/do`, un proceso
de `~/ws/do-v` salía como **propio** — y lo ajeno leído como propio es lo que te hace matarlo
(regla 0). Comprobado el 2026-08-28 con un proceso en `/home/deploy/src-otro`. Con un workspace por
tema los nombres vecinos dejan de ser hipotéticos. Vive en `scripts/workspaces-locales.mjs`, que
comparten este script y `cerrable.mjs`: dos copias de esa comparación divergen y nadie se entera.

Como todo preflight de aquí, **comprueba estado utilizable, no presencia**, y **crece con
cada fallo**: si algo se descubre a mitad, la comprobación se añade ahí en el mismo commit
que el arreglo.

### Trampas conocidas, indexadas por la acción que las dispara

**Al relanzar una flota parada** — `vigilante_avance.py` decide si hay flota viva con
`pgrep -f "estudio_flota.py"` (línea 362), **sin filtrar por ruta**. Con dos workspaces, el
vigilante de uno ve la flota del otro y aplica su regla 4 (*«hay una flota viva: no se
relanza»*): **los puntos que le faltan no se relanzan nunca, y no lo dice nadie**. El arreglo
es mirar el **cwd** de cada PID, no su línea de comando:

```python
salida = subprocess.run(["pgrep", "-f", "estudio_flota.py"], ...).stdout
for pid in salida.split():
    cwd = os.readlink(f"/proc/{pid}/cwd")      # de quién es lo dice el CWD
    if Path(cwd).is_relative_to(ROOT): ...     # ...sólo entonces es mío
```

⚠ **Y no vale filtrar por la línea de comando, que es la solución que parece obvia.**
Comprobado el 2026-08-27: la flota se lanza como `.venv/bin/python scripts/estudio_flota.py`,
o sea **con ruta relativa**, así que la línea de `ps` **no contiene el workspace por ningún
lado**. Un filtro por ruta sobre `pgrep -af` no clasifica de más: clasifica **tus propios
procesos como ajenos**. (Pasó al escribir `scripts/workspace.mjs`, en la primera versión.)

**Al matar algo** — `pkill -f estudio_flota` mata las flotas de **todos** los workspaces.
Saca el PID mirando `/proc/<pid>/cwd` y mata **ese PID**.

**Al copiar un workspace nuevo** — se copian también `data/sessions/`, `data/claude-sessions/`
y `data/shell-cwd/`, que son estado efímero **por tema de Telegram**. Dos coordinadores con
el mismo estado creen los dos que mandan sobre la misma conversación. Bórralos al copiar.

**Al arrancar un segundo coordinador** — sólo puede haber **una** instancia haciendo polling
por token (error 409, ya documentado arriba). Un workspace nuevo **no** arranca su bot salvo
que tenga token propio: se copia para trabajar en el código, no para servir.

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
