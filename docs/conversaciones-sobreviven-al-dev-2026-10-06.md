# Que las conversaciones de «Claude web» sobrevivan a destruir el dev

**Estado: A IMPLEMENTADA el 2026-10-07** por orden del dueño («Corre merge. Implementa A, pues
quiero poder revisar la conversación en claude web»): `scripts/estado-por-tema.mjs` (foto +
restauración), el ejecutor `historial`, el `post` de `types/dev.json`, el `pre_destroy` del
servicio y el arreglo de `almacen conectar` del § 5. **A+ no** (que `c` recuerde no se pidió).
La primera restauración real ocurrirá en el próximo dev. Lo de abajo es el análisis tal como se
escribió antes de decidir.
Escrito el 2026-10-06 en un dev nacido ese mismo día a las 22:55 UTC, o sea
justo después de la pérdida que motiva la petición. Revisado por el agente
`revisor` (sus hallazgos van integrados y los que importan se re-midieron a mano)
y por el `arquitecto` (§ 6: dónde va cada pieza, en qué orden y con qué tests).

> «Claude web hoy funciona en el dev, y eso está bien porque hace lo que
> necesito, y es el dev quien tiene claude, así que debe tener claude si quiero
> enviarle órdenes. Pero al destruir el dev ya pierdo el acceso a las
> conversaciones previas. Me gustaría cambiar eso, si es posible.»
> — el dueño, 2026-10-06

**Respuesta corta: sí es posible, y barato.** Lo que no se puede hacer aquí es
elegir solo, por tres cosas: hay dos sitios donde puede vivir el dato (el almacén,
por git, o un volumen propio del dev); «acceso» puede significar **ver** las
conversaciones en la web o que **`c` las recuerde**, que son trabajos distintos; y
hay una regla escrita que hoy dice lo contrario y habría que revocar a sabiendas
(`docs/log-de-mensajes.md:63`, *«No sobrevive a rehacer la máquina … Es
deliberado»*, y `CLAUDE.md` § Seguridad, *«los datos efímeros están en
`.gitignore`. No los commitees»*).

⚠ **Y antes de cualquier opción hay que arreglar el § 5**: este dev **no puede
empujar al almacén** y ninguna restauración al nacer leería hoy el dato bueno.

## 1. «Las conversaciones» son DOS cosas, y la web sólo enseña una

Medido hoy leyendo el código, no de memoria:

| | Qué es | Dónde vive | Quién lo escribe | Sobrevive a… |
|---|---|---|---|---|
| **Lo que la web enseña** | el **log de mensajes**: una línea JSON por mensaje (usuario / claude / sistema) por tema | `DATA_DIR/mensajes/<tema>.jsonl` del coordinador | `scripts/mensajes.mjs` (el coordinador en cada vuelta, y los desacoplados) | reiniciar el bot: sí · **destruir el dev: NO** (`.gitignore:12`) |
| **Lo que claude recuerda** | el transcript de Claude Code de la conversación de `c` | `~/.claude/projects/<cwd-codificado>/<uuid>.jsonl`; el uuid se **deriva** de `<tema>#<época>` (`scripts/claude-marker.mjs`) | `claude` | reiniciar: sí · destruir: **NO** en crudo; **SÍ redactado y comprimido** en el almacén, por el hook que ya existe (`scripts/guardar-conversacion.mjs`) · **30 días**: NO, Claude Code los borra (`cleanupPeriodDays`, doc oficial) |

La web (`claude-code-webapp-mobile`, unidad `claude-web`, :8020) lee el primero
(`server/datos.mjs`, `join(raiz, 'mensajes', …)`) y **no toca** `~/.claude`. Por
eso un dev nuevo la enseña vacía aunque los transcripts estén archivados. Y por
eso tiene que vivir donde el coordinador: para **enviar** una orden deja un
fichero en `data/entrada/` que recoge `src/entrada.ts`. **Leer**, en cambio, no
necesita ni coordinador ni claude: sólo el fichero.

Lo que el log ya cumple, y que importa para sacarlo de la máquina:

- **Está redactado al escribirse** (`mensajes.mjs:132-136`, con `redactar.mjs`, el
  mismo módulo que el archivador y el log de errores). ⚠ **Pero más flojo que el
  archivador**, y esto lo encontró el `revisor`: no pasa la **rejilla final**
  (`loQueSigueSiendoSecreto`, que el archivador sí aplica en
  `guardar-conversacion.mjs:227`); si la redacción **lanza**, escribe el texto
  **crudo** (`:136`, el `catch`); y si no puede leer los ficheros de secretos,
  redacta sólo por patrón **sin decirlo** (`:134`). Para la máquina está bien;
  para el almacén, el snapshot tiene que pasar la rejilla del archivador.
- **Está acotado**: 30 días o 300 mensajes por tema, lo que llegue antes
  (`mensajes.mjs:187-188`), y cada mensaje recortado a 64 KB (`:67`). ⚠ En el
  almacén la purga **deja de acotar nada**: allí nadie borra (es la regla).
- **Es texto append-only** con `id` monótono (regla 5 del fichero), así que se
  puede **fusionar** y en git se delta-comprime.

Y lo que la frase «es deliberado» quería decir: el motivo escrito es que el log
*«contiene todo lo que Claude dijo, incluidas salidas de shell y rutas»* y la
purga *«acota cuánto hay que perder si alguien entra en la máquina»*
(`docs/log-de-mensajes.md:63-65,105-108`; lo repiten
`claude-code-webapp-mobile/docs/especificacion.md:211-214` y
`docs/plan-general.md:157-165`, y `CLAUDE.md` § Seguridad). Es una cota de
**exposición**, no una decisión sobre durabilidad. El almacén ya guarda hoy los
**transcripts enteros** de las mismas conversaciones, redactados, desde el
2026-08-31: meter el log ahí no abre una puerta nueva — **pero sí revoca una
frase escrita en cinco sitios**, y se revoca en los cinco o quedan dos versiones.

## 2. Lo medido hoy (con el comando, para repetirlo)

| Hecho | Cómo se midió |
|---|---|
| Este dev nació el **2026-10-06 22:55 UTC** (id 606776120, IP 167.99.173.143) | `/var/lib/cloud/instances/606776120/` y `journalctl --list-boots` |
| El almacén registra **al menos tres devs distintos desde el 10-01** (IPs 157.230.51.124 hasta el 10-03 21:31, 178.128.153.190 hoy 11:54–12:04, y éste) | `ssh mini 'sudo cat /mnt/datos/log/pushes.log'` |
| **Un transcript archivado y redactado SE REANUDA**: `2026-09-17-65d83721.jsonl.gz`, descomprimido en una HOME temporal bajo `~/.claude/projects/<cwd>/<uuid>.jsonl` (con el campo `cwd` reescrito al directorio de prueba), `claude --resume <uuid> -p …` con haiku recordó el primer mensaje | prueba en `/tmp`, borrada después |
| La conversación REAL de `c` del tema principal (`2026-10-05-64641da7.jsonl.gz`, última actividad 10-05 20:51): **25,0 MB crudos, 16,3 MB gz** (apenas comprime: 24 imágenes, 10,2 MB en base64), 33 mensajes tuyos; cadena activa 1.155 mensajes, **~1,6 MB de texto ≈ 400k tokens a 4 chars/token + 24 imágenes ≈ 57k** (*estimado*, no contado con la API); **cero marcas de compactación** | `python3` sobre el fichero descomprimido |
| Esa conversación **con haiku NO se reanuda**: «Prompt is too long» a los 164 s. Con `fable` (el modelo de `c`) corría en vivo el 10-05; **no repetido** hoy para no pagar una llamada de ~460k tokens | mismo arnés |
| Claude Code **borra los transcripts a los 30 días** por defecto (`cleanupPeriodDays`), aunque el dev viva; `--resume <id>` busca en el proyecto actual y luego en todos los demás, pero **si el mismo id está en dos proyectos dice «no encontrado»**; y el formato del transcript *«es interno y cambia entre versiones»* | doc oficial, `code.claude.com/docs/en/sessions`, leída el 2026-10-06 |
| Un `.gz` del archivo **SÍ se delta-comprime en git**: las 16 versiones de `2026-10-05-64641da7.jsonl.gz` suman 127,2 MB lógicos y ocupan **22,6 MB** en el clon (15 guardadas como delta). La frase de `CLAUDE.md` § «SE LLENÓ» punto 2 («un `.gz` no se delta-comprime») **no se sostiene** y queda corregida allí | `git rev-list --objects … \| git cat-file --batch-check='%(objectsize) %(objectsize:disk) %(deltabase)'` en `~/ws/tema-2/foveal-vision-data` |
| Almacén: volumen `datos` 1 GB nyc1, **40 % usado** (320 MB; eran 263 MB el 10-03) · un volumen de DO cuesta **0,10 $/GB/mes**, conectado o no, **un droplet a la vez** | `do_droplet.py almacen estado` · `volume list` |
| La historia que **sólo** tiene GitHub (y este clon): **16.342 objetos, 366 MB en disco** — lo que un `merge` de las dos historias empujaría al almacén | `git rev-list --objects main --not origin/main \| git cat-file --batch-check` en `~/src/foveal-vision-data` |
| El mini tiene **272 MB disponibles** con sus 4 servicios corriendo | `ssh mini free -m` |
| `data/` del coordinador recién nacido: 128 KB · `~/.claude/projects`: 4,1 MB (con la sesión de hoy dentro) | `du -sh` |

