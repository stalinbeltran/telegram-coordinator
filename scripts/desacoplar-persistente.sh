#!/usr/bin/env sh
# Lanza un trabajo COMO UNIDAD de systemd: sobrevive a que muera quien lo lanza.
#
#   scripts/desacoplar-persistente.sh <nombre-unidad> <comando> [args...]
#
# POR QUE EXISTE, y no basta con `desacoplar.sh`
# ----------------------------------------------
# `desacoplar.sh` usa `systemd-run --scope`. Eso da cgroup propio --sobrevive a
# `systemctl restart telegram-coordinator`, que es para lo que se escribio-- pero
# el proceso SIGUE SIENDO HIJO del que lo lanza, asi que un tree-kill al padre se
# lo lleva entero.
#
# Costo dinero el 2026-08-31. Se lanzo `entrenar_vast.py` con `desacoplar.sh`
# desde una sesion de Claude Code; la sesion termino, el harness mato el arbol de
# su comando, y el scope se fue con el. El entrenamiento en la maquina de Vast
# siguio vivo (1 h 38 min de reloj cuando se descubrio) y el proceso que baja los
# pesos Y DESTRUYE LA INSTANCIA habia desaparecido: trabajo intacto, factura
# corriendo, nadie mirando. Y no era la primera vez que moria un vigilante.
#
# QUE CAMBIA AQUI: `systemd-run` SIN `--scope` registra una **unidad transitoria**
# (un servicio), cuyo padre es **PID 1**. No es hijo de nadie mas, asi que no hay
# tree-kill que lo alcance. Ademas:
#
#   - `Restart=on-failure` lo levanta si se cae por un fallo. Para un vigilante
#     que puede volver a engancharse --como `adoptar_vast.py`-- eso es la
#     diferencia entre "hay que rescatarlo a mano" y "se arregla solo".
#     ⚠⚠ ...Y POR ESO EL LIMITE DE REINICIOS TIENE QUE SER DE VERDAD. El de
#     systemd por defecto es `StartLimitBurst=5` en `StartLimitIntervalSec=10s`,
#     y con `RestartSec=30` NUNCA CABEN 5 ARRANQUES EN 10 s: el limitador no
#     salta jamas y `on-failure` es un bucle infinito.
#
#     Medido dos veces, con el mismo mecanismo y dos meses de diferencia:
#       2026-09-02  la sonda L1 termino bien, `notify.mjs` fallo al final, y la
#                   unidad quedo reiniciandose cada 30 s -- 12 h de rejilla
#                   relanzadas por un aviso.
#       2026-09-04  un entrenamiento de 37 epocas termino bien, `notify.mjs`
#                   salio con 2 ("Falta BOT_TOKEN", que es lo que TIENE que pasar
#                   aqui: los secretos no viajan a una unidad, a proposito), y
#                   systemd la relanzo 62 VECES.
#     Las dos se "arreglaron" poniendo `|| true` en AQUEL sitio de llamada. Dos
#     veces el mismo arreglo puntual, y a la tercera volvio a morder: la trampa
#     no estaba en quien llama, estaba aqui.
#
#     La ventana pasa a 30 min, que es > `RestartSec` x `StartLimitBurst` (150 s)
#     y por tanto ALCANZABLE. Un trabajo que falla 5 veces en media hora se rinde
#     y se queda en `failed` -- visible en `systemctl status` -- en vez de
#     reintentar para siempre. Un vigilante que necesite mas de 5 reinicios en
#     media hora no se esta recuperando: esta roto.
#   - `systemctl status <nombre>` y `journalctl -u <nombre>` dicen que paso, que
#     con un scope anonimo (`--collect`) no se podia mirar.
#   - el log va a `/tmp/<nombre>.log`, que es donde se mira desde el movil.
#     ⚠ Ese fichero lo crea systemd como ROOT (0644): se LEE sin problema, pero
#     borrarlo pide `sudo rm`. Es lo que hay al pedirle a systemd que redirija; la
#     alternativa (`journalctl -u <nombre>`) tambien esta y no tiene ese pero.
#
# CUANDO USAR CADA UNO
# --------------------
#   desacoplar.sh              trabajo CORTO que puede morir con su turno, y del
#                              que solo hay que protegerse contra el restart del
#                              coordinador. Es la mayoria.
#   desacoplar-persistente.sh  trabajo LARGO cuya muerte cuesta dinero o pierde
#                              horas: cualquier cosa que alquile una maquina, o
#                              que la vigile. Si dudas, este.
#
# ⚠ EL NOMBRE ES UNICO. Una unidad con un nombre ya tomado NO arranca (a
# diferencia de un scope anonimo, que se apila). Es deliberado: dos vigilantes
# sobre la misma instancia se pisarian bajando el mismo fichero. Si de verdad
# quieres otro, dale otro nombre.
#
# ⚠ NINGUN SECRETO VIAJA POR AQUI, igual que en `desacoplar.sh` y por el mismo
# motivo: `sudo` escribe la lista de `--setenv` en claro en el journal. El
# comando carga los suyos de disco (`. ~/.config/dev-secrets.env`), y para eso se
# conservan el cwd y HOME.
#
# ⚠ SIN sudo/systemd NO hay unidad posible, y entonces esto se NIEGA en vez de
# caer a `setsid`: caer daria exactamente la falsa sensacion de persistencia que
# costo la maquina. Quien no pueda, que use `desacoplar.sh` sabiendo lo que no da.

