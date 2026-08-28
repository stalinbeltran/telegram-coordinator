# Reglas de diseño de aplicaciones

**Para qué es esto.** Diecisiete reglas para decidir **cómo se parte un sistema, cómo se conectan
sus piezas y dónde vive cada cosa**. Salen de una revisión de arquitectura de este proyecto —cinco
repos que existen para entrenar una red— y están escritas para servir en **cualquier otro
proyecto**: el ejemplo es de aquí, la regla no.

**Cómo se usa, y esto es lo importante.** No se lee entero. Se entra por el **disparador**: la
acción que estás a punto de hacer. La tabla de § 0 es la puerta. Cada regla trae **cómo se
comprueba**, porque una regla que no se puede comprobar es una opinión.

> **A quien la aplique — Claude incluido:** antes de proponer una estructura, una interfaz nueva o
> un fichero en un sitio nuevo, **busca tu acción en la tabla de § 0 y aplica esas reglas**. Si
> una regla choca con lo que ibas a hacer, **dilo y explica el choque**; no la rompas en silencio
> ni la des por inaplicable sin decirlo. Si el usuario confirma, se hace como pide y **se anota la
> excepción con su motivo** donde se aplique.

## Qué NO es esto, y dónde está lo demás

Este documento habla de **estructura**. Lo operativo y lo de redacción ya están escritos y **no se
repiten aquí**:

