# Prioridad 2 — el relanzamiento de los cuatro a medias

Continuación de [`2026-08-26-prioridad2.md`](2026-08-26-prioridad2.md), que dejó cuatro recorridos
incompletos y anunció que su reporte iría aparte. Va aquí. **Los cuatro se cerraron.**

⚠ **Este reporte se redactó a mitad de la corrida y lo dio por cortado; lleva DOS correcciones
encima** (el título original era «…, cortado por el apagado»). El cuerpo se deja tal cual porque
los errores son más instructivos que el dato; **lo válido es lo que dicen las dos correcciones y
la sección «Las dos tablas que cambian».**

> ## ⚠ Corrección (2026-08-26, 15:40 UTC) — los cuatro `interrupted` SÍ habían terminado
>
> **Lo que este reporte llama «4 runs cortados a mitad» son cuatro medidas válidas.** No se
> perdió nada; lo que falló fue el camino por el que la noticia tenía que llegar. Se deja el
> texto original tal cual y se corrige aquí, porque el error es más instructivo que el dato.
>
> Los cuatro (`ch-fov` semilla 5 de `channels`=32; `ov-fov` `overlap`=2 s3, `overlap`=4 s2 y
> s5) tienen `summary.json` con **`stopped_early: true` y `cancelled: false`** —fichero que el
> entrenador sólo escribe al terminar limpio, y que un proceso muerto por SIGKILL nunca deja— y
> su `metrics.jsonl` llega hasta la época declarada (51, 48, 62 y 67).
>
> **Por qué se marcaron mal, que es lo que hay que arrastrar:** el `git push` del libro de a
> bordo llevaba **51 vueltas seguidas fallando** (`main -> main (fetch first)`, la rama local
> divergida de `origin`). La flota terminó esos cuatro runs y los commiteó **aquí** entre las
> 13:15 y las 13:19 UTC, pero **origin nunca los vio**. A las ~15:18 UTC se pasó
> `estudio_informe.py` desde **otro clon** —el commit `3636ccfa` no es ancestro de la rama de
> esta máquina, o sea otra línea— que sólo tenía lo empujado, vio los runs como huérfanos y los
> marcó `interrupted` con toda la razón *para los datos que él tenía*.
>
> Corregido en `foveal-vision@199f10d4` tras fusionar las dos ramas. Estado real de los cuatro
> recorridos: **`sch-fov` 10/10, `pw-fov` 20/20, `ch-fov` 20/20 y `ov-fov` 19/20** — o sea
> **tres cerrados y uno a un solo run**, no «dos y dos».
>
> **La lección no es sobre visión foveada:** un push roto no se nota como un error, se nota
> como *datos que se contradicen entre máquinas*, y el que mira desde fuera concluye lo
> razonable y equivocado. El libro de a bordo commitea cada minuto pero **nunca fusiona**: en
> cuanto la rama diverge, empuja en vano para siempre y nadie lo lee, porque el fallo va a un
> log que sólo se abre cuando ya hay un problema. Es la regla de siempre de este proyecto —*lo
> que no está empujado, no existe*— con un matiz nuevo: **lo que no está empujado tampoco es
> inocuo; puede hacer que otro escriba lo contrario de lo que pasó.**

