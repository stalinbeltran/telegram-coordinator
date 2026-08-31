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
# ⚠⚠ A QUE NO SOBREVIVE, Y COSTO UNA MAQUINA FACTURANDO (medido 2026-08-31)
# ------------------------------------------------------------------------
# `--scope` da cgroup propio, pero el proceso SIGUE SIENDO HIJO del que lo lanza.
# Un tree-kill al padre se lo lleva entero. O sea:
#
#     sobrevive a  `systemctl restart telegram-coordinator`   <- para lo que se escribio
#     NO sobrevive a que muera su propio padre                <- lo que nadie habia escrito
#
# Paso asi: se lanzo `entrenar_vast.py` desde una sesion de Claude Code con este
# script; la sesion termino, el harness mato el arbol de su comando, y con el se
# fue el scope. El entrenamiento en la maquina alquilada siguio vivo (1 h 38 min
# cuando se descubrio) pero el proceso que baja los pesos Y DESTRUYE LA INSTANCIA
# habia desaparecido: trabajo intacto, factura corriendo, nadie mirando.
#
# QUE USAR PARA TRABAJO LARGO QUE NO PUEDE MORIR CON QUIEN LO LANZA: una unidad
# transitoria, o sea `systemd-run` SIN `--scope`. Su padre es PID 1 y sobrevive a
# las dos cosas. Cuesta un nombre de unidad y da ademas `systemctl status`:
#
#   sudo systemd-run --unit=<nombre> --uid=$(id -u) --gid=$(id -g) \
#        --working-directory="$PWD" --setenv=HOME="$HOME" \
#        --property=StandardOutput=append:/tmp/<nombre>.log \
#        --property=StandardError=append:/tmp/<nombre>.log \
#        /bin/bash -lc '<comando>'
#
# Este script NO se cambia a unidad: la mayoria de lo que pasa por aqui son
# trabajos cortos que sí quieren morir con su turno, y una unidad con nombre fijo
# choca si se lanza dos veces. Lo que hacia falta era decir a que NO sobrevive.
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
