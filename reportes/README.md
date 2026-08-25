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

## Los reportes, en orden cronológico

Se **añade al final**; las filas anteriores no se tocan.

| # | Reporte | Ubicación | Inicio (UTC) | Fin (UTC) | Instancias | Coste real | Hallazgo en una línea |
|---:|---|---|---|---|---:|---:|---|
| 1 | `bench-vcpu` — s/época por vCPU en droplets de DO | [2026/08-agosto/2026-08-20-bench-vcpu-droplets-do.md](2026/08-agosto/2026-08-20-bench-vcpu-droplets-do.md) | 2026-08-20 12:50:52 ⚠ sin zona | ⚠ no registrado | 2 | ⚠ **no registrado** | Doblar las vCPU dio 1,83×, no 2×. La corrida no guardó ni coste ni horas |
| 2 | `foveal-cpu` — barrido de vCPU en Vast.ai | [2026/08-agosto/2026-08-20-barrido-vast-foveal-cpu.md](2026/08-agosto/2026-08-20-barrido-vast-foveal-cpu.md) | 2026-08-20 21:18:28 | 2026-08-21 02:22:57 | ≥5 | **≥0,0293 $** | El precio por hora no ordena el rendimiento: 18 vCPU y 2 vCPU al mismo $/h, 4× de diferencia en $/unidad |
| 3 | `lr-alto-L4` — cerrar `lr` por la derecha | [2026/08-agosto/2026-08-23-lr-alto-L4.md](2026/08-agosto/2026-08-23-lr-alto-L4.md) | 2026-08-23 18:18:10 *(derivado)* | 2026-08-23 20:37:16 | 3 | **0,2952 $** | `lr` queda acotado por los dos lados; bandas disjuntas y `p = 0,100` es el suelo, no un empate |
| 4 | `lr-alto-L4-b` — el mismo, una máquina por run | [2026/08-agosto/2026-08-23-lr-alto-L4-b.md](2026/08-agosto/2026-08-23-lr-alto-L4-b.md) | 2026-08-23 22:40:55 *(derivado)* | 2026-08-23 23:36:19 | 9 | **0,3656 $** | 2,5× menos reloj por 7 céntimos. El coste del paralelismo fino no es el peaje: es agotar las ofertas baratas |
| 5 | `bs5-L4`+`nl5-L4`+`d5-L4` — tres ejes, pasada 1 | [2026/08-agosto/2026-08-24-tres-ejes-pasada1.md](2026/08-agosto/2026-08-24-tres-ejes-pasada1.md) | 2026-08-24 17:19:19 | 2026-08-24 23:28:00 | 22 (+43 en 2 abortos) | **2,6471 $** (+0,14 abortos) | `batch_size` es plano entre 57 y 192 —no lo que decían los 3 estudios viejos—; `n_layers=4` confirmado. Reproducibilidad bit a bit con 5 pares |
| 6 | `d5-L4` — pasada 2 (rehacer el eje `d`) | [2026/08-agosto/2026-08-24-d5-L4-pasada2.md](2026/08-agosto/2026-08-24-d5-L4-pasada2.md) | 2026-08-24 23:52:10 | 2026-08-25 02:22:37 | 11 | **0,7071 $** | `d` sube monótono y gana el extremo: sin acotar por arriba. Un estudio inválido tampoco vale para decidir dónde mirar |
| 7 | `pl-t-lr`+`pl-t-bs` — tanteo de la red plana | [2026/08-agosto/2026-08-25-plana-tanteo.md](2026/08-agosto/2026-08-25-plana-tanteo.md) | 2026-08-25 03:01:05 | 2026-08-25 04:35:58 | 25 | **1,026 $** | ⚠ Incompleto (13/20). `lr` útil en 0,00035–0,0014; en 0,0028 **una semilla colapsó a f1 = 0** |
| 8 | `bs-alto-fov`+`bs-alto-pl` — `batch_size` por arriba | [2026/08-agosto/2026-08-25-bs-alto-tanteo.md](2026/08-agosto/2026-08-25-bs-alto-tanteo.md) | 2026-08-25 10:35:05 | 2026-08-25 13:08:32 | 24 | **1,6846 $** | En las dos redes el f1 **baja** monótono al subir el batch: la zona plana termina en el ancla, no hay nada arriba |

**Gastado y registrado hasta aquí: 6,89 $.** No incluye lo que no quedó anotado —la flota de
droplets de DO (#1) y los alquileres de Vast que fallaron antes de medir (#2)—, que es justamente
lo que este directorio existe para que no vuelva a pasar.
