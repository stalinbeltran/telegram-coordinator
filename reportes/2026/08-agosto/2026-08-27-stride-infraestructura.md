# Barrido del `stride` de extracción: infraestructura y validación en Vast

| campo | valor |
|---|---|
| **Qué era** | Montar el barrido que mide la **calidad de predicción** frente a la densidad de la rejilla de muestreo (stride de extracción, 1 → 16 px), y probar la cadena entera sobre máquinas de verdad **antes** de gastar en las 25 que pide el estudio |
| **Lanzado con** | `estudio_stride.py` (datasets + recorridos, no gasta) → `estudio_flota.py --sweep stride-h01 --sweep stride-h16 --criba 0 --git --horas-max 1 --prefijo st- --yes`, en tres corridas |
| **Criterio** | [`foveal-vision/docs/plan-stride-2026-08-27.md`](https://github.com/stalinbeltran/foveal-vision/blob/estudio-stride/docs/plan-stride-2026-08-27.md) §3, escrito **antes** de mirar. Mecanismo en [`docs/barrido-stride.md`](https://github.com/stalinbeltran/foveal-vision/blob/estudio-stride/docs/barrido-stride.md) |
| **Inicio** (UTC) | 2026-08-27 **02:29:43** *(leído del log, no derivado)* |
| **Fin** (UTC) | 2026-08-27 **10:40:32** |
| **Duración** | **37,1 min de reloj de flota** repartidos en 3 corridas (12,8 + 14,3 + 10,0); entre la 2ª y la 3ª pasaron 7,5 h de parón, no de trabajo |
| **Instancias** | **9 alquiladas** (4 + 3 + 2). De ellas **2 entrenaron hasta el final**; las otras 7 facturaron sin producir |
| **Coste real** | **0,0383 $** (0,0180 + 0,0120 + 0,0083) |
| **Dataset** | `dirty1000-80px-16px-st01` y `-st16`, extraídos de `local/dirty-1000-80px` con `window_size` 16, `eval_stride` 5 y `seed` de split 1 |
| **Estado** | **La infraestructura, terminada y probada. El estudio, sin correr.** 2/2 brazos de la validación en verde; 0 de los 25 runs del estudio |
| **Rama** | `estudio-stride` en `foveal-vision` (13 commits, 227 tests) — **sin fusionar a `main`** |

---

## 1. Qué se midió, y por qué no es el estudio

Esto **no** contesta si un stride es mejor que otro. Son 3 épocas y 1 semilla por brazo: el propio
informe se niega a leer nada de ahí (§3). Lo que se midió es si **la máquina hace lo que el
documento dice que hace**.

El estudio de verdad son 5 brazos × 5 semillas = 25 runs, y su criterio está escrito antes de
mirar en el plan §3.

### El problema que el barrido tuvo que resolver primero

Un barrido de stride hecho de la manera natural **mide otra cosa**, y la tabla sale igual de
creíble. Dos veces:

1. **El examen se movía con el eje.** `extract_windows` cortaba val y test con el mismo stride que
   train, así que el brazo de stride 1 se examinaba de 2925 ventanas por imagen y el de 16 de 20.
   Comparar esos dos f1 es comparar dos exámenes distintos. → `eval_stride` **fijo** (5), la misma
   rejilla de producción, así que además los números quedan comparables con todo lo ya medido.
2. **El presupuesto también.** Hay **146,2×** más ventanas de train a stride 1 que a stride 16. A
   épocas iguales, la tabla mediría el presupuesto. → `windows_per_epoch` = **84.000** en todos los
   brazos: los mismos pasos de gradiente por época que todo estudio anterior de este proyecto.

La fuga train/test **no** hubo que arreglarla: el split ya era por imagen. Lo que había que hacer
era no romperla al abaratar el eval.

## 2. Lo que quedó demostrado en producción

Los dos brazos extremos entrenaron en Vast, y con eso quedan comprobadas en máquina —no en local—
las cinco piezas nuevas:

| # | Qué | Evidencia |
|---|---|---|
| 1 | El payload lleva **varios datasets** en una sola flota | tar de **6,7 MB** con `…-st01` y `…-st16` dentro. Antes la flota moría con «lanza una flota por dataset» |
| 2 | Cada recorrido entrena con **el suyo** | el `config.json` que devolvió cada máquina declara su `window_dataset` con **huellas distintas**: `sha256:5b7a7737…` (st16) y `sha256:3bd24e6c…` (st01) |
| 3 | El **presupuesto igualado** viaja | los dos traen `windows_per_epoch: 84000`. El brazo de stride 16 recorrió su pool de 12.000 **7 veces por época**; el de stride 1 sacó 84.000 frescas de 1.755.000 |
| 4 | La **rejilla de eval fija** funciona | 28.000 ventanas de val en los dos, idénticas |
| 5 | Los runs son runs normales | ver la tabla de abajo |

| brazo | dataset | ventanas de train | f1 por época | `val_loss` final | s/época |
|---|---|---:|---|---:|---:|
| `stride-h16` | `…-st16` | 12.000 | 0,7054 → 0,8093 → **0,8724** | 0,1872 | **39,41** |
| `stride-h01` | `…-st01` | 1.755.000 | 0,6037 → 0,7494 → **0,8038** | 0,2261 | **33,91** |

⚠ **Esas dos columnas de f1 NO son un adelanto del resultado.** Con 3 épocas, el brazo de stride 16
ha vuelto a ver su pool de 12.000 ventanas **21 veces**, y el de stride 1 ha visto 252.000 ventanas
distintas **una vez cada una**. Al principio del entrenamiento la repetición converge antes; eso no
dice nada sobre dónde acaban a 150 épocas, que es lo que el estudio pregunta.

### El control de coste (R4), que es el que valida el diseño

Las dos corridas buenas cayeron —por casualidad— en la **misma máquina física** (`33176`, Xeon
E5-2680 v4). Con el presupuesto igualado, dos brazos cuyos pools se llevan **146,2×** midieron
**39,41 y 33,91 s/época**: ±7,5 % sobre la mediana, dentro del 15 % que R4 exige.

Sin igualar el presupuesto, el brazo de stride 1 habría hecho **20,9×** más trabajo por época
—unos 700 s en vez de 34— y la tabla habría medido eso.

## 3. Hallazgos: seis fallos, ninguno buscado

Cuatro sólo se ven con la flota delante; dos, leyendo el código con **dos estudios vivos en la
misma cuenta**.

| # | Qué | Por qué importa |
|---|---|---|
| 1 | **La rama de «sobrantes» del vigilante destruía TODA instancia `estudio-*`** al terminar sus recorridos, incluidas las que `juzgar()` acababa de declarar ajenas | Al acabar un estudio, su vigilante **mata las máquinas del otro**. El síntoma serían runs cortados a media época, sin error propio, **indistinguibles de una máquina que se muere sola** |
| 2 | **La etiqueta `estudio-` estaba cableada** en `V.alquilar` | Dos estudios a la vez comparten espacio de nombres en la cuenta. Ahora es `--prefijo`, y lo heredan los relanzamientos |
| 3 | **`flota_viva()` preguntaba por CUALQUIER flota** | Con la flota de otro estudio viva —lo que había—, este vigilante no habría relanzado **nunca**: un estudio que parece vigilado y no avanza |
| 4 | **La sonda proyectaba s/época desde el POOL, no desde la época** | Anunció «~392 s/época» para un brazo que midió 39,4: **20,9× de más**. La criba **no** se equivocaba (ordena por ms/paso), pero el log sí |
| 5 | **El informe se contradecía con un solo brazo**: decía a la vez «la densidad no compra nada» y «el eje no queda cerrado por arriba» | Y es el caso **normal**: es lo que sale al mirar mientras la flota corre |
| 6 | **El informe moría después de darlo**: `relative_to` lanza si el `--json` cae fuera del repo, y estaba en la última línea | Informe entero y código de salida 1: quien llama descarta un resultado bueno |

Los seis van arreglados con test. El #1 es el que habría costado dinero ajeno: cuando se encontró
había **8 máquinas de otro estudio vivas** a 0,5159 $/h.

## 4. Lo que quedó pendiente

- **El estudio, entero.** 25 runs (5 brazos × 5 semillas), estimados en **1,12–1,53 $** por el
  propio `estudio_estimar.py` y en ~1,35 $ por el $/run medido el 25-ago. Los cinco datasets y los
  cinco recorridos ya están creados; falta lanzar la flota.
- **La rama sin fusionar.** `estudio-stride` está empujada pero **no está en `main`**, y un clon
  limpio saca `main`: mientras siga así, para la máquina siguiente esto no existe.
- **Los `windows.npz` no están en git** (sí sus `manifest.json` y `split.json`). En una máquina
  nueva hay que reconstruir la fuente —`scripts/bench_dataset.py build`, ~15-20 min— y volver a
  extraer. `estudio_stride.py` lo comprueba antes de nada y dice el comando.
- **7 de 9 máquinas no produjeron nada.** Seis se alquilaron y **nunca aceptaron la clave SSH**
  (4 min de espera cada una, rc=255) — indisponibilidad de Vast, no código. Con `--cpu E5-26` el
  catálogo se quedaba en 12 ofertas; la corrida que funcionó soltó esa restricción, legítimo para
  una prueba de humo porque no compara nada entre máquinas.

## 5. De dónde salen los números

| dato | fuente |
|---|---|
| Inicio, fin, instancias, coste | `/tmp/stride-humo{,2,3}.log` **leídos del log, no derivados**, y `sweeps/stride-h*/flota.json` (que ya distingue `maquinas` de `maquinas_alquiladas`) |
| f1, `val_loss`, s/época | `runs/stride-h*/metrics.jsonl` y `summary.json`, commiteados por el libro de a bordo desde la propia máquina |
| Dataset de cada run y su huella | `runs/stride-h*/config.json` |
| 146,2× y los conteos por brazo | calculados con `fv.windows.extract._positions`, y la aritmética **reproduce el manifest real** de `dirty1000-80px-16px-r20260826` (140.000 / 84.000) |
| Estimación de las 25 máquinas | `estudio_flota.py --dry-run` del 2026-08-27 02:26 UTC |

⚠ `/tmp` no sobrevive a rehacer la máquina. Lo que había que conservar de esos logs está aquí.

**Reporte hermano, con el detalle de la validación**:
[`foveal-vision/reportes/2026/08-agosto/2026-08-27-stride-validacion.md`](https://github.com/stalinbeltran/foveal-vision/blob/estudio-stride/reportes/2026/08-agosto/2026-08-27-stride-validacion.md).
