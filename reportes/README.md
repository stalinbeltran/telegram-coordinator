# Reportes de barridos y estudios

Aquí queda **un reporte por cada barrido o estudio que se termine**, se haya lanzado desde donde se
haya lanzado. El coordinador es el sitio desde el que se dispara el trabajo (`/use estudio`,
`/use barrido`, `/use bench`), así que es también el sitio donde tiene sentido poder verlos todos
seguidos sin saltar de repo.

⚠ **Esto NO sustituye a la fuente de verdad, la resume y la enlaza.** El dato vive donde lo dejó
quien lo produjo —`sweeps/*/flota.json` e `informe.json` en foveal-vision, `results/*/` en el
lanzador— y el **veredicto** de un estudio vive en el documento de plan que escribió su criterio
*antes* de mirar. Copiar aquí el análisis es como nacen las dos mitades desfasadas. Un reporte de
este directorio contesta *«qué se corrió, cuándo, con cuántas máquinas, qué costó y qué salió»*, y
para lo demás apunta.

## Dónde va cada reporte

```
reportes/<año>/<mes>/<fecha>-<nombre-del-estudio>.md
                 └─ p. ej. reportes/2026/08-agosto/2026-08-25-bs-alto-tanteo.md
```

El mes lleva **número delante** (`08-agosto`, no `Agosto`) por una razón práctica: así `ls` y el
árbol de GitHub salen en orden cronológico en vez de alfabético, que con nombres de mes deja
`Agosto` antes que `Julio`. El nombre del fichero lleva la fecha por lo mismo, dentro del mes.

## Qué lleva un reporte, siempre

Una tabla de cabecera con estos campos, y ninguno se omite —si un dato no existe **se escribe que
no existe**, que es información y no un hueco—:

| campo | por qué |
|---|---|
| **Qué era** y **lanzado con** | para poder repetirlo |
| **Inicio** y **Fin** (UTC) | y si están *derivados* en vez de leídos, se dice |
| **Duración** | el reloj, que es lo que se nota |
| **Instancias** | las **alquiladas**, no las que trabajaron: son las que facturan |
| **Coste real** | el de la factura. Si sólo se conoce un suelo, se marca como suelo |
| **Dataset** | dos medidas sólo se comparan si coinciden en el dato |
| **Estado** | terminado / incompleto, con el recuento de lotes |

Y después: qué se midió, los hallazgos, **lo que quedó pendiente**, y de dónde salen los números.

## Tabla resumen: en qué quedó cada parámetro

**Para qué sirve esta sección:** los valores de aquí son los que se van a **usar en los
entrenamientos y estudios siguientes**, así que interesa poder leer de un vistazo *qué está fijado,
con cuánta evidencia, y qué sigue abierto* — y poder saltar al reporte que tiene el detalle.

⚠ **Esto no decide nada: refleja lo decidido.** El **vigente** de cada parámetro lo fija la
configuración del repo que entrena (`base_network_value` y `base_recipe_value` de cada
`sweeps/*/spec.json` en `foveal-vision`), y el **veredicto** vive en el documento de plan que
escribió su criterio antes de mirar. Aquí se resume y se enlaza; si una casilla y su fuente
discrepan, manda la fuente.

### Cómo leer la columna «estado»

| estado | significa |
|---|---|
| **cerrado** | barrido con 5 semillas y con el óptimo **interior** al rango: hay un valor peor por arriba y otro por abajo. Es lo más firme que da el protocolo |
| **cerrado por un lado** | acotado sólo por un extremo; por el otro el ganador está en el borde y no se sabe qué hay más allá |
| **tanteo** | 2 semillas. **Acota, no declara ganador** — con 2 contra 2 el *p* mínimo alcanzable es **0,333** |
| **sin cerrar** | medido, pero el recorrido no llegó a poder declarar (semillas incompletas, o *p* mínimo alcanzable por encima del 5 %) |
| **sin medir** | ninguna medida con semillas |

Y dos reglas del proyecto que explican por qué hay ganadores nominales que **no** mueven el vigente:

- **El vigente sólo cambia si `p` < 0,05 y la diferencia supera δ.** Un ganador con `p` = 0,063 no
  mueve nada, aunque gane dos veces seguidas (es el caso de `border_px` = 8).
