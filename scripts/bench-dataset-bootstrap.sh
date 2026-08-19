#!/usr/bin/env bash
# Prepara los venvs y construye el dataset del benchmark. Pensado para correr
# DESACOPLADO (decenas de minutos). La fuente de verdad es el log y el .npz.
set -uo pipefail

LOG=/tmp/bench-dataset-build.log
FOVEAL=/home/deploy/src/foveal-vision
GEN=/home/deploy/src/image-text-sample-generator

exec >>"$LOG" 2>&1
echo "===================================================================="
echo "INICIO $(date -Is)"
echo "===================================================================="

paso() { echo; echo "---- $* ----"; }

paso "1/3 venv de foveal-vision (numpy/pillow/pyyaml)"
if [ ! -x "$FOVEAL/.venv/bin/python" ]; then
  python3 -m venv "$FOVEAL/.venv" || { echo "FALLO: venv foveal"; exit 1; }
fi
"$FOVEAL/.venv/bin/python" -m pip install --upgrade pip -q || echo "aviso: pip upgrade falló"
( cd "$FOVEAL" && .venv/bin/python -m pip install -e . ) || { echo "FALLO: deps foveal"; exit 1; }
echo "foveal listo: $("$FOVEAL/.venv/bin/python" -c 'import numpy,PIL;print("numpy",numpy.__version__,"pillow",PIL.__version__)')"

paso "2/3 venv del generador + Chromium"
if [ ! -x "$GEN/.venv/bin/python" ]; then
  python3 -m venv "$GEN/.venv" || { echo "FALLO: venv generador"; exit 1; }
fi
"$GEN/.venv/bin/python" -m pip install --upgrade pip -q || echo "aviso: pip upgrade falló"
"$GEN/.venv/bin/python" -m pip install -r "$GEN/requirements.txt" || { echo "FALLO: deps generador"; exit 1; }
"$GEN/.venv/bin/python" -m playwright install chromium || { echo "FALLO: playwright chromium"; exit 1; }
sudo -n "$GEN/.venv/bin/python" -m playwright install-deps chromium || echo "aviso: install-deps falló (Chromium puede no arrancar)"

paso "3/3 build del dataset (los mil renders: esto es lo lento)"
cd "$FOVEAL" || exit 1
python3 scripts/bench_dataset.py build
CODE=$?

echo
echo "===================================================================="
echo "FIN $(date -Is) — bench_dataset.py build salió con código $CODE"
ls -la "$FOVEAL/data/window-datasets/bench-dirty1000-16/" 2>/dev/null || echo "(no hay ventanas)"
echo "===================================================================="
exit $CODE
