import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ClipboardPaste, Copy, Loader2, Music, Rocket, Trash2, Upload } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useMe } from "@/lib/useMe";
import {
  ALLOWED_DURATIONS,
  captureBlockFrame as captureBlockFrameApi,
  copyBlock as copyBlockApi,
  createAudioClip as createAudioClipApi,
  createBlock as createBlockApi,
  deleteBlock as deleteBlockApi,
  exportTemplate as exportTemplateApi,
  fetchAdminTemplate,
  fetchAdminTemplates,
  fetchAvatars,
  fetchModels,
  fetchSwapModels,
  modelsForDuration,
  updateAudioClip as updateAudioClipApi,
  updateBlock as updateBlockApi,
  updateTemplate as updateTemplateApi,
  type Avatar,
  type GenerationModel,
  type SwapModelOption,
  type Template,
  type TemplateAudioClip,
  type TemplateBlock,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignedOut } from "@/components/SignedOut";
import { Timeline, type BlockPatch, type TimelineCaptureApi } from "@/components/timeline/Timeline";
import { BlockInspector } from "@/components/timeline/BlockInspector";
import { AudioClipInspector } from "@/components/timeline/AudioClipInspector";
import { TemplateSetupForm } from "@/components/timeline/TemplateSetupForm";

/** Snap a dragged span to the nearest allowed clip duration. */
function nearestDuration(span: number): number {
  return ALLOWED_DURATIONS.reduce((best, d) =>
    Math.abs(d - span) < Math.abs(best - span) ? d : best,
  );
}

/**
 * Smallest allowed generated duration that can cover `span` seconds (so the block
 * can be cropped down to exactly `span`); falls back to the longest duration.
 */
function durationForSpan(span: number): number {
  const sorted = [...ALLOWED_DURATIONS].sort((a, b) => a - b);
  return sorted.find((d) => d >= span - 1e-3) ?? sorted[sorted.length - 1]!;
}

