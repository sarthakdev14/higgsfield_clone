Few things need to change in the video template
 - When creating the template, the admin should select one of their avatars (or two) as the avatars that will be used during the template generation
 - When they create a video block, they should simply select "Avatar 1" or "Avatar 2" as reference image. If they select "Face swap the start frame" or "Face swap the end frame", they should still just select which avatar (1 or 2) should be face swapped. They shouldnt re-upload a new image because then the template isnt generic anymore.
 - I should be allowed to play the timeline and preview it as well, standard feature that premere pro has.

---

## Implementation notes

- **Avatars at template creation.** `Template.avatarIds` (1-2 of the admin's own
  avatars) is chosen in `TemplateSetupForm`; it sets `avatarSlots`. Admin `/export`
  now renders with the template's own avatars (no avatar picker on export). Users
  still pick their own avatars (same slot count) when generating.
- **Blocks reference avatars by slot.** Removed `TemplateBlock.referenceImageKeys`
  and the per-block reference-image upload. The block's `avatarSlot` ("Avatar 1"/
  "Avatar 2", shown with the avatar's name) is used as the OpenRouter reference
  image and as the face-swap source for the start/end frame toggles. Admins still
  upload the block's base start/end frames.
- **Timeline play/preview.** `Timeline.tsx` gained a program monitor + play/pause/
  stop transport. The playhead advances in real time (synced to the audio track
  when present) and the monitor shows the current block's start/end frame with the
  prompt as a caption; clicking the ruler scrubs.
- **Also fixed:** large audio uploads (a dedicated 200 MB multer instance) and a
  multer error handler so oversized/unexpected uploads return a clean 400 instead
  of crashing the request.