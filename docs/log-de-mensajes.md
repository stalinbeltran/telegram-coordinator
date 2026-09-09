# El log de mensajes — el formato, que es el contrato

**Qué es.** Un JSONL por sesión con lo que se dijo en ese tema:
`data/mensajes/<sesión>.jsonl`, sólo-añadir, una línea por mensaje.

**Por qué está escrito aquí.** Lo produce el coordinador, así que su formato vive
donde su productor. Lo consume
[`claude-code-webapp-mobile`](https://github.com/stalinbeltran/claude-code-webapp-mobile),
que **enlaza a este documento y no lo copia**: dos mitades desfasadas es
exactamente como se rompe un contrato entre repos.

Lo implementa [`scripts/mensajes.mjs`](../scripts/mensajes.mjs) y lo fija
[`tests/mensajes.test.mjs`](../tests/mensajes.test.mjs).

## La línea

```json
{"id":"mf5kfojk000284b5c","ts":"2026-09-09T18:22:31Z","sesion":"-1001234567_7",
 "autor":"claude","origen":"telegram","texto":"## Resultado\n\n| a | b |\n"}
```

| campo | qué es |
|---|---|
| `id` | ordenable lexicográficamente: `<ms base36, 8><contador, 3><azar, 6>`. Es con lo que pagina `?desde=` |
| `ts` | UTC, sin milisegundos |
| `sesion` | `<chatId>_<threadId>` — la misma identidad que usa todo lo demás del coordinador |
| `autor` | `usuario` · `claude` · `sistema` |
| `origen` | `telegram` · `web` · `resumer` · `repetir` · `creset` · `shell` |
| `texto` | el mensaje **entero**, con sus saltos escapados por JSON |

`autor` es **quién habla**; `origen`, **por dónde entró**. Se separan porque un
mensaje tuyo puede llegar desde Telegram o desde la web, y hay que poder
distinguirlo cuando algo se comporte raro.

⚠ Un `autor` o un `origen` que no estén en esas listas **se rechazan**: no se
escriben y se dice por qué. Si entraran, el lector tendría que aprender a mostrar
categorías que nadie diseñó.

## Lo que el fichero garantiza

1. **Una línea = un mensaje entero.** Aunque Telegram lo trocee a 4000
   caracteres, aquí va completo y en una sola línea: por eso el lector puede
   reconstruir una tabla que en el chat llegó partida. Tiene test.
2. **Sólo se añade.** Nadie reescribe líneas; la purga reescribe el fichero entero
   y es la única excepción.
3. **Los `id` crecen**, incluso dentro del mismo milisegundo y aunque el reloj
   retroceda por un ajuste de NTP.
4. **El texto está redactado** con [`redactar.mjs`](../scripts/redactar.mjs) — el
   mismo módulo que usan el archivador de conversaciones y el log de errores.
5. **El texto puede venir recortado**, con tope de `COORD_LOG_MAX` (64.000 por
   defecto). Cuando se recorta **lo dice dentro del propio texto**: un mensaje
   truncado en silencio se lee como un mensaje corto.

## Lo que NO garantiza, y hay que saberlo

⚠ **No es la conversación de claude.** Aquélla vive en el almacén de claude,
indexada por el uuid que deriva `claude-marker.mjs`. Esto es una **transcripción
paralela** y se pueden desincronizar: un `creset` empieza una conversación nueva
sin borrar el log, y un resumer reinyecta un turno. Esos sucesos se registran
como mensajes de `autor: "sistema"`; **no se esconden**, porque un lector que
enseña un contexto que claude ya no tiene es peor que uno que no enseña nada.

⚠ **No sobrevive a rehacer la máquina.** `data/mensajes/` está en `.gitignore`,
como el resto del estado por tema. Es deliberado: contiene todo lo que Claude
dijo, incluidas salidas de shell y rutas.

## Dónde se escribe, y por qué importa

En el `data/` **del coordinador que corre**, uno por máquina, indexado por tema —
igual que `claude-sessions/` y `shell-cwd/`.

⚠⚠ La ruta sale de `DATA_DIR`, que el coordinador pasa **absoluto** a todo
comando, y el fallback es `COORD_HOME/data`; **nunca** `'data'` relativo al cwd.
Con un fallback relativo, un tema atado a un workspace escribiría su log en la
copia (`~/ws/tema-2/telegram-coordinator/data/mensajes/`) y el log quedaría
**partido en dos sin dar un solo error** — la misma forma del fallo de
`notify.mjs` con `.env` del 2026-09-04, que pareció intermitente durante días
porque dependía de qué ejecutor lanzaras. Tiene test.

## Quién escribe

- **El coordinador**, en cada vuelta: la entrada del usuario y la respuesta
  **antes de trocearla**.
- **Los procesos desacoplados** (`notify.mjs`, `repetir-bucle.mjs`,
  `claude-resumer.mjs`, `claude-reset.mjs`), **directamente al fichero**.

⚠ Los desacoplados **no** hablan con el coordinador por HTTP a propósito: si
tuvieran que hacerlo, dejarían de funcionar justo cuando el bot está caído, que es
cuando más falta hacen. Es el mismo razonamiento que ya está escrito en
[`errores.mjs`](../scripts/errores.mjs).

Es seguro porque cada mensaje es **una línea y un solo `write` en modo `a`**
(`O_APPEND`): en Linux los write a un fichero regular se serializan por el inode,
así que dos procesos no se intercalan a media línea. *(Leído, NO medido aquí; en
otros sistemas de ficheros no se ha comprobado.)*

## La purga

**30 días o 300 mensajes por sesión, lo que llegue primero** (`COORD_LOG_DIAS`,
`COORD_LOG_TOPE`). Corre **al arrancar el coordinador y una vez al día**.

⚠ Al arrancar y no sólo cada 24 h porque estas máquinas se rehacen y se
reinician constantemente: un ciclo que sólo dispara al día siguiente puede no
dispararse nunca.

⚠ **No es sólo higiene de disco.** El log tiene todo lo que Claude dijo,
incluidas salidas de shell y rutas: la purga es lo que acota cuánto hay que
perder si alguien entra en la máquina.

⚠⚠ **Y la carrera con los desacoplados está resuelta, no ignorada.** Reescribir
un fichero al que otros procesos hacen `append` puede perder lo que llegue entre
que se lee y que se sustituye — y lo que se perdería es justo el aviso de un
trabajo largo que acaba de terminar. Así que se escribe en un temporal y **antes
de renombrar se comprueba que el original no ha crecido**; si creció, esa purga
se salta. Es idempotente: vuelve mañana. Tiene test, con la costura para
provocar el append a propósito.

⚠ Una línea **sin fecha legible se conserva**: perder un mensaje por no saber
cuándo es sería peor que guardar uno de más.

---

## El latido: `data/coordinador.json`

Va aquí porque lo lee el mismo consumidor y por la misma razón: sin él, la web no
puede distinguir **«claude está pensando»** de **«el bot está parado»**, y las dos
se ven igual — una conversación que no avanza.

```json
{"pid": 30973, "arrancado": "2026-09-09T20:06:54Z", "visto": "2026-09-09T21:31:02Z",
 "vence_ms": 45000,
 "turnos": {"-1001234567_7": {"desde": "2026-09-09T21:30:58Z", "ejecutor": "c"}}}
```

| campo | qué es |
|---|---|
| `visto` | cuándo se refrescó por última vez. Se reescribe cada 15 s |
| `vence_ms` | **la regla de caducidad viaja con el dato**: pasado eso desde `visto`, todo lo de este fichero se descarta |
| `turnos` | qué sesiones tienen un ejecutor corriendo **ahora** |

⚠⚠ **Los turnos viven DENTRO del latido, y eso no es por ahorrar un fichero.**
El proceso puede morir por SIGKILL sin borrar nada, así que un fichero de turnos
aparte sería un cerrojo sin dueño vivo — el fallo que ya costó el `.resume.lock`,
donde un fallo de una tarde dejó una función muerta en silencio para siempre.
Compartiendo fichero, cuando el latido vence **los turnos se caen con él**: no
hay estado que sobreviva a su dueño, y no hay nada que limpiar.

⚠ La ventana son **3 latidos** y no uno: un latido perdido por carga, o por un
turno que bloquea el bucle un instante, no puede leerse como una caída.

⚠ Y se escribe de forma **síncrona**. Con escrituras asíncronas sin esperar,
empezar y terminar un turno son dos escrituras concurrentes del mismo fichero y
pueden llegar en orden inverso: el latido se queda diciendo que hay un turno que
ya acabó. Lo pilló su test de integración el 2026-09-09.

Como el resto del estado por tema, **no se commitea**.
