#!/usr/bin/env sh
# Un barrido de velocidad en Vast.ai, de principio a fin y sin nadie mirando.
#
#   sh scripts/vast-sweep.sh [argumentos de `vast_instance.py sweep`]
#   sh scripts/vast-sweep.sh --cpus 2,4,8,16
#   sh scripts/vast-sweep.sh --cpus 16 --min-ram 8
#
# Hace las tres cosas en orden, y las tres tienen que pasar aunque el turno que
# lo lanzo (o el bot entero) se muera a mitad:
#
#   1. medir     alquila una maquina por nivel de vCPU, mide y la destruye
#   2. publicar  commit + push de los resultados; lo que no esta empujado no existe
#   3. barrer    comprobar que no queda NADA facturando, y cerrarlo si queda
#
# Por que un script y no un ejecutor con todo dentro: el ejecutor `barrido` es
# solo la linea que desacopla esto (`scripts/desacoplar.sh`). La logica vive
# aqui, donde se puede leer, versionar y probar sin Telegram:
#
#   VAST_SWEEP_LOG=/dev/stdout sh scripts/vast-sweep.sh --dry-run
#
# NO se corre dentro de un turno: tarda decenas de minutos. Un `claude -p` muere
# al responder y se lleva por delante todo lo que lanzo, asi que el ejecutor lo
# manda a su propio cgroup y este script avisa por su cuenta al terminar.
#
# El aviso es una comodidad. La fuente de verdad son los JSON commiteados en
# results/ y este log.
set -u

# El repo del coordinador, deducido de donde vive este script: hace falta para
# el `.env` (BOT_TOKEN) y para notify.mjs, y asi da igual desde donde se llame.
COORD=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 1
LANZADOR="${VAST_LANZADOR:-$HOME/src/digital-ocean-dropplet-auto-launching}"
BENCH="${VAST_BENCH:-foveal-cpu}"
LOG="${VAST_SWEEP_LOG:-/tmp/vast-sweep-${COORD_SESSION:-suelto}.log}"

exec >>"$LOG" 2>&1

# Los secretos se cargan de disco a proposito: `desacoplar.sh` no los deja
# pasar, porque sudo escribe la lista entera de --preserve-env en claro en el
# journal y ahi acabarian BOT_TOKEN y los tokens de las APIs.
set -a
[ -f "$COORD/.env" ] && . "$COORD/.env"
[ -f "$HOME/.config/dev-secrets.env" ] && . "$HOME/.config/dev-secrets.env"
set +a

avisar() {
    node "$COORD/scripts/notify.mjs" "$1" >/dev/null 2>&1 || true
}

morir() {
    echo "ABORTADO: $1"
    avisar "Barrido de Vast abortado: $1"
    exit 1
}

[ -d "$LANZADOR" ] || morir "no encuentro el lanzador en $LANZADOR (clonalo o pon VAST_LANZADOR)"
cd "$LANZADOR" || morir "no puedo entrar en $LANZADOR"

# `--yes` siempre: aqui no hay nadie para contestar a la confirmacion. El
# `--bench` solo se pone si no venia ya, para poder medir otra cosa sin tocar
# esto (`barrido --bench otro --cpus 8`).
case " $* " in
    *" --bench "*) ;;
    *) set -- --bench "$BENCH" "$@" ;;
esac

# Cual quedo de verdad: si venia en los argumentos manda ese, y el aviso final
# tiene que apuntar a SU tabla, no a la de foveal-cpu.
anterior=""
for arg in "$@"; do
    [ "$anterior" = "--bench" ] && BENCH="$arg"
    anterior="$arg"
done

echo "================================================================"
echo "=== $(date -u +%FT%TZ)  sweep $*"
echo "================================================================"

python3 scripts/vast_instance.py sweep --yes "$@"
rc_sweep=$?
echo ""
echo "=== el barrido salio con codigo $rc_sweep ==="

# ------------------------------------------------------------------ 2. publicar
#
# Se empuja a la rama en la que este el lanzador, con su mismo nombre. Si no es
# `main` se dice, porque un clon limpio saca `main`: un resultado parado en otra
# rama es invisible para la maquina siguiente, que es la forma cara de perderlo.
echo ""
echo "=== $(date -u +%FT%TZ)  commit y push ==="
rama=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
git add -A results/
if git diff --cached --quiet; then
    echo "Nada que commitear: el barrido no dejo ninguna medida."
    publicado="no habia nada que publicar"