## 3. Las opciones

### A · El log viaja por el ALMACÉN y el dev nuevo lo restaura al nacer — recomendada para VER

**Qué.** Un snapshot de `data/mensajes/*.jsonl` en el repo de datos, p. ej.
`foveal-vision-data/coordinador/mensajes/<tema>.jsonl`, **empujado por el mismo
hook que ya empuja los transcripts** en cada turno de `c` —cero pushes nuevos—.
Al nacer el dev, el `post` de `types/dev.json` lo restaura **fusionando por
`id`**, así que no pisa lo que el bot nuevo ya haya escrito mientras arrancaba.

**Qué cambia para ti.** Al abrir la web en un dev nuevo ves los mismos temas con
los últimos 30 días / 300 mensajes de cada uno, igual que si el dev no hubiera
muerto. Y una cosa que hoy no existe: **el mini también tiene el clon**, así que
podría servir la web **en modo lectura** sin dev vivo (hoy P12 de la web dice
«sólo dev»; habría que revisarlo, y el envío seguiría pidiendo coordinador).

**Requisitos que salen de la revisión, los seis:**

1. **El snapshot pasa la rejilla del archivador** (§ 1): lo que no la pase no
   se guarda y se dice, como ya hace con los transcripts.
2. **Sólo el historial, no el estado.** `data/ws/` **no se restaura tal cual**:
   `src/workspaces.ts:107-109` carga el MODO aunque `~/ws/tema-N` no exista, y
   `decidirWorkspace` (`:170`) no vuelve a decidir un tema decidido → el tema
   trabajaría en `~/src` junto al principal, sin automontar y sin aviso (Regla 0
   rota en silencio). `buffer/` y `repeticiones/` guardan texto **sin redactar**.
   La lista de lo que viaja se **declara** (R14), y el arquitecto la fijó así:
   **viajan** `mensajes/`, `sessions/`, `claude-profile/` (y `claude-sessions/` sólo con
   A+); **no viajan** `ws/`, `shell-cwd/` (el `cd` guardado puede no existir en la
   máquina nueva), `repeticiones/`, `entrada/`, `buffer/`, `coordinador.json`. Y un
   test falla si aparece en `.gitignore` una carpeta de `data/` sin clasificar.
3. **La última respuesta no entra hasta el turno siguiente, y la última de todas
   no entra nunca.** El coordinador anota la entrada **antes** de lanzar `c`
   (`src/orchestrator.ts:93-94` + `:134`) y la respuesta **después**, cuando el
   `SessionEnd` de ese `claude -p` ya disparó el hook. Igual que hoy con los
   transcripts: la ventana es un turno. Los avisos de `notify.mjs`/resumer entran
   con el siguiente turno de claude. Si se quiere menos ventana, el disparador
   tiene que ser otro (§ 7).
4. **Se niega si el clon no está al día con el almacén** (R2): hoy leería la
   copia de GitHub, cortada el 10-01 (§ 5).
5. **La web marca el corte**: tras restaurar sin A+, la web enseña una
   conversación que `c` **ya no tiene**; `log-de-mensajes.md:56-61` dice que eso
   es «peor que no enseñar nada» si no se ve. Un mensaje de `sistema` al
   restaurar («máquina rehecha el …: claude empieza en blanco») lo resuelve con
   lo que ya hay.
