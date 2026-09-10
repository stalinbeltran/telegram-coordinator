#!/usr/bin/env bash
# Reiniciar el coordinador SIN matarte a ti mismo.
#
# Por qué existe, medido el 2026-09-10
# ------------------------------------
# El servicio es `KillMode=control-group`, así que `systemctl restart` mata TODO
# lo que haya en su cgroup. Y el `claude` que atiende un mensaje de Telegram vive
# ahí dentro: reiniciar desde un turno es matarse a media respuesta. Pasó ese día
# —el reinicio funcionó, el trabajo estaba commiteado y empujado, pero la
# respuesta que lo explicaba nunca llegó al usuario, que volvió a preguntar lo
# mismo—. El síntoma desde fuera es «no me contestaste».
#
# El `CLAUDE.md` ya lo advertía. No bastó: lo que falla no es no saberlo, es
# ejecutar la comprobación y el `restart` en el mismo comando y no mirar el
# resultado. Por eso esto es un FRENO y no otra nota.
#
# Qué hace: si quien lo llama NO está en el cgroup del bot, reinicia y ya. Si lo
# está, **no se suicida**: programa el reinicio para dentro de unos segundos, con
# `systemd-run`, de modo que ocurra cuando el turno haya terminado.
#
# ⚠⚠ Y TRAE MODO SECO, por la misma razón que lo trae cualquier lanzador de este
# proyecto: **ejecutarlo tiene efecto, así que sin modo seco no se puede
# comprobar sin consecuencias**. Lo aprendí en el mismo commit — lo corrí «para
# ver si funcionaba» y programó un reinicio de verdad, que hubo que cancelar
# antes de que cortara la respuesta que estaba escribiendo.
#
#     scripts/reiniciar-bot.sh --seco    → dice qué haría, sin hacerlo
set -euo pipefail

UNIDAD=telegram-coordinator
SECO=0
if [ "${1:-}" = "--seco" ]; then SECO=1; shift; fi
ESPERA="${1:-20}"

mio=$(cat /proc/self/cgroup 2>/dev/null | head -1)

if [[ "$mio" != *"$UNIDAD"* ]]; then
  if [ "$SECO" = 1 ]; then
    echo "🧪 SECO — no he tocado nada."
    echo "   No estoy en el cgroup de $UNIDAD, así que haría:  systemctl restart $UNIDAD"
    exit 0
  fi
  echo "Reiniciando $UNIDAD (no estoy en su cgroup: es seguro)…"
  sudo -n systemctl restart "$UNIDAD"
  sleep 3
  systemctl is-active "$UNIDAD"
  exit 0
fi

# ⚠ Aquí está la gracia: reiniciar ahora mataría a quien lo pide.
if [ "$SECO" = 1 ]; then
  echo "🧪 SECO — no he tocado nada."
  echo "   Estoy DENTRO del cgroup de $UNIDAD, así que PROGRAMARÍA el reinicio:"
  echo "     systemd-run --on-active=${ESPERA}s --unit=reiniciar-${UNIDAD} systemctl restart $UNIDAD"
  exit 0
fi
echo "⚠ Estoy DENTRO del cgroup de $UNIDAD: reiniciar ahora me mataría a mitad."
echo "  Lo programo para dentro de ${ESPERA}s, cuando este turno haya terminado."
sudo -n systemd-run --on-active="${ESPERA}s" --unit="reiniciar-${UNIDAD}" \
  systemctl restart "$UNIDAD" >/dev/null
echo "✅ Programado. El bot se reinicia solo en ${ESPERA}s; este turno acaba antes."
echo "   Comprobar después:  systemctl show $UNIDAD -p ActiveEnterTimestamp --value"