else
    mensaje=$(python3 - <<'PY'
import json, pathlib, subprocess

nuevos = subprocess.run(["git", "diff", "--cached", "--name-only"],
                        capture_output=True, text=True).stdout.split()
filas, gasto = [], 0.0
for f in sorted(nuevos):
    if not (f.endswith(".json") and "/results/" in "/" + f):
        continue
    try:
        d = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        continue
    m = d.get("maquina", {})
    gasto += float(d.get("usd_medida") or 0)
    filas.append("- %.0f vCPU (%s): %s %s a %.4f $/h" % (
        float(m.get("vcpu") or 0), m.get("cpu") or "?",
        d.get("metrica"), d.get("unidad", ""), float(d.get("usd_hora") or 0)))

print("bench: barrido de velocidad en Vast.ai\n\n"
      "Una maquina alquilada por nivel, medida y destruida.\n"
      "Lanzado por el ejecutor `barrido` del coordinador.\n\n"
      + ("\n".join(filas) or "(sin filas legibles)")
      + f"\n\nGastado en el barrido: {gasto:.4f} $.\n"
      "La tabla la rehace vast_instance.py a partir de estos JSON.")
PY
    )
    if ! git commit -q -m "$mensaje"; then
        publicado="NO -- el commit fallo; los JSON estan en el disco sin mas"
    else
        echo "Commiteado en '$rama': $(git log --oneline -1)"
        # Un push rechazado por ir por detras no es un fallo del barrido: se
        # reintegra y se reintenta una vez. Si vuelve a fallar, el dato sigue
        # commiteado en local y el aviso lo dice.
        if git push origin "HEAD:$rama"; then
            publicado="si, en '$rama'"
        elif git pull --rebase origin "$rama" && git push origin "HEAD:$rama"; then
            publicado="si, en '$rama' (tras rebase)"
        else
            publicado="NO -- commiteado en local pero el push fallo"
        fi
        [ "$rama" = "main" ] || publicado="$publicado; OJO: no es main, un clon limpio no lo vera"
    fi
    echo "=== push: $publicado ==="
fi

# -------------------------------------------------------------------- 3. barrer
#
# Una instancia viva factura por segundo aunque el proceso que la alquilo ya no
# exista, asi que no vale con fiarse del `finally` del barrido: se comprueba.
# Solo se destruye lo que lleva etiqueta de medir (`sweep-*` / `bench-*`); lo
# demas se reporta y no se toca, que puede ser algo del usuario.
echo ""
echo "=== $(date -u +%FT%TZ)  que no quede nada facturando ==="
vivas=$(python3 scripts/vast_instance.py list 2>&1)
echo "$vivas"

if echo "$vivas" | grep -q "No hay ninguna instancia viva"; then
    limpio="si"
else
    mias=$(echo "$vivas" | awk '$1 ~ /^[0-9]+$/ && $2 ~ /^(sweep|bench)-/ {print $1}')
    ajenas=$(echo "$vivas" | awk '$1 ~ /^[0-9]+$/ && $2 !~ /^(sweep|bench)-/ {print $1}')
    for id in $mias; do
        echo "--- sobrevivio la instancia $id del barrido: se destruye"
        python3 scripts/vast_instance.py destroy "$id" --yes 2>&1
    done
    if [ -n "$ajenas" ]; then
        echo "--- vivas y NO son del barrido, no se tocan: $(echo "$ajenas" | tr '\n' ' ')"
    fi
    echo "--- recuento final ---"
    vivas=$(python3 scripts/vast_instance.py list 2>&1)
    echo "$vivas"
    if echo "$vivas" | grep -q "No hay ninguna instancia viva"; then
        limpio="si (hubo que cerrar alguna a mano)"
    else
        limpio="NO -- queda algo vivo, miralo: vast_instance.py list"
    fi
fi

echo ""
echo "=== $(date -u +%FT%TZ)  TERMINADO ==="
echo "sweep=$rc_sweep  publicado=$publicado  sin_instancias_vivas=$limpio"

avisar "Barrido de Vast terminado (codigo $rc_sweep).
Publicado: $publicado
Sin instancias vivas: $limpio
Tabla: $LANZADOR/results/$BENCH/tabla.md
Log: $LOG"
