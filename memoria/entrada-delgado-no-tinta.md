---
name: entrada-delgado-no-tinta
description: "en experimentos-cnn TODO se calcula por defecto sobre el DELGADO (delg-cnn), no la tinta; el vértice aún va sobre tinta (pendiente)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 64641da7-341a-4081-8434-78cacbf03c44
  modified: 2026-10-17T14:24:08.548Z
---

En `experimentos-cnn` la entrada por defecto **no es la tinta** (`imagenes > 0` del dataset) sino el **delgado**: la salida
de `delg-cnn`, `2026-10-15-delgado-cnn/resultados/delgados-k3x3.npz`, clave `M` (mapa continuo 32×32). La cresta es el
esqueleto de `M > 0,4`. Toda feature, detector **y figura** va sobre el delgado; la tinta sólo si se decide a propósito y se
dice en el código, la figura y el README.

**Why:** el dueño lo corrigió el 2026-10-17 al ver la tinta de fondo en una figura del vértice (rizo-2 § 102): leyó, con
razón, que el cálculo era sobre tinta. Es una transformación que se aplica siempre antes de buscar features.

**How to apply:** al cargar datos para un análisis o una figura de `experimentos-cnn`, cargar `M` del delgado y pintarlo
de fondo; si aparece `tinta` en el código, justificarlo o cambiarlo. El 2026-10-17 el dueño dijo «por default todo se calcula sobre el delgado… hay un divorcio
entre lo que yo esperaba y lo que el sistema hace»: en el REVISOR lo único que hoy va sobre la tinta es el VÉRTICE (bloques
`vertice`, `vertice_1` y el que dibuja el revisor); fuera de él, 33 scripts antiguos de rizo-2/nn y otros 28 experimentos
leen la tinta (no auditados); pasarlo al delgado está PENDIENTE, sin recalcular, y sin entrenar compositores
hasta que él lo diga. La regla completa vive en
`experimentos-cnn/CLAUDE.md` § «POR DEFECTO, TODO se calcula sobre el DELGADO». Relacionado: [[imagen-antes-que-texto]],
[[revisor-en-vivo-en-el-dev]].
