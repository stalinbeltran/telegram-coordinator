---
name: entrada-delgado-no-tinta
description: "en experimentos-cnn la entrada por defecto de features, detectores y figuras es el DELGADO (delg-cnn), no la tinta"
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
de fondo; si aparece `tinta` en el código, justificarlo o cambiarlo. Ojo: el bloque `vertice` del revisor de rizo-2 (§ 95)
sigue sobre la tinta y eso está anotado como pendiente de decisión del dueño. La regla completa vive en
`experimentos-cnn/CLAUDE.md` § «la entrada por DEFECTO es el DELGADO». Relacionado: [[imagen-antes-que-texto]],
[[revisor-en-vivo-en-el-dev]].