> ## ⚠ Corrección 2 (2026-08-26, tarde) — la flota NO se apagó a mano: terminó, y dejó su `flota.json`
>
> **Este reporte se escribió a mitad de la corrida y la dio por muerta.** No lo estaba. La flota
> siguió viva después de las 13:19, terminó el único run que le quedaba y **cerró normalmente a
> las 15:58:19 UTC**, escribiendo su `flota.json` en los cuatro directorios. O sea que las dos
> casillas que abajo dicen «no registrado» **sí existen**:
>
> | | |
> |---|---|
> | **Inicio** | **2026-08-26 11:04:49 UTC** *(derivado de `cuando` − `reloj_min`, ±3 s)* |
> | **Fin** | **2026-08-26 15:58:19 UTC** *(`sweeps/*/flota.json`)* |
> | **Duración** | **293,5 min** (4 h 54 min) |
> | **Instancias** | **34 alquiladas** para 18 lotes, 18/18 ok |
> | **Coste real** | **2,0283 $** *(peaje 92,0 min, 5,5 %)* |
>
> **Y el estado real es que los cuatro recorridos están COMPLETOS**: `sch-fov` 10/10, `pw-fov`
> 20/20, `ch-fov` **20/20** y `ov-fov` **20/20**. Los 70 `runs/*/status.json` están en `done`.
> Las tablas de `ch-fov` y `ov-fov` de más abajo se quedaron con menos semillas de las que hay;
> las corregidas van en «Las dos tablas que cambian».
>
> **Por qué se escribió lo contrario, que es lo que hay que arrastrar:** los `informe.json` que
> se leyeron para redactar esto se calcularon a las **15:13:42 UTC**, y el último run
> (`ov-fov` `overlap`=4 semilla 3) terminó a las **15:57:59** — **44 minutos después**. Un
> `informe.json` es una **foto**, no una vista: no se recalcula solo, y en disco no lleva nada
> que lo distinga de uno al día. Se leyó un estado intermedio como si fuera el final.
>
> **Es la segunda vez en dos días, y el síntoma es idéntico al de la Corrección 1**: un lector
> mira una fuente que parece completa, concluye lo razonable y escribe lo contrario de lo que
> pasó. Allí la fuente rancia era `origin` por un push roto; aquí es `informe.json` por un
> informe prematuro. **Regla que sale de las dos: antes de declarar el estado de un recorrido,
> comprobar que la fuente que estás mirando es posterior al último run** — `status.json` es el
> que manda, y `flota.json` sólo existe si la flota llegó a su final.
>
> ⚠ **Lo que NO cambia: la lección de «un apagado a mano se lleva la contabilidad» sigue siendo
> cierta** — sólo que este relanzamiento no fue uno de esos casos. El aviso de no leer los
> `flota.json` de estos directorios se escribió cuando los únicos que había eran los de la
> corrida de las 06:53; ahora hay unos propios, con `recorridos` distinto, y **no hay riesgo de
> doble contabilidad**: 06:53 → 101 máquinas / 3,2996 $ (los siete ejes), 15:58 → 34 máquinas /
> 2,0283 $ (sólo estos cuatro).

| | |
|---|---|
| **Qué era** | terminar los **cuatro recorridos a medias** de la flota de prioridad 2: `sch-fov`, `pw-fov`, `ch-fov`, `ov-fov` |
| **Lanzado con** | relanzamiento de `estudio_flota.py` sobre los puntos pendientes (el mecanismo que sólo rehace lo que falta) |
| **Proveedor** | Vast.ai |
| **Inicio** | ~~2026-08-26 08:14:12 UTC *(derivado)*~~ → **11:04:49 UTC** (Corrección 2) |
| **Fin** | ~~2026-08-26 13:16:35 UTC *(derivado)*~~ → **15:58:19 UTC** (Corrección 2) |
| **Duración** | ~~≈302 min~~ → **293,5 min** (4 h 54 min) |
| **Instancias** | ~~⚠ no registrado~~ → **34 alquiladas** para 18 lotes (Corrección 2) |
| **Coste real** | ~~⚠ no registrado *(estimado 1,39 $)*~~ → **2,0283 $** (Corrección 2) |
| **Dataset** | `dirty1000-80px-16px-r20260824` |
| **Estado** | ~~⚠ parcial: 2 de 4~~ → ✅ **los cuatro completos** (10/10, 20/20, 20/20, 20/20) |

⚠ **Las casillas tachadas son lo que este reporte afirmó a mitad de la corrida, y todas eran
falsas.** Se dejan visibles a propósito: el fallo —leer un `informe.json` de hace 44 minutos como
si fuera el estado final— es lo que hay que arrastrar. Ver Corrección 2 arriba.

## Estado por recorrido

| # | Recorrido | Eje | Runs | Estado |
|---|---|---|---:|---|
| E7 | `sch-fov` | `scheduler` | 10/10 | ✅ terminado |
| E5 | `pw-fov` | `pos_weight` | 20/20 | ✅ terminado |
| E8 | `ch-fov` | `channels` | ~~19/20~~ **20/20** | ✅ terminado (Corrección 2) |
| E10 | `ov-fov` | `overlap_fovea_px` | ~~16/20~~ **20/20** | ✅ terminado (Corrección 2) |

~~Los cuatro runs cortados pararon **por la muerte de la máquina, no por `patience`**, así que por R1
no son medidas y `estudio_informe.py` los **excluye**~~ — **falso las dos veces.** La Corrección 1
mostró que esos cuatro `interrupted` eran medidas válidas mal marcadas por un push roto; la
Corrección 2, que el único que de verdad faltaba (`ov-fov` `overlap`=4 semilla 3) se corrió después
y terminó por `patience` a las 15:57:59. **Los 70 runs de los cuatro recorridos están en `done`.**

