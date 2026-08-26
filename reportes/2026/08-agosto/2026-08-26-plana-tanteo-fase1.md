# `pl-t-bs` + `pl-t-nl` — terminar el afinado de la red plana (fase 1)

| | |
|---|---|
| **Qué era** | el estudio **2 de prioridad 1**: cerrar los dos tanteos de la **CNN plana** que estaban a medias. Bloquean la pregunta central del proyecto, porque comparar una foveada afinada contra una plana sin afinar mediría el afinado, no la arquitectura |
| **Lanzado con** | `estudio_flota.py --sweep borde-ancho --sweep pl-t-bs --sweep pl-t-nl --reparto seed --cpu E5-26 --max-price 0.12 --criba 2 --git` · `pl-t-nl` lo terminó el **vigilante** relanzando solo lo que faltaba |
| **Proveedor** | Vast.ai |
| **Inicio** | **2026-08-26 01:42:54 UTC** · el relanzamiento de `pl-t-nl`, **07:47:59 UTC** |
| **Fin** | `pl-t-bs` **04:40:15 UTC** · `pl-t-nl` **08:32:39 UTC** |
| **Duración** | 177,2 min la flota principal + **44,5 min** el relanzamiento |
| **Instancias** | **18 alquiladas** (flota compartida) + **4 alquiladas** para 1 lote en el relanzamiento |
| **Coste real** | **1,0536 $** (compartido con `borde-ancho`) + **0,0571 $** del relanzamiento |
| **Dataset** | `dirty1000-80px-16px-r20260824` |
| **Estado** | **terminado, 10/10 + 10/10 runs**, 529 + 471 épocas |

## ⚠ Esto es un TANTEO: 2 semillas, y no declara ganador

Con 2 semillas la permutación exacta da **2 arreglos**, así que el p mínimo alcanzable es 0,5. Un
tanteo **acota**, no decide. El criterio de «acotado», escrito antes de mirar, es que **el mejor
punto quede interior**, con al menos un valor claramente peor por encima y por debajo.

La **fase 2 con 5 semillas** es la que declararía ganador, y **no se ha corrido** (ver pendientes).

## `pl-t-bs` — `batch_size` de la plana, 10/10

**✅ R1 — válido.** Los 10 runs pararon por `patience`, entre 31 y 61 épocas.

| `batch_size` | f1 (media de 2) | sem | épocas | s/época |
|---:|---:|---:|---:|---:|
| 24 | 0,9510 | 0,0058 | 31 · 54 | 61,2 |
| 43 | 0,9581 | 0,0014 | 49 · 51 | 68,7 |
| 85 *(vigente)* | 0,9626 | 0,0036 | 54 · 58 | 85,2 |
| **170** | **0,9658** | 0,0015 | 52 · 60 | **50,2** |
| 340 | 0,9601 | 0,0015 | 59 · 61 | 48,2 |

**Acotado por los dos lados**: el mejor punto (170) es **interior**, con 340 peor por arriba y 85,
43 y 24 peores por abajo. Y 170 es además **más barato por época que el vigente** (50,2 s contra
85,2), que es el mismo patrón que ya salió en la foveada: subir el batch abarata sin perder.

Encaja con `bs-alto-pl` del 25-ago, que midió 170 → 0,9658 con las mismas 2 semillas — **el mismo
número**, otra réplica exacta entre flotas distintas.

## `pl-t-nl` — `n_layers` de la plana, 10/10

**✅ R1 — válido** por el tope (entre 20 y 86 épocas, tope 150), pero ver el aviso de abajo.

| `n_layers` | f1 (media de 2) | sem | min | max | épocas | s/época |
|---:|---:|---:|---:|---:|---:|---:|
| 2 | 0,9196 | 0,0119 | 0,9077 | 0,9315 | 36 · 53 | 27,8 |
| 3 | 0,9521 | 0,0027 | 0,9494 | 0,9548 | 38 · 54 | 37,0 |
| 4 *(vigente)* | 0,9615 | 0,0012 | 0,9603 | 0,9626 | 36 · 46 | 41,2 |
| **5** | **0,9659** | 0,0002 | 0,9657 | 0,9661 | 41 · 61 | 52,6 |
| 6 | **0,4815** | 0,4815 | **0,0000** | 0,9630 | 20 · 86 | 61,2 |

### El punto de `n_layers` = 6 no es «malo»: es **bimodal**

Sus dos semillas dieron **0,0000 y 0,9630**. Una entrenó bien y la otra **no arrancó en absoluto**.
La media de 0,4815 no describe ninguna de las dos y **no debe citarse como el rendimiento de L6** —
es el promedio de una moneda.

Esto **replica exactamente** lo que [`plan-plana.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-plana.md)
§6.1 ya había documentado en la plana con L5/L6, y lo que `nl5-L4` vio en la foveada a partir de L5
(`sem` 7× mayor, semillas bimodales). Y es la tercera vez que aparece un f1 **exactamente 0,0000** en
este proyecto: la otra fue `pl-t-lr` en `lr`=0,0028.

⚠ **Consecuencia práctica para la fase 2**: el ganador nominal es **5**, que está justo en el borde
de la zona donde el entrenamiento deja de ser fiable. Con 2 semillas y `sem` = 0,0002 parece
finísimo, pero **es exactamente el número de semillas que no puede ver la bimodalidad**. La fase 2
tiene que llevar 5 semillas y **declarar cuántas colapsan**, no promediarlas.

## Lo que quedó pendiente

- **La fase 2 con 5 semillas no se ha corrido.** Es la que declara ganador. Según la regla escrita
  antes, barrería el ganador nominal y sus dos vecinos: `batch_size` ∈ {85, 170, 340} y `n_layers`
  ∈ {4, 5, 6}. **No se ha hecho.**
- **Y por tanto el estudio 3 de prioridad 1 —foveada vs plana por métrica de tarea— sigue sin
  contestar**, que es *la* pregunta que da nombre al proyecto. Depende de esta fase 2.
- ⚠ **Los 0,96 de la plana contra los 0,93 de la foveada NO son esa comparación** y no deben citarse
  como tal: son f1 de **ventana** y las dos redes ven áreas distintas.
  [`plan-cnn-plana.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-cnn-plana.md)
  §4 exige métrica **de tarea** y 5 semillas.
- **`n_layers` = 6 necesita más semillas para caracterizar la bimodalidad**, o descartarse
  explícitamente. Hoy es un punto con una moneda dentro.

## De dónde salen los números

- Tablas y R1: `scripts/estudio_informe.py --sweep pl-t-bs --eje batch_size --vigente 85` y
  `--sweep pl-t-nl --eje n_layers --vigente 4`, con copia en `sweeps/*/informe.json`.
- Coste, reloj e instancias: `sweeps/pl-t-bs/flota.json` y `sweeps/pl-t-nl/flota.json`.
- El relanzamiento de `pl-t-nl` lo hizo `scripts/vigilante_prioridades.py` solo, y queda en
  `/tmp/vigilante-p1.log`.