6. **Revocar «es deliberado» en los cinco sitios** de § 1, con el motivo nuevo.

**Coste.** 0 $ · coordinador: snapshot (~100 líneas, al lado del archivador) +
`restaurar-mensajes.mjs` (~100) + tests (R17) · lanzador: **una línea** en el
`post` de `types/dev.json` **y el arreglo del § 5, condición previa** · web app:
el mensaje de corte ya lo enseña (es un mensaje de `sistema`).

### A+ · Además, que `c` RECUERDE: restaurar también la memoria de claude

**Qué.** Al nacer, descomprimir del archivo redactado el transcript **vivo** de
cada tema en `~/.claude/projects/<cwd>/<uuid>.jsonl`, y restaurar la **época**
(`data/claude-sessions/`) para que el uuid derivado sea el de la conversación que
estaba viva. Entonces `c` continúa el hilo del dev anterior.

**Medido**: funciona en pequeño (fila 3 de § 2). **Lo que el `revisor` añadió, y
cambia el diseño:**

- **El uuid NO identifica una conversación** (R16): el almacén tiene **tres**
  distintas con `64641da7` (10-01, 10-01-2, 10-05) y este dev ya tiene una
  **cuarta, viva**, de 535 KB, empezada hoy a las 23:20. Restaurar «por uuid»
  pisaría la viva. La restauración tiene que ir **antes del primer turno** o
  **negarse** si ya hay transcript, y elegir la archivada por **última
  actividad**, nunca por nombre.
- **Lo que la rejilla rechazó no está en el archivo**: ese tema empezaría en
  blanco. Hay que **decir** qué se restauró y qué no.
- **El cwd del transcript depende de qué árbol tenía el tema**, y el primer
  mensaje tras reiniciar decide quién se queda `~/src` (`workspaces.ts`,
  regla 2). Entre vidas puede cambiar; `--resume` busca en otros proyectos, pero
  sólo si el id está en **uno**.
- **Hoy rehacer el dev es un `creset` implícito.** Con A+, la conversación del
  tema principal (25 MB, ~460k tokens, sin un `creset` en cuatro días) **vuelve
  entera** y sigue creciendo de dev en dev. Revoca lo que
  `claude-marker.mjs:17-19` acepta a propósito («empieza en blanco»).
- El formato del transcript es **interno** y la doc avisa de que cambia entre
  versiones: una restauración que hoy funciona puede dejar de funcionar con una
  actualización de `claude`, y hay que medirlo cuando pase (test con un transcript
  real pequeño, no con uno inventado).

**Coste.** ~100-150 líneas + tests, 0 $. Independiente de A.

### B · Un VOLUMEN de DigitalOcean para el dev

**Qué.** `types/dev.json` declara `"volume": "dev-estado"` como el mini declara
`datos`, y el estado efímero del coordinador y `~/.claude` viven en él: con el
patrón `almacen.apps` (carpeta → enlace al volumen, `do_droplet.py` ~l. 2210), o
con `CLAUDE_CONFIG_DIR` apuntando al volumen (la doc lo prevé para «mover el
almacenamiento fuera de `~/.claude`»). Restaurar = montar.

**A favor.** Completo y **crudo** (no hay que redactar, no se publica nada), y
cubre también lo que A no restaura (imágenes y `tool-results` de claude). No toca
el almacén ni su tamaño, y **no depende del § 5**.

**En contra.** 0,10 $/GB/mes (1 GB basta hoy; el gasto no es el problema) ·
**conserva `~/.claude/projects` en crudo de un dev a otro**: hoy eso muere con
cada dev, y el `.env` que se filtró una vez a una conversación quedaría ahí en
claro, para siempre, en un disco que sobrevive · **un droplet a la vez**:
cualquier `launch --type dev` con el dev vivo **muere** (`do_droplet.py:1402-1432`),
y eso incluye la receta `prueba-almacen --type dev` que se lanza **desde** el dev
(`CLAUDE.md` § «LO PRIMERO», punto 0) → habría que añadirle `--sin-volumen` **en
el mismo commit** · región fija (nyc1) · se destruye sin `umount`
(`limpiar_antes_de_destruir` podría desmontar) · **hoy el volumen se monta DESPUÉS de
arrancar los servicios** (`do_droplet.py:1523`), con el bot ya escribiendo: habría que
reordenar el lanzador para todos los tipos · y **es un segundo almacén**: la
regla del dueño del 2026-10-01 es *«todo dato … al almacén»*, y los transcripts
ya están allí redactados — B los duplicaría en crudo. `data/ws` tendría el mismo
problema que en A (el volumen conserva la atadura, no `~/ws`).

