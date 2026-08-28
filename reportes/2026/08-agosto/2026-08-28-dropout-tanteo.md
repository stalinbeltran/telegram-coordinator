# `do-t` — tanteo de `dropout`: ¿regulariza, y ayuda?

| campo | valor |
|---|---|
| **Qué era** | Tanteo del eje `dropout` (C) sobre la red foveada vigente: 4 valores × 2 semillas. Primera medición del parámetro desde que se implementó el 2026-08-27 |
| **Lanzado con** | `estudio_flota.py --sweep do-t --cpu E5-26 --criba 2 --git --horas-max 6 --prefijo dr- --yes` |
| **Inicio (UTC)** | 2026-08-28 01:30:11 *(leído del log)* |
| **Fin (UTC)** | 2026-08-28 04:51:22 *(leído del log y de `flota.json`)* |
| **Duración** | 201,2 min de reloj (3 h 21 min) |
| **Instancias** | **5 alquiladas** · 2 entrenaron. Las otras 3: dos fallaron antes de estar listas y una la descartó la criba de velocidad (0,0108 $ entre las tres) |
| **Coste real** | **0,3626 $** *(de `flota.json`, la flota cerró sola y lo escribió)* |
| **Dataset** | `dirty1000-80px-16px-r20260827` — ⚠ **nuevo**, y **no es** el `r20260826` de los estudios del 26-ago, que se perdió y no vuelve. Los números **no se restan** con los de aquéllos |
| **Estado** | **Terminado**, 8/8 runs, 2/2 lotes. R1 ✅ (todos pararon por `patience`) |
| **Plan / criterio** | [`foveal-vision/docs/plan-dropout-2026-08-28.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/plan-dropout-2026-08-28.md), escrito **antes** de mirar |

## Qué se midió

`dropout` es el mando de regularización **dentro de la red**, sobre las features aplanadas justo
antes de la cabeza — donde vive el 97 % de los parámetros. Se implementó el 2026-08-27 y **nunca
se había medido**. Base `ws16-p2-d2-L4` (167.852 parámetros, y el eje es **cost-neutral**: los
mismos 167.852 en todo el rango, medido).

| `dropout` | f1 (media) | sem | épocas |
|---:|---:|---:|---:|
| **0,0** *(vigente)* | **0,9315** | 0,0010 | 47 · 54 |
| 0,25 | 0,9282 | 0,0022 | 46 · 59 |
| 0,5 | 0,9274 | 0,0025 | 73 · 82 |
| **0,1** | **0,9129** | 0,0020 | 34 · 35 |

## Hallazgos

**1. El vigente `0,0` gana, y ningún otro valor entra en la banda** (δ = 0,0010). Con 2 contra 2
el `p` mínimo alcanzable es 0,333, así que —como estaba escrito— **el tanteo no declara**. Sí
acota: la amplitud es **0,0186**, casi el doble del umbral de 0,010, o sea que el eje **mueve la
aguja — hacia abajo**.

**2. El hallazgo que vale más que el ranking: `dropout` SÍ regulariza, y aun así no ayuda.**
La brecha `val_loss` / `train_loss` en la época del checkpoint:

| `dropout` | brecha media | f1 medio |
|---:|---:|---:|
| **0,0** | **+29,5 %** | 0,9315 |
| 0,1 | −2,6 % | 0,9129 |
| 0,25 | −4,4 % | 0,9282 |
| 0,5 | −15,7 % | 0,9274 |

- El **+28 % medido sobre 612 runs viejos** —la premisa entera del estudio— queda **confirmado de
  forma independiente**: sobre un dataset nuevo y con dos semillas limpias sale **+29,5 %**.
- `dropout` **cierra esa brecha entera ya con 0,1**, y con 0,5 la invierte. Hace exactamente lo
  que se diseñó que hiciera.
- **Y el f1 baja igual.** Es el desenlace que el plan §5 había escrito antes de mirar: *el
  sobreajuste no era el cuello de botella; `patience` ya lo estaba recogiendo.*
- **Dato no previsto que lo refuerza:** el `train_loss` casi se dobla (0,0793 → 0,1480 con 0,1).
  La red no redistribuye capacidad, **la pierde**. Con 167.852 parámetros sobre este dato, no
  sobra red: falta.

**3. Junto con `weight_decay` (#14), los DOS mandos de regularización del inventario quedan
cerrados con la misma conclusión** — y ahora con un mecanismo medido detrás, no con una conjetura.
La reserva que justificaba mirar `dropout` pese al resultado de `weight_decay` (que aquél iba a
`torch.optim.Adam`, o sea L2 acoplada, la forma que se porta mal con Adam) **queda resuelta**: no
era la implementación, es que la brecha no es el cuello de botella.

## Lo que quedó pendiente

1. **`do-v`, el estudio completo, está CREADO Y COMMITEADO pero SIN LANZAR** (el server se
   descartó). `dropout` ∈ **{0,0 · 0,05 · 0,1 · 0,2}** × 5 semillas = **20 runs, ≈1,1 $, ~3,5 h**
   al ritmo real medido (53 s/época, no los 40 estimados). El rango lo fijó la tabla que el plan
   escribió **antes** de mirar, a partir del pico `0,0`. Aporta dos cosas: el punto **`0,05`**,
   que nadie ha mirado y es donde podría quedar una ganancia, y **5 semillas**, que bajan el `p`
   mínimo alcanzable de 0,333 a **0,0079** — lo que convierte «el vigente gana» en una
   declaración al 5 %.
2. ⚠ **`patience` = 10 no es neutral a lo largo de este eje.** Las épocas van de 34-35
   (`dropout` 0,1) a 73-82 (`dropout` 0,5): factor **2,4**. `dropout` mete ruido, la `val_loss`
   mejora a tirones y una `patience` fija corta antes. Parte de lo medido es *cómo le sienta a
   `patience` = 10 ese ruido*, no sólo cuánto regulariza — y es la explicación más plausible de
   que el eje **no sea monótono** (0,1 es el peor y el que antes para; 0,5 el que más entrena y
   casi alcanza al vigente). **Es un estudio propio y no se ha hecho.**
3. **Sin métrica de tarea (R5)**, como todos los ejes del proyecto.
4. **El s/época de la tabla NO compara valores**: los cuatro se corrieron en orden en la misma
   máquina, así que está confundido con el momento del alquiler (el log registra `s1` pasando de
   ~36 a 53,9 s/época). El eje es cost-neutral en parámetros; si el coste importa, se mide aparte.

## De dónde salen los números

| qué | dónde |
|---|---|
| coste, reloj, instancias | `foveal-vision-data/2026/08-agosto/sweeps/do-t/flota.json` |
| tabla, δ, contrastes | `…/sweeps/do-t/informe.json` (`estudio_informe.py --sweep do-t --vigente 0.0`) |
| brecha val/train, `train_loss` | `…/sweeps/do-t/runs/do-t-*/metrics.jsonl`, época `best_epoch` de cada `summary.json` |
| el criterio, escrito antes | `foveal-vision/docs/plan-dropout-2026-08-28.md` §5 y §8 |
| log de la flota | `/tmp/estudio-dropout-tanteo.log` ⚠ **no sobrevive a rehacer la máquina**; lo que hacía falta está copiado aquí |

⚠ **Las rutas de arriba cambiaron el 2026-08-28**, después de escribir este reporte: `do-t` estaba
en la raíz plana del repo de datos y se movió a `2026/08-agosto/` (un run vive dentro de su
recorrido). **Los números no se tocaron** — git registró los 38 ficheros como renombrados y
`estudio_informe.py` sale idéntico antes y después.

**Y por eso la forma fiable de llegar a un run es su NOMBRE, no su ruta**: `fv.artefactos`
resuelve `do-t-0003-dropout0p1_seed2` esté donde esté, y es lo que hacen `estudio_informe.py` y
`estudio_progreso.py`. Una ruta escrita a mano en un documento envejece; el nombre no.

```bash
cd ~/src/foveal-vision && .venv/bin/python -c "import sys;sys.path.insert(0,'src')
from fv.training.registry import RunStore;print(RunStore().path('do-t-0000-dropout0p0_seed1'))"
```