| Si tu duda es… | Está en |
|---|---|
| documentar, desacoplar procesos, secretos, preflights, frenos | [`revision-2026-08-22.md` § 3, los ocho patrones A–H](revision-2026-08-22.md#3-los-ocho-patrones) |
| cómo se redacta (procedencia de los números, «sobrevive» con complemento, caducidad de cerrojos) | [`../CLAUDE.md` § «Cómo se escribe aquí»](../CLAUDE.md) |
| la evidencia concreta de este proyecto, con sus medidas | [`../reportes/2026/08-agosto/2026-08-28-analisis-arquitectura.md`](../reportes/2026/08-agosto/2026-08-28-analisis-arquitectura.md) |

⚠ **Las reglas de aquí son las que quedaron en pie tras mirar qué funcionó y qué costó.** Las que
tienen ✅ es que este proyecto las cumple y le salió bien; las que tienen ❌ es que las incumple hoy
y se sabe lo que está costando. Las dos clases valen igual: una regla que sólo se ilustra con
aciertos no se distingue de un eslogan.

---

## 0. Índice por disparador

| Si vas a… | Aplica |
|---|---|
| crear un repo, un paquete o un módulo nuevo | **R1 R2 R3** |
| hacer que A use algo de B | **R4 R5 R6** |
| decidir dónde se guarda un fichero que produce el sistema | **R7 R8 R9** |
| escribir código que gasta dinero, borra o lanza recursos | **R10 R11 R12** |
| automatizar una decisión, un umbral o una elección | **R13 R14 R15 R16** |
| dar algo por terminado | **R17 R18 R19** |
| mover, renombrar o migrar algo que ya existe | **R19** (y **R7** si cambia de dueño) |

---

## 1. Al partir un sistema en piezas

### R1 · Parte por velocidad de cambio y por quién escribe, no por capa técnica

Antes de decidir la frontera, contesta dos preguntas por pieza: **¿cada cuánto cambia?** y **¿quién
la escribe: una persona, un proceso, o nadie?** Dos cosas con el mismo reloj y el mismo autor van
juntas; dos con relojes distintos se separan aunque sean «la misma capa».

**Por qué.** ✅ Este proyecto tiene cinco repos con relojes muy distintos —el generador con 3
commits en el mes, `foveal-vision` con 2.418, el repo de datos escrito por máquinas— y sigue siendo
operable. Si se hubiera partido en `frontend`/`backend`/`común`, el repo de datos y el código de
entrenamiento estarían en el mismo sitio, y cada medición sería un commit sobre el código.

**Cómo se comprueba.** Por cada pieza, `git log --since=<fecha fija> --oneline | wc -l` y quién
firma. Si dos piezas dan órdenes de magnitud distintas y están juntas, la frontera está mal puesta.
Si dan lo mismo y están separadas, la separación es coste sin beneficio.

**Antipatrón.** `común/`, `utils/`, `core/`: nombres que describen la *capa* y no dicen ni el reloj
ni el dueño. Acaban siendo el sitio donde va lo que no se sabe dónde poner.

### R2 · Toda separación tiene que degradar: sin una pieza, el resto sigue o falla ANTES de empezar

Al separar algo, decide explícitamente qué pasa cuando la pieza no está, y **sólo hay dos respuestas
aceptables**: (a) sigue funcionando con un valor por defecto declarado, o (b) se niega a empezar
diciendo qué falta y cómo se arregla. **Fallar a mitad no es una de las dos.**

**Por qué.** ✅ `fv.settings.data_root()` busca el repo de datos hermano y, si no está, cae al repo
de código y todo sigue: *«una separación que rompe al que no ha clonado nada es una separación que
nadie adopta»*. Y donde el fallback sería silencioso y caro, se elige (b): `estudio_flota.py --git`
**aborta antes de alquilar** si no encuentra dónde commitear, porque descubrirlo a mitad son
máquinas facturando para nada.

**Cómo se comprueba.** Renombra la pieza y ejecuta. Si el sistema arranca y muere veinte minutos
después, la separación está mal hecha.

**Antipatrón.** El fallback silencioso que *parece* (a) y es fallar a mitad: escribe resultados en
un sitio ignorado por git, termina sin un solo error, y el trabajo se pierde. Le pasó a este
proyecto un estudio entero el 2026-08-27.

### R3 · Una pieza que no se puede usar sola no es una pieza

Si para usar B hace falta tener A, C y D clonados en el sitio exacto, no has hecho cuatro piezas:
has hecho una, repartida en cuatro carpetas, con el coste de cuatro y las garantías de ninguna.

**Por qué.** ❌ Aquí ningún repo se puede clonar solo y usar: el grafo de dependencias es cíclico y
se expresa como rutas de disco. La consecuencia fue tener que inventar el concepto de **workspace**
—copiar los cuatro repos siempre juntos— para tapar el síntoma.

**Cómo se comprueba.** Clona la pieza sola en un directorio vacío y corre su suite. Si no puede ni
arrancar, escribe en su README **qué necesita al lado y por qué**, y trátalo como deuda, no como
diseño.

---

## 2. Al conectar dos piezas

### R4 · El acoplamiento se declara; nunca se deduce del layout del disco

Que B esté «al lado» de A es una coincidencia del sistema de ficheros, no un contrato. Una
dependencia se expresa como algo que se puede **configurar y validar**: variable de entorno, fichero
de configuración, dependencia de paquete. El descubrimiento automático vale como *comodidad por
defecto*, nunca como único mecanismo.

**Por qué.** ❌ `ROOT.parent / "image-text-sample-generator"` es una interfaz que no valida nadie
hasta que un script falla a mitad. Peor: el mismo repo busca el lanzador de **dos formas distintas**
—`ROOT.parent` en `estudio_flota.py:187` y `Path.home()/"src"/…` en `bench_fleet.py:59`—, así que
mover el árbol rompe uno y no el otro. ✅ El patrón correcto ya existe al lado: `FV_DATA_ROOT` gana
al hermano, y el hermano gana al fallback.

**Cómo se comprueba.** `grep -rn 'parent /\|\.\./\.\.' --include='*.py' --include='*.ts'`. Cada
resultado que cruce una frontera de pieza necesita su variable de entorno equivalente.

### R5 · Si importas de otra pieza, esa pieza tiene superficie pública declarada y tests de esa superficie

Importar convierte los detalles internos de la otra pieza en tu contrato. O declaras cuál es la
parte pública —y la pruebas— o cualquier refactor ajeno es un fallo tuyo, en producción.

**Por qué.** ❌ `estudio_flota.py` importa **19 funciones** de `vast_instance.py`, un fichero de
1.939 líneas escrito como CLI, **sin un solo test** y sin superficie declarada. Un renombrado se
descubre **con las máquinas ya alquiladas y facturando**. Es el acoplamiento más caro del sistema
sobre la garantía más débil.

**Cómo se comprueba.** Por cada import que cruce una pieza: ¿existe `__all__`, un módulo de API o
equivalente? ¿hay un test que ejercite esa función desde fuera? Si las dos respuestas son no, o se
añaden, o se anota en el reporte de arquitectura.

**Antipatrón.** `sys.path.insert(...)` apuntando a otro repo. Funciona, no declara nada y no
sobrevive a que alguien mueva el árbol.

### R6 · Cuando origen y destino son distintos a propósito, se escribe junto y con test

A veces la asimetría es deliberada: se lee de un sitio y se escribe en otro porque el consumidor no
tiene lo que tiene el productor. Eso **no** se «simplifica» igualando los dos: se documenta en el
punto exacto donde ocurre, con el motivo, y se ata con un test.

**Por qué.** ✅ El dataset se lee del repo de datos y se empaqueta en `data/window-datasets/`,
porque la máquina alquilada no tiene ese repo y **no debe tenerlo**. Está escrito en
`construir_payload` y en `window_datasets_root()`, en los dos extremos, y tiene test. Igualarlos
rompería el lado remoto y se descubriría con la flota facturando.

**Cómo se comprueba.** ¿Alguien que lea sólo uno de los dos lados podría «arreglarlo» y romper el
otro? Si sí, falta el aviso en el otro lado.

---

## 3. Al decidir dónde vive un artefacto

### R7 · Un artefacto vive en la pieza de quien lo produce, no en la de quien lo transporta

El sitio desde el que se lanza un trabajo no es el dueño de su resultado. El dueño es quien lo
midió, lo generó o lo decidió — porque es quien tiene el contexto para interpretarlo y quien lo
volverá a necesitar.

**Por qué.** ❌ **17 de 20 reportes de estudio** viven en el repo del bot de Telegram y sólo 3 en el
repo que mide; la tabla de qué parámetros están cerrados —el artefacto más valioso del proyecto—
vive en el README de reportes del bot. Hoy, quien clone sólo `foveal-vision` no puede saber qué está
decidido. El argumento de que «se dispara desde el coordinador» es cierto para el *lanzamiento*, y
lo que se guarda no es el lanzamiento: es el **veredicto**.

**Cómo se comprueba.** Pregunta: *si mañana desaparece la pieza donde está guardado, ¿lo echaría de
menos alguien que no la usa?* Si sí, está en el sitio equivocado.

### R8 · Separa el estado del historial: uno se reescribe, el otro sólo se añade

Un documento que responde *«qué es verdad hoy»* y otro que responde *«qué pasó»* tienen reglas de
edición opuestas. Juntarlos obliga a leerlo todo y ordenar por fecha para saber el presente.

**Por qué.** ❌ `foveal-vision/CLAUDE.md` son 1.442 líneas en forma de log, con bloques `✅ fecha —` y
marcas de `desactualizado` *dentro* del texto vivo. ✅ La disciplina del contenido es excelente
—cada afirmación con su procedencia— y hay que conservarla intacta: el problema es la forma, no el
fondo. El bloque «PENDIENTE AHORA MISMO» al principio del CLAUDE.md de este repo es el parche, y que
haga falta es el síntoma.

**Cómo se comprueba.** Busca `desactualizado`, `ya no aplica`, `~~` en documentos vivos. Cada
aparición es historial atrapado dentro de un documento de estado.

### R9 · Un dato que no se puede re-derivar y no se guarda, se pierde — y guardarlo NO cierra el defecto

Si algo que creías reproducible resulta que no lo es, guárdalo: es la decisión operativa correcta y
es barata. Pero **deja el defecto anotado como abierto**, porque el no-determinismo sigue ahí y
puede morder en otro sitio.

**Por qué.** ✅ y ❌ a la vez. `windows.npz` se commitea porque está **medido** (`repro-chk`,
2026-08-26) que reconstruirlo da otro dato — y esa decisión salvó la comparabilidad. Pero **nadie
diagnosticó por qué**: el almacenamiento crece sin techo y la causa sigue viva. Antes de eso se
perdió un dataset entero al rehacer la máquina, y con él **20 runs ya pagados**.

**Cómo se comprueba.** Por cada artefacto que el sistema declare «regenerable»: **regénéralo y
compara**. Si no coincide, o no es regenerable, o la comparación es la que está mal — y las dos
respuestas valen su coste.

---

## 4. Al escribir código que gasta, borra o lanza recursos

### R10 · El esfuerzo de prueba se reparte por consecuencia del fallo, no por facilidad de prueba

Lo que es fácil de probar se prueba solo. Ordena por **qué pasa si se equivoca** y comprueba que la
cobertura sigue ese orden, no el contrario.

**Por qué.** ❌ Aquí `src/fv` tiene 243 tests y contratos numerados; `estudio_flota.py` —2.006 líneas
que alquilan máquinas, las criban, las vigilan y las destruyen— **no tiene ninguno**. Lo que puede
equivocarse y cuesta 0 € está probado; lo que puede equivocarse y cuesta dinero, no.

**Cómo se comprueba.** Lista los componentes por consecuencia del fallo (dinero > datos perdidos >
resultado incorrecto > molestia) y pon al lado su número de tests. Si las dos columnas no
correlacionan, ahí está el trabajo.

**Antipatrón.** «Es que depende de una API externa y no se puede probar.» Se prueba con un doble de
esa API; lo que se está probando es **tu** lógica de reparto, reintento y limpieza, no la suya.

### R11 · Quien puede encender tiene que poder apagar — y el apagador sobrevive al encendedor

Si una pieza puede crear recursos que cuestan, otra pieza **con vida más larga** tiene que poder
enumerarlos y destruirlos. El freno va en el mismo commit que el acelerador, nunca después.

**Por qué.** ✅ El reparto mini/dev: *«el token de cualquier cosa que dev pueda ENCENDER tiene que
estar también en el mini. No para encender: para apagar»*. La capacidad de gastar vive en la máquina
desechable, el freno en la permanente. ❌ Antes de esa regla hubo **1 h 08 min** con capacidad de
alquilar máquinas por segundo y sin forma de apagarlas desde el móvil.

**Cómo se comprueba.** *Si la pieza que lanzó los recursos desaparece ahora mismo, ¿qué queda vivo y
quién puede matarlo?* Si la respuesta es «nadie», falta el freno.

### R12 · Lo efímero se registra según ocurre, no al terminar

Un resumen que se escribe al final sólo existe si hay final. Todo lo que corra sobre infraestructura
que puede morir tiene que dejar rastro **mientras avanza**.

**Por qué.** ✅ El libro de a bordo commitea los resultados de cada época a git — 2.287 de los 2.418
commits del mes— y de ahí sale gratis la reanudación por punto y sobrevivir a que se rehaga la
máquina de control. ❌ Y el contraejemplo está en el mismo fichero: `flota.json` —coste, reloj,
máquinas— **se escribe al terminar**, así que las flotas apagadas a mano dejaron su contabilidad
irrecuperable, dos veces.

**Cómo se comprueba.** Mata el proceso a mitad. Lo que no esté en disco en ese momento, no existe.

---

## 5. Al automatizar una decisión

### R13 · El criterio se escribe antes de mirar, y vive en código

Cualquier decisión con un umbral —qué es «mejor», cuándo se reintenta, cuándo se descarta— se define
**antes** de ver los datos, y se guarda donde se aplica. Escrito después, no se distingue de una
racionalización.

**Por qué.** ✅ Es lo mejor que tiene este proyecto. `protocolo.md` (R1–R6) y la `TABLA_PICO` dentro
del propio script de estudio hacen que «no hubo señal» sea **un resultado** y no una decepción. La
regla vale fuera del laboratorio: un reintento, un límite de gasto o una heurística de caché son el
mismo problema.

**Cómo se comprueba.** ¿El umbral está en el código o en la cabeza de alguien? ¿Existía antes del
primer dato? Si la respuesta es «se ajustó al ver los resultados», está midiendo la expectativa.

### R14 · Las reglas que no se pueden romper son tests, no prosa

Una invariante escrita en un documento se cumple mientras alguien la recuerde. Escrita como test se
cumple siempre. Si de verdad no se puede romper, tiene que ser imposible romperla en silencio.

**Por qué.** ✅ 44 contratos numerados y ejecutables. El ⑨ —*el objetivo no puede ser la pérdida si un
peso de la pérdida está en el espacio*— impide un experimento inválido **mecánicamente**. Y
`RENAMED_AXES` se niega a reinterpretar un nombre que cambió de significado, con el motivo: sin eso,
un spec viejo entrenaría otra red **en silencio**.

**Cómo se comprueba.** Rompe la invariante a propósito y comprueba que algo falla. Si no falla, no
es una invariante: es una costumbre.

### R15 · Una colisión se anuncia; nunca se resuelve en silencio

Cuando dos fuentes definen lo mismo, elige un ganador determinista **y dilo**. Que gane el primero
está bien; que nadie se entere, no.

**Por qué.** ✅ El registro de ejecutores anota lo pisado en `origen.pisados` y lo dicen tanto el
arranque como `/executors`. El razonamiento se generaliza: **un componente que hace otra cosa de la
que crees es peor que uno que falta**, porque el que falta se ve.

**Cómo se comprueba.** Provoca la colisión. Si la salida no la menciona, falta el aviso.

### R16 · La identidad la da un dato comprobable, no una convención de nombres

Para decidir de quién es un proceso, un recurso o un fichero, usa algo que el sistema pueda leer y
que no dependa de que alguien haya nombrado bien.

**Por qué.** ✅ *«De quién es un proceso lo dice su CWD, no su línea de comando»*: la flota se lanza
con ruta relativa, así que filtrar por la salida de `ps` clasifica **los procesos propios como
ajenos**. Y en la nube el dueño es una **etiqueta**, no el nombre. ✅ La misma idea en la caducidad de
un marcador: la vida de una sesión se lee del `mtime` de un fichero que ya se escribe solo, no de un
heartbeat que alguien tendría que mantener.

**Cómo se comprueba.** ¿El criterio de propiedad falla si alguien renombra algo, o si dos cosas se
llaman igual? Entonces no es identidad, es una convención.

---

## 6. Al dar por terminado

### R17 · Una comprobación que no corre sola no existe

Tests, linters y preflights que hay que acordarse de ejecutar se ejecutan hasta que hay prisa. Si la
comprobación importa, la dispara la máquina: en el commit, en el push o al arrancar.

**Por qué.** ❌ **Ninguno de los cinco repos tiene CI**, y hay 243 tests que nadie corre al empujar.
En un sistema cuya premisa es *«los servidores son efímeros, lo que no está empujado no existe»*, un
push roto se descubre **en la máquina siguiente**. ✅ El proyecto ya conoce la forma correcta y la
aplica en otro sitio: `bench-preflight.mjs` y el hook de sesión corren solos, y por eso funcionan.

**Cómo se comprueba.** `ls .github/workflows/` (o el equivalente). Y: ¿cuándo se corrió la suite por
última vez, y quién la disparó?

### R18 · El núcleo, genérico y estable; el comportamiento, dato

Lo que cambia a menudo no debería exigir tocar —ni desplegar— lo que no cambia. Si añadir una
capacidad obliga a editar el enrutado, el enrutado se ha comido el dominio.

**Por qué.** ✅ El coordinador: **92 líneas** de orquestador y 17 comandos operativos que son JSON
descubiertos en cada repo. Consecuencia real: un comando no existe si su repo no está clonado, **y
eso es correcto** — la ausencia se lee como lo que es.

**Cómo se comprueba.** Añade una capacidad nueva. ¿Hubo que tocar el núcleo? ¿Hubo que reiniciar o
reempaquetar? Si sí, la frontera entre mecanismo y política está mal puesta.

⚠ **Y el reverso, que aquí está midiéndose:** cuando la lógica de *operación* crece más rápido que
la de *dominio* —9.810 líneas en `scripts/` contra 7.124 en `src/fv`— hereda el riesgo sin heredar
la disciplina. Un `scripts/` que adelanta a `src/` es una señal de que hay dominio sin reconocer.

### R19 · Una migración a medias son dos sistemas

Mientras conviven el layout viejo y el nuevo, toda pregunta tiene dos respuestas y alguien escribe
un script para reconciliarlas. Termínala, o declara por escrito cuál es el estado final y qué falta.

**Por qué.** ❌ El repo de datos tiene a la vez `<año>/<mes>/sweeps/…` y `runs/` plano; hay una
función para leer el primero y un script cuyo único trabajo es mover del segundo al primero. «¿Dónde
está un run?» tiene dos respuestas.

**Cómo se comprueba.** ¿Existe código cuyo trabajo sea convertir entre dos formas internas de lo
mismo? Es una migración sin terminar con otro nombre.

---

## 7. Lista de comprobación, antes de dar un diseño por bueno

Diez preguntas. Cada «no» es deuda: se arregla o se anota **por escrito**, nunca se deja implícita.

1. ¿Cada pieza tiene un reloj y un dueño distintos de sus vecinas? *(R1)*
2. Si falta una pieza, ¿el resto sigue o se niega **antes** de empezar? *(R2)*
3. ¿Cada dependencia que cruza una pieza se puede configurar, o es una ruta de disco? *(R4)*
4. ¿Lo que importas de otra pieza tiene superficie declarada y tests? *(R5)*
5. ¿Cada artefacto vive donde su productor? *(R7)*
6. ¿El estado y el historial están en documentos distintos? *(R8)*
7. ¿La cobertura de tests sigue el orden de consecuencia del fallo? *(R10)*
8. Si muere quien lanzó los recursos, ¿alguien puede apagarlos? *(R11)*
9. ¿Los umbrales estaban escritos antes de ver los datos? *(R13)*
10. ¿Las comprobaciones las dispara la máquina? *(R17)*

---

## 8. Procedencia

Las reglas salen del **análisis de arquitectura del 2026-08-28**
([reporte](../reportes/2026/08-agosto/2026-08-28-analisis-arquitectura.md)), que revisó los cinco
repos de este sistema leyendo sus interfaces reales. **Todas las cifras citadas aquí están medidas
ese día**, con los comandos que ese reporte deja en su § 7; aquí se resumen y **no se re-derivan**,
que es la regla de siempre: el dato vive donde se produjo.

⚠ **Este documento crece con cada fallo, como un preflight.** Cuando una decisión de estructura
salga mal, la regla que lo habría evitado se añade aquí **en el mismo commit que el arreglo**, con
lo que costó — y si contradice a una de las diecisiete, se corrige la vieja en vez de añadir una
excepción.

⚠ **Y no se cita como autoridad.** Diecisiete reglas escritas a partir de **un** sistema, revisado
**una** vez. Aciertan en lo que ese sistema ya pagó; en un proyecto con otras restricciones —un
equipo grande, latencia dura, un binario que se distribuye— alguna sobra o se invierte. Si una regla
no encaja, el error puede estar en la regla: dilo aquí.
