# `borde-ancho` — ¿ayuda ver más contexto, a coste constante?

| | |
|---|---|
| **Qué era** | el estudio **1 de prioridad 1**: barrer `border_px` ∈ [4, 8, 10, 12, 16] px manteniendo el anillo **fijo en 2 celdas** (`border_reduce` atado = `border_px`/2), 5 semillas. Continúa la serie que `proxy-c-d` y `d5-L4` dejaron **abierta por la derecha** |
| **Lanzado con** | `estudio_flota.py --sweep borde-ancho --sweep pl-t-bs --sweep pl-t-nl --reparto seed --cpu E5-26 --max-price 0.12 --criba 2 --git --horas-max 4` |
| **Proveedor** | Vast.ai |
| **Inicio** | **2026-08-26 01:42:54 UTC** (primera línea de `/tmp/estudio-p1.log`) |
| **Fin** | **2026-08-26 04:40:15 UTC** (`sweeps/borde-ancho/flota.json`) |
| **Duración** | **177,2 min** (2 h 57 min) |
| **Instancias** | **18 alquiladas** para 9 lotes (la flota compartida con `pl-t-bs` y `pl-t-nl`) |
| **Coste real** | **1,0536 $** — el de la flota entera de los tres recorridos, no separable por recorrido |
| **Dataset** | `dirty1000-80px-16px-r20260824` |
| **Estado** | **terminado, 25/25 runs**, 1.389 épocas escritas |

⚠ Hubo **una corrida anterior el 2026-08-25 22:20 UTC que se cortó** y cuyo coste **no quedó
registrado** (se la mató con SIGTERM y `flota.json` se escribe al final). 11 de estos 25 runs vienen
de ella. No es cero: es **no registrado**, y la razón está en «lo que quedó pendiente».

## Qué preguntaba, y por qué la pregunta no se podía hacer hasta ahora

`N = fovea + 2·(border_px / border_reduce)` y la cabeza es `Linear(2·C·N², 12)` — el **97 % de los
parámetros**. Si se barre `border_px` con `border_reduce` fijo, **N crece con el eje** y el estudio
mide «más área **y** más parámetros», que son dos cosas.

Con el anillo fijo en 2 celdas los cinco puntos salen **idénticos en coste**. Comprobado al crear el
recorrido:

| `border_px` | `border_reduce` | celdas | N | parámetros | recorte real |
|---:|---:|---:|---:|---:|---:|
| **4** *(vigente)* | 2 | 2 | 20 | 167.852 | 24×24 |
| **8** | 4 | 2 | 20 | 167.852 | 32×32 |
| **10** | 5 | 2 | 20 | 167.852 | 36×36 |
| **12** | 6 | 2 | 20 | 167.852 | 40×40 |
| **16** | 8 | 2 | 20 | 167.852 | 48×48 |

Mismo tensor de entrada, **mismos 167.852 parámetros**, y lo único que cambia es cuántos píxeles
reales de la imagen se condensan en el anillo. Eso es exactamente la pregunta de la visión foveada.

**Hasta la reparametrización del 2026-08-25 esto no se podía ni escribir**: hacía falta mover `N` y
`c_frac` a la vez y el motor es OAT (un eje cada vez). Y aun con la geometría nueva hacía falta una
**atadura** (`couple`) en el motor de recorridos, porque como producto cartesiano `border_px`=8
habría salido con 2 celdas **y** con 1 — dos redes distintas agregadas bajo el mismo valor del eje.

## Lo que se midió

**✅ R1 — válido.** Los 25 runs pararon por `patience`, entre 33 y 87 épocas. Ninguno cerca del tope
de 150.

| `border_px` | f1 (media de 5) | sem | min | max | épocas | s/época |
|---:|---:|---:|---:|---:|---:|---:|
| 4 *(vigente)* | 0,9341 | 0,0022 | 0,9296 | 0,9416 | 47 · 48 · 54 · 58 · 70 | **36,8** |
| **8** | **0,9408** | 0,0021 | 0,9333 | 0,9446 | 35 · 47 · 50 · 51 · 59 | 42,5 |
| 10 | 0,9385 | 0,0019 | 0,9337 | 0,9430 | 48 · 50 · 63 · 71 · 87 | 41,0 |
| 12 | 0,9376 | 0,0016 | 0,9332 | 0,9423 | 42 · 52 · 62 · 62 · 76 | 47,4 |
| 16 | 0,9321 | 0,0024 | 0,9242 | 0,9393 | 33 · 38 · 41 · 72 · 73 | 50,5 |

## El hallazgo: **el eje queda CERRADO por los dos lados**

Ésta es la respuesta a la pregunta que `d5-L4` dejó abierta, y es un resultado, no un empate:

**El eje sube hasta 8 px y a partir de ahí BAJA de forma monótona** (8 → 10 → 12 → 16), hasta que a
16 px queda **por debajo del vigente**. El ganador, 8 px, es **interior** al rango — que es
literalmente la condición de R3 para decir que un óptimo está acotado.

`d5-L4` había medido los puntos 2, 4, 6 y 8 px subiendo de forma monótona y se cortó con el ganador
en el borde. La lectura entonces fue «sigue subiendo y no sabemos hasta dónde». **La respuesta es que
se acaba justo ahí**: 8 px era el máximo, no un tramo de subida.

Y la caída **encaja con la predicción del relleno** que se escribió *antes* de mirar
([instructionsNewNN.md](https://github.com/stalinbeltran/foveal-vision/blob/main/instructionsNewNN.md) §2.2):
sobre imágenes de 60×80, el porcentaje del anillo que es relleno replicado y no imagen sube 11,5 % →
15,3 % → 21,4 % → **26,4 %** para 4/8/12/16 px. A partir de ~8–12 px se está midiendo `pad_mode`, no
la imagen. El rango se paró en 16 a propósito para poder ver ese techo, y se vio.

### Réplica exacta, de regalo

El punto `border_px`=8 / `border_reduce`=4 **es la misma red** que el `d`=4 de `d5-L4` bajo la
ortografía vieja. Salió **idéntico**: 0,9408 · sem 0,0021 · min 0,9333 · max 0,9446 · épocas
35·47·50·51·59 — los mismos números hasta el último decimal. Lo mismo el punto de 4 px contra el
`d`=2. Es una comprobación independiente de dos cosas a la vez: que **la reparametrización no cambió
ninguna red**, y que la reproducibilidad bit a bit dentro de la familia E5-26xx aguanta entre
flotas distintas y días distintos.

## El veredicto, con la regla escrita antes

**R4 — contra el vigente (4 px), permutación exacta de 5 contra 5 (252 arreglos, p mínimo 0,008):**

| `border_px` | diferencia | p |
|---:|---:|---:|
| 8 | **+0,0067** | **0,063** |
| 10 | +0,0044 | 0,167 |
| 12 | +0,0036 | 0,214 |
| 16 | −0,0019 | 0,563 |

La regla escrita antes dice que **el vigente sólo cambia si (a) p < 0,05 Y (b) la diferencia supera
δ**. Aquí (b) se cumple (0,0067 contra δ = 0,0021) y **(a) no** (p = 0,063). Así que:

> **El vigente se queda en `border_px` = 4.** El eje queda **acotado por los dos lados** con el
> óptimo en 8 px, y 8 px se queda a un pelo de la significación con la misma p = 0,063 que ya tenía
> en `d5-L4`.

⚠ **Y esto es lo que hay que entender del resultado**: repetir el mismo punto con más semillas es lo
que decidiría, no ampliar el rango. Dos estudios independientes han dado **la misma p = 0,063** para
el mismo contraste, que es justo lo que pasa cuando el efecto es real pero pequeño frente al ruido de
semilla. La diferencia (+0,0067) es **3× δ**, y sin embargo la permutación no baja de 0,063 porque
las bandas de 4 y 8 px se solapan en dos semillas.

## Lo que quedó pendiente

- **El contraste de 8 px contra 4 px sigue sin resolverse al 5 %**, con p = 0,063 medida dos veces.
  Lo que lo cerraría es **más semillas en esos dos puntos** (10 contra 10 da p mínimo 5,4·10⁻⁶), no
  un rango más ancho. **No se ha hecho.**
- **Nada de esto ha pasado por la métrica de tarea** (R5). Es f1 de **ventana**, un proxy que está
  medido que **exagera**: en `n_layers` la ganancia real fue la mitad. Antes de mover el vigente por
  este eje hay que medirlo con `proxy_vs_task.py`. **No se ha hecho.**
- **El coste de la corrida del 25-ago 22:20 no quedó registrado.** Se la mató para parar el gasto
  cuando se descubrió que el pozo de máquinas se había agotado, y `flota.json` sólo se escribe al
  terminar. Los 1,0536 $ de la cabecera son **sólo** los de la corrida del 26-ago.

## De dónde salen los números

- Tabla, R1, R2 y R4: `scripts/estudio_informe.py --sweep borde-ancho --eje border_px --vigente 4`,
  que deja el mismo contenido en `sweeps/borde-ancho/informe.json`.
- Geometría y parámetros: `fv.fovea.derive_dims` + `fv.models.builder.build_model` sobre los puntos
  expandidos del recorrido.
- Coste, reloj e instancias: `sweeps/borde-ancho/flota.json`.
- El criterio (R1..R6) se escribió **antes de medir** en
  [`docs/plan-prioridades-2026-08-25.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-prioridades-2026-08-25.md) §1.