**Coste.** 0,10 $/mes · lanzador: generalizar `apps` al dev + `--sin-volumen` en
la receta (~150 líneas + tests) · coordinador: 0.

### C · Que la web lea el ARCHIVO de transcripts como histórico — descartada

Enseñaría **todo** el pasado desde el 2026-08-31, de sólo lectura. Pero
**revoca dos decisiones cerradas de la web** —P8 *«Sembrar el historial viejo:
no»* (`decisiones.md:261-263`) y P4 *«sólo `c`»* (`:195-213`; el archivador
guarda **todas** las sesiones, también las interactivas)—, obliga a parsear un
formato interno que cambia, y **amplía lo que se sirve sin TLS** (`README.md`
de la web: «el token viaja en claro»): hoy expone el log de `c` purgado a 30
días; con C, el archivo entero con salidas de herramientas y sin purga. Y
enseñaría contexto que `c` no tiene (§ 3.A, requisito 5).

### D · El `SessionStore` del Agent SDK — anotado para no volver a discutirlo

Es el mecanismo **oficial** para exactamente este problema (*«Local containers
are ephemeral. An external store survives restarts and redeploys»*,
`code.claude.com/docs/en/agent-sdk/session-storage`). Pero sólo existe para el
Agent SDK, no para la CLI que lanza `claude-session.mjs`; exige un backend
(S3/Redis/Postgres o uno propio), y el dueño ya descartó un servicio de objetos
para datos (MinIO, febrero de 2026). Y no toca el log de la web.

## 4. Recomendación y lo que hay que decidir

**A para VER; A+ sólo si además quieres que `c` RECUERDE.** Porque cuesta 0 $,
reusa dos mecanismos que **ya corren en cada dev** (el hook y el `post`),
respeta las dos reglas de la casa (*todo dato al almacén* y *la puerta es la
redacción*) y abre la lectura sin dev vivo. **B** sólo si prefieres el estado
crudo y completo y asumes dos cosas: el `.env` filtrado sobreviviendo en un disco
que no muere, y el cambio de procedimiento al rehacer el dev.

Lo que decides tú, y sin esto no se empieza:

1. **¿Ver, o continuar?** Ver = A. Continuar = A+ (o B). Son trabajos distintos.
2. **A o B.**
3. Si A: **¿la web enseña 30 días/300, o más?** El snapshot puede no purgar; en
   el almacén nada borra, así que «más» es «para siempre».
4. Si A+: aceptar que el tema principal vuelva con sus 25 MB (un `creset` antes
   de destruir lo evita) y que rehacer el dev **deje de ser** un `creset`.
5. **Revocar «es deliberado»** en `docs/log-de-mensajes.md:63`, `CLAUDE.md`
   § Seguridad y los tres sitios de la web — de «no sobrevive» a «sobrevive por
   el almacén, redactado y pasado por la rejilla», con el motivo de exposición
   conservado donde está.

## 5. 🔴 Hallazgo lateral, y es de HOY: este dev no puede empujar al almacén

**Medido**: `git -C ~/src/foveal-vision-data status -sb` →
`main...origin/main [ahead 758, behind 52]`, y **sin base común**
(`git merge-base` falla). `provision` clona el repo de datos **de GitHub** (la
copia congelada el 10-01), y `almacen conectar` (`do_droplet.py:2264`,
`almacen_conectar`) hace `pull --ff-only` y, si no avanza, **sólo imprime un
AVISO y sale con 0** (`:2320-2321`; no cuenta en `problemas`). Desde que la
historia del almacén se compactó el 2026-10-03 (`CLAUDE.md` § «HISTORIA
COMPACTADA»), **ningún dev nuevo puede hacer fast-forward**: es la nota *«Un clon
de antes de ese día no puede empujar»* por la otra puerta — el clon es NUEVO,
pero su historia es vieja. La premisa «los dev nuevos nacen conectados, medido
el 2026-10-01» es **anterior** a la compactación, y el test del lanzador sólo
comprueba que la cadena `almacen conectar` esté en el `post`
(`tests/test_almacen.py:175`), no que funcione.

