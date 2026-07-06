# 06 — Video Templates: Session Learnings & Decisions (Follow-up)

This is a follow-up to [`05-video-templates-decisions.md`](./05-video-templates-decisions.md).
Where `05` is the structured "what we shipped" record, this doc is the **narrative
log of every decision, learning, gotcha, and operational note** from the session
that implemented [`04-video-templates.md`](./04-video-templates.md) — including the
things that only surfaced while building, testing, and running it.

---

## 1. How the ambiguous spec was resolved (the 4 confirmed decisions)

`04-video-templates.md` left several high-impact choices open. Rather than guess,
these were confirmed up front; the rationale matters for future changes:

| Question | Decision | Why it matters |
| -------- | -------- | -------------- |
| How is "admin" determined? | **DB `role` field on `User`**, seeded from an `ADMIN_EMAILS` allowlist. | A real, queryable role survives restarts and isn't tied to env alone; the allowlist makes bootstrapping the first admin trivial. |
| How does rendering run? | **Synchronous** (matches existing video/image/face-swap pattern). | Simplest, consistent. The cost: a render blocks the request and runs blocks serially — see §4. |
| Where does ffmpeg run? | **In the backend** (installed in its Docker image), shelled out via `child_process`. | Avoids a second microservice; keeps the render pipeline in one place. |
| What is an "avatar"? | **Both** a face-swap source *and* an OpenRouter reference image. | The face-swap fixes the exact face on start/end frames; the reference keeps the person consistent through the generated motion. |

Lesson: the spec implied but never stated the avatar→generation mechanism. Treat
"create an avatar" as **storing a face image**, not training a model — see §3.

---

## 2. Architecture decisions (and the rejected alternatives)

- **Avatar creation is a passthrough, not a model.** A user uploads 1-2 photos; we
  store them and set `faceKey = first photo`. That face is the FaceFusion source and
  the OpenRouter reference.
  - *Rejected:* synthesising a "clean portrait" via the image API on creation —
    adds latency, cost, and a failure mode for zero functional gain (FaceFusion only
    needs one good face image).

- **One shared render pipeline for admin export *and* user generation.**
  `lib/templateRender.ts` does the work (face-swap → generate → stitch → thumbnail)
  and returns buffers; `lib/runRender.ts` persists them onto a `TemplateRender` row
  (COMPLETED/FAILED). Admin `/export` additionally copies the result onto the
  `Template` and flips `published = true`.
  - *Why:* admin "test/preview" and user "generate" are the same operation with a
    different owner + a publish step. Duplicating it would drift.

- **`TemplateRender` is the unit of work for both flows.** Admin exports and user
  generations both create a render row, so "generate a thumbnail for the template on
  export" and "generate a thumbnail for the user when they use it" fall out of the
  same code path.