set -eu

if [ "$#" -lt 2 ]; then
  echo "uso: $0 <nombre-unidad> <comando> [args...]" >&2
  exit 2
fi

UNIDAD="$1"; shift
LOG="${DESACOPLAR_LOG:-/tmp/${UNIDAD}.log}"

if ! command -v systemd-run >/dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
  echo "ERROR: hace falta systemd y sudo sin contrasena para una unidad persistente." >&2
  echo "  NO caigo a setsid: eso daria la falsa sensacion de que sobrevive, que es" >&2
  echo "  exactamente lo que costo una maquina de Vast facturando sola." >&2
  echo "  Si aceptas que muera con su padre, usa scripts/desacoplar.sh." >&2
  exit 1
fi

if systemctl is-active --quiet "$UNIDAD" 2>/dev/null; then
  echo "ERROR: ya hay una unidad activa llamada '$UNIDAD'." >&2
  echo "  Dos vigilantes sobre el mismo trabajo se pisan. Mira que hace:" >&2
  echo "    systemctl status $UNIDAD" >&2
  exit 1
fi
# una unidad que quedo en 'failed' bloquea el nombre sin estar corriendo
systemctl reset-failed "$UNIDAD" 2>/dev/null || true

echo "unidad: $UNIDAD   log: $LOG"
echo "  ver:     systemctl status $UNIDAD   ·   tail -f $LOG"
echo "  parar:   sudo systemctl stop $UNIDAD"

exec sudo -n systemd-run \
  --unit="$UNIDAD" \
  --uid="$(id -u)" --gid="$(id -g)" \
  --working-directory="$PWD" \
  --setenv=HOME="$HOME" \
  --setenv=COORD_HOME="${COORD_HOME:-}" \
  --setenv=COORD_SESSION="${COORD_SESSION:-}" \
  --setenv=COORD_CHAT="${COORD_CHAT:-}" \
  --setenv=COORD_THREAD="${COORD_THREAD:-}" \
  --property=Restart=on-failure \
  --property=RestartSec="${DESACOPLAR_ESPERA:-30}" \
  --property=StartLimitIntervalSec="${DESACOPLAR_LIMITE_VENTANA:-1800}" \
  --property=StartLimitBurst="${DESACOPLAR_LIMITE_ARRANQUES:-5}" \
  --property=StandardOutput="append:$LOG" \
  --property=StandardError="append:$LOG" \
  "$@"