**Efecto**: el hook ya commiteó hoy `8760af63 conversaciones: archivo automático`
sobre la historia de GitHub y su `git push` **falla** (`--dry-run`: rechazado,
non-fast-forward). Lo que este dev archive **no llega al almacén**, y lo único que
lo dice es el stderr de un hook que nadie lee. *«Lo que no está empujado, no
existe»*, incumplido en silencio desde las 23:20. El freno sí lo ve, pero
**mal**: dice «758 commit(s) sin empujar» cuando 757 están en GitHub —
`almacen conectar` añade el remoto `github` **sin hacer `fetch`**, así que
`--not --remotes` no los ve allí. Comprobado contra GitHub: `github/main` es
`15e683bd` y el único commit local que no está en ningún remoto es `8760af63`.

⚠⚠ **La salida obvia es una trampa**: `git pull --allow-unrelated-histories` +
`push` entraría en el almacén como fast-forward (`denyNonFastForwards` lo
acepta) y metería los **16.342 objetos / 366 MB** que sólo tiene la historia de
GitHub — más de la mitad del hueco libre, y deshace la compactación que ordenó el
dueño. **No se hace.**

**Remedio en esta máquina** (no ejecutado: `~/src` es el árbol del tema principal
y es un `reset --hard`; lo corre quien decida):

```bash
cd ~/src/foveal-vision-data
git fetch origin && git fetch github                 # con github traído, el freno baja de 758 a 1
git log --oneline HEAD --not --remotes               # tiene que quedar SÓLO 8760af63 (comprobado hoy contra GitHub)
git branch respaldo-github-$(date +%F) main          # la historia vieja, con nombre, por si acaso
git reset --hard origin/main                         # el clon pasa a ser el del almacén (52 commits)
node ~/src/telegram-coordinator/scripts/guardar-conversacion.mjs   # rehace el archivo de hoy desde el transcript vivo y empuja
```

Sin `cherry-pick`: el archivador regenera `8760af63` desde el transcript que sigue vivo en
`~/.claude/projects/`, y así no hay conflicto posible con el índice.

**Arreglo en el lanzador** (R2 + R17): en `almacen_conectar`, cuando el
`--ff-only` falla y el clon es **prístino de GitHub** (su `main` es exactamente
`github/main`, sin trabajo local: comprobable con `rev-list --count
github/main..main` = 0), hacer `reset --hard origin/main` y decirlo; si hay
trabajo local, **negarse** en voz alta en vez de avisar y seguir. Con un test que
monte un almacén de pega con historia incompatible (hoy no lo hay). Alternativa:
que `provision` clone **del almacén** (hace falta el alias SSH antes de clonar).

**Y condiciona A, A+ y C**: una restauración al nacer que lea este clon leería
datos de antes del 10-03. El paso de restaurar tiene que **negarse** si
`origin/main` no es antepasado de `HEAD` (R2: fallar antes de empezar).

## 6. Lo que fijó el `arquitecto`: dónde va cada pieza, en qué orden y con qué tests

Entró por el § 0 de `docs/reglas-de-diseno.md` («decidir dónde se guarda un fichero que
produce el sistema», «hacer que A use algo de B», «automatizar una decisión», «dar por
terminado»). Recomienda **A**, en **tres commits y en este orden**: (1) arreglar
`almacen conectar`, (2) la foto, (3) la restauración. A+ es decisión aparte del dueño.

**Reglas que aplican, y qué obligan a hacer:**

