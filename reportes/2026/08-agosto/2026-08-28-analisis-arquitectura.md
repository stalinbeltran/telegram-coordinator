# Análisis de arquitectura: los cinco repos, vistos como un solo sistema

| campo | valor |
|---|---|
| **Qué era** | Revisión de diseño del sistema completo — los cinco repos que existen para entrenar **una** red, sus interfaces reales y sus acoplamientos |
| **Lanzado con** | Nada: es una **lectura del código**, no una corrida. Los comandos de medida están abajo, en «De dónde salen los números» |
| **Inicio / Fin (UTC)** | 2026-08-28, sesión única. **No se registró la hora**: no es un barrido y no hay reloj que reconstruir |
| **Duración** | ⚠ **no aplica** — no hay trabajo cronometrado que medir |
| **Instancias** | **0.** No se alquiló ni una máquina. Todo se leyó del disco de este dev |
| **Coste real** | **0,00 $** — y esto sí es un dato, no un hueco: la revisión no tocó ninguna nube |
| **Dataset** | ⚠ **no aplica** — no se entrenó nada |
| **Estado** | **terminado.** Cubre los cinco repos clonados en `~/src` en el commit del 2026-08-28 |

⚠ **Esto NO es un barrido, y por eso NO tiene fila en la tabla cronológica de
[`../../README.md`](../../README.md).** Aquella tabla lleva instancias y coste real porque existe
para que la factura no se pierda; una fila con cinco «no aplica» ensuciaría la contabilidad sin
añadir nada. El puntero para encontrar este documento está en § «Dónde está el detalle de cada
cosa» de ese mismo README.

---

## 1. El mapa: cinco repos, un solo objetivo

| Repo | Qué es | Código | Commits (30 d) | Reloj |
|---|---|---:|---:|---|
| `image-text-sample-generator` | la **fuente** del dato (renders + labels) | 3.720 L | 3 | casi congelado |
| `foveal-vision` | **lo que mide**: red, entrenamiento, barridos, flota | 23.529 L | 2.418 | rapidísimo |
| `foveal-vision-data` | **lo medido**: 2.805 JSON + los `windows.npz` | 164 L | 201 | lo escriben máquinas |
| `digital-ocean-…-auto-launching` | **la infraestructura**: droplets de DO + Vast | 5.829 L | 71 | moderado |
| `telegram-coordinator` | **el plano de control**: operar desde el móvil | 4.040 L | 54 | núcleo estable |

Lo importante no es que sean cinco. Es **por qué eje se partieron**: no por capa técnica —no hay
`frontend`/`backend`/`common`— sino **por velocidad de cambio y por quién escribe**. El generador
está congelado porque es un *proveedor de contrato*; el repo de datos lo escriben procesos, no
personas; el coordinador tiene 919 líneas de TypeScript que no cambian y todo el comportamiento
en JSON descubierto.

Ese eje es el correcto, y es el que casi nadie elige. Es la razón de que el sistema siga siendo
operable con esta cantidad de piezas.

---

## 2. Lo que está bien diseñado

### a) La separación código/datos degrada con elegancia

`fv.settings.data_root()` busca el repo hermano `foveal-vision-data` y, si no está, **cae al repo
de código y sigue funcionando**. El propio fichero lo justifica: *«una separación que rompe al que
no ha clonado nada es una separación que nadie adopta»*.

Y el fallback no es sólo cortesía: es **el contrato con la máquina alquilada**, que recibe el dato
en `data/window-datasets/` porque allí no hay repo de datos ni debe haberlo. Origen y destino
distintos a propósito, y con test.

### b) El coordinador es un router genérico, no una aplicación

`src/orchestrator.ts` son **92 líneas**. Los 17 comandos operativos son datos JSON descubiertos en
`<repo>/telegram/executors/`. Consecuencia real: `bench` no existe si `foveal-vision` no está
clonado, **y eso es correcto**. Es un plano de control que crece clonando repos, sin desplegar
nada.