export function AdminTemplateCreatePage() {
  const { data: session, isPending } = useSession();
  const { me, loading: meLoading } = useMe();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [current, setCurrent] = useState<Template | null>(null);
  const [blocks, setBlocks] = useState<TemplateBlock[]>([]);
  const [audioClips, setAudioClips] = useState<TemplateAudioClip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [swapModels, setSwapModels] = useState<SwapModelOption[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [trackCount, setTrackCount] = useState(1);
  const [audioTrackCount, setAudioTrackCount] = useState(1);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [thumbnailPrompt, setThumbnailPrompt] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const timelineCaptureRef = useRef<TimelineCaptureApi | null>(null);
  // Copy/paste clipboard (id of the block to clone) + latest clips for handlers.
  const [clipboardId, setClipboardId] = useState<string | null>(null);
  const [clipNotice, setClipNotice] = useState<string | null>(null);
  const blocksRef = useRef<TemplateBlock[]>([]);
  blocksRef.current = blocks;
  const audioClipsRef = useRef<TemplateAudioClip[]>([]);
  audioClipsRef.current = audioClips;

  // Selecting a video block clears any audio selection and vice versa.
  const selectVideo = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setSelectedAudioId(null);
  }, []);
  const selectAudio = useCallback((id: string | null) => {
    setSelectedAudioId(id);
    if (id) setSelectedId(null);
  }, []);
  // Right-click context menu (position + the block under the cursor, if any).
  const [menu, setMenu] = useState<{ x: number; y: number; blockId: string | null } | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    fetchAdminTemplates().then(setTemplates).catch(() => {});
    fetchModels().then(setModels).catch(() => {});
    fetchSwapModels().then(setSwapModels).catch(() => {});
    fetchAvatars().then(setAvatars).catch(() => {});
  }, [session?.user]);

  const openTemplate = useCallback(async (id: string) => {
    setOpenError(null);
    try {
      const full = await fetchAdminTemplate(id);
      const loaded = (full.blocks ?? []).slice().sort((a, b) => a.startSec - b.startSec);
      const loadedAudio = (full.audioClips ?? []).slice().sort((a, b) => a.startSec - b.startSec);
      setCurrent(full);
      setThumbnailPrompt(full.thumbnailPrompt ?? "");
      setBlocks(loaded);
      setAudioClips(loadedAudio);
      setTrackCount(Math.max(1, ...loaded.map((b) => b.track + 1)));
      setAudioTrackCount(Math.max(1, ...loadedAudio.map((c) => c.track + 1)));
      setSelectedId(null);
      setSelectedAudioId(null);
      setExportError(null);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Failed to open template");
    }
  }, []);

  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const selectedAudio = audioClips.find((c) => c.id === selectedAudioId) ?? null;
  // Names for the template's avatar slots (falls back to a generic label).
  const avatarLabels = (current?.avatarIds ?? []).map(
    (id, i) => avatars.find((a) => a.id === id)?.name ?? `Avatar ${i + 1}`,
  );

  async function handleCreateBlock(startSec: number, endSec: number, track: number) {
    if (!current) return;
    if (models.length === 0) {
      setExportError("Video models are still loading — try again in a moment.");
      return;
    }
    // Footprint = generated duration: snap the dragged span to an allowed length
    // and pick a model that can generate it.
    const duration = nearestDuration(endSec - startSec);
    const model = (modelsForDuration(models, duration)[0] ?? models[0]!).id;
    const form = new FormData();
    form.set("prompt", "New clip");
    form.set("model", model);
    form.set("startSec", String(startSec));
    form.set("duration", String(duration));
    form.set("track", String(track));
    form.set("order", String(blocks.length));
    try {
      const block = await createBlockApi(current.id, form);
      setBlocks((prev) => [...prev, block].sort((a, b) => a.startSec - b.startSec));
      setTrackCount((c) => Math.max(c, track + 1));
      selectVideo(block.id);
    } catch {
      /* ignore */
    }
  }

  /** First video track with room for [start,end), else a new track on top. */
  function firstFreeVideoTrack(start: number, end: number): number {
    const maxTrack = Math.max(0, ...blocksRef.current.map((b) => b.track));
    for (let t = 0; t <= maxTrack; t++) {
      const overlaps = blocksRef.current.some(
        (b) => b.track === t && start < b.endSec - 1e-3 && end > b.startSec + 1e-3,
      );
      if (!overlaps) return t;
    }
    return maxTrack + 1;
  }

  // Create a video block spanning the two timeline markers. Its generated length
  // snaps up to an allowed duration, cropped so its footprint matches the span.
  async function handleCreateBlockFromMarkers(start: number, end: number) {
    if (!current) return;
    if (models.length === 0) {
      setExportError("Video models are still loading — try again in a moment.");
      return;
    }
    const span = Math.max(1, end - start);
    const duration = durationForSpan(span);
    const footprint = Math.min(span, duration);
    const model = (modelsForDuration(models, duration)[0] ?? models[0]!).id;
    const track = firstFreeVideoTrack(start, start + footprint);
    const form = new FormData();
    form.set("prompt", "New clip");
    form.set("model", model);
    form.set("startSec", String(start));
    form.set("duration", String(duration));
    form.set("cropStart", "0");
    form.set("cropEnd", String(footprint));
    form.set("track", String(track));
    form.set("order", String(blocks.length));
    try {
      const block = await createBlockApi(current.id, form);
      setBlocks((prev) => [...prev, block].sort((a, b) => a.startSec - b.startSec));
      setTrackCount((c) => Math.max(c, track + 1));
      selectVideo(block.id);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to create block");
    }
  }

  // Capture the program-monitor frame (from the clip under the playhead) and set
  // it as the selected block's start/end frame. Face-swap toggles still apply.
  async function handleCaptureFrame(slot: "start" | "end", sourceBlockId: string, atSec: number) {
    if (!current || !selectedId) return;
    setExportError(null);
    try {
      const updated = await captureBlockFrameApi(current.id, selectedId, { sourceBlockId, atSec, slot });
      handleBlockSaved(updated);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to capture frame");
    }
  }

  // Inspector entry point: resolve the current monitor frame, then capture it for
  // the given block. Throws (surfaced by the inspector) if nothing is under the
  // playhead. Returns the updated block so the inspector can refresh its preview.
  async function handleUsePreviewFrame(blockId: string, slot: "start" | "end") {
    if (!current) throw new Error("No template open.");
    const ctx = timelineCaptureRef.current?.getContext() ?? null;
    if (!ctx) {
      throw new Error("Move the playhead over a video clip in the preview, then try again.");
    }
    const updated = await captureBlockFrameApi(current.id, blockId, {
      sourceBlockId: ctx.sourceBlockId,
      atSec: ctx.atSec,
      slot,
    });
    handleBlockSaved(updated);
    return updated;
  }

  // Upload a raw video as a new block (used directly, not AI-generated). It's
  // placed after every existing clip on track 1 (V1) so it never collides.
  async function handleUploadVideoBlock(file: File) {
    if (!current) return;
    setExportError(null);
    setUploadingVideo(true);
    try {
      const startSec = Math.max(0, ...blocksRef.current.map((b) => b.endSec));
      const form = new FormData();
      form.set("sourceVideo", file);
      form.set("startSec", String(startSec));
      form.set("track", "0");
      form.set("order", String(blocks.length));
      const block = await createBlockApi(current.id, form);
      setBlocks((prev) => [...prev, block].sort((a, b) => a.startSec - b.startSec));
      selectVideo(block.id);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to upload video");
    } finally {
      setUploadingVideo(false);
    }
  }

  // Upload an audio file as a new clip, placed after every existing audio clip
  // (on lane A1) so it never collides on insert.
  async function handleUploadAudio(file: File) {
    if (!current) return;
    setExportError(null);
    setUploadingAudio(true);
    try {
      const startSec = Math.max(0, ...audioClipsRef.current.map((c) => c.endSec));
      const form = new FormData();
      form.set("audio", file);
      form.set("startSec", String(startSec));
      form.set("track", "0");
      const clip = await createAudioClipApi(current.id, form);
      setAudioClips((prev) => [...prev, clip].sort((a, b) => a.startSec - b.startSec));
      selectAudio(clip.id);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to upload audio");
    } finally {
      setUploadingAudio(false);
    }
  }

  function handleChangeAudio(id: string, patch: BlockPatch) {
    setAudioClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function handleCommitAudio(id: string, patch: BlockPatch) {
    if (!current) return;
    const form = new FormData();
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) form.set(k, String(v));
    }
    try {
      const updated = await updateAudioClipApi(current.id, id, form);
      setAudioClips((prev) => prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.startSec - b.startSec));
      if (patch.track !== undefined) setAudioTrackCount((c) => Math.max(c, patch.track! + 1));
    } catch {
      /* ignore */
    }
  }

  function handleAudioSaved(updated: TemplateAudioClip) {
    setAudioClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)).sort((a, b) => a.startSec - b.startSec));
    setAudioTrackCount((c) => Math.max(c, updated.track + 1));
  }

  function handleAudioDeleted(id: string) {
    setAudioClips((prev) => prev.filter((c) => c.id !== id));
    setSelectedAudioId((cur) => (cur === id ? null : cur));
  }

  function handleChangeBlock(id: string, patch: BlockPatch) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  async function handleCommitBlock(id: string, patch: BlockPatch) {
    if (!current) return;
    const form = new FormData();
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) form.set(k, String(v));
    }
    try {
      const updated = await updateBlockApi(current.id, id, form);
      setBlocks((prev) => prev.map((b) => (b.id === id ? updated : b)).sort((a, b) => a.startSec - b.startSec));
      if (patch.track !== undefined) setTrackCount((c) => Math.max(c, patch.track! + 1));
    } catch {
      /* ignore */
    }
  }

  /** Re-fetch blocks so linked siblings reflect a propagated edit/bake. */
  const refreshBlocks = useCallback(async () => {
    if (!current) return;
    const full = await fetchAdminTemplate(current.id);
    const loaded = (full.blocks ?? []).slice().sort((a, b) => a.startSec - b.startSec);
    setBlocks(loaded);
    setTrackCount((c) => Math.max(c, 1, ...loaded.map((b) => b.track + 1)));
  }, [current]);

  function handleBlockSaved(updated: TemplateBlock) {
    setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)).sort((a, b) => a.startSec - b.startSec));
    // Linked copies were updated server-side too — pull them in.
    if (updated.linkGroupId) void refreshBlocks();
  }

  function handleBlockDeleted(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  async function handleDeleteBlock(id: string) {
    if (!current) return;
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    await deleteBlockApi(current.id, id).catch(() => {});
  }

  const handleCopy = useCallback(() => {
    if (!selectedId) {
      setClipNotice("Select a video clip first, then Copy.");
      return;
    }
    setClipboardId(selectedId);
    setClipNotice("Clip copied — press Paste (or ⌘/Ctrl+V) to add a linked copy.");
  }, [selectedId]);

  // Paste a linked copy of the clipboard block at the playhead (or first marker,
  // if set), on the first video track free at that spot. Linked copies share content.
  const handlePaste = useCallback(async () => {
    if (!current) return;
    if (!clipboardId) {
      setClipNotice("Nothing to paste yet — select a clip and Copy it first.");
      return;
    }
    const source = blocksRef.current.find((b) => b.id === clipboardId);
    if (!source) {
      setClipNotice("The copied clip no longer exists — copy a clip again.");
      return;
    }
    // Drop it where the user is looking: a marker if one is set, else the playhead.
    const markers = timelineCaptureRef.current?.getMarkers() ?? [];
    const playhead = timelineCaptureRef.current?.getPlayhead() ?? 0;
    const startSec = Math.max(0, markers[0] ?? playhead);
    const footprint = source.endSec - source.startSec;
    const track = firstFreeVideoTrack(startSec, startSec + footprint);
    setClipNotice("Pasting…");
    try {
      const { block, source: updatedSource } = await copyBlockApi(
        current.id,
        source.id,
        startSec,
        track,
      );
      setBlocks((prev) =>
        [...prev.map((b) => (b.id === updatedSource.id ? updatedSource : b)), block].sort(
          (a, b) => a.startSec - b.startSec,
        ),
      );
      setTrackCount((c) => Math.max(c, block.track + 1));
      selectVideo(block.id);
      setClipNotice(`Pasted a linked copy at ${Math.round(startSec)}s on track ${track + 1}.`);
    } catch (err) {
      setClipNotice(`Paste failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }, [current, clipboardId, selectVideo]);

  // Premiere-style Cmd/Ctrl+C / +V (ignored while typing in a field).
  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "c") handleCopy();
      else if (key === "v") {
        e.preventDefault();
        void handlePaste();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, handleCopy, handlePaste]);

  async function handleExport() {
    if (!current) return;
    setExportError(null);
    if (blocks.length === 0) {
      setExportError("Add at least one video block first.");
      return;
    }
    setExporting(true);
    try {
      // Persist the thumbnail description first so the export render (and every
      // future user render) uses it, then export.
      if ((current.thumbnailPrompt ?? "") !== thumbnailPrompt) {
        const form = new FormData();
        form.set("thumbnailPrompt", thumbnailPrompt);
        await updateTemplateApi(current.id, form);
      }
      const updated = await exportTemplateApi(current.id);
      setCurrent(updated);
      setThumbnailPrompt(updated.thumbnailPrompt ?? "");
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  // Only blank on the *initial* load (before we know the user). Never unmount
  // once `me` is known, or a background /me refresh (e.g. on window focus after
  // a file dialog closes) would tear the editor down mid-interaction.
  if ((isPending || meLoading) && !me) return null;
  if (!session?.user) return <SignedOut />;
  if (!me?.isAdmin) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Admin access required</h1>
        <p className="mt-2 text-muted-foreground">
          This area is only available to administrators.
        </p>
      </div>
    );
  }

  // Template picker / creation view.
  if (!current) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <button className="border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground">
            Template creator
          </button>
          <span className="text-sm text-muted-foreground">
            {templates.length} {templates.length === 1 ? "template" : "templates"}
          </span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Setup rail */}
          <aside className="w-full shrink-0 lg:w-[380px]">
            <div className="lg:sticky lg:top-20">
              <TemplateSetupForm
                onCreated={(t) => {
                  setTemplates((prev) => [t, ...prev]);
                  openTemplate(t.id);
                }}
              />
            </div>
          </aside>

          {/* Continue editing */}
          <main className="min-h-[60vh] flex-1 overflow-hidden rounded-2xl border border-white/[0.08] bg-card/40 p-6">
            <h2 className="mb-4 text-lg font-semibold">Continue editing</h2>
            {openError && <p className="mb-3 text-sm text-destructive">{openError}</p>}
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No templates yet — create one from the panel on the left.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => openTemplate(t.id)}
                    className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] text-left transition-colors hover:border-primary/40 hover:bg-white/[0.05]"
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-black/40">
                      {t.previewVideoUrl ? (
                        <video
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          src={t.previewVideoUrl}
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          onMouseEnter={(e) => void e.currentTarget.play()}
                          onMouseLeave={(e) => e.currentTarget.pause()}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 to-card text-xs text-muted-foreground">
                          No preview yet
                        </div>
                      )}
                      <span
                        className={
                          "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide " +
                          (t.published
                            ? "bg-primary text-primary-foreground"
                            : "bg-black/60 text-white backdrop-blur")
                        }
                      >
                        {t.published ? "Published" : "Draft"}
                      </span>
                    </div>
                    <div className="p-3">
                      <div className="truncate text-sm font-semibold">{t.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    );
  }

  // Editor view.
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setCurrent(null)} title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{current.name}</h1>
            <p className="text-xs text-muted-foreground">
              {current.avatarSlots} avatar slot(s) · {blocks.length} block(s) · {audioClips.length}{" "}
              audio ·{" "}
              <span className={current.published ? "text-primary" : undefined}>
                {current.published ? "published" : "draft"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadVideoBlock(file);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadAudio(file);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => videoInputRef.current?.click()}
            disabled={uploadingVideo}
            title="Add a clip from an uploaded video (no AI generation)"
          >
            {uploadingVideo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload video
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => audioInputRef.current?.click()}
            disabled={uploadingAudio}
            title="Add an audio clip to the timeline"
          >
            {uploadingAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />} Upload audio
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!selectedId} title="Copy clip (⌘/Ctrl+C)">
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handlePaste()} disabled={!clipboardId} title="Paste linked copy (⌘/Ctrl+V)">
            <ClipboardPaste className="h-4 w-4" /> Paste
          </Button>
        </div>
      </div>

      {clipNotice && (
        <p className="mb-2 text-sm text-primary" role="status">
          {clipNotice}
        </p>
      )}

      <p className="mb-2 text-sm text-muted-foreground">
        Drag on empty space to create a video clip. Upload videos and audio with the buttons above.
        Drag clips to move them and drag their edges to crop. The timeline grows to fit your clips;
        overlapping audio is mixed together.
      </p>

      <Timeline
        blocks={blocks}
        trackCount={trackCount}
        audioClips={audioClips}
        audioTrackCount={audioTrackCount}
        selectedId={selectedId}
        selectedAudioId={selectedAudioId}
        onSelect={selectVideo}
        onSelectAudio={selectAudio}
        onAddTrack={() => setTrackCount((c) => c + 1)}
        onAddAudioTrack={() => setAudioTrackCount((c) => c + 1)}
        onCreateBlock={handleCreateBlock}
        onCreateBlockFromMarkers={handleCreateBlockFromMarkers}
        onCaptureFrame={handleCaptureFrame}
        captureApiRef={timelineCaptureRef}
        onChangeBlock={handleChangeBlock}
        onCommitBlock={handleCommitBlock}
        onChangeAudio={handleChangeAudio}
        onCommitAudio={handleCommitAudio}
        onContextMenu={(blockId, e) => setMenu({ x: e.clientX, y: e.clientY, blockId })}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Export panel */}
        <div className="rounded-2xl border border-white/[0.08] bg-card/40 p-5">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-medium">
            <Rocket className="h-4 w-4" /> Test &amp; export
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Renders the whole template with this template&apos;s avatar(s) so you can preview it.
            Exporting publishes the template (and its thumbnail) for users.
          </p>
          <div className="flex flex-col gap-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Avatars: </span>
              {avatarLabels.length > 0 ? (
                avatarLabels.map((name, i) => (
                  <span key={i} className="font-medium">
                    {i > 0 ? ", " : ""}
                    {name}
                  </span>
                ))
              ) : (
                <span className="text-destructive">none assigned</span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-thumbnail-prompt">Thumbnail description</Label>
              <Textarea
                id="tpl-thumbnail-prompt"
                rows={3}
                value={thumbnailPrompt}
                onChange={(e) => setThumbnailPrompt(e.target.value)}
                placeholder="e.g. The actor smiling on a neon-lit city street at night, close-up, cinematic"
              />
              <p className="text-xs text-muted-foreground">
                Describes the cover thumbnail. The avatar is added as a reference image so the actor
                appears in it. Saved on export and reused (with each user&apos;s avatar) when users
                generate from this template.
              </p>
            </div>

            {exportError && <p className="text-sm text-destructive">{exportError}</p>}
            <Button onClick={handleExport} disabled={exporting} className="w-fit">
              {exporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Rendering… this can take several
                  minutes
                </>
              ) : (
                "Render & export"
              )}
            </Button>
          </div>

          {current.previewVideoUrl && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-medium">Latest export</h3>
              <video src={current.previewVideoUrl} controls className="w-full rounded-md" />
            </div>
          )}
        </div>

        {/* Inspector */}
        <div className="rounded-2xl border border-white/[0.08] bg-card/40 p-5">
          {selected ? (
            <BlockInspector
              templateId={current.id}
              avatarLabels={avatarLabels}
              trackCount={trackCount}
              models={models}
              swapModels={swapModels}
              block={selected}
              onSaved={handleBlockSaved}
              onDeleted={handleBlockDeleted}
              onUsePreviewFrame={handleUsePreviewFrame}
            />
          ) : selectedAudio ? (
            <AudioClipInspector
              templateId={current.id}
              audioTrackCount={audioTrackCount}
              clip={selectedAudio}
              onSaved={handleAudioSaved}
              onDeleted={handleAudioDeleted}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a video or audio clip on the timeline to edit it.
            </p>
          )}
        </div>
      </div>

      {menu && (
        <>
          {/* click-away / right-click-away closes the menu */}
          <div
            className="fixed inset-0 z-50"
            onPointerDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-36 overflow-hidden rounded-md border bg-popover p-1 text-sm shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
              disabled={!menu.blockId}
              onClick={() => {
                setClipboardId(menu.blockId);
                setMenu(null);
              }}
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
              disabled={!clipboardId}
              onClick={() => {
                void handlePaste();
                setMenu(null);
              }}
            >
              <ClipboardPaste className="h-4 w-4" /> Paste
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-destructive hover:bg-accent disabled:opacity-50"
              disabled={!menu.blockId}
              onClick={() => {
                if (menu.blockId) void handleDeleteBlock(menu.blockId);
                setMenu(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
