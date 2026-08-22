#!/usr/bin/env sh
# Ejecuta un comando en su PROPIO cgroup, para que sobreviva a un
# `systemctl restart` del coordinador.
#
# Por que: `setsid`/`detached: true` da sesion y grupo de procesos propios, pero
# NO cgroup propio; el cgroup se hereda y no se toca. El unit del servicio es
# KillMode=control-group (el default), asi que un restart mata TODO lo que quede
# dentro de /system.slice/telegram-coordinator.service, incluido lo que se creia
# a salvo. Medido el 2026-08-19: el resumer espero sus 220 min, desperto puntual
# a las 22:00:32, y el restart de las 22:05:36 lo mato con la respuesta a medias.
#
# `systemd-run --scope` registra un cgroup aparte (/system.slice/<algo>.scope),
# que un restart del servicio ya no alcanza.
#
# NINGUN SECRETO VIAJA POR AQUI, y es a proposito: `sudo` escribe la lista de
# --preserve-env COMPLETA y en claro en el journal del sistema, asi que pasar
# BOT_TOKEN o DO_TOKEN por aqui los deja en disco en cada lanzamiento. Solo se
# conserva lo que no es credencial. Cada trabajo carga sus secretos por su
# cuenta desde disco:
#   - claude-resumer.mjs  ya lee BOT_TOKEN de .env si no lo hereda.
#   - el ejecutor `bench`  hace `. ~/.config/dev-secrets.env` dentro del comando.
# El cwd SI se conserva, que es lo que hace que encuentren esos ficheros. Y
# COORD_HOME viaja porque desde que cada ejecutor corre en el directorio de SU
# repo, el cwd ya no apunta al coordinador: es como se sigue encontrando
# notify.mjs para avisar al terminar.
#
# Si no se puede -sin sudo, sin systemd, otro SO- cae a `setsid`: se pierde la
# proteccion contra el restart, pero se conserva la del tree-kill del runner,
# que es exactamente como estaba antes. Nunca deja de lanzar el trabajo.
#
#   scripts/desacoplar.sh <comando> [args...]

VARS=COORD_SESSION,COORD_CHAT,COORD_THREAD,COORD_HOME,HOME,PATH,DATA_DIR,BENCH_VOLUME

if command -v systemd-run >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  exec sudo -n --preserve-env="$VARS" systemd-run --scope --quiet --collect \
       --uid="$(id -u)" --gid="$(id -g)" "$@"
fi

exec setsid "$@"
