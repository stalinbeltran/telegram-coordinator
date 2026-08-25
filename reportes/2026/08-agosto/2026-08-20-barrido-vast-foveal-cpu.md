# `foveal-cpu` — barrido de vCPU en Vast.ai

| | |
|---|---|
| **Qué era** | alquilar una máquina del marketplace por nivel de vCPU, medir `seconds_per_epoch` y destruirla |
| **Lanzado con** | `python3 scripts/vast_instance.py sweep --bench foveal-cpu …` (el envoltorio es `scripts/vast-sweep.sh`) |
| **Proveedor** | Vast.ai |
| **Inicio** | **2026-08-20 21:18:28 UTC** (arranque de la primera máquina medida) |
| **Fin** | **2026-08-21 02:22:57 UTC** (última medida sellada) |
| **Duración** | 5 h 04 min de extremo a extremo, pero **no fue continuo**: son tres invocaciones separadas (§ *Cómo se hizo*) |
| **Instancias** | **5 máquinas medidas y destruidas.** ⚠ Las que fallaron antes de medir **no dejan JSON**, así que el recuento real de alquiladas es ≥ 5 |
| **Coste real** | **≥ 0,0293 $** — suma de `usd_medida` de los 5 JSON. Es un **suelo**, no el total: los intentos fallidos facturaron y no quedaron registrados |
| **Dataset** | `bench-dirty1000-16` (red `bench-16`, receta `bench`, 3 repeticiones) |
| **Estado** | terminado |

## Cómo se hizo (y por qué el reloj no es la duración)

El barrido se completó en **tres invocaciones**, no en una. Se ve en los commits del lanzador:

| commit | cuándo | qué añadió |
|---|---|---|
| `7877d6c` | 2026-08-20 21:26 UTC | primera medida real (10 vCPU) |
| `5c9a296` | 2026-08-20 23:16 UTC | el barrido propiamente dicho: 2, 6 y 10 vCPU |
| `27d6c05` | 2026-08-21 02:22 UTC | el nivel alto (18 vCPU), **«al tercer intento»** |

Ese «al tercer intento» del mensaje de commit es la pista de que **hubo dos alquileres del nivel
alto que no llegaron a medir**. Facturaron por segundo mientras existieron y no dejaron rastro
numérico: por eso el coste de arriba es un suelo.

## Lo que se midió

Cada fila es una máquina distinta del marketplace, alquilada y destruida. `inicio` está derivado
de `medido − segundos_vivida`.

| vCPU | CPU | s/época | $/h | $ de la medida | vivió | inicio → fin (UTC) |
|---:|---|---:|---:|---:|---:|---|
| 18 | Xeon E5-2696 v3 | **13,799** | 0,0489 | 0,00481 | 327,6 s | 08-21 02:17:29 → 02:22:57 |
| 10 | Xeon E5-2630 v4 | 16,354 | 0,0489 | 0,00481 | 354,5 s | 08-20 23:10:47 → 23:16:42 |
| 6 | Core i5-8500 | 16,873 | 0,0489 | 0,00530 | 389,9 s | 08-20 23:04:16 → 23:10:46 |
| 10 | Xeon E5-2630 v4 | 21,868 | 0,0489 | 0,00593 | 436,4 s | 08-20 21:18:28 → 21:25:45 |
| 2 | Xeon E5-2620 v3 | 58,024 | 0,0489 | 0,00844 | 621,2 s | 08-20 22:53:53 → 23:04:15 |

## Hallazgos

- **La máquina más rápida costó lo mismo por hora que la más lenta.** 18 vCPU a 13,8 s/época y
  2 vCPU a 58,0 s/época, las dos a ~0,049 $/h. En el marketplace, **el precio por hora no ordena el
  rendimiento**: lo que decide es el $/unidad de trabajo, y ahí el 18 vCPU sale 4× mejor.
- ⚠ **Dos máquinas con el mismo modelo de CPU y las mismas 10 vCPU dieron 16,354 y 21,868
  s/época** — un 34 % de diferencia. Vast.ai alquila porciones de ordenadores compartidos, así que
  el número mide «esa porción con los vecinos que tuviera ese día». En la medida de las 21:25 el
  `load_avg_before` valía **1,02 antes de arrancar el benchmark**: había alguien más trabajando.
- **Consecuencia práctica, ya recogida en el proyecto**: repetir la medida antes de sacar
  conclusiones de una diferencia pequeña, y desconfiar de una fila cuyo `load_avg_before` sea
  mucho mayor que el de sus vecinas.

## Lo que este reporte deja pendiente

- **Los intentos fallidos no se contabilizan en ningún sitio.** Un barrido que alquila tres
  máquinas para medir una sola deja constancia de una. Es exactamente la columna «coste real» de
  este directorio la que se queda coja.

## Fuente de verdad

- `~/src/digital-ocean-dropplet-auto-launching/results/foveal-cpu/*.json` (el dato, uno por máquina)
- `~/src/digital-ocean-dropplet-auto-launching/results/foveal-cpu/tabla.md` (la comparativa; se
  rehace sola a partir de los JSON, **no se edita a mano**)
- `~/src/digital-ocean-dropplet-auto-launching/results/README.md` (cómo se lee una fila, y por qué
  dos filas sólo se comparan si coinciden en el dataset)