Lo que sí sigue en pie del párrafo original, y por eso se conserva: **un run cortado a mitad entra
en la tabla como si fuera una medida si nadie lo detiene.** El mecanismo de exclusión es correcto;
lo que falló las dos veces fue el *diagnóstico* de qué estaba cortado.

---

## E5 `pw-fov` — el vigente gana, y subir el peso hace daño de verdad

*¿Compensa pesar más los positivos? El cuello de botella está medido y es de detección.*

**✅ R1 — válido.** 20/20 pararon por `patience`, entre 31 y 77 épocas, lejos del tope de 150.

| `pos_weight` | f1 (media de 5) | sem | s/época | diferencia | p contra el vigente |
|---:|---:|---:|---:|---:|---:|
| **1** *(vigente)* | **0,9341** | 0,0022 | 37,6 | — | — |
| 2 | 0,9337 | 0,0023 | 40,3 | −0,0004 | 0,889 |
| 4 | 0,9137 | 0,0049 | 38,3 | −0,0204 | **0,008** |
| 8 | 0,8780 | 0,0063 | 47,5 | −0,0561 | **0,008** |

**El vigente se queda.** El eje es **monótono decreciente**: 2 empata (p = 0,889) y a partir de ahí
cae, con los dos extremos significativos **al p mínimo alcanzable (0,008)**. No hay nada que ganar
por arriba y el rango está cerrado por ese lado.

⚠ **Y esto es lo que el plan mandaba mirar con cuidado, sólo que al revés.** El criterio escrito
antes decía: *«si gana algo distinto de 1, R5 no es opcional»* — porque subir `pos_weight` detecta
más y se equivoca más, y el proxy de ventana castiga los falsos positivos de otra forma que el
párrafo entero. **No ganó nada distinto de 1, así que esa cautela no se activa.** Lo que queda en
pie es lo otro: era *«la hipótesis más plausible de mejora grande sin probar»*, y **no la hubo**.
El cuello de botella de detección no se destapa moviendo el peso de la pérdida.

## E7 `sch-fov` — el scheduler no aporta, con el tope corregido a propósito

*¿Ayuda bajar el `lr` con `cosine`?*

**✅ R1 — válido.** 10/10 pararon por `patience`, entre 43 y 70 épocas, **con tope 100 y no 150**.

| `scheduler` | f1 (media de 5) | sem | min | max | s/época |
|---|---:|---:|---:|---:|---:|
| **`none`** *(vigente)* | **0,9341** | 0,0022 | 0,9296 | 0,9416 | 68,6 |
| `cosine` | 0,9329 | 0,0039 | 0,9177 | 0,9400 | 40,1 |

**R4: −0,0012 con p = 0,857.** Ni de lejos. **El vigente se queda.**

⚠ **El tope de 100 era la mitad del estudio**, y conviene no perderlo de vista al leer esta tabla
tan plana. `cosine` planifica su bajada contra `recipe.epochs`, o sea el **tope**: con 150 y parada
real entre 32 y 81, el `lr` sólo habría bajado a ~0,75 y el estudio habría medido «cosine casi sin
aplicar» — un empate falso. Con tope 100 la bajada **sí ocurre** (~0,35 en la época 60) y el tope
sigue por encima de la parada más tardía observada (70), así que manda `patience`. **El empate de
esta tabla es un empate real**, no un artefacto del presupuesto.

⚠ La diferencia de s/época (68,6 contra 40,1) **no dice nada del scheduler**: son máquinas distintas
del pozo de Vast, no una medida de coste comparable.

---

## Las dos tablas que cambian (Corrección 2 — éstas son las válidas)

Recalculadas con los 20 runs de cada recorrido, mismo criterio que `estudio_informe.py`: **f1 en la
época que guardó `best.pt`** (no la última), y permutación exacta de dos colas sobre la diferencia
de medias. El método se validó reproduciendo los tres contrastes de `pw-fov` al quinto decimal
contra su propio `informe.json`.

### `ch-fov` con 20/20 — no cambia nada

