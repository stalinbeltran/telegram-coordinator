# Prioridad 2 — el relanzamiento de los cuatro a medias, cortado por el apagado

Continuación de [`2026-08-26-prioridad2.md`](2026-08-26-prioridad2.md), que dejó cuatro recorridos
incompletos y anunció que su reporte iría aparte. Va aquí. **Dos de los cuatro se cerraron; los
otros dos se quedaron a un paso.**

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

| | |
|---|---|
| **Qué era** | terminar los **cuatro recorridos a medias** de la flota de prioridad 2: `sch-fov`, `pw-fov`, `ch-fov`, `ov-fov` |
| **Lanzado con** | relanzamiento de `estudio_flota.py` sobre los puntos pendientes (el mecanismo que sólo rehace lo que falta) |
| **Proveedor** | Vast.ai |
| **Inicio** | **2026-08-26 08:14:12 UTC** *(derivado: primer `updated_at` de run posterior al fin de la flota anterior; no hay log conservado)* |
| **Fin** | **2026-08-26 13:16:35 UTC** *(derivado: último `updated_at` de run)*. El libro de a bordo commiteó por última vez a las **13:18:39 UTC** |
| **Duración** | **≈302 min** (5 h 02 min) *(derivada de las dos anteriores)* |
| **Instancias** | ⚠ **no registrado.** La flota se apagó a mano antes de cerrar, así que **no llegó a escribir su `flota.json`** |
| **Coste real** | ⚠ **no registrado**, por lo mismo. La estimación previa al lanzamiento era **1,39 $** para 34 runs — es una estimación, no la factura |
| **Dataset** | `dirty1000-80px-16px-r20260824` |
| **Estado** | ⚠ **parcial**: 2 de 4 recorridos terminados (`sch-fov`, `pw-fov`), 2 a un run del final (`ch-fov` 19/20, `ov-fov` 16/20) |

⚠ **Las dos casillas vacías de arriba son el hallazgo operativo de este reporte**, no un descuido al
escribirlo. Ver «lo que se aprendió» al final.

## Estado por recorrido

| # | Recorrido | Eje | Runs | Estado |
|---|---|---|---:|---|
| E7 | `sch-fov` | `scheduler` | 10/10 | ✅ terminado |
| E5 | `pw-fov` | `pos_weight` | 20/20 | ✅ terminado |
| E8 | `ch-fov` | `channels` | 19/20 | ⚠ 1 run cortado a mitad (época 49) |
| E10 | `ov-fov` | `overlap_fovea_px` | 16/20 | ⚠ 3 cortados a mitad + **1 que nunca arrancó** |

Los cuatro runs cortados pararon **por la muerte de la máquina, no por `patience`**, así que por R1
no son medidas y `estudio_informe.py` los **excluye** (los marca `interrupted`, con el motivo
escrito). Tienen un f1 y tiene buena pinta — y por eso mismo la exclusión importa: un run cortado a
mitad entra en la tabla como si fuera una medida si nadie lo detiene.

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

## E8 `ch-fov` — 19/20, y la lectura ya no va a cambiar

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

## E10 `ov-fov` — el que se quedó sin poder declarar nada

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

**Ésta es la parte que hay que arrastrar a la próxima vez, y no es sobre visión foveada.**

El coste, el reloj y el número de instancias los escribe `estudio_flota.py` en `sweeps/*/flota.json`
**al terminar**, en el mismo sitio donde ya se destruyen las máquinas. Al apagar la flota a mano
desde fuera, esa escritura **nunca ocurre**: las máquinas mueren —que es lo que importaba y funcionó—
pero **la contabilidad de la corrida se pierde entera**. Los `flota.json` que hay en esos cuatro
directorios son de la corrida **anterior** (06:53 UTC), y leerlos como si fueran de ésta sería
atribuirle 101 instancias y 3,2996 $ que ya están contados en el reporte anterior. **El único
antídoto es no volver a mirar ahí para este relanzamiento**, que es para lo que existe esta nota.

Lo que **sí** sobrevivió, y explica que este reporte se pueda escribir: el **libro de a bordo**, que
commitea `metrics.jsonl` y `status.json` de cada máquina cada minuto. Gracias a él los 31 runs
terminados están en git aunque las máquinas ya no existan, y las horas de arriba se pueden derivar
de sus `updated_at`. **El libro de a bordo hizo su trabajo; el cierre contable es lo que no tiene
equivalente incremental.**

Y una tercera cosa funcionó sola: al pasar `estudio_informe.py` después del apagado, los cuatro runs
huérfanos se detectaron y se marcaron `interrupted` con el motivo escrito («el proceso que lo
entrenaba ya no existe»), en vez de quedarse como `running` para siempre o —peor— colarse en la
tabla como medidas. Es exactamente el arreglo que el reporte anterior menciona haber hecho.

## Lo que quedó pendiente

- **`ov-fov` necesita 4 runs** (`overlap_fovea_px`=4 semillas 2, 3 y 5 — la 3 **nunca llegó a
  arrancar** — y `overlap_fovea_px`=2 semilla 3) para poder declarar algo. **Es el que más lo
  merece**: es el mando exclusivo de la arquitectura y hoy no dice nada.
- **`ch-fov` necesita 1 run** (`channels`=32 semilla 5) para cerrarse formalmente. La lectura no
  depende de él.
- **El coste y las instancias de este relanzamiento son irrecuperables.** Si hacía falta el número
  de la factura, sale del panel de Vast por ventana horaria, no del repo.
- **R5 (métrica de tarea) sigue sin aplicarse a ninguno de los siete ejes de prioridad 2.** Aquí no
  se activa por ganador nuevo —no hubo ninguno— pero en `kc-fov` no era opcional, y eso sigue igual
  que en el reporte anterior.
- **Los cuatro `interrupted` conservan su `metrics.jsonl` hasta la época en que murieron.** No son
  medidas y no deben entrar en ninguna tabla; si algún día se quisieran aprovechar, sería como
  reanudación, no como resultado.

## De dónde salen los números

- Tablas, R1, R2 y R4: `scripts/estudio_informe.py --sweep <r> --vigente <v>`, corrido el
  **2026-08-26 tras el apagado**, con copia en `sweeps/<r>/informe.json`.
- Horas de inicio y fin: **derivadas** de los `updated_at` de `runs/*/status.json`, porque no hay log
  ni `flota.json` de esta corrida. Marcadas como derivadas en la cabecera.
- Instancias y coste: **no existen para esta corrida**. Ver «lo que se aprendió».
- El criterio se escribió **antes de medir** en
  [`docs/plan-prioridades-2026-08-25.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-prioridades-2026-08-25.md) §2.
