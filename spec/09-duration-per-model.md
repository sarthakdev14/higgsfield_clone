Some models only support certain durations (for example veo 3 only supports 8 seconds). 

We should only show the specific models that are possible to be used for the selected duration.

We should also probably only allow certain duration lengths (4 seconds, 8 seconds etc).

This also means we need a feature of "video overlaps". On the timeline, I should see multiple video tracks, and I might generate a 8 second video with veo3, but I might only want to use the first 4 seconds. On a video track above it I will generate a new video block which has a start and end time that overlaps with the first video block.

---

## Implementation notes

Decisions (confirmed): allowed durations = **4, 5, 6, 8, 10**; overlap = **top track
wins** (higher track fully replaces lower during an overlap); a block's footprint
**equals its generated duration** (you "use less" by overlaying, not trimming); the
timeline supports **dynamically adding tracks**.

- **Per-model durations**: the OpenRouter `videos/models` response already includes
  `supported_durations`; it's now surfaced on the `VideoModel` type. `lib/api.ts`
  exposes `ALLOWED_DURATIONS`, `modelsForDuration()`, and `durationsForModel()`.
  Both the standalone Text-to-Video form and the block inspector pick a duration
  and filter the model list to models that support it (and vice-versa).
- **Block model**: `TemplateBlock` gained `track` and `duration`. The footprint
  invariant `endSec = startSec + duration` is enforced in the admin block
  create/update routes. The inspector sets duration (no free-resize); the timeline
  sets position + track via drag.
- **Multi-track timeline** (`Timeline.tsx`): stacked lanes in one positioned area,
  drag empty space to create on a lane, drag a clip to move it across time and
  tracks, an "Add video track" button, and the program monitor shows the topmost
  clip at the playhead.
- **Compositing** (`templateRender.ts` + `ffmpeg.ts`): `buildTimelineSegments`
  resolves overlaps into ordered slices (topmost block per slice, black for gaps);
  `stitchTimeline` trims each slice from the right clip and concatenates them over
  the base audio. Verified with unit cases (overlay tail/middle, gaps) and live API
  checks of the duration/track/endSec behaviour.
