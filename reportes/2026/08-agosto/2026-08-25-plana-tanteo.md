# `pl-t-lr` + `pl-t-bs` — tanteo de la red plana (fase 1)

| | |
|---|---|
| **Qué era** | fase 1 (tanteo) de los parámetros óptimos **de la red plana**: rangos anchos, 2 semillas, sólo para **acotar** |
| **Lanzado con** | `estudio_flota.py --sweep pl-t-lr --sweep pl-t-bs --cpu E5-26 --reparto run --git` (ejecutor `estudio`) |
| **Proveedor** | Vast.ai |
| **Inicio** | **2026-08-25 03:01:05 UTC** (primera línea de `/tmp/plana-tanteo.log`) |
| **Fin** | **2026-08-25 04:35:58 UTC** |
| **Duración** | **94,9 min** (1 h 35 min) |
| **Instancias** | **25 alquiladas** para 20 lotes |
| **Coste real** | **1,026 $** (estimado antes: 0,96–1,22 $ → **dentro de la banda**) |
| **Dataset** | `dirty1000-80px-16px-r20260824` |
| **Estado** | ⚠ **incompleto: 13/20 lotes.** `pl-t-lr` 10/10; **`pl-t-bs` 3/10** |

## ⚠ Por qué está incompleto

Los 7 lotes de `pl-t-bs` que faltan (`p3`…`p9`) fallaron todos con el mismo mensaje:

```
no quedan maquinas distintas libres; sube --repuestos o afloja las condiciones
```

Es **el mismo modo de fallo que se llevó `d5-L4` en la pasada 1** del estudio de tres ejes: con
`--reparto run` y `--cpu E5-26`, pedir 20 máquinas *distintas* de una sola familia de CPU agota el
pozo de ofertas. Relanzar continúa por donde iba: salta los `done` y reparte sólo lo que falte.

**`pl-t-nl` no entró en esta flota, y eso no es un fallo**: el plan lo excluye del tanteo a
propósito, porque en `n_layers` no hay nada que acotar — el rango natural es discreto y pequeño, y
el estudio foveado ya lo dejó cerrado en `[2..5]`.

## Qué puede decir un tanteo (y qué no)

⚠ **Con 2 semillas la permutación exacta da 2 arreglos: el tanteo NO puede declarar ningún ganador,
y no lo intenta.** Lo que sí distingue —y basta para acotar— es una zona donde el entrenamiento
converge de otra donde diverge o se arrastra. Las medias de abajo son **parciales y no deciden
nada**; así las etiqueta la propia herramienta del proyecto.

### `pl-t-lr` — 10/10 runs

| `lr` | f1 (media de 2) | ± |
|---:|---:|---:|
| 0,00035 | 0,9633 | 0,0009 |
| **0,0007** | **0,9649** | 0,0008 |
| 0,0014 *(óptimo de la foveada, ancla)* | 0,9615 | 0,0012 |
| 0,0028 | **0,4721** | **0,4721** |
| 0,0056 | 0,8858 | 0,0085 |

### `pl-t-bs` — 3/10 runs

| `batch_size` | f1 | ± | n |
|---:|---:|---:|---:|
| 43 | 0,9595 | — | 1 |
| **85** | 0,9626 | 0,0036 | 2 |
| 170 · 24 · 340 | — | — | **0 (no corrieron)** |

## Hallazgos

- **La zona útil de `lr` en la plana queda acotada: 0,00035–0,0014.** Los tres valores bajos quedan
  dentro de ~0,004 entre sí (0,9615–0,9649); a partir de 0,0028 el entrenamiento deja de ser
  fiable, y en 0,0056 pierde ~0,08 de f1 de forma consistente en las dos semillas.
- ⚠ **Y el dato más informativo del tanteo es un colapso, no una media:** en `lr = 0,0028`, **una
  de las dos semillas terminó con f1 = 0,0000** mientras la otra dio 0,9442. Por eso la media sale
  0,4721 con un ± idéntico. Eso **no es «0,0028 es peor»**: es que a ese `lr` el entrenamiento
  **puede colapsar entero**, y una sola semilla no lo habría visto. Es exactamente el borde que un
  tanteo existe para encontrar.
- **El ancla se comporta como ancla.** 0,0014 —el óptimo de la red foveada— cae dentro de la zona
  buena de la plana pero **no es el mejor de ella** (0,0007 queda por encima, dentro del ruido).
  Confirma la premisa del plan: **un óptimo no se hereda al cambiar de arquitectura**, y suponerlo
  habría sido suponer la respuesta.
- **`batch_size` no se puede acotar con lo que hay.** Los dos únicos valores con dato (43 y 85) son
  vecinos y están dentro del ruido. Los extremos del rango —24, 170, 340— son precisamente los que
  no corrieron.

## Lo que quedó pendiente

1. **Relanzar `pl-t-bs`** para sus 7 runs (con `--repuestos` más alto o aflojando `--cpu`). Sin
   ellos el eje `batch_size` de la plana sigue sin acotar y la fase 2 no tiene rango que elegir.
2. **La fase 2** (5 semillas sobre los rangos acotados, reparto por semilla) no se ha lanzado.
3. ⚠ **Revisar el colapso de `lr = 0,0028` antes de fijar el rango de la fase 2**: si el borde de
   inestabilidad está ahí, el rango final no debería acercarse.

## Fuente de verdad

- `~/src/foveal-vision/sweeps/{pl-t-lr,pl-t-bs}/flota.json` — coste, reloj, máquinas
- `~/src/foveal-vision/runs/` (el libro de a bordo, commiteado en cada sonda). Para releerlo:
  `/use estudio-progreso` → `--sweep pl-t-lr --sweep pl-t-bs --sweep pl-t-nl --tabla`
- `/tmp/plana-tanteo.log` ⚠ **`/tmp` no sobrevive a rehacer la máquina**
- [`foveal-vision/docs/plan-cnn-plana.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-cnn-plana.md)
  §6 — el criterio, escrito antes
