# El fixture del log de mensajes

`ejemplo.jsonl` es **una copia real**: lo generó `scripts/mensajes.mjs`, no está
escrito a mano. Por eso vale como contrato — un fixture inventado sólo prueba que
alguien supo escribir JSON.

**Está en los dos lados**, aquí y en
[`claude-code-webapp-mobile/tests/fixtures/mensajes/`](https://github.com/stalinbeltran/claude-code-webapp-mobile),
byte a byte igual. Es lo que permite probar el formato **desde el productor y
desde el consumidor** sin que ninguno de los dos tenga que arrancar al otro.

Cubre los siete casos que el lector tiene que saber mostrar:

| # | qué |
|---|---|
| 1 | un mensaje tuyo desde Telegram |
| 2 | una respuesta de claude con **tabla, lista anidada, `código en línea` y cita** — lo que Telegram enseña en crudo |
| 3 | un error del coordinador (`autor: sistema`) |
| 4 | una vuelta de `repetir` (`origen: repetir`) |
| 5 | una respuesta **recortada** por el tope, con su aviso dentro del texto |
| 6 | la **divisoria** de un `creset` (`origen: creset`) |
| 7 | un mensaje tuyo escrito **desde la web** (`origen: web`) |

⚠ **Si cambia el formato, este fichero se regenera y se copia a los dos repos en
el mismo commit.** Dos copias que divergen es exactamente el fallo que un
contrato compartido existe para evitar. El comando está en
`tests/mensajes-fixture.test.mjs`, que además comprueba que el fixture sigue
cumpliendo lo que promete [`docs/log-de-mensajes.md`](../../../docs/log-de-mensajes.md).
