# `bs-alto-fov` + `bs-alto-pl` — cerrar `batch_size` por arriba (tanteo)

| | |
|---|---|
| **Qué era** | tanteo de 2 semillas para acotar `batch_size` **por la derecha**, en las dos redes a la vez. El estudio de tres ejes lo dejó abierto por ese lado |
| **Lanzado con** | `estudio_flota.py --sweep bs-alto-fov --sweep bs-alto-pl --cpu E5-26 --reparto run --git` (ejecutor `estudio`) |
| **Proveedor** | Vast.ai |
| **Inicio** | **2026-08-25 10:35:05 UTC** (primera línea de `/tmp/bs-alto-tanteo.log`) |
| **Fin** | **2026-08-25 13:08:32 UTC** |
| **Duración** | **153,4 min** (2 h 33 min) |
| **Instancias** | **24 alquiladas** para 16 lotes: 16 terminaron su lote, 8 fallaron antes de estar listas |
| **Coste real** | **1,6846 $** |
| **Dataset** | `dirty1000-80px-16px-r20260824` |
| **Estado** | terminado, **16/16 lotes**, 1.241 épocas escritas |

## Qué puede decir un tanteo (y qué no)

⚠ **2 semillas dan 2 arreglos en la permutación exacta: el tanteo NO declara ganador.** Su único
trabajo es **acotar**. Y el criterio de «acotado», escrito antes de ver un solo run, es que **el
mejor punto del tanteo quede INTERIOR**, con al menos un valor por encima que sea claramente peor.

El tope de épocas se subió a **300** a propósito para este tanteo: un batch grande da menos
actualizaciones por época, y con el tope de 150 los puntos altos habrían parado **por el tope y no
por `patience`** — que es el defecto que invalidó los estudios de `batch_size` de julio, y sería
repetirlo justo en la zona que se quiere medir.

**✅ Validez: los 16 runs pararon por `patience`**, entre 52 y 130 épocas. Ninguno se acercó a 300.
El tanteo es válido.

## Lo que se midió

### `bs-alto-fov` (red foveada) — 8/8 runs

| `batch_size` | f1 (media de 2) | ± | épocas | s/época |
|---:|---:|---:|---:|---:|
| **192** *(ancla)* | **0,9386** | 0,0002 | 61 · 65 | **30,7** |
| 384 | 0,9362 | 0,0005 | 56 · 65 | 34,0 |
| 768 | 0,9316 | 0,0000 | 93 · 86 | 40,0 |
| 1536 | 0,9259 | 0,0012 | 122 · 130 | 63,4 |

### `bs-alto-pl` (red plana) — 8/8 runs

| `batch_size` | f1 (media de 2) | ± | épocas | s/época |
|---:|---:|---:|---:|---:|
| **170** *(ancla)* | **0,9658** | 0,0015 | 60 · 52 | **40,3** |
| 340 | 0,9601 | 0,0015 | 61 · 59 | 48,8 |
| 680 | 0,9575 | 0,0001 | 80 · 70 | 75,2 |
| 1360 | 0,9557 | 0,0008 | 94 · 87 | 90,9 |

## Hallazgos

- **La respuesta es limpia y va en la dirección contraria a la que abría la pregunta: subir el
  batch por encima del ancla no compra nada, y cuesta.** En las **dos redes**, el f1 **baja de
  forma monótona** en los cuatro puntos, y la caída total (−0,0127 en la foveada, −0,0101 en la
  plana) es de un orden mayor que la dispersión entre semillas (±0,0000–0,0015).
- ⚠ **Por el criterio escrito antes, el eje NO queda «acotado»** en el sentido técnico: el mejor
  punto del tanteo es **192 / 170, el extremo IZQUIERDO del rango**, no un punto interior. Pero eso
  aquí **no deja la pregunta abierta, la cierra por el otro lado**: lo que el tanteo tenía que
  averiguar era «dónde cae», y la respuesta medida es **«cae ya desde el ancla»**. No hay nada que
  buscar más arriba.
- **Y el coste de la época va justo al revés del beneficio**: 1536 tarda **2,1×** más por época que
  192 en la foveada (63,4 vs 30,7 s) y **necesita el doble de épocas** para parar (122–130 vs
  61–65). O sea que el punto peor en calidad es además ~4× más caro en reloj.
  ⚠ **Con `--reparto run` cada punto corrió en una máquina distinta**, así que las columnas de
  s/época mezclan el efecto del batch con el de la máquina (el catálogo varía ~1,5× por núcleo). La
  tendencia es demasiado grande para explicarse sólo así, pero **el factor exacto no está limpio**.
- **El «192 es 1,08× más rápido que 85 sin perder calidad» del estudio anterior sigue en pie, y
  ahora se sabe que es el techo**: la zona plana de `batch_size` termina justo ahí. Entre 57 y 192
  el eje es plano; de 192 hacia arriba, baja.

## Lo que quedó pendiente

1. ⚠ **El veredicto formal no está escrito todavía.** `plan-tres-ejes.md` §8 dejó el criterio
   escrito antes (T1–T5) pero **no tiene aún su sección de RESULTADO**. Lo de arriba son los
   números medidos; **el veredicto va en ese documento, no en este reporte** — aquí sólo se
   resume y se enlaza.
2. **Decidir si la fase 2 (5 semillas) tiene sentido.** Si la lectura es «el eje cae ya desde el
   ancla», gastar 5 semillas en confirmar una caída monótona de 4 puntos puede no comprar nada.
   Es una decisión, no un dato.

## Fuente de verdad

- `~/src/foveal-vision/sweeps/{bs-alto-fov,bs-alto-pl}/flota.json` — coste, reloj, máquinas
- `~/src/foveal-vision/runs/` (el libro de a bordo). Para releerlo:
  `/use estudio-progreso` → `--sweep bs-alto-fov --sweep bs-alto-pl --tabla`
- `/tmp/bs-alto-tanteo.log` ⚠ **`/tmp` no sobrevive a rehacer la máquina**
- [`foveal-vision/docs/plan-tres-ejes.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-tres-ejes.md)
  §8 — el criterio, escrito antes de ver un solo run