| Regla | Qué fija aquí |
|---|---|
| **R7** | la foto y la restauración viven en el **coordinador**, que produce el log y su contrato; el lanzador sólo declara **cuándo** se llaman; la web **no se toca** (ya lee `mensajes/*.jsonl` y `sessions/`, y ya enseña mensajes de `sistema`) |
| **R9** | el log no se puede regenerar (avisos de `notify`/`repetir`/resumer, el texto tal como se vio en Telegram): o se guarda o se pierde |
| **R4** | **no copiar** `repoDeDatos()` (`guardar-conversacion.mjs:92-96`, que deduce el repo de datos de `dirname(CASA)`): una variable declarada con ese mismo valor por defecto |
| **R2** | la restauración **se niega antes de escribir nada** si no puede hacer `fetch` del almacén o si `origin` es github.com; lee `origin/main` con `git show origin/main:…`, **sin depender del árbol de trabajo** — así funciona aunque el clon esté divergido como hoy |
| **R15** | si el bot ya escribió estado en ese tema antes del `post`, **gana lo local y se dice** |
| **R16** | cada máquina escribe su foto en **una carpeta propia, nombrada por el id del droplet** (`/metadata/v1/id`, el mismo dato que usa `cerrable.mjs`), nunca por su nombre: así nunca hay dos escritores en el mismo fichero (staging, dev viejo sin bot) |
| **R14/R17** | qué viaja y qué no es una **lista declarada** con test (§ 3.A, requisito 2); el invariante del `post` va en `test_almacen.py`, como ya va `almacen conectar` |
| **R19** | `almacen conectar` es **una migración a medias que se repite en cada nacimiento** (clona de GitHub y luego cambia el remoto): es la causa del § 5 |

**Dónde vive cada pieza:**

- **Coordinador**: `scripts/estado-por-tema.mjs` (nuevo; `--foto`, `--restaurar`,
  `--seco`; lleva la lista declarada) · `scripts/guardar-conversacion.mjs` llama a la
  foto antes de `empujar()`, añade la carpeta a su `git add`, empuja **también cuando
  sólo cambió la foto** (hoy sólo si cambió una conversación, `:294`) y hace
  `pull --rebase` si el push es rechazado · `scripts/mensajes.mjs` **exporta** el filtro
  de la purga, no se copia · `data/executors/restaurar.json` (regla 4 de escritura: se
  invoca desde Telegram, y es la forma de repetir la restauración si el `post` se negó)
  · `docs/log-de-mensajes.md`: el cambio de contrato.
- **Repo de datos**: `coordinador/<droplet-id>/<carpeta>/<tema>.jsonl`, **texto plano**
  (append-only → delta en git), con un README.
- **Lanzador**: arreglar `almacen_conectar` (abajo) · una línea de `post` en
  `types/dev.json` **después** de `almacen conectar` · un `pre_destroy` en
  `services/telegram-coordinator.json` que dispare la foto — **sólo comodidad**: no
  corre si se destruye desde la consola, y no se ha visto en un `destroy` real · casos
  en `tests/test_almacen.py`: «todo tipo que instale `telegram-coordinator` restaura en
  su `post`, después de conectar».

**El orden al nacer**: en el `post`, después de `almacen conectar` (moverlo antes de
arrancar el bot obligaría a conectar el almacén dentro de `provision`, reordenando el
lanzador para todos los tipos). Con una regla por cosa: **mensajes** → unir por `id`,
aplicar la ventana de la purga, escribir como ya hace la purga (temporal + comprobar
que el original no creció antes de sustituir, `mensajes.mjs:230-241`), **nunca quitar
una línea local**; **JSON de estado** → sólo donde no hay fichero local, choque = gana
lo local y se anuncia, **conservando la fecha de modificación** original porque
`destino-telegram.mjs:48` decide por ella qué tema está vivo; **línea frontera** → un
mensaje `autor: sistema` con id = último restaurado + 1 ms, entre lo viejo y lo nuevo:
*«historial del dev anterior; claude NO lo recuerda»*; y **repetible**: correrla otra
vez sólo añade.

**El arreglo de `almacen conectar`, mínimo**: (1) `fetch github`, para que la historia
vieja cuente como guardada; (2) si no hay base común **y** los commits que no están en
ningún remoto sólo tocan `conversaciones/` (regenerables desde los transcripts del
disco), `reset --hard origin/main` **diciéndolo**; (3) si no, sumarlo a `problemas` y
salir con error; (4) **cualquier** `pull --ff-only` fallido cuenta como problema (hoy
avisa y sale con 0). Deuda de fondo: que `provision` clone los `almacen.repos` **del
almacén** y no de GitHub.

**Lo que puede salir mal en silencio, y el test que lo fija** (por consecuencia, R10):

