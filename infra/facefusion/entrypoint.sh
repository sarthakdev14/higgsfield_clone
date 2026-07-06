#!/bin/sh
# Pre-pull the FaceFusion models once, then start the swap API.
#
# FaceFusion normally downloads models lazily on the first run, which makes the
# first face swap very slow. We instead pre-download them at container startup
# into /facefusion/.assets, which is a named docker volume — so the download
# happens once and persists across restarts (the marker file makes restarts a
# no-op).
#
# FaceFusion has no per-model download flag; `force-download` only supports a
# `lite` / `full` scope. We pre-pull `lite` (the reliable minimal set: face
# analyser + a base swapper) — `full` is avoided because it greedily fetches many
# unrelated heavy models (frame colorizer, deep-swap "corridor", age modifier, …)
# and a single corrupt source aborts the whole thing. The extra models our
# max-quality swap config needs (hyperswap swapper, GFPGAN enhancer, occlusion
# masker) are auto-downloaded lazily on the FIRST swap, then cached in the volume,
# so only that first swap is slow.
set -e

ASSETS_DIR="/facefusion/.assets"
MARKER="${ASSETS_DIR}/.models-downloaded"

if [ -f "${MARKER}" ]; then
  echo "[facefusion] Pre-download already attempted; skipping."
else
  # Best-effort, single attempt. `force-download` is all-or-nothing and can abort
  # on an upstream-corrupt model we don't even use (e.g. corridor_key_1024), so we
  # don't gate on its exit code — the models our swap config actually needs are
  # fetched lazily (and validated) on the first swap regardless. Mark it done
  # either way so restarts don't re-attempt the (possibly broken) bulk download.
  echo "[facefusion] Pre-downloading models (lite scope, best-effort) — runs once, persisted in the .assets volume…"
  python facefusion.py force-download --download-scope lite \
    && echo "[facefusion] Model pre-download complete." \
    || echo "[facefusion] WARNING: pre-download incomplete; needed models will download lazily on first swap." >&2
  touch "${MARKER}"
fi

echo "[facefusion] Starting swap API on :7865"
exec uvicorn server:app --host 0.0.0.0 --port 7865 --app-dir /facefusion
