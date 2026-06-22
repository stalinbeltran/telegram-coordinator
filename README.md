# Coordinador de Telegram

Coordinador **inmutable** que recibe mensajes tuyos por Telegram y los enruta a
**ejecutores** y **encargados** definidos dinámicamente (sin recompilar).

```
Tú (Telegram, un tema = una sesión)
  → Coordinador → Ejecutor (comando shell) → salida de texto
                → Encargados (comandos shell) → comandos para el coordinador:
                     >>USER <texto>   te responde por Telegram
                     >>SHELL <cmd>    ejecuta y te envía la salida
```

## Conceptos

- **Ejecutor**: una plantilla de comando shell. Eliges uno por sesión. Recibe tu
  texto (por `{{input}}` si la plantilla lo contiene, o por `stdin`).
- **Encargado**: comando shell asociado a un ejecutor. Recibe la salida del
  ejecutor y devuelve "comandos" (ver protocolo) que el coordinador ejecuta.
- **Sesión**: un ejecutor ligado a un tema de Telegram. Identificada por
  `chatId + message_thread_id`, así varios temas corren en paralelo.

## Puesta en marcha (≈5 min)

1. Crea un bot con [@BotFather](https://t.me/BotFather) → `/newbot` → copia el token.
2. `cp .env.example .env` y pega el token en `BOT_TOKEN`.
3. `npm install`
4. `npm run dev`
5. Escríbele `/whoami` al bot, copia tu user id en `ALLOWED_USER_IDS` del `.env`
   y reinicia. **Sin esto el bot ignora a todos** (es ejecución remota de comandos:
   la allowlist es tu única protección).
6. (Recomendado) Crea un **grupo**, actívale **Temas/Topics**, añade el bot como
   admin. Cada tema será una sesión independiente.

## Uso

```
/use shell        abre sesión con el ejecutor "shell" en este tema
ls -a             (con sesión abierta) se ejecuta en el sistema
/who              ejecutor activo en este tema
/executors        lista de ejecutores
/end              cierra la sesión
/whoami           tu id de Telegram
```

## Kit de arranque (sembrado automático)

- Ejecutor **`shell`** → plantilla `{{input}}`: ejecuta lo que envíes.
- Ejecutor **`definer`** → crea ejecutores/encargados con parámetros simples.
- Encargado **`echo`** → reenvía la salida del ejecutor de vuelta a ti.

Con esto basta para crear todo lo demás desde Telegram.

## Definir ejecutores/encargados (forma fácil: `definer`)

`/use definer` y envía un mensaje donde la **1ra línea es el encabezado** y el
**resto es el comando** (literal, puede ser multilínea):

```
exec <nombre> [encargado1 encargado2 ...]
<comando>
```
```
enc <nombre>
<comando>
```

- En `exec`, si no listas encargados se asigna **`echo`** por defecto.
  Para no asignar ninguno: `exec <nombre> -`.
- El comando puede contener `{{input}}` (se sustituye por tu texto) o leer `stdin`.

**Ejemplo — crear un ejecutor `grep`:**

```
exec grep
grep -n {{input}}
```

Luego `/end`, `/use grep`, y manda `"patron" archivo.txt`.

> Alternativa manual: en sesión con `shell` puedes escribir directamente los
> archivos JSON en `data/executors/` o `data/encargados/`.

### Protocolo de comandos (salida de un encargado)

```
>>USER <texto>    enviar <texto> al usuario por Telegram
>>SHELL <cmd>     ejecutar <cmd> y enviar su salida
(sin prefijo)     equivale a >>USER con todo el texto
```

## Estructura

```
src/
  index.ts         bot, allowlist, comandos de control, troceo de mensajes
  config.ts        carga de .env y validación
  registry.ts      ejecutores/encargados + sembrado del kit de arranque
  sessions.ts      sesiones por tema (persistidas)
  runner.ts        ejecución de shell con timeout y captura de errores
  protocol.ts      parseo de >>USER / >>SHELL
  orchestrator.ts  flujo ejecutor → encargados → comandos
data/
  executors/*.json
  encargados/*.json
  sessions/*.json  (efímero, ignorado por git)
```

## Notas

- **Multiplataforma**: el shell por defecto es `cmd.exe` (Windows) o `/bin/sh`
  (Linux). Las plantillas que dependan del SO defínelas según dónde corra el
  coordinador. Los helpers de arranque usan `node -e` para funcionar en ambos.
- **Timeout** por comando: `COMMAND_TIMEOUT_MS` (30 s por defecto).
- **Despliegue** (p.ej. droplet de DigitalOcean): usa long polling, no necesita
  IP pública ni puertos abiertos. Corre con un gestor de procesos (pm2/systemd).
```
