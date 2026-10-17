---
name: rejilla-por-direccion
description: en experimentos-cnn un feature con dirección lleva UNA rejilla 3×3 por dirección, sólo N E S O (sectores de 90°), celdas sin letras
metadata:
  type: feedback
---

Un feature con dirección (vértice, entrante…) se representa con **una rejilla 3×3 por dirección**, y sólo hay **4
direcciones: N, E, S, O**, cada una un sector de 90° del rumbo (N [315°, 45°), E [45°, 135°), S [135°, 225°), O [225°, 315°)).
No hay NE: un vértice que apunta a 30° es N. Las **celdas no se rotulan con letras de brújula**: una celda es un sitio del
dígito, y si hay que nombrarla, por fila y columna («arriba-der»).

**Why:** el 2026-10-17 el dueño vio una figura (rizo-2 § 101) con las celdas rotuladas NO, N, NE… y lo leyó como
direcciones diagonales: «no quiero meter tanto detalle». Mezclar letras de dirección y de posición confunde.

**How to apply:** al dibujar o definir rejillas con dirección, título = la dirección; celdas sin letras; cuatro rejillas,
nunca ocho. La regla vive en `experimentos-cnn/CLAUDE.md` § «UNA rejilla por DIRECCIÓN». Relacionado:
[[entrada-delgado-no-tinta]], [[imagen-antes-que-texto]].
