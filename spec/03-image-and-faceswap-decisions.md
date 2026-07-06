# 03 — Image Generation & Face Swap: Decisions & Learnings

This document records what we built and learned while implementing
[`02-implement-image-and-faceswap.md`](./02-implement-image-and-faceswap.md):
adding **image generation** (OpenRouter) and **face swap** (self-hosted
FaceFusion) on top of the existing video app, keeping endpoints/code reusable.

It is the companion to [`01-implementation-decisions.md`](./01-implementation-decisions.md).

---

## 1. Summary of what was added

| Area      | What                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| Image gen | Text-to-image via OpenRouter's **dedicated Image API**, stored in MinIO.                 |
| Face swap | Base image + face → swapped image via a **self-hosted FaceFusion HTTP wrapper**.         |
| DB        | New `Image` and `FaceSwap` models; `VideoStatus` → shared `GenerationStatus` enum.       |
| Reuse     | Shared upload helpers, model-picker shape, frontend `FileField` / `StatusBadge`.         |
| Infra     | New `infra/facefusion` service (Dockerfile + FastAPI wrapper + model pre-pull).          |

---

## 2. Key external-API findings (the important learnings)

### OpenRouter image generation
- Image generation has moved to a **dedicated Image API**, separate from chat
  completions: `POST /api/v1/images` with `{ model, prompt, resolution?, aspect_ratio?, size?, input_references? }`.
- It is **synchronous** — the response returns the image directly (no polling,
  unlike video): `{ created, data: [{ b64_json | url }], usage: { cost } }`.
  Images come back base64-encoded in `b64_json`.
- Model discovery: `GET /api/v1/images/models`. The shape differs from the video
  models endpoint — capabilities live under `supported_parameters` as typed
  descriptors (e.g. `resolution: { type: "enum", values: [...] }`). We normalise
  this into the same `{ id, name, supported_resolutions, supported_aspect_ratios }`
  shape the video model picker uses so the frontend can share one component.
- Response contains no explicit mime type, so we sniff it from the leading bytes
  (PNG/JPEG/WEBP magic numbers), defaulting to PNG.

### FaceFusion (the big one)
- **The `facefusion/facefusion:3.6.1-cpu` image ships NO REST API.** The built-in
  "Local API" (`facefusion.py api`) landed in a PR in **late 2025**, after 3.6.1.
  For 3.6.1 the only programmatic entry points are the **Gradio UI** and the
  **CLI** (`headless-run`, `force-download`, etc.).
- The image is plain `python:3.12` (no conda), WORKDIR `/facefusion`, default
  command `python facefusion.py run` (the Gradio UI on port 7865). `ffmpeg` and
  `curl` are pre-installed. `gradio` pulls in `starlette`/`fastapi`/`uvicorn`/
  `pydantic`, but we pin our own `fastapi`/`uvicorn`/`python-multipart` to be safe.
- Face swap via CLI:
  `python facefusion.py headless-run --processors face_swapper --face-swapper-model inswapper_128 --execution-providers cpu -s <source> -t <target> -o <output>`.
  `source` = the face to apply; `target` = the base image being modified.
- **Model download is lazy by default** (on first run) and there is **no
  per-model download flag**. `force-download` only supports `--download-scope`
  with values `lite` (minimal, includes the face swapper) or `full`. Confirmed
  `download_scope` exists in 3.6.1 (`facefusion/choices.py`, `args.py`).
- Observed: `force-download --download-scope lite` pulls a **large** set of
  models (~4 GB+, 48+ files across all processors — not just the swapper),
  because there's no way to scope to a single processor.

---

## 3. Architectural decisions

### FaceFusion integration = thin HTTP wrapper over the CLI
Because 3.6.1 has no REST API, we built a tiny **FastAPI sidecar**
(`infra/facefusion/server.py`) on top of the official image that wraps
`headless-run`:
- `POST /swap` (multipart `source` + `target`) → runs the CLI in a temp dir →
  returns the swapped image bytes.
- `GET /health`.

This keeps the Node backend clean: it calls the swap service like any other
provider (multipart POST → bytes), mirroring how it calls OpenRouter. Rejected
alternatives: calling FaceFusion's Gradio API (extremely fragile, event-driven),
and `docker exec` from the backend (needs docker socket access, messy).

### Generation is synchronous everywhere
Every route follows the existing video pattern: create a DB row (`IN_PROGRESS`)
→ call the provider → store the output in MinIO → mark `COMPLETED`/`FAILED`.
Inputs and outputs are always persisted to MinIO; the bucket is anonymous-read so
the API returns permanent public URLs (`getPublicUrl`).

### Reusability (explicit spec requirement)
- **DB**: introduced a shared `GenerationStatus` enum (renamed from `VideoStatus`)
  used by `Video`, `Image`, and `FaceSwap`.
- **Backend**: extracted `src/lib/uploads.ts` (shared multer instance +
  `extFromMime` + `toDataUrl`), reused by all upload routes. `openrouter.ts` gained
  `generateImage()` / `listImageModels()` alongside the video functions.
  `models.ts` serves `/api/models[/video]` and `/api/models/image` via one handler.
- **Frontend**: extracted `FileField` and `StatusBadge` components; `api.ts`
  collapsed to shared `get`/`post` helpers; `GenerationModel` shape shared by both
  model pickers. Image/FaceSwap pages mirror the VideoPage create/library tab layout.

### FaceFusion model pre-pull + persistence
- `infra/facefusion/entrypoint.sh` pre-downloads models **once on first boot**
  (`force-download --download-scope lite`), gated by a marker file so restarts are
  instant, then `exec`s uvicorn.
- Models download into the named volume `facefusion_data:/facefusion/.assets`, so
  they **persist across restarts**.