La política de colisiones —gana la primera fuente, pero **se anuncia** en `origen.pisados`— es la
elección correcta: un ejecutor que hace otra cosa de la que crees es peor que uno que falta.

### c) El protocolo experimental es el activo más valioso del sistema

`foveal-vision/docs/protocolo.md` (R1–R6) y la `TABLA_PICO` dentro de `estudio_dropout.py` son *el
criterio escrito antes de mirar, en código*. Es lo que convierte «no hubo señal» en un resultado en
vez de una decepción — visible en el tanteo de `dropout` ([#17](2026-08-28-dropout-tanteo.md)),
donde el desenlace estaba escrito antes de medir.

Muy poca gente que entrena redes tiene esto, y es lo más difícil de reconstruir si se pierde.

### d) Los contratos son tests, no prosa

`tests/test_contracts.py` tiene **44 funciones de test** numeradas como contratos. El ⑨ —*el
objetivo no puede ser la pérdida si un peso de la pérdida está en el espacio*— impide un
experimento inválido **mecánicamente**, no por disciplina. Igual `RENAMED_AXES` en `sweeps/spec.py`:
un spec viejo re-ejecutado no entrena otra red en silencio, se **niega con el motivo**.

### e) El libro de a bordo convierte git en el log durable del cómputo efímero

**2.287 de los 2.418 commits del mes** en `foveal-vision` son «libro de a bordo (épocas)». Suena a
abuso de git, y no lo es: de ahí salen gratis la reanudación por punto, la supervivencia a que se
rehaga la máquina de control, y no perder los runs ya hechos de una máquina caída.

Y el multi-escritor está resuelto de verdad: `fetch` + `merge` + reintento del push
(`Libro._reconciliar`, `estudio_flota.py:735`), y aviso por Telegram al cruzar N fallos seguidos
(`_avisar_push_roto`), porque *«un fallo silencioso para siempre es el peor de los dos»*.

### f) El reparto mini/dev es ingeniería de seguridad real

*«El token de cualquier cosa que dev pueda ENCENDER tiene que estar también en el mini. No para
encender: para apagar.»* La capacidad de gastar vive en la máquina desechable; el freno vive en la
permanente. Es la regla de «el freno nunca llega después del acelerador» aplicada a máquinas.

### g) El aislamiento entre sesiones ataca la causa correcta

El hallazgo de que *«de quién es un proceso lo dice su CWD, no su línea de comando»* —porque la
flota se lanza con ruta relativa y `ps` no contiene el workspace por ningún lado— es exactamente el
detalle que decide si un mecanismo de aislamiento funciona o sólo lo parece.

---

## 3. Las debilidades estructurales

### 3.1 El grafo de dependencias entre repos es cíclico

```
foveal-vision ──import (sys.path)──▶ lanzador          (19 funciones de vast_instance)
foveal-vision ──ROOT.parent────────▶ foveal-vision-data
foveal-vision ──ROOT.parent────────▶ image-text-sample-generator
foveal-vision ──COORD_HOME─────────▶ telegram-coordinator   (notify.mjs)
telegram-coordinator ──descubre───▶ TODOS
lanzador/types/dev.json ──clona───▶ foveal-vision, -data, generator
```

**No hay ningún repo que se pueda clonar solo y usar.** Y el acoplamiento se expresa como *layout
del sistema de ficheros* (`ROOT.parent / "..."`), que es una interfaz **no declarada**: no la valida
nadie hasta que un script falla a mitad.

El proyecto ya pagó la factura y la documentó (el `~/dev/` sin generador del 2026-08-27). Pero la
solución adoptada —copiar los cuatro repos siempre juntos, § «Varias sesiones a la vez» del
CLAUDE.md— trata el síntoma. **La causa es que «hermano en el directorio padre» se está usando como
sistema de paquetes.**

⚠ Y el mecanismo correcto **ya existe, a medias**: `FV_DATA_ROOT` y `FV_DATASETS_ROOT` son variables
de entorno que ganan al hermano. El lanzador no tiene equivalente: `LANZADOR` está cableado a
`ROOT.parent` en `estudio_flota.py:187` y a `Path.home()/"src"/…` en `bench_fleet.py:59` — **dos
formas distintas de encontrar el mismo repo, en el mismo repo**.

### 3.2 `vast_instance.py` se usa como librería y está escrito como CLI

`estudio_flota.py` importa **19 funciones** (`alquilar`, `destruir`, `elegir_ofertas_distintas`,
`esperar_ssh`, `bloquear_maquina`, `ssh_script`…) de un fichero de **1.939 líneas** que **no tiene
un solo test** y no declara superficie pública.

Si alguien renombra `elegir_ofertas_distintas`, foveal-vision se entera **con las máquinas ya
alquiladas y facturando**. Es el punto de fallo peor colocado del sistema: acoplamiento máximo
(import directo), garantía mínima (cero tests, cero versión), consecuencia monetaria.

### 3.3 El componente que gasta dinero es el menos protegido

`estudio_flota.py` son **2.006 líneas** con planificación distribuida, pozo de máquinas bajo cerrojo
con relleno, criba de velocidad por sonda, detección de degradación por dos muestras, lista negra
persistida, journaling a git en hilo aparte, contabilidad de coste y reanudación por punto. Es un
orquestador distribuido.

`tests/` cubre `src/fv` muy bien —243 funciones de test, contratos incluidos—. **De la flota no hay
ni un test.** La asimetría está invertida respecto al riesgo: lo que puede equivocarse y cuesta 0 €
está probado; lo que puede equivocarse y cuesta dinero, no.

Y `scripts/` (**9.810 L**) ya es más grande que `src/fv` (**7.124 L**): la lógica de operación creció
más que la de dominio, sin heredar su disciplina de contratos.

### 3.4 Cero CI en los cinco repos

**Ningún repo tiene `.github/workflows`.** Existen 243 tests en foveal-vision y nadie los ejecuta al
empujar.

Combinado con *«los servidores son efímeros, lo que no está empujado no existe»*, un push roto se
descubre **en la máquina siguiente** — que es exactamente el escenario que más ha costado aquí. Es
la mejora con mejor relación coste/beneficio de toda la lista: un workflow de quince líneas por
repo.

### 3.5 Los reportes viven en el repo equivocado

**17 de 20 reportes de estudio están en `telegram-coordinator/reportes/`; 3 en
`foveal-vision/reportes/`.** Y la tabla de estado de parámetros —`vigente` / `cerrado` / óptimo
medido / rango útil, el artefacto más valioso que produce el proyecto— vive en el README de
reportes **del bot de Telegram**.

Esto contradice la propia regla del proyecto: *«una lección que cruza repos se escribe en el repo
donde se dispara»*. Los estudios los dispara `foveal-vision`; el coordinador es el **transporte**.
Hoy, quien clone sólo `foveal-vision` no puede saber qué parámetros están cerrados.

⚠ El README de este directorio da su razón —*«el coordinador es el sitio desde el que se dispara el
trabajo»*— y para el **lanzamiento** es cierta. Pero lo que se guarda no es el lanzamiento: es el
**veredicto**, y ése pertenece a quien mide.

### 3.6 La documentación es un registro cronológico, no un estado

`foveal-vision/CLAUDE.md` son **1.442 líneas**; el coordinador tiene ratio doc:código de **1,31**
(5.309 L de markdown contra 4.040 de código).

El contenido es excelente —cada afirmación con procedencia, «medido el X con Y» frente a
«estimado»— y esa disciplina hay que conservarla intacta. Pero la **forma** es un log: bloques
`✅ 2026-08-26 —`, con `~~desactualizado~~` *dentro* del texto vivo. Para saber qué es verdad hoy hay
que ordenar por fecha y leerlo todo.

El bloque `⚠ PENDIENTE AHORA MISMO` al principio del CLAUDE.md del coordinador es el parche a ese
problema, y funciona — pero es un síntoma: el estado actual tuvo que abrirse paso a codazos hasta
arriba del historial.

### 3.7 El repo de datos tiene dos layouts a la vez

`<año>/<mes>/sweeps/<recorrido>/runs/…` (archivado, con `index.json` como mapa) conviviendo con
`runs/<run>/` plano, que es donde se escribe hoy. `data_archive_root()` existe para leer el primero;
`recoger_planos.py` para mover del segundo al primero.

Es una migración a medias: «¿dónde está un run?» tiene dos respuestas, y hay un script cuyo trabajo
es reconciliarlas periódicamente.

### 3.8 El agujero de reproducibilidad está tapado, no cerrado

`windows.npz` se commitea porque está **medido** que reconstruirlo da otro dato (`repro-chk`,
2026-08-26). La decisión operativa es correcta y salvó comparabilidad.

Pero **nadie diagnosticó por qué** la extracción no es determinista. Queda un defecto vivo: hay
no-determinismo en algún punto de `windows/extract.py` que no está localizado, el almacenamiento
crece sin techo (~2-6 MB por dataset, para siempre, y sólo se añaden), y esa misma
no-determinación puede morder en cualquier otro sitio que re-derive algo.

---

## 4. Qué hacer, por orden de retorno

> **Y lo que se generaliza de aquí ya está escrito.** Los hallazgos de la § 3 —y los aciertos de la
> § 2— quedaron convertidos en reglas reutilizables, indexadas por la acción que las dispara, en
> [`docs/reglas-de-diseno.md`](../../../docs/reglas-de-diseno.md). Este reporte es **la evidencia**;
> aquel documento es **la regla**. Si los dos discrepan, manda éste, que es el que midió.


| # | Cambio | Por qué ahí |
|---|---|---|
| 1 | **CI mínimo en los 5 repos** (`pytest` / `tsc --noEmit` al empujar) | Quince líneas por repo; ataca el modo de fallo más caro que tiene el proyecto |
| 2 | **Mover `reportes/` y la tabla de parámetros a `foveal-vision`**, dejando enlace desde aquí | Aplica la regla que el proyecto ya escribió; hoy el veredicto vive en el repo del transporte |
| 3 | **Declarar la API del lanzador**: `fleet_api.py` fino con tests, y `FV_LANZADOR_ROOT` como el `FV_DATA_ROOT` que ya existe | Convierte el acoplamiento más caro en un contrato comprobable, y unifica las dos formas de encontrar el lanzador |
| 4 | **Tests de la flota con un `vast_instance` falso** — pozo, criba, reanudación por punto, `finally` de destrucción | Lo que gasta dinero merece al menos la cobertura de lo que no |
| 5 | **Partir CLAUDE.md** en `ESTADO.md` (qué es verdad hoy, se reescribe) + `BITACORA.md` (qué pasó, sólo se añade) | Conserva la procedencia, que es lo bueno, y quita el coste de leer 1.442 líneas para saber el presente |
| 6 | **Terminar la migración del repo de datos** a un solo layout | Elimina `recoger_planos.py` y la doble respuesta a «dónde está un run» |
| 7 | **Diagnosticar el no-determinismo de la extracción** | Seguir commiteando el `.npz` de todos modos, pero sabiendo qué se está tapando |

---

## 5. Veredicto

**Este sistema está bien diseñado en lo difícil y flojo en lo fácil.**

Lo difícil —dónde poner las costuras, cómo hacer creíble un resultado, cómo no perder dinero cuando
la máquina de control es desechable, cómo operar desde un móvil— está resuelto con criterios
explícitos y medidos, y con la propiedad más rara de todas: **cada regla lleva escrito lo que costó
aprenderla**. Eso es lo que hace que el conocimiento sobreviva a que se destruya la máquina, que es
el problema real de este proyecto.

Lo flojo es infraestructura estándar: no hay CI, el acoplamiento entre repos se expresa por rutas de
disco en vez de por contratos, el orquestador que alquila máquinas no tiene tests, y los reportes
están guardados en el repo del bot. Nada de eso es un problema de concepción; son cuatro cosas
mecánicas que ninguna sesión ha priorizado porque siempre había un estudio esperando.

**El riesgo que vigilar: `scripts/` crece más rápido que `src/`.** La lógica de operación ya es más
grande que la de dominio (9.810 contra 7.124 líneas) y no comparte su disciplina de contratos. Si
algo va a envejecer mal aquí, es eso.

---

## 6. Lo que quedó pendiente

- **Nada de la § 4 está hecho.** Este documento es el análisis; no se tocó una línea de código de
  ningún repo.
- **No se leyó `foveal-vision/src/fv` a fondo.** El juicio sobre el dominio (red, extracción,
  métricas) sale de sus contratos y sus docs, no de una revisión línea a línea. Lo que se revisó de
  verdad es **la arquitectura entre repos** y las costuras.
- **No se comprobó que los 243 tests pasen.** Se contaron las funciones `def test_`; no se ejecutó
  `pytest` (haría falta el venv y no era la pregunta).
- **El generador (`image-text-sample-generator`) se leyó por encima.** Está congelado desde el
  2026-08-19 y su contrato (`docs/SAMPLE_FORMAT.md`) no se auditó contra los consumidores en
  `fv/datasets/loader.py`. Si algún día ese contrato se rompe, este análisis no lo habría visto.
- ⚠ **La afirmación 3.8 —que hay no-determinismo sin localizar— es una lectura de la
  documentación, no un diagnóstico propio.** No se ejecutó ninguna extracción para reproducirlo.

---

## 7. De dónde salen los números

Todos **medidos el 2026-08-28** sobre los cinco repos clonados en `~/src` de este dev, con estos
comandos:

```sh
# líneas de markdown, de código y ficheros JSON por repo, y commits del mes
for r in foveal-vision foveal-vision-data image-text-sample-generator \
         digital-ocean-dropplet-auto-launching telegram-coordinator; do
  cd ~/src/$r
  echo "$r md=$(git ls-files '*.md' | xargs cat | wc -l)" \
       "code=$(git ls-files '*.py' '*.ts' '*.mjs' | xargs cat | wc -l)" \
       "json=$(git ls-files '*.json' | wc -l)" \
       "c30=$(git log --since=2026-07-29 --oneline | wc -l)" \
       "ci=$(ls .github/workflows/* 2>/dev/null | wc -l)"
done

cd ~/src/foveal-vision
cat scripts/*.py | wc -l                                    # 9810  (scripts/)
find src -name '*.py' | xargs cat | wc -l                   # 7124  (src/fv/)
wc -l scripts/estudio_flota.py                              # 2006
grep -o 'V\.[a-zA-Z_]*' scripts/estudio_flota.py | sort -u | wc -l   # 19
grep -c 'def test_' tests/test_contracts.py                 # 44
grep -rc 'def test_' tests/*.py | awk -F: '{s+=$2} END {print s}'    # 243
git log --since=2026-07-29 --format='%s' | grep -c 'libro de a bordo'  # 2287 de 2418

cd ~/src/digital-ocean-dropplet-auto-launching
wc -l scripts/vast_instance.py scripts/do_droplet.py        # 1939 · 3119

cd ~/src/telegram-coordinator
cat src/*.ts | wc -l ; wc -l src/orchestrator.ts            # 919 · 92
find reportes -name '2026-*.md' | wc -l                     # 17
find ~/src/foveal-vision/reportes -name '*.md' | wc -l      # 3
```

⚠ **`c30` es «desde el 2026-07-29», no «los últimos 30 días»**: se fijó la fecha a propósito para
que el número se pueda reproducir mañana y dé lo mismo.

⚠ **El recuento de `code` excluye `*.js`** (sólo `.py`, `.ts`, `.mjs`), así que deja fuera lo que
haya de JavaScript suelto y todo `node_modules`. Es comparable entre repos, no es «todo el código
que existe».
