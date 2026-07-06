Lets add a few more things
1. Allow user to copy paste video segments. Whenever that happens we should maintain a reference so that if one is updated/re-baked, other should show it as well.
2. Allow Cropping (just like premere pro). When I crop a video, the original duration should still be matinained but in the final render and in the timeline it should only show the cropped portion. I should be able to expand the cropped portion if I want (just like premere pro does)

---

## Implementation notes

`TemplateBlock` gained `cropStart`, `cropEnd` (crop window into the clip) and
`linkGroupId` (copy/paste link). DB pushed; no other schema changes.

**1. Copy/paste with shared reference.**
- New `POST /api/admin/templates/:id/blocks/:blockId/copy` clones a block's
  *content* into a new block and links both via a `linkGroupId` (created on first
  copy). Position + crop are per-copy; everything else (prompt, model, frames,
  baked `videoKey`, duration, face-swap, avatar) is shared.
- Editing (`PATCH`) or baking any block in a group propagates the shared content
  (and a duration change, re-clamping each one's crop) to the rest.
- Frontend: ⌘/Ctrl+C copies the selected clip, ⌘/Ctrl+V pastes a linked copy at the
  end of the timeline (also Copy/Paste buttons). Linked clips show a link icon; the
  inspector notes "editing/baking updates all copies"; the page re-fetches after a
  linked edit so siblings update on screen.

**2. Cropping (Premiere-style).**
- The full clip (`duration`) is always generated/kept; only `[cropStart, cropEnd)`
  is used. Footprint `endSec - startSec = (cropEnd ?? duration) - cropStart`,
  enforced server-side.
- Timeline clips have left/right trim handles: the right handle moves the out-point
  (up to `duration`), the left handle moves the in-point (down to 0) and shifts the
  clip's start so the right edge stays put — both expandable again later. The
  inspector shows "Using X of Ys (cropped)" + a **Reset crop** button.
- `buildTimelineSegments` maps timeline time → clip time with the `cropStart`
  offset, so the render + the program monitor show exactly the cropped portion.
- Crop drops respect the spec-10 same-track no-overlap rule (snap back on collision).