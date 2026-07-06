I should be allowed to drag a video segment/track left and right. 
I should also be allowed to move it up and down (lets avoid overlaps though, if I drag it on top of a video thats already present it should get rejected).

---

## Implementation notes

Frontend-only change in `apps/frontend/src/components/timeline/Timeline.tsx`
(dragging left/right and across tracks already existed from spec 09):

- Added `collides(start, end, track, exceptId?)` — true when the proposed span
  overlaps another clip **on the same track** (touching edges don't count).
- A move drop that collides is **rejected**: the clip snaps back to its original
  `start/end/track` (no server commit). While dragging into a colliding spot the
  clip renders red. The same check rejects creating a clip over an existing one.
- **Cross-track overlaps remain allowed** — that's the spec-09 feature (higher
  track wins). Only same-track overlaps are forbidden.
- Collision checks read a `blocksRef` (latest blocks) so the window drag listeners
  don't use stale state. No backend/schema changes were needed.
