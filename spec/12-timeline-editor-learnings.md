# 12 — Timeline Editor: Learnings & Decisions

Consolidated learnings from building out the admin template **timeline editor**
across specs [07](./07-video-template-followups.md) → [11](./11-video-ui-updates.md)
(bake, per-model durations, multi-track overlaps, same-track drag rejection,
cropping, copy/paste). Companion to the earlier templates docs
([05](./05-video-templates-decisions.md), [06](./06-video-templates-learnings.md)).

---

## 1. The block data model (and why it grew the way it did)

`TemplateBlock` accreted fields one spec at a time. The current shape and the role
of each field:

| Field | Added in | Meaning |
| ----- | -------- | ------- |
| `startSec`, `endSec` | 04 | Position + footprint on the timeline. `endSec` is **derived**, never authoritative. |
| `track` | 09 | Which lane. Higher track = composited on top. |
| `duration` | 09 | The length the model **generates** (must be one of the model's `supported_durations`). |
| `videoKey` | 08 | The block's individually "baked" preview clip. |
| `cropStart`, `cropEnd` | 11 | Crop window into the generated clip; `cropEnd` null = "to the end". |
| `linkGroupId` | 11 | Copy/paste link — blocks sharing it share generation content. |
| `avatarSlot`, `faceSwapStart/End` | 04/07 | Which template avatar is the reference + face-swap source. |

**The invariant that keeps everything sane:**
`endSec = startSec + ((cropEnd ?? duration) - cropStart)`. It's enforced **server-side**
on every create/patch so the client can never desync the footprint from the crop.
`endSec` is computed, not trusted from the client — this avoided a whole class of
"the block looks one length but renders another" bugs.

**Decision: footprint = cropped length, not generated length.** Spec 09 said
"footprint = generated duration" (you shrink usage by overlaying). Spec 11 then added
real cropping, so footprint became the *cropped* length. Both coexist: a block with
no crop still has footprint = duration.

---

## 2. Rendering: generate-then-composite

The render pipeline (`lib/templateRender.ts` + `lib/ffmpeg.ts`) separates concerns:

1. **`renderBlockClip(block, face)`** generates one block's *full* clip (face-swap the
   avatar onto start/end frames if enabled → call the model). This is reused by the
   full render, the per-block **bake**, and (indirectly) verified independently. Always
   generating the full `duration` (never the cropped length) means crop/expand is free
   and non-destructive.
2. **`buildTimelineSegments(blocks)`** flattens overlapping multi-track blocks into an
   ordered list of slices: cut at every block edge, pick the **topmost** block covering
   each slice (ties → later start), map the timeline time to clip time via
   `inPoint = cropStart + (sliceStart - block.startSec)`, and emit black for gaps.
   This is a **pure function** — which made it trivially unit-testable (overlay-tail,
   overlay-mid, gaps, crop offset) without touching ffmpeg or the network.
3. **`stitchTimeline(clips, segments, audio)`** turns slices into the final mp4.

Keeping the overlap/crop resolution in a pure function (step 2) was the single best
structural decision — every tricky case was verified in milliseconds.

---

## 3. ffmpeg learnings (the fiddly bits)

- **A clip can appear in multiple non-adjacent slices** (e.g. an overlay hides its
  middle). ffmpeg won't let you consume the same `[i:v]` input pad twice. Fix: add a
  **separate decode input (`-i clip.mp4`) per slice**, so each is consumed once. Re-
  reading the file is cheap and avoids `split` gymnastics.
- **Black gaps** use a `color=c=black:s=WxH:r=fps:d=LEN` source filter (no input).
- **Trim a slice**: `[i:v]trim=start=IN:duration=LEN,setpts=PTS-STARTPTS,…`.
- **Uniform geometry before concat**: `scale=…:force_original_aspect_ratio=decrease,
  pad=…,setsar=1,fps=…,format=yuv420p` on every slice (clips differ in size/fps/SAR).
- **One base audio spanning the whole video**: `[a]apad[outa]` + `-shortest` handles
  both "audio shorter than video" (pad silence) and "longer" (trim) in one go.
- Thumbnails: `-ss <t> -frames:v 1`, with a fallback to frame 0 for very short videos.

---

## 4. Durations are per-model

OpenRouter's `GET /videos/models` already returns `supported_durations` per model
(e.g. `google/veo-3.1` → `[4,6,8]`). We surface it on `VideoModel` and the UI offers a
fixed allowed set (`ALLOWED_DURATIONS = [4,5,6,8,10]`), filtering the model picker to
models that support the chosen duration (and vice-versa via `durationsForModel`).
Lesson: **the provider already encodes these constraints — read them, don't hardcode.**

---

## 5. The hand-built timeline (frontend)

The timeline is built from raw pointer events (no DnD library), matching the repo's
"hand-build the UI" ethos. Hard-won patterns:

- **Stale closures are the main hazard.** Window `pointermove`/`pointerup` listeners
  are attached once at drag start, so they close over *that render's* state. Fixes:
  - Mutable drag info lives in a **`dragRef`** (including a `last` snapshot of the
    computed position) so commit-on-drop reads fresh values, not the stale `blocks`.
  - Collision checks read a **`blocksRef`** (mirror of latest blocks) so they're never
    stale mid-drag.
  - The playhead has a **`playheadRef`** for the rAF loop.
- **Multi-track lanes = one positioned area, not nested rows.** A single relative
  container of height `tracks * LANE_H`; blocks are absolutely placed with
  `top = (tracks-1-track) * LANE_H` (track 0 at the bottom, NLE-style). `x → seconds`
  and `y → track` are simple arithmetic off the area's bounding rect. Far simpler than
  per-lane drop zones.
- **One drag handler, several modes** (`create | move | crop-l | crop-r`) discriminated
  on `dragRef.current.mode`. Commit-or-reject all flows through one `pointerup`.
- **Cropping math**: right handle moves the out-point (clamp to `duration`); left handle
  moves the in-point *and* shifts `startSec` by the same delta so the right edge stays
  anchored — exactly how Premiere trims. The monitor maps `playhead → clip time` with
  the same `cropStart` offset so preview == render.
- **Patch-shaped change/commit callbacks** (`onChangeBlock(id, patch)`) instead of
  positional args — adding crop fields (`cropStart`/`cropEnd`) to the existing
  move/track flow was then a non-event.

---

## 6. Same-track overlap rejection (spec 10) vs overlaps-as-a-feature (spec 09)

These sound contradictory but aren't: **cross-track** overlaps are the feature (top
track wins); **same-track** overlaps are forbidden. `collides(start, end, track, exceptId)`
checks only same-track time overlap (touching edges don't count). A colliding drag
turns the clip red mid-drag and **snaps back** on drop (revert via a local
`onChangeBlock` to the original geometry, no server commit).

---

## 7. Copy/paste = a link group, not a deep copy

**Decision: a server-side clone endpoint, not "pass all the keys through create".**
`POST …/blocks/:id/copy` clones content + assigns a shared `linkGroupId` (created on
first copy, back-filled onto the source). Rationale: the multipart create takes image
*files*; making it also accept existing object keys + videoKey would be messy and
error-prone. A dedicated endpoint copies keys server-side cleanly.

- **Content is shared, position/crop are per-instance.** Editing/baking any group
  member propagates content (prompt, model, frames, `videoKey`, duration) to siblings;
  a duration change re-clamps each sibling's own crop. This is the "reference" the spec
  asked for.
- **Frontend keeps it simple**: clipboard holds the source block id; paste appends a
  linked copy at the end of the timeline (always collision-free) on the source's track;
  after a linked edit the page re-fetches so siblings update on screen.

---

## 8. Backend conventions worth repeating

- **Multipart fields are strings**; zod `z.coerce.number()` / a `"true"|"false"` enum
  transform handle that. Repeated fields (e.g. `avatarIds`) arrive as string | string[].
- **Optional `endSec`**: once the footprint became derived, `endSec` had to be made
  optional in the block schema (the client stopped sending it) — a required-field
  validation 400 was the symptom.
- **`clampCrop(cropStart, cropEnd, duration)`** centralizes the "valid crop window with
  a min length" logic, reused by create/patch/sibling-propagation.
- **Large audio uploads**: a dedicated 200 MB `audioUpload` multer instance + a global
  `uploadErrorHandler` (multer errors → clean 400 instead of a crash). The original
  symptom was an opaque `LIMIT_FILE_SIZE` stack trace.

---

## 9. Gotchas / time-savers

- **TS discriminated-union narrowing fails across early-returns inside a closure.**
  After `if (mode==="create") return;` … `if (mode==="crop-r") return;`, the trailing
  "move" code still saw the full union and errored on `drag.origEnd`. Fix: wrap the
  last branch in an explicit `if (drag.mode === "move") { … }` rather than relying on
  fall-through narrowing.
- **`build` (tsc `-b`) is stricter than `check-types`** — `noUnusedParameters` caught an
  unused `endSec` param that `tsc --noEmit` didn't. Always run `bun run build`, not just
  check-types, before declaring done.
- **The running Docker `backend`/`frontend` are stale images.** Every feature here needs
  `bun run docker:up` to be visible in the app; schema changes are applied additively
  via `prisma db push` (all these were additive — no data loss).
- **`prisma db push` against the dev DB** is the workflow; the host backend can be booted
  on a spare port (`PORT=4001`) against the same Postgres/MinIO for live smoke tests
  without disturbing the Docker stack.

---

## 10. What I'd do next

- **Move rendering to a background job** (still synchronous + serial; a multi-block,
  multi-crop template can take many minutes and risks HTTP timeouts).
- **Per-block preview while baking the whole template** (currently bake is per-block).
- **Snap-to-edges / magnetic timeline** and crossfades between overlapping tracks.
- **Enforce same-track no-overlap server-side too** (today it's a UI guard; the inspector
  track dropdown could still create an overlap that the renderer tolerates via track
  tie-breaks).