- **Timeline UI built from scratch with pointer events** — no drag/resize library.
  - *Why:* the repo deliberately hand-builds its UI (shadcn-style components, no
    component kit). A 3-track timeline (ruler / video / audio) with create-by-drag,
    move, and edge-resize is achievable with `pointerdown`/`move`/`up` + a
    pixels-per-second scale. Live drag updates local state; the change is persisted
    on pointer-up (so we don't PATCH on every mouse move).

- **Block edits are multipart; render/export triggers are JSON.** Anything with file
  uploads (template create, block create/update) uses multer + `FormData`; the
  pure-data triggers (`/render`, `/export` with `avatarIds`) use `express.json()`.

---

## 3. Technical learnings & gotchas (the useful stuff)

### ffmpeg
- **Concat of mismatched clips needs the filter graph, not the concat demuxer.**
  Generated blocks can differ in size/fps/SAR. We scale each to a common WxH with
  `scale=…:force_original_aspect_ratio=decrease,pad=…,setsar=1,fps=30,format=yuv420p`
  then `concat=n=N:v=1:a=0`. The demuxer (`-f concat`) would fail on differing params.
- **One base audio track spanning the whole video** = take the concatenated video,
  add the audio as a separate input, `[a]apad[outa]` (pad with silence) + `-shortest`.
  - `apad` handles **audio shorter than video** (pads silence); `-shortest` then
    trims to the (now video-length-limited) shorter stream, which also handles
    **audio longer than video**. This single combo covers both directions.
- **Thumbnails**: `-ss <t> -i in -frames:v 1`. If the clip is shorter than `<t>`,
  ffmpeg errors → we retry seeking to frame 0. Always have that fallback.
- **Output dimensions are derived from the first block's aspect ratio**
  (`aspectToDims`), defaulting to 1280×720. Vertical (`9:16`) → 720×1280, etc.
- Verified the whole pipeline in isolation (2 s + 3 s differently-sized clips →
  one 5.0 s 1280×720 mp4 with audio + a valid JPEG) before trusting it.

### OpenRouter / MinIO
- **Local MinIO is not reachable by OpenRouter.** As with the existing video/image
  routes, all frames + references are sent to OpenRouter as **base64 data URLs**, not
  MinIO URLs. Originals still live in MinIO.
- **Image bytes carry no mime type** when pulled back from storage, so we **sniff**
  it from the leading bytes (PNG/JPEG/WEBP magic numbers, defaulting to PNG) before
  building data URLs / FaceFusion uploads.
- Block duration is `round(endSec - startSec)` (min 1 s), passed as the OpenRouter
  `duration`.

### Prisma / DB
- **The schema change is purely additive** (`role` has a default; `Avatar`,
  `Template`, `TemplateBlock`, `TemplateRender` are new), so `prisma db push` applies
  with **no data loss** — unlike the `VideoStatus → GenerationStatus` rename in `03`.
- `TemplateRender` has both `avatarIds String[]` (ordered, source of truth for slot
  mapping) **and** a relation `avatars Avatar[]` (so the render keeps a reference and
  avatars aren't orphaned). The array preserves slot order; the relation preserves
  integrity.

### Auth
- `requireAdmin` runs `requireAuth` first, then checks the role, **lazily promoting**
  any email in `ADMIN_EMAILS` on the way. `resolveIsAdmin` is shared with `/api/me`
  so the promotion happens on the very first authenticated call from the frontend.
- The frontend can't read the role from the better-auth session without extra config,
  so a dedicated `GET /api/me` (consumed by `useMe`) is the simplest gate for the
  admin nav link.

---

## 4. Known limitations / explicit trade-offs

- **Synchronous + serial rendering.** A multi-block template generates each block one
  after another inside the request. A 5-10 minute target video = many model calls =
  potentially many minutes, with no resume and a real risk of HTTP timeouts on long
  templates. This was an accepted trade-off; a **background job/queue + polling** is
  the clear next step (already flagged as a follow-up in `01` and `03` too).
- **No per-block preview.** The admin must run a full export to see output; the
  timeline playhead only scrubs the audio, not generated video.
- **Avatar is a passthrough** (no synthesized portrait).
- **Editing audio/avatarSlots after creation** is supported by the API
  (`PATCH /api/admin/templates/:id`) but not yet surfaced in the admin UI.
- **Face swap depends on the profile-gated FaceFusion service** being up; if it's
  down, blocks with face-swap enabled fail the whole render.

---

## 5. Operational learnings (running it for real)

- **Admin bootstrapping has two paths:** (a) set `ADMIN_EMAILS=you@example.com` in
  `.env` (auto-promotes on next request — preferred, survives DB resets), or (b) a
  one-off DB update: `UPDATE "user" SET role='admin' WHERE email='…'`.
- **The running `backend` Docker container can be stale.** During this session the
  live container was an image built *before* this feature, so `/api/me`, the admin
  routes, and ffmpeg weren't present in it. New backend code requires a
  **`bun run docker:up` rebuild**; the DB schema change requires `prisma db push`
  (already run on container start via the Dockerfile `CMD`).
- **Host-based rendering needs ffmpeg on PATH.** It's installed in the backend image,
  but to run renders outside Docker, install it locally (e.g. `brew install ffmpeg`).
- **Smoke-testing approach used here:** because port 4000 was occupied by the stale
  container, the new backend was booted on `PORT=4001` against the *same* running
  Postgres + MinIO. This let us validate admin promotion, avatar/template/block CRUD,
  403/401 gating, and public-URL storage without disturbing the running stack. The
  ffmpeg pipeline was validated separately with a tiny standalone script. Full
  end-to-end export was **not** run live (it spends real OpenRouter credits and needs
  FaceFusion warm).
- **Test data left in the dev DB:** smoke-testing created `admin@example.com`,
  `plainuser@example.com` (+ a smoke template/avatar/block). Safe to delete on a
  throwaway dev DB.

---

## 6. If picking this up next, do this first

1. **Move rendering to a background worker** (queue + status polling); the frontend
   already shows IN_PROGRESS/FAILED via `StatusBadge`, so polling slots in cleanly.
2. Add **per-block preview** generation in the timeline (render a single block).
3. Surface **template settings editing** (audio/slots/name) in the admin UI.
4. Consider **scene-gap handling** on the timeline (black/silence between
   non-contiguous blocks) — today blocks are simply concatenated in start-time order.
