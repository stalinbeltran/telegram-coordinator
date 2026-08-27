# Cierre de parámetros: acotar `overlap_fovea_px` y medir lo que nunca se midió

| campo | valor |
|---|---|
| **Qué era** | Cerrar `overlap_fovea_px` por arriba y con significación, tantear los **nueve** ejes nunca barridos, y rematar los tres cierres pendientes (`border_px` al 5 %, fase 2 de la plana) |
| **Lanzado con** | `estudio_cierre.py --dataset dirty1000-80px-16px-r20260826` → `estudio_flota.py` con los 14 recorridos, `--cpu E5-26 --sin-cpu v2 --max-price 0.12 --criba 2 --horas-max 6 --git` |
| **Criterio** | [`foveal-vision/docs/plan-cierre-2026-08-26.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-cierre-2026-08-26.md), escrito **antes** de mirar |
| **Inicio** (UTC) | 2026-08-26 22:13:08 (`repro-chk`) · el barrido grande, 22:28:57 |
| **Fin** (UTC) | 2026-08-27 18:05 *(parado a mano con 22 runs pendientes)* |
| **Duración** | 19 h 52 min de reloj, en **4 flotas** (una previa + tres del barrido) |
| **Instancias** | **≥160 alquiladas** (4 + 99 + 36 + ≥21). Las de la última flota no están todas contadas: ver «coste» |
| **Coste real** | **≥9,9367 $** — 0,0164 + 5,6289 + 2,1510 registrados, **+ ≥2,1404 de la última flota, que NO quedó registrado** |
| **Dataset** | ⚠ **`dirty1000-80px-16px-r20260826`**, y ése es el titular — ver abajo |
| **Estado** | ⚠ **Incompleto: 190/212 runs.** Los tres bloques declaran; faltan 22 runs que firman números sin cambiar veredictos |

---

## 0. El titular no es un parámetro: **el dataset de los estudios ya no se puede reconstruir**

La máquina se rehízo y `data/` se perdió entera (ni `.venv`, ni el `windows.npz`, ni un solo
`best.pt` de los 630 runs). Reconstruir el dato es un procedimiento escrito y **funcionó**: los mil
renders salen del generador con los specs congelados, y `bench-dirty1000-16` —el dataset del
benchmark, stride 8— **reproduce su huella de git exactamente** (`sha256:6268a2f5…`). O sea que la
fuente es la buena.

Pero **el dataset de los estudios, stride 5, no reproduce**:

| | git (`r20260824`) | reconstruido hoy |
|---|---|---|
| `sha256` del `.npz` | `3df67624…` | **`ac875e22…`** |
| `num_windows` | 140.000 | 140.000 ✅ |
| `windows_per_split` | 84.000 / 28.000 / 28.000 | idem ✅ |
| `positives_per_corner` | 17.043 · 17.564 · 19.198 · 18.575 | idem ✅ |
| `split.json` | — | **idéntico byte a byte** ✅ |

**Todo coincide menos la huella.** Y eso admite dos explicaciones que llevan a decisiones opuestas
—misma información con otra compresión, u otra información— que la huella **no distingue**.

### Por qué no se podía dejar así

Tres de los recorridos planeados (`ov-sig`, `bp-sig`, `pl-f2-*`) estaban diseñados para **sumar
semillas a runs que ya existían**, que es la forma barata de llegar a 10 contra 10. Si el dato no
es el mismo, esos tres comparan medidas de dos datasets distintos **y no dan ningún síntoma**: el
`p` sale igual de creíble.

### Cómo se decidió: entrenando, no mirando la huella

⚠ **El contraste local no valía**: aquí la época 1 dio `train_loss` 0,4923 contra 0,4850, pero
divergencia de CPU y divergencia de dato **se confunden** (medido en este proyecto: cruzar de
familia mueve el f1 hasta 0,0457). Un número con dos causas posibles no decide nada.

Así que se midió con todo lo demás igualado — `repro-chk`: **el mismo punto** (`overlap` = 2), **la
misma semilla** (2), **la misma familia de CPU** (E5-2630 v4 contra el E5-2683 v4 del original, los
dos E5-26xx v4, donde está medido que el entrenamiento sale **idéntico bit a bit**) y **los mismos
8 hilos** de torch. 3 épocas, `patience` = 0, **0,0164 $**:

| época 1 | `repro-chk` (dato de hoy) | `ov-fov-0011` (dato `r20260824`) | Δ |
|---|---:|---:|---:|
| `train_loss` | 0,4462163726167322 | 0,4484938883624737 | −2,28·10⁻³ |
| `val_loss` | 0,2742790627208623 | 0,31479289938103067 | −4,05·10⁻² |
| `val_f1` | 0,7813885915277565 | 0,6786845310596833 | **+1,03·10⁻¹** |
| `pos_err_px` | 2,398193359375 | 2,409182548522949 | −1,10·10⁻² |

**Lo que cierra la pregunta es el `train_loss` de la época 1**: con la misma inicialización y el
mismo orden de ejemplos —los dos los fija la semilla—, en una familia donde el entrenamiento es bit
a bit idéntico, la primera época **no tiene de dónde sacar una diferencia** que no venga del dato.
Las tres épocas van además en la misma dirección: **el dato de hoy es más fácil**.

**Es otro dataset.** Se le pone nombre nuevo, `dirty1000-80px-16px-r20260826`, que es la convención
que este repo ya usó dos veces (`r20260823` → `r20260824`). El `r20260824` **no se pisa**.

### La causa es reincidente, y esta vez es más silenciosa

La CDN de Playwright devuelve **403 desde este proveedor** («this service is not available in your
location»). El 24-ago se resolvió rasterizando con `google-chrome-stable`; hoy, trayendo el
Chromium que Playwright fija **desde otra CDN** (`registry.npmmirror.com`). Otro binario, otros
píxeles.

⚠ **La diferencia del 24-ago movió los `positives_per_corner` y por eso se vio comparando
manifests. Ésta no mueve ni un campo del manifest.** Sólo la huella. Indexado por la acción que lo
dispara, no por la víctima: **al reconstruir un dataset, comparar la huella no es opcional — y si
no coincide, que los resúmenes sí coincidan NO absuelve.** Hay que entrenar un punto conocido y
comparar la curva.

### Lo que se llevó por delante

| | plan inicial | lo que se corrió |
|---|---|---|
| solape | `ov-alto` {5,6,7}×5 + `ov-sig` {2,4}×semillas 6–10 | **`ov-r26`**: el eje **entero** {0,1,2,4,5,6,7}×5 (35 runs) + **`ov-sig26`** {2,4}×6–10 (10) |
| `border_px` | `bp-sig`: 5 semillas sumadas a `borde-ancho` | **`bp-r26`**: {4,8} × **10 semillas propias** (20) |
| plana | `pl-f2-*`: 3 semillas sumadas al tanteo | **5 semillas propias** (15 + 15); del tanteo se hereda **la red**, no los números |
| bloque B (tanteos) | 9 recorridos | **sin cambios**: son auto-contenidos |

**105 runs → 147.** El sobrecoste de haberlo comprobado: 0,0164 $. El de no haberlo comprobado
habría sido un inventario de parámetros con tres casillas falsas y ningún síntoma.

---

## 1. Qué se midió

**212 runs declarados en 22 recorridos, 190 medidos**, todos sobre `r20260826`. Cuatro bloques,
con el criterio escrito antes en [`plan-cierre-2026-08-26.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-cierre-2026-08-26.md):

