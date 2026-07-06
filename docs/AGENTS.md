# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

Video Arena is a generative-media SaaS (video + image generation and face swap).
It is a **bun**-managed **Turborepo** monorepo.

- `apps/frontend` — React + Vite + TypeScript SPA. Tailwind v4 + shadcn-style UI
  (components in `src/components/ui`). Auth via `better-auth/react`
  (`src/lib/auth-client.ts`). API calls in `src/lib/api.ts`. Routes: `/` (video),
  `/image`, `/face-swap`, `/user/templates`, `/user/avatar`,
  `/admin/template/create`. Each page reuses the create/library tab layout; shared
  bits live in `components/FileField.tsx` and `components/StatusBadge.tsx`.
  `src/lib/useMe.ts` loads `/api/me` (admin flag) to gate the admin nav link.
  The admin template creator uses a hand-built Premiere-style timeline in
  `components/timeline/` (`Timeline.tsx`, `BlockInspector.tsx`, `AudioClipInspector.tsx`,
  `TemplateSetupForm.tsx`). Templates start with an **empty timeline** (no fixed
  duration — it grows to fit the furthest clip). `Timeline.tsx` has video lanes
  (V1, V2, …) and audio lanes (A1, A2, …); both video blocks and audio clips can be
  dragged/cropped. A program monitor + play/pause/stop transport scrubs a playhead
  (rAF-driven) and previews each block's frames — or, if a block has been "baked"
  (or is an uploaded video), plays that clip — while every audio clip plays via a
  hidden `<audio>` element synced to the playhead (an in-browser mix preview).
