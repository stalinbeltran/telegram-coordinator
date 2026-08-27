# Barrido del `stride` de extracción: la rejilla más densa predice mejor, y no satura

| campo | valor |
|---|---|
| **Qué era** | Medir la **calidad de predicción** de la red foveada frente a la densidad de la rejilla de muestreo: stride de extracción **1 · 2 · 4 · 8 · 16 px**, 5 semillas cada uno |
| **Lanzado con** | `estudio_flota.py --sweep stride-01 … --sweep stride-16 --cpu E5-26 --criba 2 --git --horas-max 6 --prefijo st-`, y una segunda flota de recuperación para los 14 puntos que se quedaron sin máquina |
| **Criterio** | [`foveal-vision/docs/plan-stride-2026-08-27.md`](https://github.com/stalinbeltran/foveal-vision/blob/estudio-stride/docs/plan-stride-2026-08-27.md) §3 (R1–R4), escrito **antes** de mirar |
| **Inicio** (UTC) | 2026-08-27 **12:55:06** *(leído del log)* |
| **Fin** (UTC) | 2026-08-27 **17:11:55** |
| **Duración** | **161,7 min de reloj de flota** (97,4 + 64,3); entre las dos hubo 1,6 h de parón que no fue trabajo (ver §5) |
| **Instancias** | **97 alquiladas** (76 + 21) para **39 lotes** entregados. 25 runs útiles |
| **Coste real** | **1,6801 $** (1,1989 + 0,4812) |
| **Dataset** | `dirty1000-80px-16px-st{01,02,04,08,16}`, los cinco desde `local/dirty-1000-80px`, ventana 16, `eval_stride` **5** y `seed` de split **1** |
| **Estado** | **Terminado: 25/25 runs, 1191 épocas.** Los cinco brazos con sus 5 semillas |

---

## 1. El resultado

Objetivo **f1 de ventana** (proxy), sobre una rejilla de evaluación **fija e idéntica** en los cinco
brazos (28.000 ventanas de val).

| stride | f1 (media de 5) | banda min–max | SEM | épocas hasta la meseta |
|---:|---:|---|---:|---:|
| **1** | **0,9383** | 0,9283–0,9430 | 0,0026 | 68,0 |
| 2 | 0,9328 | 0,9208–0,9442 | 0,0042 | 68,0 |
| 4 | 0,9277 | 0,9195–0,9381 | 0,0037 | 55,4 |
| 8 | 0,9159 | 0,9078–0,9281 | 0,0035 | 29,8 |
| 16 | 0,8901 | 0,8747–0,8990 | 0,0045 | 17,0 |

**δ = 0,0026** (regla de 1 SE sobre las 5 semillas del mejor punto).

- **R1 · Saturación.** El mejor brazo es **stride 1**, y dentro de δ **no queda ningún otro**. O sea
  que **no hay punto de saturación dentro del rango**: la frase correcta es **«gana el extremo»**, no
  «satura en 1». El eje **no queda cerrado por arriba** — con ventana de 16 px no se puede mirar más
  denso que 1 px.
- **R2 · Significación.** stride 1 contra stride 16: diferencia **0,0482**, **`p` = 0,00794**
  (5 vs 5, exacto sobre 252 reordenaciones). → **la densidad de la rejilla mueve la calidad de
  predicción.**
- **R3 · Monotonía.** Sin rupturas mayores que δ: el f1 **no empeora** al hacer la rejilla más densa,
  en ninguno de los cuatro tramos.
- **R4 · Control de presupuesto.** ✅ Los 25 runs hicieron **989 pasos de gradiente por época**, el
  mismo número, leído del `config.json` que devolvió cada máquina. ⚠ Este control **falló como estaba
  escrito** y hubo que arreglarlo antes de declarar: ver §3.

### El hallazgo secundario, que es medio resultado

**Las épocas hasta la meseta caen monótonas con la densidad: 68 · 68 · 55 · 30 · 17.** Los 25 runs
pararon por `patience` y **ninguno tocó el tope de 150**, así que ningún brazo se quedó sin entrenar
por presupuesto: el que hizo menos épocas es el que **dejó de mejorar antes**.

Eso responde a la objeción obvia —«stride 1 ganó porque entrenó cuatro veces más»—: no se le dio más,
se le paró con la misma regla y siguió mejorando más tiempo. Con menos posiciones distintas, el
modelo agota lo que puede aprender antes.

## 2. Lo que este número NO dice

- **No es la métrica de tarea.** Es f1 de **ventana**, el proxy. Está medido en este proyecto que el
  proxy **exagera** (en `n_layers` la ganancia real fue la mitad). Ningún eje ha pasado por la
  métrica de tarea.
- **No dice que haya que reextraer a stride 1.** Dice cuánto se pierde por no hacerlo: **−0,0482**
  de f1 entre 16 y 1, y **−0,0106** entre 5 (la rejilla de producción) y 1 por interpolación entre
  los brazos 4 y 8 — *no medido, el 5 no es un brazo*. El coste de stride 1 es 146,2× más ventanas
  de train, y a presupuesto igualado eso no cuesta más reloj por época, pero sí más disco y más
  extracción.
- **No cierra el eje por arriba.** Gana el extremo del rango legal.

## 3. R4 falló como estaba escrito, y por qué se declara igual

El criterio decía: *«si `seconds_per_epoch` se desvía más del 15 % entre brazos, el igualado de
presupuesto ha fallado y el estudio no declara nada hasta explicarlo»*. **Se desvió**: stride 1 a
35,6 s/época (−23 %), stride 8 a 37,6 (−19 %), stride 16 a 54,5 (+18 %).

Investigado antes de declarar nada, el control estaba midiendo el **proxy equivocado**, porque cada
run corre en una **máquina alquilada distinta**:

| dispersión de `s/época` | cociente max/min |
|---|---:|
| **DENTRO** de un mismo brazo (misma config, 5 máquinas) | **2,50** (stride-16: 37,2 → 93,0) |
| **ENTRE** brazos (las medias) | **1,53** |
| entre las 25 máquinas | 2,76 (33,8 → 93,0) |

El ruido dentro de un brazo es **mayor** que la separación entre brazos: ese número no puede estar
midiendo el eje. Y la criba de velocidad, que existe justo para recortarlo, **no pudo hacer su
trabajo** en la primera flota — sólo 8 máquinas llegaron a la cohorte para 25 plazas
(`descartadas: []`), así que entraron máquinas lentas.

Lo que R4 quería saber se lee **exacto** del `config.json` que devolvió cada máquina:
`ceil(windows_per_epoch / batch_size)` = **989 pasos en los 25 runs**. El presupuesto sí estaba
igualado; lo que fallaba era el control. Arreglado en el código y con test: R4 cuenta pasos, y
`s/época` queda como *información* con su dispersión intra-brazo al lado.

⚠ **Un control que da falsa alarma se acaba ignorando**, y entonces no hay control. Por eso se
arregla en vez de anotarse como excepción.

## 4. Coste, y por qué 97 máquinas para 25 runs

| flota | ventana (UTC) | reloj | alquiladas | lotes | coste |
|---|---|---:|---:|---:|---:|
| 1 — los 5 brazos | 12:55:06 → 14:32:39 | 97,4 min | **76** | 11/25 | **1,1989 $** |
| 2 — recuperación (04, 08, 16) | 16:07:28 → 17:11:55 | 64,3 min | **21** | 14/14 | **0,4812 $** |
| | | **161,7 min** | **97** | **25/25** | **1,6801 $** |

La estimación previa era 1,12–1,53 $ (central 1,21). El real cae **un 39 % por encima del central**,
y la razón está en la primera flota: **65 de sus 76 máquinas no llegaron a entrenar** (0,4728 $
tirados) porque se alquilan y no aceptan la clave SSH. Con `--cpu E5-26` el catálogo se quedaba en
~30 ofertas útiles, así que el pozo se agotó y 14 lotes murieron con *«no quedan máquinas distintas
libres»*.

La segunda flota, con `--criba 0 --repuestos 15`, entregó **14/14 con 21 máquinas**: 1,5 máquinas por
lote contra 6,9 de la primera.

## 5. Lo que quedó pendiente, y un fallo mío que costó 3 horas

**Entre las dos flotas hubo 1,6 h de parón que no fue trabajo, y fue culpa mía.** Armé el aviso de fin
con `while pgrep -f "estudio_flota.py --sweep stride-01"`, así que ese proceso llevaba la cadena en su
**propia** línea de comando. Dos daños:

- `flota_viva()` lo contó como flota, y el vigilante pasó **19 vueltas (~3 h) diciendo «hay una flota
  viva» sin relanzar** los 14 puntos que faltaban;
- el avisador se esperaba a sí mismo, así que **el aviso no llegó nunca**.

Es exactamente el síntoma que el proyecto tiene documentado como el peor: *un estudio que parece
vigilado y no avanza, sin un solo error*. Comprobado: `pgrep -f estudio_flota.py` devolvía **cinco**
procesos y **sólo uno era una flota**.

Arreglado con test: `flota_viva` exige ahora las tres —que `argv[0]` sea un python y algún argumento
**sea** el script, que el **CWD** sea el workspace, y que mencione alguno de **mis** recorridos—.

**Y un hallazgo de operación**: con `--criba`, las máquinas nacen etiquetadas `c0, c1…` y **nunca se
renombran**, así que el vigilante las da todas por ajenas (*«no sé de qué recorrido es 'c0'»*) y queda
**ciego para matar una atascada**. Con `--criba 0` nacen con la etiqueta del lote y las juzga bien.
Afecta a cualquier estudio, no sólo a éste.

### Abierto

- **La métrica de tarea.** Es la pregunta que de verdad decide, y ningún eje ha pasado por ella.
- **Dónde satura**, si es que satura: haría falta una ventana mayor para poder mirar por encima de
  stride 1, o aceptar que en esta geometría el eje no cierra.
- **El tramo 1–4 sin refinar**: entre 1 y 4 hay 0,0106 de f1 y sólo un punto intermedio (el 2).
- **La interacción stride × `overlap_fovea_px`**, y otras fuentes: sólo se ha medido
  `dirty-1000-80px`, 1000 imágenes de 60×80.

## 6. De dónde salen los números

| dato | fuente |
|---|---|
| f1, bandas, SEM, δ, R1–R4 | `estudio_stride_informe.py --estudio stride-2026-08-27` → `data/stride-2026-08-27-informe.json` |
| épocas y `s/época` por run | `runs/stride-*/summary.json` y `metrics.jsonl`, commiteados por el libro de a bordo desde cada máquina |
| pasos por época (el control R4) | `runs/*/config.json`, el que devolvió cada máquina |
| coste, reloj, instancias | `sweeps/stride-{01,16}/flota.json` (distingue `maquinas` de `maquinas_alquiladas`) y `/tmp/estudio-stride{,2}.log` |
| conteos de ventanas por brazo | `data/window-datasets/*/manifest.json` |

⚠ `/tmp` no sobrevive a rehacer la máquina; lo que había que conservar está aquí.

**Reportes hermanos**: la infraestructura y su validación, en
[#14](2026-08-27-stride-infraestructura.md).