| `channels` | n | f1 | sem | s/época | diferencia | p contra el vigente |
|---|---:|---:|---:|---:|---:|---:|
| **[16]×4** *(vigente)* | 5 | **0,9335** | 0,0017 | 42,2 | — | — |
| [32]×4 | **5** | 0,9307 | 0,0038 | 71,4 | −0,0028 | 0,532 |
| [24]×4 | 5 | 0,9303 | 0,0030 | 55,2 | −0,0031 | 0,397 |
| [8]×4 | 5 | 0,9021 | 0,0147 | 33,2 | −0,0313 | **0,008** |

La 5.ª semilla de `[32]×4` llegó y **el veredicto es el mismo** (−0,0037 → −0,0028; p 0,476 →
0,532). El reporte apostó a que no cambiaría la lectura y acertó. **El vigente se queda y el eje
queda acotado por los dos lados.**

### `ov-fov` con 20/20 — **esto sí cambia: el punto 0 pasa a ser significativo**

| `overlap_fovea_px` | n | f1 | sem | s/época | diferencia | p contra el vigente |
|---:|---:|---:|---:|---:|---:|---:|
| 4 | **5** | 0,9372 | 0,0032 | 55,8 | +0,0065 | 0,270 |
| **2** *(vigente)* | **5** | **0,9308** | 0,0035 | 78,9 | — | — |
| 1 | 5 | 0,9273 | 0,0026 | 48,1 | −0,0035 | 0,444 |
| 0 | 5 | 0,9186 | 0,0030 | 46,7 | −0,0122 | **0,032** |

**El recorrido pasa de no poder declarar nada a declarar lo que el plan quería.** Con 2 semillas en
el punto ganador el p mínimo alcanzable era 0,133 y la sección de abajo concluyó, con razón para lo
que tenía, que R4 no podía contestar. Con 5 en todos los puntos hay 252 arreglos y **el punto 0
—las dos ramas disjuntas— es significativamente peor que el vigente, p = 0,032.**