| bloque | qué | runs |
|---|---|---:|
| **0** | `repro-chk` — ¿reproduce el dato? (la comprobación previa) | 2 |
| **A** | `overlap_fovea_px`: el eje entero {0,1,2,4,5,6,7} + el ganador a 10 semillas | 50 |
| **B** | tanteo de **9 ejes nunca barridos** (2 semillas: acota, no declara) | 52 |
| **C** | `border_px` a 10 contra 10 · fase 2 de la plana | 50 |
| **D** | verificación a 5 semillas de los **7 tanteos que ascendieron** | 60 |

## 2. Hallazgos

### 2.1 `overlap_fovea_px`: el vigente pasa de 2 a **7**

El eje sube **monótono** en todo su rango legal, con las 5 semillas en los siete puntos:

| valor | 0 | 1 | **2** *(vigente)* | 4 | 5 | 6 | **7** |
|---|---:|---:|---:|---:|---:|---:|---:|
| f1 | 0,9236 | 0,9278 | **0,9332** | 0,9375 | 0,9400 | 0,9415 | **0,9433** |
| `p` vs vigente | **0,048** | 0,198 | — | 0,294 | 0,079 | 0,063 | **0,008** |

Y el contraste decisivo, con **10 semillas contra 8**: `7` → 0,9428 contra `2` → 0,9304,
**`p` < 0,001**, Δ = +0,0124 muy por encima de δ = 0,0009.

