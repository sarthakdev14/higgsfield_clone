"""Thin HTTP wrapper around FaceFusion's `headless-run` CLI.

FaceFusion 3.6.1 ships only a Gradio UI and a CLI (no built-in REST API), so we
expose a tiny FastAPI service that the backend can call like any other provider:

    POST /swap   (multipart: source + target images) -> swapped image bytes
    GET  /health

`source` is the face to apply; `target` is the base image being modified.
"""

import os
import subprocess
import tempfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

app = FastAPI(title="FaceFusion Swap API")

FACEFUSION_DIR = "/facefusion"
# Models download on first use, then face processing runs — both can be slow on CPU.
TIMEOUT_SECONDS = 14 * 60


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# --- Swap tuning (env-overridable; defaults favour IDENTITY/likeness) ----------
#
# The single biggest lever on "does it look like me" is the GFPGAN face enhancer:
# at a high blend it regenerates the face from a generic restoration prior, which
# averages out the source person's features. We therefore keep its blend LOW by
# default (identity dominates) and allow disabling it entirely for max likeness.
#
#   FACE_SWAPPER_MODEL        swapper network (default hyperswap_1a_256)
#   FACE_SWAPPER_PIXEL_BOOST  swapper output resolution (default 1024x1024)
#   FACE_ENHANCER_ENABLED     run the GFPGAN enhancer pass at all (default true)
#   FACE_ENHANCER_MODEL       enhancer network (default gfpgan_1.4)
#   FACE_ENHANCER_BLEND       0-100; how much enhancement to blend in (default 30)
#   FACE_MASK_BLUR            0-1; edge feather — lower keeps more swapped face (default 0.2)
FACE_SWAPPER_MODEL = _env("FACE_SWAPPER_MODEL", "hyperswap_1a_256")
FACE_SWAPPER_PIXEL_BOOST = _env("FACE_SWAPPER_PIXEL_BOOST", "1024x1024")
FACE_ENHANCER_ENABLED = _env_flag("FACE_ENHANCER_ENABLED", True)
FACE_ENHANCER_MODEL = _env("FACE_ENHANCER_MODEL", "gfpgan_1.4")
FACE_ENHANCER_BLEND = _env("FACE_ENHANCER_BLEND", "30")
FACE_MASK_BLUR = _env("FACE_MASK_BLUR", "0.2")


def _extension(upload: UploadFile, default: str = "jpg") -> str:
    name = upload.filename or ""
    if "." in name:
        return name.rsplit(".", 1)[1].lower()
    mime_map = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
    return mime_map.get(upload.content_type or "", default)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/swap")
async def swap(source: UploadFile = File(...), target: UploadFile = File(...)) -> FileResponse:
    with tempfile.TemporaryDirectory() as work_dir:
        source_path = os.path.join(work_dir, f"source.{_extension(source)}")
        target_ext = _extension(target)
        target_path = os.path.join(work_dir, f"target.{target_ext}")
        output_path = os.path.join(work_dir, f"output.{target_ext}")

        with open(source_path, "wb") as f:
            f.write(await source.read())
        with open(target_path, "wb") as f:
            f.write(await target.read())

        # Max-likeness config: the newest high-res swapper (hyperswap) with full
        # pixel boost, an occlusion mask so hair/hands over the face aren't
        # overwritten, a tight mask blur so more of the swapped face survives at
        # the edges, and lossless image output. The GFPGAN face enhancer is kept
        # at a LOW blend (or disabled) so it restores detail WITHOUT averaging out
        # the source person's features — see the env knobs above. CPU-only (no GPU
        # on this host); slower per frame but we only swap a block's 1-2 still
        # frames, so the cost is acceptable.
        processors = ["face_swapper"]
        if FACE_ENHANCER_ENABLED:
            processors.append("face_enhancer")

        command = [
            "python",
            "facefusion.py",
            "headless-run",
            "--processors",
            *processors,
            "--face-swapper-model",
            FACE_SWAPPER_MODEL,
            "--face-swapper-pixel-boost",
            FACE_SWAPPER_PIXEL_BOOST,
            "--face-mask-types",
            "box",
            "occlusion",
            "--face-mask-blur",
            FACE_MASK_BLUR,
            "--output-image-quality",
            "100",
            "--execution-providers",
            "cpu",
            "--source-paths",
            source_path,
            "--target-path",
            target_path,
            "--output-path",
            output_path,
        ]
        if FACE_ENHANCER_ENABLED:
            command += [
                "--face-enhancer-model",
                FACE_ENHANCER_MODEL,
                "--face-enhancer-blend",
                FACE_ENHANCER_BLEND,
            ]

        try:
            result = subprocess.run(
                command,
                cwd=FACEFUSION_DIR,
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Face swap timed out")

        if result.returncode != 0 or not os.path.exists(output_path):
            detail = (result.stderr or result.stdout or "Face swap failed").strip()[-2000:]
            raise HTTPException(status_code=500, detail=detail)

        # Copy out of the temp dir so it survives after the context manager exits.
        persisted = tempfile.NamedTemporaryFile(suffix=f".{target_ext}", delete=False)
        with open(output_path, "rb") as src:
            persisted.write(src.read())
        persisted.close()

    media_type = "image/png" if target_ext == "png" else "image/jpeg"
    return FileResponse(persisted.name, media_type=media_type, filename=f"swap.{target_ext}")
