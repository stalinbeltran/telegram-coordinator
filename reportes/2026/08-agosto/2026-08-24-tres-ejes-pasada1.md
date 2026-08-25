# `bs5-L4` + `nl5-L4` + `d5-L4` — tres ejes con 5 semillas (pasada 1)

| | |
|---|---|
| **Qué era** | rehacer con 5 semillas los tres ejes que el proyecto llegó a estudiar de verdad y no estaban medidos sobre la red vigente: `batch_size`, `n_layers` y `d` (⚠ desde 2026-08-25 ese eje se declara como **`border_px`**, en px reales — ver [la pasada 2](2026-08-24-d5-L4-pasada2.md)) |
| **Lanzado con** | `estudio_flota.py --sweep bs5-L4 --sweep nl5-L4 --sweep d5-L4 --cpu E5-26 --reparto seed --git` (ejecutor `estudio`) |
| **Proveedor** | Vast.ai |
| **Inicio** | **2026-08-24 17:19:19 UTC** (primera línea de `/tmp/estudio-tres-ejes-pasada1.log`) |
| **Fin** | **2026-08-24 23:28:00 UTC** |
| **Duración** | **368,7 min** (6 h 09 min) |
| **Instancias** | **22 alquiladas** para 15 lotes. ⚠ Además, **dos lanzamientos abortados antes de éste** alquilaron 21 y 22 instancias más que se destruyeron en minutos (§ *Los dos abortos*) |
| **Coste real** | **2,6471 $** esta pasada · **+0,14 $** de los dos abortos = **2,79 $** |
| **Dataset** | `dirty1000-80px-16px-r20260824` |
| **Estado** | **10/15 lotes** — `bs5-L4` y `nl5-L4` completos; **los 5 lotes de `d5-L4` fallaron** y se rehicieron en [la pasada 2](2026-08-24-d5-L4-pasada2.md) |

## Los dos abortos que hubo antes

Antes de la corrida buena hubo dos lanzamientos que se cortaron a los dos minutos:

| intento | inicio (UTC) | instancias alquiladas | por qué murió |
|---|---|---:|---|
| 1 | 2026-08-24 17:11:18 | 21 | la API dio **el mismo puerto SSH a dos máquinas**; además fallos de payload y de instalación |
| 2 | 2026-08-24 17:16:28 | 22 | lo mismo: `no pude poner el sello de propiedad (rc=255)` en cadena |

Los logs sólo imprimen el coste de 2 de esas instancias (0,0023 $): el resto se destruyó sin
imprimir importe. **Los 0,14 $ de arriba salen de `plan-tres-ejes.md` §7.5**, que los contabilizó
en su momento; no son reconstruibles desde los logs de `/tmp`.

⚠ **Y ese fallo se pagó en la pasada buena**: dejó 8 máquinas apuntadas en la lista negra, así que
sólo sobrevivieron **11 máquinas del pozo para 15 lotes**. Es la causa directa de los 5 lotes de
`d5-L4` que no llegaron a arrancar.

## Hallazgos

### `batch_size` (`bs5-L4`) — el vigente se queda; el eje **no** queda acotado por la derecha

| `batch_size` | f1 | sem | s/época |
|---:|---:|---:|---:|
| **192** | **0,9351** | 0,0040 | **35,3** |
| **85** (vigente) | 0,9341 | 0,0022 | 38,1 |
| 128 | 0,9317 | 0,0041 | 36,0 |
| 57 | 0,9302 | 0,0012 | 40,1 |
| 38 | 0,9197 | 0,0029 | 45,9 |

192 le saca +0,0010 al vigente con **p = 0,857**: indistinguible. 38 pierde con **p = 0,024**, así
que el lado bajo queda cerrado — pero **el ganador nominal es el extremo del rango**, y eso es
justo la condición de «sigue sin acotar por ese lado».

**Lo que cambia respecto a los estudios viejos:** los tres anteriores dieron 100, 25 y 85 —tres
respuestas distintas— y sus 105 runs pararon **por el tope de 20 épocas**. Con `patience`
decidiendo, el eje resulta **plano entre 57 y 192** (todo dentro de ~2 δ) y sólo cae de verdad en
38. La respuesta correcta no era ninguno de los tres ganadores: era **«el eje es plano en esa
zona»**, y con 20 épocas no se podía ver.

⚠ **Utilizable hoy: 192 va 1,08× más rápido por época que 85 sin perder calidad medible.** No mueve
el vigente por regla, pero abaratar el reloj subiendo el batch sale gratis en calidad.

### `n_layers` (`nl5-L4`) — replica julio y queda acotado por los dos lados

| `n_layers` | f1 | sem | s/época |
|---:|---:|---:|---:|
| **4** (vigente) | **0,9341** | 0,0022 | 46,3 |
| 3 | 0,9246 | 0,0026 | 39,9 |
| 5 | 0,9136 | **0,0146** | 52,3 |
| 2 | 0,9066 | 0,0018 | 31,9 |

Gana 4, que es **interior**; 3 pierde con p = 0,040 y 2 con p = 0,008. El vigente se confirma sobre
el dato de hoy, que era la pregunta.

⚠ **El 5 vuelve a ser inestable**: `sem` 0,0146 contra 0,0022 del ganador —siete veces más— y su
peor semilla cae a 0,8585 mientras la mejor llega a 0,9415. Por eso no alcanza significación
(p = 0,167) pese a estar 0,0205 por debajo: **no es que se parezca al 4, es que no se parece ni a sí
mismo.** Con una sola semilla, L5 podría haber salido ganador por suerte.

### El hallazgo que no se buscaba: reproducibilidad bit a bit, con 5 pares

El punto vigente aparece en los dos recorridos (como `batch_size=85` y como `n_layers=4`): la misma
configuración con las mismas semillas, **entrenada en máquinas distintas**. Las cinco salieron
**idénticas al cuarto decimal y con el mismo número de épocas** (0,9305 · 0,9326 · 0,9296 · 0,9416 ·
0,9360). Con la criba de por medio, o sea que **seleccionar máquinas por velocidad no altera el
resultado** — que era la condición que la criba necesitaba para ser legítima.

⚠ Sigue sin comprobarse **fuera** de `E5-26xx`, y sigue sin correrse el mismo run dos veces **en la
misma máquina**.

## Lo que costó de más, y por qué

Estimado antes de lanzar: **2,17–3,11 $ y 2,6–3,8 h**. El coste cayó dentro de la banda; **el reloj
la dobló, y la causa fue una sola máquina**: la criba marcó `c8` como **2,42× más lenta que la
mediana** y lo dijo, pero hubo que usarla igual porque sólo quedaban 11 máquinas para 15 lotes. Esa
máquina corrió a **92 s/época**, se comió **368 de los 2.058 minutos-máquina** y agotó su plazo de
6 h con un run a medias. **Los otros 10 lotes acabaron en 228 min — 3,8 h, exactamente la
predicción pesimista.**

O sea que el modelo de coste no falló: falló tener que usar máquinas que el propio filtro había
marcado. **El peaje fue el 1,9 %** de los minutos-máquina: repartir fino sigue siendo barato.

## Fuente de verdad

- `~/src/foveal-vision/sweeps/{bs5-L4,nl5-L4}/flota.json` e `informe.json`
- `/tmp/estudio-tres-ejes-pasada1.log` (y `-intento1-abortado.log`, `-intento2-abortado.log`)
  ⚠ **`/tmp` no sobrevive a rehacer la máquina**
- [`foveal-vision/docs/plan-tres-ejes.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-tres-ejes.md)
  §7 — el veredicto, con el criterio escrito **antes** de mirar