**Es aplicable sin pagar nada: 167.852 parámetros en todo el rango** (medido contando parámetros
en los ocho valores legales), y el s/época no ordena con el eje (34,6–40,4 s, sin patrón).

⚠ **Pero el eje NO queda acotado por evidencia, sino por la GEOMETRÍA.** 7 es el máximo que
`overlap_fovea_range(16)` admite: con 7, la rama del borde ya ve 14 de los 16 px de fóvea. Que el
óptimo caiga **justo en la pared** es un resultado en sí: sugiere que quien limita es el **tamaño
de fóvea**, y ése no es barrible sin regenerar el dataset (contrato ①a).

⚠ Y **contradice lo que decía el dato viejo**: el [#13] medía 4 → 0,9372 con `p` = 0,270 y no
declaraba.

### 2.2 `border_px`: el vigente pasa de 4 a **8**, y encima es más barato

La `p` = 0,063 que se había medido **dos veces** queda resuelta al llevar los dos puntos a **10
semillas cada uno**:

| `border_px` | f1 | semillas | s/época | `p` |
|---|---:|---:|---:|---|
| **8** | **0,9398** | 10 | **46,0** | **0,006** |
| 4 *(vigente)* | 0,9302 | 10 | 61,3 | — |

Δ = +0,0096 contra δ = 0,0019. Es exactamente lo que el informe pedía —*más semillas en esos dos
puntos, no un rango más ancho*— y confirma que el anillo atado mantiene el coste: **8 px sale
1,33× más rápido por época que 4**.

### 2.3 La plana, fase 2: ninguno de los dos tanteos sobrevive

| eje | tanteo (2 semillas) | fase 2 (5 semillas) |
|---|---|---|
| `batch_size` | 170 ganaba | 170 → 0,9604 contra 85 → 0,9594, **`p` = 0,770**: el vigente se queda |
| `n_layers` | 5 ganaba | 5 → 0,9635, **`p` = 0,317**: no declara |

⚠ **Y L6 colapsó en 4 de sus 5 semillas** (f1 = 0,0000). Su media (0,1933) **no debe citarse**: es
el promedio de una moneda. El tanteo vio 1 colapso de 2; con 5 semillas se ve que es **la norma,
no la excepción**.

### 2.4 Los nueve ejes nunca medidos: **ninguno mueve el vigente**

Tanteo (2 semillas) → los 7 que ascendieron, verificados a 5:

| eje | veredicto | nota |
|---|---|---|
| `weight_decay` | **gana el vigente `0.0`** | subirlo **hunde** (0,001 → 0,8731). Era la prioridad «10 ter» y **la regularización no es la respuesta** a la brecha val/train de +28 % |
| `lambda_pos` | vigente (20/20) | plano entre 0,5 y 2; el 4 hace daño |
| `smooth_l1_beta` | vigente (`p` = 1,000) | el tanteo lo daba ganando por >1 SE; con 3 semillas queda en Δ = +0,0005 |
| `patience` | vigente | el 5 pierde 0,0105: **confirma el mínimo seguro de 8** |
| `merge` | vigente (`p` = 0,743) | ⚠ `sum` **empata con 0,54× de parámetros** (91.052 contra 167.852). No gana, pero que empate es la noticia |
| `pool_mode` | **gana el vigente `avg`** (10/10) | `max` pierde 0,023 |
| `overlap_border_px` | vigente (`p` = 0,314) | con 1 semilla daba **+0,0158**; con 4, +0,0055 |
| `optimizer` | **tanteado, sin señal** | y `adam ≡ adamw` con `weight_decay` = 0: **el control salió bien** |
| `pad_mode` | **tanteado, sin señal** | amplitud 0,0045 |

**Que las dos promesas del tanteo se desinflen al añadir semillas** (`smooth_l1_beta` y
`overlap_border_px`) es el protocolo funcionando: por eso un tanteo acota y no declara.

### 2.5 Tres ejes **no son barribles** con la geometría vigente

No es que salieran mal: **no tienen más de un valor legal**, comprobado con `build_search_space`:

| eje | rango legal | por qué |
|---|---|---|
| `k_periph` | **[3]** | la banda periférica son 4 px (`border_cells` + `overlap`) y un kernel debe caber en ~la mitad |
| `s_center` | **[1]** | `2⁴` ya rompe el tope de `región/4` con 4 capas |
| `s_periph` | **[1]** | ídem sobre una banda de 4 |

Serían barribles con el borde ancho (con `border_px` = 16 la banda llega a 10 y `k_periph` admite
[3, 5]) — o sea que **el cambio de `border_px` a 8 de §2.2 los acerca**.

Y otros cuatro quedan fuera por razones distintas: `epochs` (**medido**: de los 630 runs con
curvas, la época más alta es 130 y **ninguno** llegó a 150, así que subir el tope daría runs
idénticos), `momentum` (inerte con `adam`), `dropout` (**está en la documentación y no en el
código**) y `fovea_px` (la fija el dataset).

## 3. Lo que quedó pendiente

1. **22 runs de 212**, en 6 recorridos: `sb-v` (6), `wd-v` (5), `ov-sig26` (4), `pat-v` (3),
   `mrg-v` (2), `ovb-v` (2). **Los tres bloques ya declaran sin ellos**; firmarían números.
   `ov-sig26` además quedó **obsoleto**: medía 4-contra-2 y el ganador resultó ser el 7.
2. **La flota se paró a mano**, así que su `flota.json` no se escribió y **el coste de ese tramo
   no está registrado** — sólo el suelo de 2,1404 $ que el log alcanzó a anotar. Es exactamente la
   trampa que este README documenta.
3. **Los vigentes nuevos no están aplicados.** `overlap_fovea_px` = 7 y `border_px` = 8 los fija la
   configuración del repo que entrena, y esto sólo lo mide.
4. **Ningún eje ha pasado por la métrica de tarea (R5).** Todo es f1 de ventana.
5. **La pregunta del proyecto sigue sin contestar**: la fase 2 de la plana ya está, pero la
   comparación foveada-contra-plana por métrica de tarea no se ha hecho.
6. **El confound de `border_reduce`** sigue abierto.

## 4. De dónde salen los números

- **Los veredictos**: `scripts/cierre_veredicto.py`, que no inventa criterio — reusa
  `sweep_trials`, `es_medida`, `aggregate_seeds`, `tie_delta` y `permutation_test` del propio
  proyecto, y combina recorridos **sólo tras comprobar** que comparten dataset, red base, receta,
  tope de épocas y objetivo.
- **El criterio**, escrito antes de mirar:
  [`docs/plan-cierre-2026-08-26.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-cierre-2026-08-26.md).
- **El dato crudo**: `sweeps/<recorrido>/` y `runs/` en `foveal-vision`
  (⚠ y su copia en [`foveal-vision-data`](https://github.com/stalinbeltran/foveal-vision-data)).
- **El coste y el reloj**: los `flota.json` de las tres flotas — **menos la última**, que no llegó
  a escribirlo.

⚠ **`flota.json` guarda el total de TODA la flota en la copia de cada recorrido**: sumarlos por
recorrido multiplica el coste por el número de recorridos de esa flota. Aquí están deduplicados
por `(cuando, usd, máquinas)`.

