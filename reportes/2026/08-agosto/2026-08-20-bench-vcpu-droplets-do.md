# `bench-vcpu` — s/época por capacidad de vCPU en droplets de DigitalOcean

| | |
|---|---|
| **Qué era** | flota de droplets desechables, uno por tamaño de vCPU, para medir `seconds_per_epoch` |
| **Lanzado con** | `python3 ~/src/foveal-vision/scripts/bench_fleet.py --vcpus …` (ejecutor `bench`) |
| **Proveedor** | DigitalOcean (droplets con tag `bench-efimero`) |
| **Inicio** | 2026-08-20 12:50:52 — sello del nombre de la flota (`bench-c-2-20260820-125052`). ⚠ **sin zona horaria declarada** en el reporte |
| **Fin** | **no registrado.** La última medida *arrancó* a las 12:55:48 y son 3 repeticiones de ~37 s → terminó hacia las 12:58 (**derivado**, no medido) |
| **Instancias** | **2 droplets con reporte commiteado** (`c-2`, `c-4`). No hay reporte de `c-8`: o no se pidió o no llegó a medir — el reporte de flota no lo dice |
| **Coste real** | ⚠ **no registrado.** `bench_fleet.py` no guarda precio ni segundos vividos, así que el coste de esta corrida **no es recuperable** |
| **Dataset** | `bench-dirty1000-16` (red `bench-16`, receta `bench`, 3 repeticiones) |
| **Estado** | terminado |

## De dónde salen estos números

De los dos únicos artefactos que dejó la corrida, commiteados en foveal-vision:

- `benchmarks/vcpu_c-2_20260820-125052.json`
- `benchmarks/vcpu_c-4_20260820-125052.json`

Los dos declaran `git_commit c6c61bff07f11a2a5f411546386b0df2d0a85025`, así que midieron el mismo
código.

## Lo que se midió

| tamaño | vCPU lógicas | s/época (media de 3) | std | `load_avg_before` (1 min) |
|---|---:|---:|---:|---:|
| `c-2` | 2 | **36,869** | 1,789 | 1,287 |
| `c-4` | 4 | **20,143** | 0,634 | 1,070 |

CPU idéntica en las dos (`Xeon Platinum 8168 @ 2,70 GHz`), así que la comparación es limpia en
hardware.

## Hallazgos

- **Doblar las vCPU dio 1,83× de velocidad** (36,869 → 20,143 s/época): casi lineal, pero no
  lineal. Con 2 vCPU la época cuesta un 83 % más de lo que costaría escalando perfecto.
- ⚠ **El `load_avg_before` de las dos máquinas es alto para un droplet recién nacido** (1,287 y
  1,070). Un benchmark de CPU miente bajo carga, y aquí la carga previa era casi de un núcleo
  entero. Probablemente sea la cola de la instalación del propio arranque; **no está comprobado**.
  Las dos cifras deberían tratarse como techo optimista, no como el número limpio.

## Lo que este reporte deja pendiente

1. **`bench_fleet.py` no guarda ni coste ni horas.** Es la razón de que dos de las columnas
   obligatorias de este directorio queden vacías. Mientras no las guarde, ninguna corrida suya
   podrá rellenarlas — y el coste de una flota de droplets no se reconstruye después.
2. **Falta `c-8`.** No se sabe si se pidió; el reporte de flota no distingue «no pedido» de
   «falló».

## Fuente de verdad

- `~/src/foveal-vision/benchmarks/vcpu_c-*.json` (el dato)
- [`foveal-vision/docs/benchmark-vcpu.md`](https://github.com/stalinbeltran/foveal-vision/blob/main/docs/benchmark-vcpu.md)
  (qué mide y por qué)