1. **Un secreto llega a git**: la foto vuelve a pasar `redactar` y
   `loQueSigueSiendoSecreto` **línea a línea**, y una línea con restos se sustituye por
   un marcador visible. Test: un valor del fichero de secretos de prueba, sin forma de
   patrón, no aparece en la foto.
2. **Se pierde una línea en la carrera bot/restauración**: test con la costura que ya
   tiene `purgarSesion` — un append durante la restauración sobrevive.
3. **Restaurar `ws/`** (el peor caso, § 3.A): lo fija el test de clasificación de
   `.gitignore`.
4. **La web enseña contexto que claude no tiene**: la línea frontera; test: cada tema
   restaurado la tiene entre lo viejo y lo nuevo.
5. **Fechas de modificación nuevas** → el avisador manda al tema equivocado; test con
   `destino-telegram`.
6. **Restaurar desde un clon viejo**: test con repos git reales; si `origin` es
   github.com o el `fetch` falla, se niega.
7. **Lo último no está en la foto** (§ 3.A, requisito 3): renuncia declarada, sin test.
8. **A+**: `claude-session.mjs:148-159` crea una conversación **en blanco sin decirlo**
   si falla la reanudación; hay que avisarlo con el mecanismo que ya tiene (`:119-133`),
   con test con un `claude` falso en el PATH. El transcript se restaura **al usarlo**, en
   el directorio de proyecto del cwd real, diciendo si antes trabajaba en otro árbol; con
   varios `-2` se elige por `sessionId` y marca de tiempo más reciente.
9. **B**: si el volumen no se monta, el aviso queda en un log que no sobrevive y todo se
   escribe en el disco raíz; «gana el volumen» borra con `rm -rf` lo escrito en los
   primeros minutos (`do_droplet.py:2222-2227`).

**Lo que NO haría**: restaurar «`data/` entero» (arrastra `ws/`, `repeticiones/`,
`entrada/`, `shell-cwd/`; en B, un `executors/` en el volumen taparía al del repo) ·
restaurar los marcadores de claude **sin** los transcripts (se acaba en blanco igual,
pero por el fallo silencioso y con la web aparentando continuidad) · fiarlo todo a
`pre_destroy` · que la restauración haga ella el `reset` del clon (mezcla a quien lee
con quien prepara el clon).

**Cómo se comprueba que quedó bien** (cuando se haga):

1. `python3 tests/test_almacen.py` del lanzador, con tres casos nuevos que **fallan con
   el código de hoy**: clon de GitHub + almacén compactado → `HEAD == origin/main`; un
   commit no regenerable → sale con error; un tipo con el coordinador que no restaura
   después de conectar → falla.
2. `node --test tests/estado-por-tema.test.mjs`, con el arnés de máquina falsa de
   `tests/guardar-conversacion.test.mjs:27-49` más un repo desnudo como almacén.
3. `node scripts/estado-por-tema.mjs --restaurar --seco`: por tema, cuántas líneas
   añadiría, último `ts` y choques.
4. En vivo, en el próximo ciclo de dev: la salida del `post` (la publica el Lanzador)
   dice «restaurados N temas, último <ts>» o «NO restauro: <motivo>»; en la web cada tema
   enseña lo anterior **y** la línea frontera; `git -C ~/src/foveal-vision-data status
   -sb` da `## main...origin/main` sin `ahead`/`behind`; y `cerrable.mjs --breve` ya no
   enseña los 758.

⚠ Una cosa que el arquitecto dio por buena y la medición de § 2 desmiente: repitió que
«un `.gz` no se comprime en delta». Sí se comprime (22,6 MB en disco para 127 MB lógicos);
el coste de A+ en el almacén es el **número de versiones** (una por turno) y las imágenes
en base64, no el formato. Sigue siendo un coste sin medir en ritmo.

## 7. Qué NO está verificado

- Reanudar la conversación real de 25 MB **con `fable`** (sólo con haiku, que no
  cabe).
- Que el `post` de `types/dev.json` corra **después** de que el bot haya podido
  escribir (leído del código: `launch` arranca servicios en `provision` y luego
  `ejecutar_post`; no medido con reloj).
- El coste real del volumen de B en la factura (0,10 $/GB/mes es lo que imprime
  el lanzador y el precio de lista de DO).
- El ritmo de crecimiento del almacén (263 → 320 MB entre el 10-03 y el 10-06 son
  dos cifras, no una medida).