- Compose healthcheck has a generous `start_period` (600s) because the API only
  starts serving after the initial download completes.

---

## 4. New / changed files

```
packages/db/prisma/schema.prisma     # GenerationStatus enum; Image + FaceSwap models; User relations
apps/backend/src/env.ts              # + FACEFUSION_URL
apps/backend/src/index.ts            # mount /api/images, /api/faceswaps
apps/backend/src/lib/uploads.ts      # NEW shared multer + image helpers
apps/backend/src/lib/openrouter.ts   # + generateImage(), listImageModels()
apps/backend/src/lib/facefusion.ts   # NEW HTTP client for the swap service
apps/backend/src/routes/images.ts    # NEW
apps/backend/src/routes/faceswaps.ts # NEW
apps/backend/src/routes/videos.ts    # refactored to use lib/uploads
apps/backend/src/routes/models.ts    # /video + /image model listing

apps/frontend/src/lib/api.ts                 # Image/FaceSwap types + fetchers
apps/frontend/src/components/FileField.tsx   # NEW (extracted)
apps/frontend/src/components/StatusBadge.tsx # NEW (extracted)
apps/frontend/src/components/TextToImageForm.tsx  # NEW
apps/frontend/src/components/MyImages.tsx         # NEW
apps/frontend/src/components/FaceSwapForm.tsx     # NEW
apps/frontend/src/components/MyFaceSwaps.tsx      # NEW
apps/frontend/src/pages/ImagePage.tsx             # NEW
apps/frontend/src/pages/FaceSwapPage.tsx          # NEW
apps/frontend/src/App.tsx, components/Navbar.tsx  # routes + nav tabs

infra/facefusion/Dockerfile      # NEW (wrapper on facefusion:3.6.1-cpu)
infra/facefusion/server.py       # NEW FastAPI wrapper around headless-run
infra/facefusion/entrypoint.sh   # NEW model pre-pull + start uvicorn
docker-compose.yml               # facefusion build + healthcheck + FACEFUSION_URL
package.json                     # + docker:facefusion script
.env.example, apps/backend/.env.example  # + FACEFUSION_URL
README.md, AGENTS.md             # docs
```

---

## 5. Backend API surface (additions)

| Method & path             | Auth | Description                                          |
| ------------------------- | ---- | ---------------------------------------------------- |
| `GET /api/models/image`   | ✅   | OpenRouter image-generation models.                  |
| `GET /api/models/video`   | ✅   | Video models (also `/api/models` for back-compat).   |
| `GET /api/images`         | ✅   | Current user's images.                               |
| `GET /api/images/:id`     | ✅   | Single image.                                        |
| `POST /api/images`        | ✅   | Generate image (OpenRouter) → store in MinIO.        |
| `GET /api/faceswaps`      | ✅   | Current user's face swaps.                           |
| `GET /api/faceswaps/:id`  | ✅   | Single face swap.                                    |
| `POST /api/faceswaps`     | ✅   | Store inputs → FaceFusion swap → store output.       |

Frontend routes: `/` (video), `/image`, `/face-swap`.

---

## 6. Verification performed

- `check-types`, `lint`, `build`, and `docker compose config` — all green.
- **Image generation, live end-to-end**: signed up, listed image models from live
  OpenRouter, generated a 1024×1024 PNG with `google/gemini-2.5-flash-image`,
  confirmed it was stored in MinIO and publicly fetchable, status `COMPLETED`,
  cost reported (~$0.04).
- **Face swap route**: 400 when an input is missing; when FaceFusion is down,
  inputs are still stored, the row is marked `FAILED`, and a clear actionable error
  is returned.
- **FaceFusion service**: image builds; the entrypoint pre-pull runs on boot
  (observed models downloading live) and **persists to the volume** (~3.7 GB /
  48 files written before the host's Docker Desktop VM became unresponsive under
  the download I/O — see gotchas).

---

## 7. Gotchas / things to know

- **`Blob` from a Node `Buffer`**: TS rejects `new Blob([buffer])` (SharedArrayBuffer
  type mismatch). Wrap it: `new Blob([new Uint8Array(buffer)])`.
- **Local MinIO isn't reachable by OpenRouter**, so uploaded reference images are
  sent as base64 data URLs (same pattern as video frames); originals still stored
  in MinIO.
- **Enum rename is destructive under `prisma db push`**: switching `VideoStatus` →
  `GenerationStatus` makes `db push` want to drop/recreate `video.status`
  (`--accept-data-loss`). Fine for the dev DB (throwaway data); a real deployment
  should do a proper migration that renames the type.
- **FaceFusion first boot is heavy**: `lite` pre-pull is several GB and takes
  minutes. On a constrained machine this can saturate Docker Desktop's VM I/O and
  make the daemon temporarily unresponsive. The model download is a one-time cost
  (persisted in the volume); subsequent starts skip it via the marker file.
- **FaceFusion CPU swaps are slow**; the backend uses a 15-min timeout and the
  wrapper a 14-min subprocess timeout.

---

## 8. Known follow-ups / not done yet

- **FaceFusion is still profile-gated** (`--profile facefusion`) and not part of the
  default `docker:up`, because the image (~5GB) + models are large.
- **Full FaceFusion swap not verified end-to-end** live (blocked by the Docker
  Desktop VM stalling under the download); the wrapper + CLI invocation were
  validated against the real image structure.
- **`lite` scope over-downloads** — it pulls every processor's lite models, not just
  the swapper. A leaner alternative is a one-time warmup `headless-run` with a
  bundled sample face pair, which downloads only the face-swap pipeline.
- **Generation is synchronous** (inherited): a background queue + webhooks would be
  the next step, especially for slow CPU face swaps.
- **Image-to-image / face-swap onto videos** are not implemented (image gen takes
  optional reference images, but the swap targets images only).
