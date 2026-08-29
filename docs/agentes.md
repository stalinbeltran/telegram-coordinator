# Agentes y triage: quién revisa cada petición, y qué se puede garantizar de verdad

**El problema.** Las reglas de este proyecto están escritas —19 de diseño, 8 patrones operativos,
5 de escritura— y aun así se rompen, porque **una regla escrita compite con otras 1.400 líneas y
se cumple mientras alguien la recuerde**. Es la regla 17 aplicada a sí misma: *una comprobación
que no corre sola no existe*.

**La solución tiene dos capas, y la distinción entre ellas es todo el diseño.**

| | **Hook** (`scripts/triage.mjs`) | **Agente** (`.claude/agents/*.md`) |
|---|---|---|
| ¿corre siempre? | **Sí.** Lo dispara el harness en cada mensaje | **No.** Lo invoca el modelo |
| ¿razona? | **No.** Es un comando de shell: casa patrones | **Sí** |
| qué aporta | la **obligación** | el **juicio** |

Ninguna de las dos basta sola. Un agente sin hook es una buena intención: se llama cuando alguien
se acuerda. Un hook sin agente es un `grep`: sabe que la petición *parece* de gasto, no si es
buena idea. Juntas, el hook garantiza que se llame al agente y el agente pone lo que un hook no
puede.

---

## Los tres agentes, y por qué exactamente tres

| Agente | Contesta | Cuándo |
|---|---|---|
| **`revisor`** | *¿esta petición se sostiene?* | antes de actuar, en gasto y destrucción |
| **`arquitecto`** | *¿dónde va esto y cómo se conecta?* | antes de escribir código de estructura |
| **`verificador`** | *¿es verdad lo que voy a decir que hice?* | antes de decir «hecho» |

Son **tres y no ocho** a propósito. Cada agente añade latencia y coste a las peticiones que
dispara; un catálogo grande se convierte en un menú del que se elige el cómodo. Estos tres cubren
los tres momentos donde este proyecto ha demostrado que se equivoca: **antes de gastar**, **al
decidir estructura** y **al dar por terminado**.

⚠ **El más valioso es `revisor`, y es el menos habitual.** No revisa código: revisa **la petición**,
buscando si contradice algo ya medido en el repo. El caso canónico es real: *«regenera el
dataset»* es una petición razonable, y está medido que **no devuelve el mismo dato**. Un revisor de
código no puede encontrar eso, porque el error no está en el código: está en la premisa.

### Los modelos, y que son un mando

`revisor` y `arquitecto` van con **opus** (es juicio, y equivocarse cuesta dinero o una migración a
medias); `verificador` con **sonnet**, porque es mecánico —ejecutar y reportar— y es el que más se
dispara. Se cambia en el frontmatter de cada `.md`; no hay nada más que tocar.

---

## El triage: qué clase de petición es, y qué obliga

`scripts/triage.mjs` corre en el `UserPromptSubmit` de `.claude/settings.json`. Clasifica por
patrones, de más grave a menos —**la primera clase que casa manda**—:

| clase | dispara con | obliga a |
|---|---|---|
| **gasto** | alquilar, vast, droplets, flota, barrido, launch, destroy | `revisor` **antes de ejecutar nada** |
| **destructivo** | `rm`, `--force`, borrar, eliminar, sobrescribir, `reset --hard` | `revisor` + mirar el destino + confirmar |
| **estructura** | repo nuevo, migrar, renombrar, separar, interfaz, «dónde guardo» | `arquitecto` antes de escribir código |
| **implementación** | implementa, añade, arregla, corrige, crea | `verificador` antes de decir «hecho» |
| *(consulta)* | todo lo demás | **nada** |

**El orden no es cosmético y tiene test:** *«destruye los droplets»* casa con gasto y con
destructivo, y lo que hay que leer primero es que **cuesta dinero**.

### Que calle es parte del diseño

Una pregunta normal **no imprime nada**. Es la lección del preflight (patrón B): un aviso que sale
siempre se deja de leer en una semana, y entonces tampoco se lee el que importaba. Si esto hablara
en cada mensaje, en quince días sería ruido de fondo.

⚠ **Consecuencia que hay que aceptar:** *«cada petición pasa por revisión»* es literalmente falso, y
está bien que lo sea. Lo que pasa por revisión es **cada petición que puede hacer daño**. Revisar
«¿cuántos repos hay?» es gasto sin ganancia.

---

## Lo que este diseño NO puede hacer

Cuatro límites reales. Ninguno tiene arreglo dentro de este diseño, así que van escritos:

1. **Un agente no ve la conversación.** Arranca en blanco: recibe la petición y el repo, nada más.
   No sabe lo que se acordó hace veinte minutos. Por eso `revisor` tiene escrito que **diga cuándo
   algo depende de contexto que no tiene**, en vez de suponerlo.
2. **El triage casa patrones, no entiende.** Se equivocará de clase: un falso positivo cuesta una
   llamada de más; un falso negativo, una revisión que no ocurrió. Por eso el aviso **dice siempre
   que puede equivocarse**: si no lo dijera, una clasificación tonta se leería como un veredicto.
3. **El hook obliga, pero no impide.** `UserPromptSubmit` inyecta texto en el contexto; no puede
   bloquear una acción. Lo que de verdad **frena** es un `PreToolUse`, que sí puede negar una
   llamada concreta —por ejemplo, cualquier `Bash` que case `vast_instance.py launch`—. **No está
   puesto**: es el paso siguiente natural, y va escrito aquí para que no se dé por hecho.
   ⚠ Y tiene una consecuencia que no es teórica y que va abajo, en § «llamar a un agente es
   delegarle la capacidad»: **mientras no esté, "sólo lectura" es una petición, no un límite.**
4. **Nada de esto mide su propio coste todavía.** Cada revisión son tokens y latencia. **No está
   medido** cuántas peticiones caen en cada clase ni cuánto añade. Si el triage resulta ruidoso,
   los patrones se aprietan; si resulta mudo donde importa, se abren — pero con datos, no con
   impresión.

---

## ⚠ Llamar a un agente es DELEGARLE la capacidad, no sólo el trabajo

**Ésta es la razón buena para no llamarlos, y no es «gastan tokens».** Comprobado el 2026-08-29
leyendo las tres definiciones y `.claude/settings.json`:

| Agente | `tools:` declara | Su prompt le dice |
|---|---|---|
| `arquitecto` | `Read, Grep, Glob, **Bash**` | «Trabajas **en solo lectura**» |
| `revisor` | `Read, Grep, Glob, **Bash**` | «…no ejecutas nada que cambie el estado, no lanzas nada» |
| `verificador` | `Read, Grep, Glob, **Bash**` | «No ejecutes nada que cambie el estado del mundo: nada de alquilar, destruir, empujar, desplegar ni borrar» |

Los tres son de sólo lectura **por instrucción**. Los tres tienen **`Bash`**. Y `grep -c PreToolUse
.claude/settings.json` da **0**.

En esta máquina `Bash` significa: alquilar máquinas en Vast, destruir droplets, matar procesos de
otro workspace, y empujar a `main`. O sea que **el único freno de los tres es su propio juicio** —
combinado con el límite 1 de arriba, que dice que **no ven la conversación**: no saben lo que se
acordó hace veinte minutos, ni qué está protegiendo ahora mismo la Regla 0.

⚠ **El `verificador` es el caso incómodo, y no por descuido.** Existe para **ejecutar**: quitarle
`Bash` lo deja sin poder hacer su trabajo. Su límite es irreducible por diseño, así que el freno
tiene que estar **fuera** de él.

**Escenario, no medición** (2026-08-29, sin ejecutarlo): esta sesión dejó `foveal-vision-web`
instalado y parado porque el `:8010` lo ocupaba un `fv-api` de `~/ws/tema-2`. Un `verificador` al
que se le pida «comprueba que el servicio arranca» ve un obstáculo, no un workspace ajeno —
liberar el puerto es lo obvio desde su contexto, y es exactamente lo que la Regla 0 prohíbe
(«si ves algo roto en otro workspace, **dilo, no lo arregles**»). Nadie se lo impediría.

### Qué se pierde apagándolos, para que la cuenta esté completa

Un subagente aporta **juicio independiente sobre su propio contexto**: el `verificador` no ha visto
cómo se escribió el código, así que no hereda la confianza de quien lo escribió. Eso es justo lo
que un agente **no puede darse a sí mismo**, y es todo el motivo por el que el triage los obliga.
Apagarlos deja el «¿es verdad lo que voy a decir que hice?» en manos del mismo que lo hizo.

**No es gratis, entonces.** Es cambiar un riesgo por otro, y conviene decir cuál se está eligiendo.

### Qué quitaría la razón (y entonces sí, encenderlos)

1. **`PreToolUse`** que niegue `Bash` con `vast_instance.py launch`, `do_droplet.py destroy`,
   `git push`, `pkill`/`kill` y `systemctl` cuando quien llama es un subagente. Es el límite 3, y
   es el arreglo de verdad: convierte «sólo lectura» de petición en límite.
2. O **quitarle `Bash` a `revisor` y `arquitecto`**, que dicen ser de sólo lectura y no lo
   necesitan. Barato, inmediato, y no arregla al `verificador`.

