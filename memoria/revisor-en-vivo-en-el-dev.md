---
name: revisor-en-vivo-en-el-dev
description: El dueño prefiere apps de revisión que calculen EN VIVO en el dev (no exports precalculados) y que mantengan varios modelos entrenados; el revisor de rizo-2 es el patrón
metadata:
  node_type: memory
  type: feedback
  originSessionId: 64641da7-341a-4081-8434-78cacbf03c44
  modified: 2026-10-15T11:35:52.887Z
---

El 2026-10-15, ante el boceto del revisor de dígitos (que proponía precalcular en Python y servir estático desde el mini), el dueño dijo: «que corra en el dev, y que se calcule según lo pido… También mantén varios compositores entrenados».

**Why:** quiere probar variantes (bloques, rejilla, semillas) desde el móvil sin tocar código ni esperar un export; el dev es efímero y eso le da igual, lo repone `/use revisor` → `instalar`.

**How to apply:** para una app de revisión nueva, copia `experimentos-cnn/2026-10-11-rizo-dos/web/servidor.py`: stdlib, token al arrancar, caché de lo caro (features) con hash del detector, modelos como recetas que se entrenan en segundos y se guardan en `web/cache/recetas.json`, `estado` que pregunta a `ss` y `ufw`. Ver [[imagen-antes-que-texto]] para cómo presentarla.
