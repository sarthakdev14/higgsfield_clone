# 05 — Video Templates: Decisions & Learnings

Record of what we built for [`04-video-templates.md`](./04-video-templates.md):
admin-authored, longer-form video **templates** assembled from short prompt-driven
clips on a Premiere-pro-style timeline, plus user **avatars** and per-user template
**renders**. Companion to [`01`](./01-implementation-decisions.md) and
[`03`](./03-image-and-faceswap-decisions.md).

---

## 1. Summary of what was added

| Area     | What                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| Avatars  | Users upload 1-2 photos → an `Avatar` whose primary photo is the face used for swaps + refs.  |
| Templates| Admins build a timeline of `TemplateBlock`s over one base audio track, with 1-2 avatar slots. |
| Render   | Generate every block (face-swap + generate), stitch with ffmpeg over audio, make a thumbnail. |
| Roles    | `User.role` (`user`/`admin`), seeded from an `ADMIN_EMAILS` allowlist.                        |
| Frontend | `/user/avatar`, `/user/templates`, `/admin/template/create` (hand-built timeline UI).         |

---

## 2. Key decisions (confirmed with the requester)

- **Admin access = DB role field.** `User.role` defaults to `"user"`.
  `requireAdmin` / `resolveIsAdmin` lazily promote any email in the `ADMIN_EMAILS`
  env allowlist to `"admin"` on their next request. The frontend gates the admin
  nav link via `GET /api/me`.
- **Rendering is synchronous** (matches the existing video/image/face-swap
  pattern). A render generates each block sequentially in the request handler, then
  stitches. This can take many minutes for multi-block templates — acceptable for
  now; a background queue is the obvious follow-up.
- **ffmpeg lives in the backend.** `src/lib/ffmpeg.ts` shells out to `ffmpeg`
  (installed in the backend Docker image) to (a) scale/pad each clip to a common
  size and concat them, overlaying one base audio track (`apad` + `-shortest` so
  the audio spans / trims to the video), and (b) extract a JPEG thumbnail.
- **Avatar = face-swap source *and* reference.** When a block has face-swap
  enabled, the avatar's face is swapped onto the start/end frame (via the existing
  FaceFusion service) *before* generation. The avatar face image is **also** passed
  to OpenRouter as an `input_reference` for every block (slot-targeted), to keep the
  person consistent across clips.

---

## 3. Data model (`packages/db/prisma/schema.prisma`)

- `User.role: String @default("user")`.
- `Avatar` — `sourceImageKeys[]` (the uploaded photos) + `faceKey` (= first photo).
- `Template` — `avatarSlots` (1-2), `audioKey`, `durationSec`, `published`,
  `previewVideoKey`, `thumbnailKey`; has many `TemplateBlock` + `TemplateRender`.
- `TemplateBlock` — `startSec`/`endSec`/`order` (timeline position), `prompt`,
  `model`, `resolution`, `aspectRatio`, `startImageKey`/`endImageKey`/
  `referenceImageKeys[]`, `faceSwapStart`/`faceSwapEnd`, `avatarSlot`.
- `TemplateRender` — `avatarIds[]` (slot order) + connected `avatars`, `videoKey`,
  `thumbnailKey`, `status`, `cost`. Created both for admin **exports** and user
  **generations**.

Schema is additive, so `prisma db push` applies without data loss (`role` has a
default; the rest are new tables).

---

## 4. Backend API surface (additions)

| Method & path                                  | Auth  | Description                                   |
| ---------------------------------------------- | ----- | --------------------------------------------- |
| `GET /api/me`                                  | user  | `{ id, email, isAdmin }`.                     |
| `GET/POST/DELETE /api/avatars[/:id]`           | user  | Manage avatars (1-2 photos).                  |
| `GET /api/templates[/:id]`                     | user  | Published templates.                          |
| `POST /api/templates/:id/render`               | user  | Generate a personalised video (avatarIds).    |
| `GET /api/templates/:id/renders`               | user  | The user's renders of a template.             |
| `GET /api/template-renders[/:id]`              | user  | All of the user's template renders.           |
| `GET/POST/PATCH/DELETE /api/admin/templates…`  | admin | Template + block CRUD.                        |
| `POST /api/admin/templates/:id/export`         | admin | Render with the admin's avatars + publish.    |

`/export` renders with the admin's chosen avatars, stores the result on a
`TemplateRender`, then copies the video + thumbnail onto the `Template` and sets
`published = true`. User `/render` does the same minus the publish.

---

## 5. Frontend

- **`/user/avatar`** — create avatars (name + 1-2 photos) and manage them.
- **`/user/templates`** — Browse published templates (thumbnail + preview video) →
  "Generate with my avatar" dialog (pick N avatars) → My Videos tab lists renders.
- **`/admin/template/create`** — create a template (name, 1-2 avatar slots, timeline
  length, optional audio), then a **Premiere-style timeline**:
  - `components/timeline/Timeline.tsx` — ruler + video track + audio track, built
    with pointer events (no extra deps): drag empty track to create a clip, drag a
    clip to move, drag edges to resize; live local update + commit on pointer-up.
  - `components/timeline/BlockInspector.tsx` — edit the selected block's prompt,
    model, resolution/aspect ratio, start/end frames, references, face-swap toggles
    and avatar slot.
  - Test & export panel renders the whole template with the admin's avatars and
    publishes it.
- `src/lib/useMe.ts` gates the admin nav link off `/api/me`.

---

## 6. Verification performed

- `check-types`, `build`, `lint` — all green across the monorepo.
- `prisma db push` against the running dev Postgres — additive, no data loss.
- Live API smoke test (host backend on port 4001 against the running Postgres +
  MinIO): sign-up auto-promoted an `ADMIN_EMAILS` user to admin; `/api/me` returned
  `isAdmin: true`; created an avatar (stored + public URL), a template, and a block
  (with start image + face-swap); admin routes returned **403** for a non-admin and
  **401** unauthenticated; unpublished templates were hidden from `/api/templates`.
- **ffmpeg pipeline** verified in isolation: stitched a 2 s + 3 s clip of differing
  sizes into a single 5.0 s 1280×720 mp4 with the base audio (padded/trimmed to the
  video length), and produced a valid 1280×720 JPEG thumbnail.

---

## 7. Known follow-ups / not done yet

- **Rendering is synchronous** and serial — a multi-block, multi-minute template can
  block the request for a long time and is not resumable. A background job/queue
  with polling is the natural next step.
- **No live preview** of individual block generations in the timeline; the admin
  must run a full export to see results. The timeline playhead scrubs only the audio.
- **Avatar creation is a passthrough** (first uploaded photo becomes the face); we
  don't synthesize a cleaned-up portrait from the 1-2 inputs.
- **Editing template audio/slots after creation** isn't surfaced in the admin UI
  (the API supports `PATCH /api/admin/templates/:id`).
- Face swap still depends on the profile-gated FaceFusion service being up.