Mientras no esté ninguna de las dos, **delegar a un agente con `Bash` es una decisión del usuario,
no una del modelo** — y por eso una sesión puede llegar con los subagentes apagados y eso **no** es
saltarse el triage: es cumplir su límite 3.

### El choque, que en esta máquina es real y va a repetirse

El triage marca `verificador` como **obligatorio** en cada petición de implementación. Una sesión
puede llegar con `Do not call the AgentTool unless the user requested it` en sus instrucciones —
pasó el 2026-08-29—. **Las dos reglas son legítimas y tiran en direcciones opuestas.**

- Esa instrucción **no sale de este repo**: `.claude/settings.json` sólo instala los tres hooks, y
  no dice nada de agentes. Viene de la configuración de la sesión (`/config`, cómo se lanzó, o el
  harness), y **llegó sin motivo escrito**.
- Es **condicional**: «salvo que el usuario lo pida». Una frase del usuario la levanta.
- Qué hacer mientras: **hacer el trabajo del agente a mano y decirlo**. Correr la suite, ejecutar
  los comandos que la documentación promete, y separar VERIFICADO de NO VERIFICADO — que es
  literalmente el guion de `.claude/agents/verificador.md`. Lo que **no** vale es saltárselo en
  silencio, ni ignorar la instrucción de sesión sin decirlo.
- ⚠ Y lo que se pierde en ese modo va dicho: es el juicio independiente de arriba. Ejecutar los
  comandos uno mismo comprueba los **hechos**; no comprueba que se estén mirando los hechos
  correctos.

---

## Cómo se comprueba que sigue en pie

```sh
node scripts/triage.mjs "lanza el estudio do-v"     # -> clase: gasto
node scripts/triage.mjs "¿cuántos repos hay?"       # -> clase: consulta (no obliga a nada)
npm test                                             # tests/triage.test.mjs
```

Los tests fijan lo que puede fallar **en silencio**: que calle en las consultas, que no calle en el
gasto, que el gasto gane a lo destructivo, que un fallo suyo **nunca impida al usuario mandar su
mensaje**, y que **los agentes que nombra existan** — si alguien renombra un `.md`, el triage
seguiría mandando a un agente que ya no está, y el aviso sería una instrucción imposible sin que
nadie se entere.

⚠ **El primer fallo lo encontró el test, no la lectura**: `\bdroplet\b` no casa con «droplets», así
que *«destruye los droplets»* caía en `destructivo` y **se perdía el aviso de que eso cuesta
dinero**. Es justamente la clase de fallo silencioso por la que estos ficheros llevan tests.

⚠ **Y el segundo lo encontró EJECUTAR el comando de aquí arriba, no el test** (2026-08-29). La
línea `node scripts/triage.mjs "lanza el estudio do-v"  # -> clase: gasto` **daba `consulta`**: ni
`revisor`, ni aviso de que eso son ≈1,1 $ y 20 runs en máquinas alquiladas — y es LA tarea pendiente
de `CLAUDE.md`. El patrón pedía «flota», «vast» o «droplet», y *«lanza el estudio»* no trae ninguna.

Sobrevivió porque **el test decía `lanza el estudio do-v EN LA FLOTA`**, y lo que casaba ahí era
«flota»: la prueba había elegido, sin querer, la única redacción que pasaba, y el ejemplo del
documento —sin «flota»— era falso desde el primer día. Es justo lo que avisa el `verificador`:
*«un comando documentado y nunca ejecutado es la forma más común de documentación falsa»*, y aquí
la víctima era el freno del gasto.

Arreglado con **verbo + sustantivo** (`lanza|corre|ejecuta|repite` + `estudio|tanteo|recorrido`) y
no con `estudios?` suelto, que habría convertido *«¿qué dice el reporte del estudio de dropout?»* en
una alarma de dinero. **Tiene test por los dos lados**: el que tiene que saltar y el que no.

---

## Llevárselo a otro proyecto

Lo reutilizable es la **forma**, no los patrones:

1. `.claude/agents/*.md` con los tres roles — se copian tal cual, quitando las referencias a los
   documentos de aquí.
2. `scripts/triage.mjs` — se copian las clases y se **reescriben los patrones** con el vocabulario
   de ese proyecto. Lo que se conserva es la estructura: de más grave a menos, la primera que casa
   manda, y **silencio por defecto**.
3. El `UserPromptSubmit` de `.claude/settings.json`.

Y la regla que hace que funcione, que es la única que no se puede saltar: **el hook pone la
obligación, el agente pone el juicio.** Si se junta todo en un sitio, o se garantiza y no piensa,
o piensa y no se garantiza.
