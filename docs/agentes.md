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
4. **Nada de esto mide su propio coste todavía.** Cada revisión son tokens y latencia. **No está
   medido** cuántas peticiones caen en cada clase ni cuánto añade. Si el triage resulta ruidoso,
   los patrones se aprietan; si resulta mudo donde importa, se abren — pero con datos, no con
   impresión.

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
