---
name: glosario-siempre
description: El dueño pide siempre un glosario de términos en los informes de experimentos; cada término nuevo se añade y las corridas se describen por lo que llevan
metadata:
  type: feedback
---

El dueño pide **siempre** un glosario (2026-10-15: «acuérdate del glosario que siempre pido»). Hasta ese día no estaba
escrito en ningún repo, y por eso se olvidó.

**Why:** los informes inventan términos (entrante, cono, resto, fundido/aparte, sólo-cresta) y los nombres de corrida
(`cresta-restos-aparte`) no se explican solos; el dueño lee desde el móvil y no puede rebuscar.

**How to apply:** cada README de experimento de `experimentos-cnn` lleva `## 📖 GLOSARIO` (el primero, en
`2026-10-11-rizo-dos/README.md`); todo término nuevo entra en el mismo commit que lo usa; al presentar corridas, cada
nombre se describe con lo que lleva (qué bloques, cuántos números, qué cambia respecto de la anterior). Regla anotada en
el `CLAUDE.md` de `experimentos-cnn`.