Eso es exactamente el contraste que
[`plan-prioridades-2026-08-25.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-prioridades-2026-08-25.md)
§2 señaló **antes de medir** como «el punto que más dice»: el 0 es el **control** de la elección de
solape contributivo de `instructionsNewNN.md` §7, y hasta la reparametrización del 2026-08-25 no se
podía ni escribir porque el suelo era 1 px. **El solape aporta, y ahora está medido, no intuido.**

⚠ **Pero el vigente se queda igual**, y por la otra mitad de la tabla: `overlap`=4 sube +0,0065 y
**no alcanza significación** (p = 0,270). Sigue siendo el valor mayor del rango y sigue apuntando
hacia arriba, así que **el eje no queda acotado por arriba** — la reserva que la sección de abajo
apuntó sigue viva, sólo que ya no por falta de semillas sino porque el efecto, si existe, es
pequeño frente al ruido.

⚠ La columna s/época **no compara nada**: son máquinas distintas del pozo de Vast. Que el vigente
salga como el más lento (78,9) es del reparto, no del parámetro.

---

## E8 `ch-fov` — ~~19/20~~ *(texto original, superado por la Corrección 2)*

*¿Aporta anchura? El indicio de 1 semilla decía que no.*

**⚠ Incompleto (19/20)**, pero **con los cuatro puntos poblados**: sólo falta la 5.ª semilla de
`channels`=32. 19/19 pararon por `patience`.

| `channels` | f1 (media) | sem | semillas | s/época | diferencia | p contra el vigente |
|---|---:|---:|---:|---:|---:|---:|
| **[16]×4** *(vigente)* | **0,9335** | 0,0017 | 5 | 42,2 | — | — |
| [24]×4 | 0,9303 | 0,0030 | 5 | 55,2 | −0,0031 | 0,397 |
| [32]×4 | 0,9298 | 0,0048 | **4** | 70,9 | −0,0037 | 0,476 |
| [8]×4 | 0,9021 | 0,0147 | 5 | 33,2 | −0,0313 | **0,008** |

**El vigente se queda, y el eje queda acotado por los dos lados**: subir no aporta (24 y 32 empatan
dentro del ruido, p = 0,40 y 0,48, y cuestan 1,3× y 1,7× por época) y **bajar sí hace daño**
(8 canales pierde 0,031 con p = 0,008, el mínimo alcanzable).

⚠ **La pregunta que el plan dejaba abierta hacia abajo se contesta, y con un no.** Estaba escrito
antes: *«el interés real puede estar hacia abajo — si 8 canales empatan con 16, la red vigente es el
doble de cara que hace falta»*. **No empatan.** 16 es el suelo útil, no un exceso heredado.

⚠ Y `[8]×4` trae el `sem` más alto de la tabla (0,0147, con un mínimo de 0,8449 contra 0,9233):
además de peor de media es **más inestable entre semillas**, que es la firma de una red que se queda
corta de capacidad.

**Por qué se puede leer con 19**: el run que falta es una semilla de un punto que ya tiene 4 y que
está a 0,0037 del vigente con p = 0,476. Para que la 5.ª cambiara el veredicto tendría que traer un
f1 fuera de todo lo observado en el recorrido. **Aun así, el reporte lo declara como 19/20**, y la
línea de `[32]×4` lleva su `n=4` escrito: se lee, no se cierra.

## E10 `ov-fov` — el que se quedó sin poder declarar nada *(texto original, superado por la Corrección 2)*

*El mando exclusivo de esta arquitectura, nunca medido. El plan decía que el punto 0 es el que más dice.*

**⚠ Incompleto (16/20), y aquí la falta SÍ bloquea el veredicto.** 16/16 pararon por `patience`.

| `overlap_fovea_px` | f1 (media) | sem | semillas | diferencia | p contra el vigente |
|---:|---:|---:|---:|---:|---:|
| 4 | 0,9379 | 0,0079 | **2** | +0,0069 | 0,467 |
| **2** *(vigente)* | 0,9311 | 0,0045 | **4** | — | — |
| 1 | 0,9273 | 0,0026 | 5 | −0,0038 | 0,468 |
| 0 | 0,9186 | 0,0030 | 5 | −0,0125 | 0,063 |

⚠ **Con 2 semillas en el punto ganador sólo hay 15 arreglos, así que el p mínimo ALCANZABLE es
0,133**: con este tamaño **R4 no puede declarar significación al 5 % aunque la diferencia fuera
enorme**, y el vigente se queda pase lo que pase. El `p = 0,467` de la fila de 4 px **no significa
«no hay efecto»**; significa que este recorrido no tiene con qué contestar. Es la distinción que
más veces se ha leído mal en este proyecto y por eso va escrita aquí.

**Lo único que sí se puede leer, con cautela:** el punto **0** —las dos ramas disjuntas, el control
de la elección de solape contributivo— es el peor de los cuatro, con **p = 0,063** y 5 semillas
completas. No llega al 5 %, pero es el contraste mejor poblado del recorrido y **apunta en la
dirección que la arquitectura predice**: el solape aporta. Como indicio, no como veredicto.

**Y la tendencia aparente sube hacia 4**, que es justo el extremo del rango. Si al completarlo se
confirma, el eje **no quedaría acotado por arriba** y haría falta un punto más allá — con la misma
disciplina que se aplicó en `borde-ancho`: decidir **antes** hasta dónde tiene sentido llegar.

---

## Lo que se aprendió: un apagado a mano se lleva por delante la contabilidad

> ⚠ **Esta sección describe un apagado que NO ocurrió.** La flota terminó sola a las 15:58 y
> escribió su `flota.json`; ver Corrección 2. **El mecanismo que describe es real y la advertencia
> sigue valiendo** —una flota matada a mano sí pierde su cierre contable, y le pasó de verdad al
> estudio #9 del índice— pero **este relanzamiento no fue un caso de eso**, y por tanto el «único
> antídoto es no volver a mirar ahí» del párrafo siguiente es exactamente el consejo equivocado
> aquí: hay que mirar ahí, porque el fichero existe.
>
> **Y el error de fondo es el mismo que el de la Corrección 1, en su tercera forma:** dar por
> muerto lo que sólo estaba tardando. Primero fueron cuatro runs («murió la máquina» → habían
> terminado), luego la contabilidad («se apagó a mano» → cerró sola 2 h 40 después). En los dos
> casos se dedujo un final a partir de una fuente que aún no lo era. **La pregunta que ahorra las
> dos: ¿es esta fuente posterior al último run, o sólo la última que miré?**

**Ésta es la parte que hay que arrastrar a la próxima vez, y no es sobre visión foveada.**

El coste, el reloj y el número de instancias los escribe `estudio_flota.py` en `sweeps/*/flota.json`
**al terminar**, en el mismo sitio donde ya se destruyen las máquinas. Al apagar la flota a mano
desde fuera, esa escritura **nunca ocurre**: las máquinas mueren —que es lo que importaba y funcionó—
pero **la contabilidad de la corrida se pierde entera**. Los `flota.json` que hay en esos cuatro
directorios son de la corrida **anterior** (06:53 UTC), y leerlos como si fueran de ésta sería
atribuirle 101 instancias y 3,2996 $ que ya están contados en el reporte anterior. **El único
antídoto es no volver a mirar ahí para este relanzamiento**, que es para lo que existe esta nota.

Lo que **sí** sobrevivió, y explica que este reporte se pueda escribir: el **libro de a bordo**, que
commitea `metrics.jsonl` y `status.json` de cada máquina cada minuto. Gracias a él los ~~31~~ **70**
runs terminados están en git aunque las máquinas ya no existan, y las horas se pueden derivar de sus
`updated_at`. **El libro de a bordo hizo su trabajo**, y de hecho es lo que permitió detectar los dos
errores de este reporte: es la única fuente que se actualiza sola.

~~Y una tercera cosa funcionó sola: al pasar `estudio_informe.py` después del apagado, los cuatro runs
huérfanos se detectaron y se marcaron `interrupted`…~~ — **esto se contó dos veces como acierto y
las dos era un fallo.** Los cuatro no eran huérfanos (Corrección 1: un push roto los escondió) y no
hubo apagado (Corrección 2). El marcado `interrupted` hizo lo correcto *con los datos que tenía*;
lo que no existe todavía es lo que habría evitado las dos vueltas: **algo que avise de que la
fuente que estás leyendo es más vieja que los datos.**

## Lo que quedó pendiente

- ~~**`ov-fov` necesita 4 runs**~~ ✅ **cerrado, 20/20**, y con ellos el punto 0 llega a p = 0,032.
  Ver «Las dos tablas que cambian».
- ~~**`ch-fov` necesita 1 run**~~ ✅ **cerrado, 20/20**, sin cambio de lectura.
- ~~**El coste y las instancias de este relanzamiento son irrecuperables.**~~ ✅ **Sí existen**:
  **2,0283 $** y **34 máquinas**, en el `flota.json` que la flota escribió a las 15:58:19 UTC.
- **`overlap_fovea_px` no queda acotado por arriba.** El 4 es el mayor del rango, gana +0,0065 sin
  significación (p = 0,270) y la tendencia sigue subiendo. Si se quiere cerrar el eje hace falta un
  punto más allá de 4 — con la disciplina de `borde-ancho`: decidir **antes** hasta dónde tiene
  sentido llegar, y contra qué coste (el solape sube N, no es gratis).
- **R5 (métrica de tarea) sigue sin aplicarse a ninguno de los siete ejes de prioridad 2.** No se
  activa por ganador nuevo —no hubo ninguno en los cuatro de aquí— pero en `kc-fov` no era opcional,
  y eso sigue igual que en el reporte anterior.
- ⚠ **Los `informe.json` de los cuatro recorridos siguen siendo los de las 15:13 UTC, o sea
  rancios.** Las tablas de arriba se recalcularon a mano desde `runs/*/metrics.jsonl` porque la
  máquina donde se escribió esto no tiene `torch` y no puede pasar `estudio_informe.py`. **Hay que
  volver a pasarlo en una máquina con el entorno** para que el disco diga lo mismo que este reporte;
  mientras tanto, `sweeps/ov-fov/informe.json` afirma 2 semillas en el punto 4 y un `pendiente`, y
  las dos cosas son falsas.

## De dónde salen los números

- **Tablas de «Las dos tablas que cambian» (las válidas)**: recalculadas el **2026-08-26** desde
  `runs/*/summary.json` + `runs/*/metrics.jsonl`, tomando f1 en `best_epoch` y permutación exacta de
  dos colas. Método validado contra `sweeps/pw-fov/informe.json` (los tres contrastes coinciden al
  quinto decimal). **No hay copia en `sweeps/<r>/informe.json`** — ver el pendiente de arriba.
- **Tablas de las secciones E8 y E10 originales**: `sweeps/<r>/informe.json` calculado a las
  **15:13:42 UTC**, o sea **antes de que terminara el último run**. Superadas; se conservan como
  registro del error.
- Instancias, coste y reloj: `sweeps/{sch,pw,ch,ov}-fov/flota.json`, `cuando` = 2026-08-26T15:58:19Z.
  **Es un fichero distinto del de la corrida de las 06:53** (`recorridos` de 4 contra 7): no
  confundirlos, y no sumarlos dos veces.
- El criterio se escribió **antes de medir** en
  [`docs/plan-prioridades-2026-08-25.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-prioridades-2026-08-25.md) §2.
