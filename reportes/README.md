# Los reportes se mudaron a `estudios-redes-neuronales`

Viven en **[https://github.com/stalinbeltran/estudios-redes-neuronales](https://github.com/stalinbeltran/estudios-redes-neuronales)**, clasificados por tipo:
`reportes/<tipo>/<año>/<mes>/<fecha>-<nombre>.md`.

| Si quieres… | Ve a |
|---|---|
| **qué se corrió, cuándo, con cuántas máquinas y qué costó** | [`reportes/README.md`](https://github.com/stalinbeltran/estudios-redes-neuronales/blob/main/reportes/README.md) — el índice cronológico |
| **en qué quedó cada parámetro** y qué sigue abierto | [`ESTADO.md`](https://github.com/stalinbeltran/estudios-redes-neuronales/blob/main/ESTADO.md) |
| **cómo encajan los cinco repos** | [el análisis de arquitectura](https://github.com/stalinbeltran/estudios-redes-neuronales/blob/main/reportes/arquitectura/2026/08-agosto/2026-08-28-analisis-arquitectura.md) |

## Por qué se fueron de aquí

Este repo es **el transporte**: dispara los estudios, no los produce. Guardar aquí sus reportes era
el incumplimiento de la R7 que el propio [análisis de arquitectura del 2026-08-28](https://github.com/stalinbeltran/estudios-redes-neuronales/blob/main/reportes/arquitectura/2026/08-agosto/2026-08-28-analisis-arquitectura.md)
señaló. Y **4 de los 21 no son de ningún repo en concreto**: el `#1` mide droplets del lanzador con
un script de `foveal-vision`, el `#2` se lanza con `vast_instance.py` envuelto en `vast-sweep.sh`, y
el análisis de arquitectura tiene por sujeto los cinco repos y por productor a ninguno.

⚠ **La regla del proyecto no cambia, cambia el destino**: un barrido o estudio que termina **no está
cerrado hasta que su reporte está escrito y commiteado**. Ahora se escribe en el repo central, y su
fila se añade al final de la tabla de allí. El detalle, en su
[`reportes/README.md`](https://github.com/stalinbeltran/estudios-redes-neuronales/blob/main/reportes/README.md).

Desde Telegram el freno sigue igual (`/use cerrable`): `scripts/cerrable.mjs` cuenta ese repo como
el sexto, así que un reporte sin empujar pone el veredicto en 🔴.