- `apps/backend` — TypeScript + Express API. Run directly with **bun** (no build step).
  - `src/auth.ts` — better-auth (email/password + Google), Prisma adapter.
  - `src/lib/openrouter.ts` — OpenRouter client: video (submit + poll) **and**
    image (`generateImage`, `listImageModels`) generation, plus video model list.
  - `src/lib/facefusion.ts` — calls the self-hosted FaceFusion swap service over HTTP.
    The frame face-swap step in `renderBlockClip` is provider-pluggable via
    `SWAP_PROVIDER`: `facefusion` (classic pixel swap) or `flux` (diffusion identity
    edit through an OpenRouter image model `OPENROUTER_SWAP_MODEL`, default
    `black-forest-labs/flux.2-klein-4b`, via `swapFaceWithImageModel`). The `flux`
    path also honors a per-block `swapContext` prompt. Verify a model with
    `scripts/test-flux-swap.ts`.
  - `src/lib/storage.ts` — MinIO (S3-compatible) object-store client.
  - `src/lib/uploads.ts` — shared multer instance + image helpers (`extFromMime`,
    `toDataUrl`); reused by every route that accepts uploads.
  - `src/lib/ffmpeg.ts` — shells out to **ffmpeg** to stitch template clips
    together (scale/pad to a common size) and mix any number of positioned audio
    parts over them (`AudioPart[]`: each trimmed + `adelay`ed to its start, summed
    with `amix`), to extract thumbnails, and to read an uploaded file's duration
    (`probeMediaDuration`, via **ffprobe**). ffmpeg is installed in the backend
    Docker image.
  - `src/lib/templateRender.ts` + `src/lib/runRender.ts` — synchronous template
    render pipeline. `renderBlockClip()` generates one block's clip (the block's
    chosen avatar slot is passed as the OpenRouter reference image and, when
    `faceSwapStart`/`faceSwapEnd` are set, is face-swapped onto the block's base
    start/end frame); `renderTemplate()` runs it for every block, stitches the clips,
    mixes the template's audio clips over them, and makes a thumbnail. The timeline
    has no fixed length — it runs to the furthest clip (video *or* audio), padding
    the video with black if audio extends past it. `renderBlockClip()` is also reused
    by the per-block "bake" route. Blocks reference avatars by slot — never per-block uploads.
    On **export** the cover thumbnail is **AI-generated from the block prompts**
    (`generateAiThumbnail` → OpenRouter image model `OPENROUTER_THUMBNAIL_MODEL`),
    falling back to an ffmpeg frame grab on error; user renders still use a frame grab.
  - `src/lib/templateSerialize.ts` — attaches public URLs to template/block/render rows.
  - `src/middleware/requireAdmin.ts` — gates admin routes; lazily promotes emails
    in `ADMIN_EMAILS` to the `admin` role. `resolveIsAdmin` is reused by `/api/me`.
  - `src/routes/{videos,images,faceswaps}.ts` — CRUD + generation per media type.
  - `src/routes/avatars.ts` — user avatars (1-2 photos; first photo = face source).
  - `src/routes/templates.ts` — user-facing templates (`/api/templates`) + their
    renders (`/api/template-renders`).
  - `src/routes/adminTemplates.ts` — admin CRUD for templates, blocks **and audio
    clips** (`/audio`, `/audio/:clipId`), plus `/blocks/:id/bake` (generate one
    block's preview clip) and `/export` (render + publish). `/api/admin/templates`,
    admin-only. Template create/patch no longer take an upfront audio file or
    duration — audio is added per-clip in the editor.
  - `src/routes/me.ts` — `/api/me` → `{ id, email, isAdmin, credits }`.
  - `src/routes/models.ts` — `/api/models[/video]` (video) and `/api/models/image`.
  - `src/routes/credits.ts` — credits & billing (`/api/credits`): balance + ledger
    (`GET /`), packs + per-action prices + checkout config (`GET /packs`), create a
    Razorpay order (`POST /checkout`), verify a completed payment + grant credits
    (`POST /verify`), and a `payment.captured` webhook backstop (`POST /webhook`,
    mounted with a raw-body parser BEFORE `express.json()` in `index.ts` so the
    signature can be checked against the exact bytes).
  - `src/lib/credits.ts` — credit ledger helpers + pricing. `actionCost()` returns
    the FIXED credit price per action (`CREDITS_PER_{IMAGE,VIDEO,TEMPLATE_RENDER}`
    env). `spendCredits()` is an atomic conditional decrement (can't go negative),
    `refundCredits()` is net-aware/idempotent (so a charge→refund→re-charge retry
    works and double callbacks don't double-refund), `addCredits()` grants
    PURCHASE/BONUS/REFUND/ADJUSTMENT. `CREDIT_PACKS` defines the 3 INR top-up tiers.
  - `src/lib/razorpay.ts` — minimal Razorpay client over the REST API (no SDK dep):
    `createOrder`, `verifyPaymentSignature` (HMAC of `orderId|paymentId`), and
    `verifyWebhookSignature`.
- `infra/facefusion` — Dockerfile + `server.py`: a tiny FastAPI wrapper around
  FaceFusion's `headless-run` CLI (3.6.1 ships no REST API). Exposes
  `POST /swap` (multipart source+target → swapped image) + `GET /health`.
  `entrypoint.sh` pre-downloads the `lite` model set (`force-download
  --download-scope lite`) on first boot into the `facefusion_data` volume
  (`/facefusion/.assets`), gated by a marker file so restarts are instant. The swap
  runs a **max-likeness** config (env-tunable, see below): `hyperswap_1a_256` swapper
  + `1024x1024` pixel boost + box/occlusion mask + a tight `0.2` mask blur + lossless
  output, plus a `gfpgan_1.4` face-enhancer pass kept at a **low blend (30)** so it
  restores detail without averaging out the source person's features. Tune via env on
  the `facefusion` service: `FACE_SWAPPER_MODEL`, `FACE_SWAPPER_PIXEL_BOOST`,
  `FACE_ENHANCER_ENABLED` (set false for the strongest, roughest likeness),
  `FACE_ENHANCER_MODEL`, `FACE_ENHANCER_BLEND`, `FACE_MASK_BLUR`. (CPU
  execution.) The extra models that config needs beyond `lite` (hyperswap, GFPGAN,
  occluder) download lazily on the first swap, then cache in the volume — so only the
  first swap is slow. (`full` scope is avoided: it greedily pulls many unrelated heavy
  models and a single corrupt source aborts the whole pre-download.)
- `packages/db` — Prisma schema (`prisma/schema.prisma`) + client (`@repo/db`).
  Models: `Video`, `Image`, `FaceSwap` (shared `GenerationStatus` enum), plus the
  templates feature: `Avatar`, `Template`, `TemplateBlock`, `TemplateAudioClip`,
  `TemplateRender`, and a `role` field on `User` (`"user"`/`"admin"`). The credits
  feature adds a `credits` balance on `User`, the `CreditTransaction` ledger
  (`CreditTxnType`) and `Payment` rows (`PaymentStatus`) for Razorpay orders.
  Reused by the backend; never duplicate Prisma logic elsewhere.

## Conventions

- Package manager is **bun**. Use `bun install`, `bun run <script>`.
- Backend imports use `.js` extensions (NodeNext); bun resolves them to `.ts` at runtime.
- Frontend uses the `@/` alias for `src/`.
- Keep all Prisma access in the `@repo/db` package.
- All user-uploaded inputs and generated outputs (videos, images, face swaps) must
  be stored in the object store (MinIO) — see `src/lib/storage.ts`. Object keys are
  persisted on the `Video`/`Image`/`FaceSwap` models; the bucket is anonymous-read,
  so the API returns permanent public URLs (`getPublicUrl`) built from
  `MINIO_FRONTEND_ENDPOINT`.
- Generation is **synchronous**: routes create a DB row (`IN_PROGRESS`), call the
  provider, store the result and mark `COMPLETED`/`FAILED`. Mirror this pattern and
  reuse `src/lib/uploads.ts` when adding new media types. Template renders follow
  the same pattern (`TemplateRender` row → render → store), but a render generates
  *every* block sequentially, so it can take many minutes.
- **Template avatars**: the admin assigns 1-2 of their own avatars to a template at
  creation (`Template.avatarIds`, which sets `avatarSlots`). Blocks pick one of
  those slots (`TemplateBlock.avatarSlot`) for both the reference image and the
  face-swap source — admins never re-upload per-block reference images. Admin
  `/export` renders with the template's own avatars; users pick their own avatars
  (same slot count) when they render via `POST /api/templates/:id/render`.
- **Durations are per-model** (spec 09): OpenRouter exposes `supported_durations`
  per video model; the UI offers a fixed set (`ALLOWED_DURATIONS` in `lib/api.ts`)
  and filters the model picker to models that support the chosen duration. A
  block's `duration` is its generated length and equals its timeline footprint
  (`endSec = startSec + duration`, enforced server-side).
- **Multi-track timeline + overlaps**: blocks have a `track`; the timeline stacks
  tracks (higher = on top). Clips can be dragged left/right and between tracks, but
  a drag that would overlap another clip **on the same track** is rejected (it turns
  red and snaps back — `collides()` in `Timeline.tsx`); cross-track overlaps are
  allowed. Rendering (`buildTimelineSegments` in `templateRender.ts`) slices the
  timeline at block edges, picks the topmost covering block per slice (trimming via
  `ffmpeg.ts`'s `stitchTimeline`), and fills uncovered gaps with black.
- **Crop (trim)**: a block keeps its full generated clip (`duration`) but only uses
  `[cropStart, cropEnd)` — drag a clip's edges to crop/expand (Premiere-style). The
  footprint is `endSec - startSec = (cropEnd ?? duration) - cropStart` (enforced
  server-side); `buildTimelineSegments` offsets the clip in-point by `cropStart`.
- **Uploaded (non-AI) video blocks**: an admin can add a block backed by a raw
  uploaded video instead of an AI-generated clip — `TemplateBlock.sourceVideoKey`
  (created via the "Upload video" button on the editor; `POST …/blocks` with a
  `sourceVideo` multipart field, served by `videoUpload` in `uploads.ts`). The
  block's `duration` is the clip's real length (probed by `probeVideoDuration` in
  `ffmpeg.ts` via ffprobe), so it crops/moves like any clip. `prompt`/`model` are
  empty for these blocks and `renderBlockClip()`/baking are skipped — the render
  (`templateRender.ts`) uses `sourceVideoKey` verbatim, **always** (even on user
  renders where `forceRegenerate` is set), with no avatar/face-swap applied.
- **Face-swap provider**: `SWAP_PROVIDER` selects how a block's start/end frame is
  swapped in `renderBlockClip` — `facefusion` (default, pixel swap) or `flux`
  (diffusion identity edit via `OPENROUTER_SWAP_MODEL`, which accepts the block's
  `swapContext` prompt). The inspector exposes `swapContext` (shown only when a
  face-swap toggle is on); it's shared across a link group like other content.
- **Audio clips + auto length**: templates have no upfront duration or single
  audio track. The admin uploads any number of audio files as `TemplateAudioClip`s
  (the "Upload audio" button → `POST …/audio`); each is placed on an audio lane
  (`track`), can be dragged/cropped like a video block, and its `duration` is the
  uploaded file's real length (probed via ffprobe). All audio clips are **mixed**
  together over the video on render (overlaps on the same lane are rejected like
  video; cross-lane overlaps are allowed + summed). The timeline length is derived
  from the furthest clip (video or audio) everywhere — there is no `durationSec`.
- **Copy/paste with linked references**: blocks sharing a `linkGroupId` share
  generation content (prompt, model, frames, baked `videoKey`, …). The copy endpoint
  (`POST …/blocks/:id/copy`) clones content into a new linked block; editing or
  baking any member propagates content to the rest (PATCH/bake in `adminTemplates.ts`).
  Position + crop stay per-block. Frontend: ⌘/Ctrl+C / +V or the Copy/Paste buttons.
- **Admins** are determined by `role == "admin"` on `User`, seeded from the
  `ADMIN_EMAILS` allowlist. Gate admin-only routes with `requireAdmin`; the
  frontend reads `/api/me`.
- **Credits**: users buy credits (Razorpay, INR) on `/billing` and spend a FIXED
  number per generation — `actionCost()` in `src/lib/credits.ts`. Every billable
  route (`videos`, `images`, template `render`/`retry`) follows the same pattern:
  reject up front with **402** if the balance is too low, `spendCredits()` once the
  DB row exists, and `refundCredits()` on failure (synchronous routes in their
  catch; template renders in the background `.catch`). Admin `/export` and per-block
  `/bake` are NOT charged (they're authoring tools). The frontend shows the balance
  in the navbar (`useMe().credits`); call `refreshCredits()` after any spend/top-up
  so it updates immediately. Pricing defaults assume ~30% margin over typical
  OpenRouter cost — raise `CREDITS_PER_*` for pricier model mixes.
- Local host-based template rendering needs **ffmpeg on PATH** (it's installed in
  the backend Docker image, but install it locally — e.g. `brew install ffmpeg` —
  to run renders outside Docker).

## Common commands

```sh
bun install                 # install all workspace deps
bun run db:generate         # generate the Prisma client (run after schema changes)
bun run db:migrate          # apply Prisma migrations
bun run dev                 # run all apps with hot reload (turbo)
bun run build               # build everything
bun run check-types         # type-check the whole monorepo
bun run lint                # lint
```

Per app:

```sh
bun run --cwd apps/backend dev
bun run --cwd apps/frontend dev
```

## Local infrastructure

```sh
bun run infra:up            # Postgres + MinIO only (for host-based dev)
bun run docker:up           # full stack in Docker
bun run docker:facefusion   # build + start the FaceFusion swap service (~5GB, needed for face swap)
bun run docker:reset        # stop + wipe volumes (DESTRUCTIVE)
```

## Verification

Before considering a change complete:

1. `bun run check-types` (must pass).
2. `bun run build` (frontend `vite build` + backend `tsc --noEmit`).
3. For backend logic, smoke-test by booting `bun run --cwd apps/backend start`
   and hitting `http://localhost:4000/health`.

## Environment

Secrets (`OPENROUTER_API_KEY`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
`BETTER_AUTH_SECRET`) are configured via `.env`. See the `.env.example` files at
the repo root and in each app/package. Google sign-in is only enabled when the
Google client id/secret are present. `FACEFUSION_URL` points the backend at the
FaceFusion swap service (`http://localhost:7865` on host, `http://facefusion:7865`
in Docker).
