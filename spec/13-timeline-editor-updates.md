1. Cropping feature isnt working as expected. I do see the mouse pointer change but when I click and drag to shorten the video, atleast in the UI it doesnt shorter
2. Right click on this page should be hijacked. It should show options like copy, paste, delete etc.
3. I should be able to start creating a new video block from the current marker exactly. Right now it seems like I can only do it on certain steps (0.5 s steps I think). Precision selection should be allowed here, and if the mouse pointer is close enough to the marker (current point), it should snap to it
4. Dragging is also not working neither horizontally nor vertically.

---

## Implementation notes

All four were frontend-only fixes in `Timeline.tsx` (+ the context menu in
`AdminTemplateCreatePage.tsx`); no backend/schema changes.

- **Root cause of #1 (crop) and #4 (move): detached drag listeners.** The window
  `pointermove`/`pointerup` listeners were added in `beginDrag`, but the handlers were
  `useCallback`s depending on the (non-memoized) parent callback props. The
  `onSelect()` fired on pointer-down triggered a re-render → new handler identities →
  a cleanup `useEffect` removed the just-added window listeners, killing the drag
  instantly. Fix: the handlers are now **stable** (`useCallback` reading the latest
  props/track-count via refs — `propsRef`, `tracksRef`, `blocksRef`), so re-renders
  never detach an in-progress drag. The cleanup effect now only runs on unmount.
- **#3 Precision + snap-to-marker.** Replaced the hard 0.5s quantization with
  `xToSecRaw` (precise px→seconds) + `snapSec` (magnet to the playhead within 8px,
  otherwise a fine 0.1s grid). New blocks created near the marker snap to it exactly;
  moves/crops snap their dragged edge to the marker too. Crop edges snap in
  timeline-space and derive `cropStart`/`cropEnd` from the snapped edge.
- **#2 Right-click context menu.** The timeline emits `onContextMenu(blockId | null, e)`;
  the page renders a small Copy / Paste / Delete menu at the cursor (Copy enabled on a
  block, Paste when the clipboard has something, Delete on a block), closed by
  click-away or another right-click.
- All pointer-down handlers now ignore non-left buttons (`e.button !== 0`) so
  right-click reliably opens the menu instead of starting a create/move/crop.