- **Todo esto es f1 de VENTANA, un proxy** que está medido que **exagera** (en `n_layers` la
  ganancia real fue la mitad). **Ningún eje ha pasado todavía por la métrica de tarea** (R5).

### Red foveada (`ws16-p2-d2-L4` · `regions: split` · ≈167.852 parámetros)

Recorte real 24×24 px, tensor N = 20. Es la base de todos los estudios de la tabla cronológica salvo
los marcados como «plana».

| Parámetro | Vigente | Estado | Óptimo medido | Rango útil / qué se sabe | Reporte |
|---|---:|---|---|---|---|
| **`lr`** | **0,0014** | **cerrado** | 0,0014 | Plano entre 0,00035 y 0,0014; por encima degrada (0,0020 → 0,9055, 0,0028 → 0,8998). Bandas disjuntas. `p` = 0,100 es el **suelo** de 3×3, no un empate | [#3](2026/08-agosto/2026-08-23-lr-alto-L4.md) · [#4](2026/08-agosto/2026-08-23-lr-alto-L4-b.md) |
| **`batch_size`** | **85** | **cerrado** | 85–192 (zona plana) | Plano entre 57 y 192 (0,9302–0,9351); 38 pierde (`p` = 0,024) y de 192 arriba **baja monótono** (384 · 768 · 1536). ⚠ **Utilizable ya: 192 va 1,08× más rápido por época sin pérdida medible** | [#5](2026/08-agosto/2026-08-24-tres-ejes-pasada1.md) · [#8](2026/08-agosto/2026-08-25-bs-alto-tanteo.md) |
| **`n_layers`** | **4** | **cerrado** | 4 | 2 → 0,9066 (`p` = 0,008) · 3 → 0,9246 (`p` = 0,040) · **4 → 0,9341** · 5 → 0,9136. ⚠ **A partir de 5 no arranca de forma fiable**: `sem` 7× mayor, semillas bimodales | [#5](2026/08-agosto/2026-08-24-tres-ejes-pasada1.md) |
| **`border_px`** | **4** → **8** ⚠ | **CERRADO al 5 %** | **8** *(no aplicado)* | Sube hasta 8 px y **baja** de ahí (10 · 12 · 16). ⚠ **La `p` = 0,063 medida DOS veces queda RESUELTA en el [#14]**: con **10 semillas contra 10** sobre `r20260826`, 8 → 0,9398 contra 4 → 0,9302, **`p` = 0,006** y Δ = +0,0096 > δ. A coste constante en parámetros y **1,33× más rápido por época** | [#14](2026/08-agosto/2026-08-26-cierre-parametros.md) · [#9](2026/08-agosto/2026-08-26-borde-ancho.md) |
| **`border_reduce`** | **2** | **sin cerrar** *(confundido)* | 1 por f1, **pero no comparable** | Con `border_px` = 8: 4 → 0,9408 · 2 → 0,9472 · **1 → 0,9574** (`p` = 0,008, el mínimo alcanzable). ⚠ **NO es cost-neutral**: N pasa de 20 a 32, **+156 % de parámetros** y 1,77× por época. Capacidad y resolución están **confundidas** en este diseño | [#11](2026/08-agosto/2026-08-26-prioridad2.md) |
| **`k_center`** | **3** | **cerrado** | 3 | 3 → 0,9341 · 5 → 0,9226 (`p` = 0,024) · 7 → 0,9206 (`p` = 0,008). Los dos alternativos son peores **y más caros**. ⚠ **Contradice el indicio de 1 semilla de julio**, donde 5 era el mejor por métrica de tarea: eso sigue sin resolverse, porque esto mide el proxy | [#11](2026/08-agosto/2026-08-26-prioridad2.md) |
| **`channels`** | **[16]×4** | **cerrado** *(20/20)* | [16]×4 | Subir no aporta: 24 → 0,9303 (`p` = 0,40) y 32 → 0,9307 (`p` = 0,53), a 1,3× y 1,7× por época. **Bajar sí hace daño**: 8 → 0,9021 (`p` = 0,008) y con el `sem` más alto de la tabla. **16 es el suelo útil, no un exceso heredado**. Recalculado con **las 5 semillas de [32]×4**: el veredicto no cambió | [#13](2026/08-agosto/2026-08-26-prioridad2-relanzamiento.md) |
| **`pos_weight`** | **1,0** | **cerrado por arriba** | 1,0 | Monótono decreciente: 2 empata (`p` = 0,889), 4 → 0,9137 y 8 → 0,8780, los dos a `p` = 0,008. ⚠ Era **«la hipótesis más plausible de mejora grande sin probar»** y **no la hubo**: el cuello de botella de detección no se destapa desde el peso de la pérdida | [#13](2026/08-agosto/2026-08-26-prioridad2-relanzamiento.md) |
| **`scheduler`** | **`none`** | **cerrado** *(2 valores)* | `none` | `cosine` → 0,9329 contra 0,9341, `p` = 0,857. ⚠ **El empate es real, no un artefacto**: el tope se bajó a 100 a propósito para que `cosine` llegara a aplicar su bajada (con 150 habría medido «cosine casi sin aplicar») | [#13](2026/08-agosto/2026-08-26-prioridad2-relanzamiento.md) |
| **`monitor`** | **`val_loss`** | **cerrado** *(2 valores)* | `val_loss` | `val_f1` → 0,9346 (+0,0059, `p` = 0,214). ⚠ Y **el brazo `val_f1` partía con ventaja mecánica** —elige checkpoint con la misma métrica con que se le puntúa— y aun así no llega. La incoherencia declarada cuesta ~0,006 y **es indistinguible del ruido** | [#11](2026/08-agosto/2026-08-26-prioridad2.md) |
| **`overlap_fovea_px`** | **2** → **7** ⚠ | **el óptimo es la PARED LEGAL** *(#14)* | **7** *(no aplicado)* | **Barrido ENTERO {0,1,2,4,5,6,7} sobre `r20260826`, y sube MONÓTONO**: 0 → 0,9236 · 1 → 0,9278 · 2 → 0,9332 · 4 → 0,9375 · 5 → 0,9400 · 6 → 0,9415 · **7 → 0,9433**. Con **10 semillas contra 8**: `p` < 0,001, Δ = +0,0124. **Cost-neutral: 167.852 parámetros en TODO el rango** (medido). ⚠ **El óptimo es el máximo LEGAL** (`overlap_fovea_range(16)` = [0..7]): no está acotado por evidencia sino por la geometría — apunta a que quien limita es el tamaño de fóvea. ⚠ El dato viejo decía otra cosa (4 con `p` = 0,270) | [#14](2026/08-agosto/2026-08-26-cierre-parametros.md) · [#13](2026/08-agosto/2026-08-26-prioridad2-relanzamiento.md) |
| `fovea_px` | 16 | **no barrible** | — | Atado por contrato al `window_size` del dataset. Cambiarlo exige **regenerar el dataset** | — |
| `overlap_border_px`, `merge`, `pool_mode`, `pad_mode` | 0 · concat · avg · edge | **medidos** *(#14)* | los cuatro vigentes | Tanteo + verificación: **ninguno mueve el vigente**. `overlap_border_px` 2 daba +0,0158 con 1 semilla y +0,0055 con 4 (`p` = 0,314). ⚠ **`merge: sum` EMPATA con 0,54× de parámetros** (91.052 contra 167.852): no gana, pero que empate es la noticia. `pool_mode: max` pierde 0,023 | [#14](2026/08-agosto/2026-08-26-cierre-parametros.md) |
| `k_periph`, `s_center`, `s_periph` | 3 · 1 · 1 | **NO BARRIBLES hoy** | — | ⚠ **No es que salieran mal: tienen UN SOLO valor legal** con la geometría vigente (comprobado con `build_search_space`). La banda periférica son 4 px, y un kernel/stride debe caber en ~la mitad. Serían barribles con el borde ancho — o sea que **`border_px` = 8 los acerca** | [#14](2026/08-agosto/2026-08-26-cierre-parametros.md) |
| `optimizer`, `weight_decay`, `lambda_pos`, `smooth_l1_beta`, `patience` | adam · 0,0 · 1,0 · 0,08 · 10 | **medidos** *(#14)* | los cinco vigentes | **Ninguno mueve el vigente.** ⚠ **`weight_decay` = 0 GANA y subirlo hunde** (0,001 → 0,8731): la regularización **no** es la respuesta a la brecha val/train de +28 %, que era la prioridad «10 ter» — y eso rebaja el interés de implementar `dropout`. `patience` = 5 pierde 0,0105: **confirma el mínimo medido de 8**. `adam ≡ adamw` con `wd` = 0: el **control** salió bien | [#14](2026/08-agosto/2026-08-26-cierre-parametros.md) |
| `momentum`, `epochs` | 0,9 · 100 | **no procede** | — | `momentum` es **inerte** con `adam`. `epochs` es **guarda, no ajuste, y hoy no ata**: medido sobre los 630 runs con curvas, la época más alta es **130** y **ninguno** llegó a 150, así que subir el tope daría runs idénticos | [#14](2026/08-agosto/2026-08-26-cierre-parametros.md) |

### Red plana de control (`plana-24-single` · `regions: single` · ≈165.430 parámetros)

Existe para responder *la* pregunta del proyecto. Está afinada sólo a nivel de **tanteo**, y por eso
la comparación todavía no se puede hacer.

| Parámetro | Vigente | Estado | Óptimo del tanteo | Qué se sabe | Reporte |
|---|---:|---|---|---|---|
| **`lr`** | **0,0014** | **tanteo** | 0,0007 | Zona útil **0,00035–0,0014** (0,9615–0,9649, todo dentro del ruido). ⚠ En **0,0028 una semilla colapsó a f1 = 0,0000** mientras la otra dio 0,9442: ahí el entrenamiento **puede colapsar entero**. El óptimo de la foveada (0,0014) cae dentro de la zona buena pero **no es el mejor**: un óptimo **no se hereda** al cambiar de arquitectura | [#7](2026/08-agosto/2026-08-25-plana-tanteo.md) |
| **`batch_size`** | **85** | **tanteo, acotado** | **170** *(interior)* | 24 → 0,9510 · 43 → 0,9581 · 85 → 0,9626 · **170 → 0,9658** · 340 → 0,9601. Y 170 es además **más barato por época** que el vigente (50,2 s contra 85,2) — el mismo patrón que en la foveada. Réplica exacta con `bs-alto-pl`, otra flota | [#10](2026/08-agosto/2026-08-26-plana-tanteo-fase1.md) · [#8](2026/08-agosto/2026-08-25-bs-alto-tanteo.md) |
| **`n_layers`** | **4** | **tanteo, acotado** | **5** *(interior, pero al borde de lo fiable)* | 2 → 0,9196 · 3 → 0,9521 · 4 → 0,9615 · **5 → 0,9659** · 6 → **bimodal**. ⚠ **L6 dio 0,0000 y 0,9630 en sus dos semillas**: la media de 0,4815 es el promedio de una moneda y **no debe citarse**. El ganador 5 está justo en el borde de esa zona, y 2 semillas es **exactamente el número que no puede ver la bimodalidad** | [#10](2026/08-agosto/2026-08-26-plana-tanteo-fase1.md) |

### Inferencia — se ajustan **sin reentrenar** (dominio F)

Es el mejor ratio ganancia/coste del inventario, y está **deliberadamente sin aplicar**.

| Parámetro | Default vigente | Óptimo medido hoy | Nota |
|---|---:|---|---|
| **`threshold`** | 0,5 | **0,25 – 0,40** ⚠ *ya no coincide entre modelos* | El pico está medido como **plano entre 0,2 y 0,4**, así que la discrepancia puede ser ruido |
| **`stride`** | `n/2` (8 px) | **2 px** | Los dos runs válidos coinciden |
| **`nms_radius`** | `n/2` | **16 px** | Los dos runs válidos coinciden |
| `min_size` | 4,0 | sin medir | — |

**Ganancia medida con los pesos que ya hay: +0,053 a +0,071** de métrica de tarea.

⚠ **Dos avisos que pesan más que la ganancia**, los dos del reporte [#12](2026/08-agosto/2026-08-26-knobs-f.md):

1. **El óptimo ya NO es el mismo para todos los modelos, y en julio sí lo era.** Si el `threshold`
   óptimo depende del modelo, los knobs dejan de ser un ajuste global y pasan a ser **parte de la
   identidad de cada run** — y eso afecta a **cómo se comparan modelos**, no sólo a cuánto valen.
   ⚠ **Con dos runs válidos no se puede afirmar**; la re-corrida con tres estaba en marcha.
2. **La decisión F15 está CERRADA en NO** (del usuario, 2026-07-26): aplicarlos **re-escala todos los
   números publicados**, y hay un efecto medido de que **comprimen la separación entre modelos**.

### Lo que sigue abierto, en una pantalla

1. **La pregunta que da nombre al proyecto sigue sin contestar** — ¿gana la foveada a la plana? Está
   bloqueada por la **fase 2 de la plana** (5 semillas sobre `batch_size` ∈ {85, 170, 340} y
   `n_layers` ∈ {4, 5, 6}), **que no se ha corrido**. ⚠ Y **los 0,96 de la plana contra los 0,93 de
   la foveada NO son esa comparación**: son f1 de ventana y las dos redes ven áreas distintas.
2. **Ningún eje ha pasado por la métrica de tarea (R5).** En `k_center` no es opcional: es el eje
   donde proxy y tarea se contradicen **en el signo**.
3. **`border_px` = 8 contra 4 sigue sin resolverse al 5 %**, con `p` = 0,063 medida **dos veces**. Lo
   que lo cerraría es **más semillas en esos dos puntos** (10 contra 10 da `p` mínimo **1,08·10⁻⁵**), **no**
   un rango más ancho.
4. ✅ **`overlap_fovea_px` ya declara, y dice que el solape aporta** (`p` = 0,032 para el punto 0).
   El run que faltaba —`overlap`=4 semilla 3— lo corrió la propia flota antes de cerrar a las
   15:58:19 UTC, así que el recorrido está en **20/20**, igual que `channels`. ⚠ **Lo que sigue
   pendiente y es gratis: volver a pasar `estudio_informe.py`.** Las tablas de arriba se
   recalcularon a mano desde `runs/*/metrics.jsonl`; los `sweeps/*/informe.json` en disco son de
   las **15:13 UTC**, o sea de antes del último run, y aún dicen que `ov-fov` tiene 2 semillas en su
   punto ganador. **Cero alquileres, y quita la última fuente rancia de este inventario.**
   ⚠ Por arriba el eje **no queda cerrado**: 4 es el borde del rango. Cerrarlo pide un punto más
   allá, decidido **antes** —como en `borde-ancho`—. ⚠ **Y no hay coste que sopesar: corregido el
   2026-08-26, este eje es cost-neutral.** Aquí decía «contra su coste, porque el solape sube N», y
   es falso: `N = fovea_px + 2·(border_px // border_reduce)` **no contiene el solape**. Medido
   contando parámetros en los ocho valores legales: **167.852 en todos**. Lo que crece es la banda
   de la rama periférica, no el tensor. El tope de este eje lo pone la geometría —
   `overlap_fovea_range(16)` = [0…7]— y no el presupuesto.
5. **El confound de `border_reduce` sigue abierto**: capacidad contra resolución. Desconfundirlo pide
   un diseño que suba N sin subir el área, o que compare a parámetros igualados.

### Dónde está el detalle de cada cosa

Esta tabla resume; el detalle está en tres sitios, y cada uno contesta algo distinto:

| Si necesitas… | Mira en |
|---|---|
| **qué se corrió, cuándo, con cuántas máquinas y qué costó** | el reporte de la tabla cronológica de abajo |
| **el veredicto y el criterio escrito ANTES de mirar** | el documento de plan que enlaza cada reporte, en `foveal-vision/docs/` — [`plan-prioridades-2026-08-25.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-prioridades-2026-08-25.md) (prioridades 1 y 2), [`plan-tres-ejes.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-tres-ejes.md) (`batch_size`, `n_layers`, `border_px`), [`plan-lr-alto.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-lr-alto.md) (`lr`), [`plan-cnn-plana.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-cnn-plana.md) y [`plan-plana.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-plana.md) (la plana), [`metrica-de-tarea.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/metrica-de-tarea.md) y [`decisiones.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/decisiones.md) **F15** (los knobs) |
| **el número crudo, run a run** | `foveal-vision/sweeps/<recorrido>/informe.json` (grupos y contrastes) y `flota.json` (coste, reloj, máquinas); el libro de a bordo en `runs/`. ⚠ **Mira desde qué commit lo lees**: `informe.json` describe los runs que ese clon tenía a la vista, y un `push` roto hizo que `3636ccfa` marcara `interrupted` cuatro runs que sí habían terminado (corregido en `foveal-vision@199f10d4`; ver la corrección del [#13](2026/08-agosto/2026-08-26-prioridad2-relanzamiento.md)). Un `n_seeds` bajo puede ser un recorrido incompleto **o** un clon desactualizado |
| **qué significa cada parámetro, en cristiano, y por qué se estudia en ese orden** | [`foveal-vision/reportes/2026/08-agosto/parametros-y-prioridad-de-estudios.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/reportes/2026/08-agosto/parametros-y-prioridad-de-estudios.md) — el inventario completo de los cuatro dominios (C/D/F/X) con la explicación de cada mando |
| **cómo se lee la geometría nueva** (`border_px`, `border_reduce`, `overlap_*`) y su traducción desde `N`/`c_frac`/`d` | [`foveal-vision/instructionsNewNN.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/instructionsNewNN.md) §2.1 |
| **los primeros resultados bajo la geometría nueva** | [`foveal-vision/reportes/2026/08-agosto/2026-08-26-geometria-nueva-primeros-resultados.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/reportes/2026/08-agosto/2026-08-26-geometria-nueva-primeros-resultados.md) |

⚠ **El inventario de `parametros-y-prioridad-de-estudios.md` es del 2026-08-25 y esta tabla es
posterior.** Los siete ejes de prioridad 2 que allí figuran como «NUNCA barrido» —`pos_weight`,
`scheduler`, `monitor`, `k_center`, `channels`, `border_reduce`, `overlap_fovea_px`— **se midieron el
26-ago** (reportes #11 y #13), y `border_px` ya **no** está «abierto por la derecha» (#9 lo cerró).
Para el estado de un eje manda esta tabla; para *qué es* cada parámetro, aquel documento.

## Los reportes, en orden cronológico

Se **añade al final**; las filas anteriores no se tocan.

| # | Reporte | Ubicación | Inicio (UTC) | Fin (UTC) | Instancias | Coste real | Hallazgo en una línea |
|---:|---|---|---|---|---:|---:|---|
| 1 | `bench-vcpu` — s/época por vCPU en droplets de DO | [2026/08-agosto/2026-08-20-bench-vcpu-droplets-do.md](2026/08-agosto/2026-08-20-bench-vcpu-droplets-do.md) | 2026-08-20 12:50:52 ⚠ sin zona | ⚠ no registrado | 2 | ⚠ **no registrado** | Doblar las vCPU dio 1,83×, no 2×. La corrida no guardó ni coste ni horas |
| 2 | `foveal-cpu` — barrido de vCPU en Vast.ai | [2026/08-agosto/2026-08-20-barrido-vast-foveal-cpu.md](2026/08-agosto/2026-08-20-barrido-vast-foveal-cpu.md) | 2026-08-20 21:18:28 | 2026-08-21 02:22:57 | ≥5 | **≥0,0293 $** | El precio por hora no ordena el rendimiento: 18 vCPU y 2 vCPU al mismo $/h, 4× de diferencia en $/unidad |
| 3 | `lr-alto-L4` — cerrar `lr` por la derecha | [2026/08-agosto/2026-08-23-lr-alto-L4.md](2026/08-agosto/2026-08-23-lr-alto-L4.md) | 2026-08-23 18:18:10 *(derivado)* | 2026-08-23 20:37:16 | 3 | **0,2952 $** | `lr` queda acotado por los dos lados; bandas disjuntas y `p = 0,100` es el suelo, no un empate |
| 4 | `lr-alto-L4-b` — el mismo, una máquina por run | [2026/08-agosto/2026-08-23-lr-alto-L4-b.md](2026/08-agosto/2026-08-23-lr-alto-L4-b.md) | 2026-08-23 22:40:55 *(derivado)* | 2026-08-23 23:36:19 | 9 | **0,3656 $** | 2,5× menos reloj por 7 céntimos. El coste del paralelismo fino no es el peaje: es agotar las ofertas baratas |
| 5 | `bs5-L4`+`nl5-L4`+`d5-L4` — tres ejes, pasada 1 | [2026/08-agosto/2026-08-24-tres-ejes-pasada1.md](2026/08-agosto/2026-08-24-tres-ejes-pasada1.md) | 2026-08-24 17:19:19 | 2026-08-24 23:28:00 | 22 (+43 en 2 abortos) | **2,6471 $** (+0,14 abortos) | `batch_size` es plano entre 57 y 192 —no lo que decían los 3 estudios viejos—; `n_layers=4` confirmado. Reproducibilidad bit a bit con 5 pares |
| 6 | `d5-L4` — pasada 2 (rehacer el eje `d`) | [2026/08-agosto/2026-08-24-d5-L4-pasada2.md](2026/08-agosto/2026-08-24-d5-L4-pasada2.md) | 2026-08-24 23:52:10 | 2026-08-25 02:22:37 | 11 | **0,7071 $** | `d` sube monótono y gana el extremo: sin acotar por arriba. Un estudio inválido tampoco vale para decidir dónde mirar. ⚠ Releído con la geometría de 2026-08-25: ese eje era **`border_px` a coste constante** (2→8 px) |
| 7 | `pl-t-lr`+`pl-t-bs` — tanteo de la red plana | [2026/08-agosto/2026-08-25-plana-tanteo.md](2026/08-agosto/2026-08-25-plana-tanteo.md) | 2026-08-25 03:01:05 | 2026-08-25 04:35:58 | 25 | **1,026 $** | ⚠ Incompleto (13/20). `lr` útil en 0,00035–0,0014; en 0,0028 **una semilla colapsó a f1 = 0** |
| 8 | `bs-alto-fov`+`bs-alto-pl` — `batch_size` por arriba | [2026/08-agosto/2026-08-25-bs-alto-tanteo.md](2026/08-agosto/2026-08-25-bs-alto-tanteo.md) | 2026-08-25 10:35:05 | 2026-08-25 13:08:32 | 24 | **1,6846 $** | En las dos redes el f1 **baja** monótono al subir el batch: la zona plana termina en el ancla, no hay nada arriba |
| 9 | `borde-ancho` — ¿más contexto a coste constante? | [2026/08-agosto/2026-08-26-borde-ancho.md](2026/08-agosto/2026-08-26-borde-ancho.md) | 2026-08-26 01:42:54 | 2026-08-26 04:40:15 | 18 *(flota compartida con #10)* | **1,0536 $** *(compartido con #10)* | **El eje queda CERRADO por los dos lados**: sube hasta 8 px y baja de ahí en adelante. El vigente se queda (p = 0,063, la misma que en `d5-L4`) |
| 10 | `pl-t-bs`+`pl-t-nl` — afinado de la plana (fase 1) | [2026/08-agosto/2026-08-26-plana-tanteo-fase1.md](2026/08-agosto/2026-08-26-plana-tanteo-fase1.md) | 2026-08-26 01:42:54 | 2026-08-26 08:32:39 | 18 *(compartida con #9)* + 4 | **compartido con #9** + **0,0571 $** | Los dos tanteos acotados: `batch_size` 170 y `n_layers` 5, los dos interiores. ⚠ En L6 **una semilla dio f1 = 0,0000** |
| 11 | Prioridad 2 — siete ejes nunca medidos | [2026/08-agosto/2026-08-26-prioridad2.md](2026/08-agosto/2026-08-26-prioridad2.md) | 2026-08-26 01:57:11 | 2026-08-26 06:53:57 | **101** *(para 35 lotes)* | **3,2996 $** | ⚠ Incompleto (3 de 7; los otros 4 se cierran en el **#13**). `border_reduce`=1 gana con p = 0,008 **pero no es cost-neutral**; `k_center` y `monitor` dejan el vigente donde estaba |
| 12 | Knobs de inferencia (F) re-medidos | [2026/08-agosto/2026-08-26-knobs-f.md](2026/08-agosto/2026-08-26-knobs-f.md) | 2026-08-26 ~01:30 | 2026-08-26 03:23 | **0** *(local)* | **0,00 $** | ⚠ 2 de 3 filas válidas. Los defaults dejan +0,053 a +0,071, y **el óptimo ya no es el mismo para todos los modelos** — en julio sí lo era |
| 13 | Prioridad 2 — relanzamiento de los cuatro a medias | [2026/08-agosto/2026-08-26-prioridad2-relanzamiento.md](2026/08-agosto/2026-08-26-prioridad2-relanzamiento.md) | 2026-08-26 11:04:49 | 2026-08-26 15:58:19 | **34** *(18 lotes)* | **2,0283 $** | **Los cuatro cerrados, 20/20.** El vigente gana en los cuatro ejes; en `ov-fov` el punto **0** (ramas disjuntas) es **peor con p = 0,032**: el solape aporta. ⚠ `overlap` no queda acotado por arriba |

| 14 | Cierre de parámetros — `overlap_fovea_px`, `border_px` y los 9 ejes nunca medidos | [2026/08-agosto/2026-08-26-cierre-parametros.md](2026/08-agosto/2026-08-26-cierre-parametros.md) | 2026-08-26 22:13:08 | 2026-08-27 18:05 *(parado a mano)* | **≥160** *(4 flotas)* | **≥9,9367 $** ⚠ *el último tramo no quedó registrado* | ⚠ **El dataset de los estudios ya no se puede reconstruir** (`r20260826`, otro dato). Con el eje entero sobre un solo dataset: **`overlap_fovea_px` 2 → 7** (`p` < 0,001) y **`border_px` 4 → 8** (`p` = 0,006, y más rápido). Los 9 ejes nunca medidos: **ninguno mueve el vigente** |

**Gastado y registrado hasta aquí: ≥23,27 $** (13,33 hasta el #13, más ≥9,94 del #14)

⚠ **Y el #14 vuelve a dejar el hueco que este directorio existe para evitar**: su última flota se
**paró a mano**, así que `estudio_flota.py` no llegó a escribir su `flota.json` y de ese tramo sólo
hay el **suelo** que el log alcanzó a anotar (2,1404 $ en 21 instancias). La lección de siempre, y
van dos: **cuando haya que parar una flota a mano, el número de la factura sólo queda en el panel
del proveedor.**

**Gastado y registrado hasta el #13: 13,33 $** (6,89 hasta el #8, más 6,44 en los estudios de
prioridad del 26-ago). No incluye lo que no quedó anotado —la flota de droplets de DO (#1), los
alquileres de Vast que fallaron antes de medir (#2) y **la corrida del 25-ago 22:20 que se mató a
mitad** (#9), cuyo `flota.json` no llegó a escribirse—, que es justamente lo que este directorio
existe para que no vuelva a pasar.

⚠ **Cuando falta el dato, falta por una razón: la corrida no llegó a su final.** El coste, el reloj
y las instancias los escribe `estudio_flota.py` **al terminar**; si la flota se mata o se apaga desde
fuera, las máquinas mueren pero **la contabilidad no se escribe**. El libro de a bordo salva los
*resultados* minuto a minuto, no el *cierre*. Cuando haya que apagar una flota a mano, el número de
la factura sólo queda en el panel del proveedor: **anótalo antes de perderlo.**

⚠ **Y el recíproco, que costó dos correcciones en el #13: que falte el dato AHORA no quiere decir
que vaya a faltar siempre.** Ese reporte declaró su coste irrecuperable mientras la flota seguía
viva; cerró sola 2 h 40 más tarde y escribió los 2,0283 $ que ahora están en la tabla. **Un
`flota.json` ausente sólo prueba que la flota no ha terminado —no que haya muerto.** Antes de dar
una corrida por perdida, comprobar que de verdad no queda nada corriendo.
