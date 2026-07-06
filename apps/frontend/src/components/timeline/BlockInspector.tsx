import { useEffect, useMemo, useState } from "react";
import { Camera, Clapperboard, Loader2, Trash2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileField } from "@/components/FileField";
import {
  bakeBlock as bakeBlockApi,
  deleteBlock as deleteBlockApi,
  durationsForModel,
  generateBlockSwap as generateBlockSwapApi,
  modelsForDuration,
  updateBlock as updateBlockApi,
  type GenerationModel,
  type SwapModelOption,
  type TemplateBlock,
} from "@/lib/api";

const FALLBACK_RESOLUTIONS = ["480p", "720p", "1080p"];
const FALLBACK_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
// Sentinel for "use the server's default swap engine" (Radix Select can't use "").
const SWAP_DEFAULT = "__default__";

interface Props {
  templateId: string;
  /** Display names for the template's avatar slots, in slot order (length 1-2). */
  avatarLabels: string[];
  /** Number of video tracks available (for the track picker). */
  trackCount: number;
  models: GenerationModel[];
  /** Selectable face-swap engines (local FaceFusion + OpenRouter edit models). */
  swapModels: SwapModelOption[];
  block: TemplateBlock;
  onSaved: (block: TemplateBlock) => void;
  onDeleted: (id: string) => void;
  /** Grab the current program-monitor frame as this block's start/end frame. */
  onUsePreviewFrame: (blockId: string, slot: "start" | "end") => Promise<unknown>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function BlockInspector({
  templateId,
  avatarLabels,
  trackCount,
  models,
  swapModels,
  block,
  onSaved,
  onDeleted,
  onUsePreviewFrame,
}: Props) {
  const [prompt, setPrompt] = useState(block.prompt);
  const [model, setModel] = useState(block.model);
  const [duration, setDuration] = useState(
    block.duration ?? Math.max(1, Math.round(block.endSec - block.startSec)),
  );
  const [track, setTrack] = useState(block.track);
  const [resolution, setResolution] = useState(block.resolution ?? "");
  const [aspectRatio, setAspectRatio] = useState(block.aspectRatio ?? "");
  const [faceSwapStart, setFaceSwapStart] = useState(block.faceSwapStart);
  const [faceSwapEnd, setFaceSwapEnd] = useState(block.faceSwapEnd);
  const [avatarSlot, setAvatarSlot] = useState(block.avatarSlot);
  const [swapContext, setSwapContext] = useState(block.swapContext ?? "");
  const [swapModel, setSwapModel] = useState(block.swapModel ?? "");
  const [lipsync, setLipsync] = useState(block.lipsync);
  const [startImage, setStartImage] = useState<File | null>(null);
  const [endImage, setEndImage] = useState<File | null>(null);
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [baking, setBaking] = useState(false);
  const [grabbing, setGrabbing] = useState<null | "start" | "end">(null);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An admin-uploaded raw video block: used as-is, with no AI generation.
  const isUpload = !!block.sourceVideoUrl;

  // Reset form whenever a different block is selected.
  useEffect(() => {
    setPrompt(block.prompt);
    setModel(block.model);
    setDuration(block.duration ?? Math.max(1, Math.round(block.endSec - block.startSec)));
    setTrack(block.track);
    setResolution(block.resolution ?? "");
    setAspectRatio(block.aspectRatio ?? "");
    setFaceSwapStart(block.faceSwapStart);
    setFaceSwapEnd(block.faceSwapEnd);
    setAvatarSlot(block.avatarSlot);
    setSwapContext(block.swapContext ?? "");
    setSwapModel(block.swapModel ?? "");
    setLipsync(block.lipsync);
    setStartImage(null);
    setEndImage(null);
    setSourceVideo(null);
    setError(null);
  }, [block]);

  const selectedModel = useMemo(() => models.find((m) => m.id === model), [models, model]);
  const resolutions = selectedModel?.supported_resolutions?.length
    ? selectedModel.supported_resolutions
    : FALLBACK_RESOLUTIONS;
  const aspectRatios = selectedModel?.supported_aspect_ratios?.length
    ? selectedModel.supported_aspect_ratios
    : FALLBACK_ASPECT_RATIOS;

  // Duration ⇄ model constraint (spec 09): only offer durations the model supports,
  // and only list models that support the chosen duration.
  const availableModels = useMemo(() => modelsForDuration(models, duration), [models, duration]);
  const durationOptions = durationsForModel(selectedModel);

  function handleModelChange(id: string) {
    setModel(id);
    const ds = durationsForModel(models.find((m) => m.id === id));
    if (!ds.includes(duration)) setDuration(ds[0] ?? duration);
  }
  function handleDurationChange(value: string) {
    const d = Number(value);
    setDuration(d);
    if (model && !modelsForDuration(models, d).some((m) => m.id === model)) {
      setModel(modelsForDuration(models, d)[0]?.id ?? "");
    }
  }

  const safeSlot = Math.min(avatarSlot, Math.max(0, avatarLabels.length - 1));
  const avatarName = (i: number) => `Avatar ${i + 1}${avatarLabels[i] ? ` — ${avatarLabels[i]}` : ""}`;

  /** Persist the current form to the server. Returns the updated block, or null on error. */
  async function persist(): Promise<TemplateBlock | null> {
    if (!prompt.trim() || !model) {
      setError("Prompt and model are required.");
      return null;
    }
    const form = new FormData();
    form.set("startSec", String(block.startSec));
    form.set("duration", String(duration));
    form.set("track", String(track));
    form.set("prompt", prompt);
    form.set("model", model);
    if (resolution) form.set("resolution", resolution);
    if (aspectRatio) form.set("aspectRatio", aspectRatio);
    form.set("faceSwapStart", String(faceSwapStart));
    form.set("faceSwapEnd", String(faceSwapEnd));
    form.set("avatarSlot", String(safeSlot));
    form.set("swapContext", swapContext);
    form.set("swapModel", swapModel);
    // Only keep lip-sync on for models that actually accept audio input.
    form.set("lipsync", String(lipsync && !!selectedModel?.supportsAudioInput));
    if (startImage) form.set("startImage", startImage);
    if (endImage) form.set("endImage", endImage);
    const updated = await updateBlockApi(templateId, block.id, form);
    onSaved(updated);
    return updated;
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await persist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save block");
    } finally {
      setSaving(false);
    }
  }

  /** Save an uploaded-video block (track + optional replacement video). */
  async function handleSaveUpload() {
    setError(null);
    setSaving(true);
    try {
      const form = new FormData();
      form.set("startSec", String(block.startSec));
      form.set("track", String(track));
      if (sourceVideo) form.set("sourceVideo", sourceVideo);
      onSaved(await updateBlockApi(templateId, block.id, form));
      setSourceVideo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save block");
    } finally {
      setSaving(false);
    }
  }

  // Save the current edits, then generate just the face swap so it can be
  // reviewed before baking. Bake reuses this — it won't re-swap.
  async function handleGenerateSwap() {
    setError(null);
    setSwapping(true);
    try {
      const saved = await persist();
      if (!saved) return;
      onSaved(await generateBlockSwapApi(templateId, block.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate face swap");
    } finally {
      setSwapping(false);
    }
  }

  // Save the current edits, then generate this single clip so it can be previewed
  // on the timeline.
  async function handleBake() {
    setError(null);
    setBaking(true);
    try {
      const saved = await persist();
      if (!saved) return;
      const baked = await bakeBlockApi(templateId, block.id);
      onSaved(baked);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to bake block");
    } finally {
      setBaking(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this video block?")) return;
    await deleteBlockApi(templateId, block.id).catch(() => {});
    onDeleted(block.id);
  }

  // Grab the current program-monitor frame as this block's start/end frame.
  async function handleGrabFrame(slot: "start" | "end") {
    setError(null);
    setGrabbing(slot);
    try {
      await onUsePreviewFrame(block.id, slot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture frame");
    } finally {
      setGrabbing(null);
    }
  }

  // Un-crop: use the whole generated clip again.
  async function handleResetCrop() {
    const form = new FormData();
    form.set("cropStart", "0");
    form.set("cropEnd", String(duration));
    try {
      onSaved(await updateBlockApi(templateId, block.id, form));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset crop");
    }
  }

  const usedLen = block.endSec - block.startSec;
  const cropped = block.cropStart > 0.001 || usedLen < duration - 0.001;

  // ---- Uploaded raw video block: a much simpler editor (no AI parameters). ----
  if (isUpload) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Upload className="h-4 w-4 text-sky-500" /> Uploaded video
          </h3>
          <Button variant="ghost" size="icon" onClick={handleDelete} title="Delete block">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          This block plays your uploaded clip as-is — no AI generation, avatar or face-swap is
          applied. It renders the same for everyone.
        </p>

        {block.sourceVideoUrl && !sourceVideo && (
          <video src={block.sourceVideoUrl} controls className="w-full rounded-md" />
        )}

        <FileField
          label="Replace video"
          hint={sourceVideo ? sourceVideo.name : "Upload a new clip (MP4 / MOV / WebM)"}
          accept="video/*"
          file={sourceVideo}
          onChange={setSourceVideo}
        />

        <div className="flex flex-col gap-1.5">
          <Label>Track</Label>
          <Select value={String(track)} onValueChange={(v) => setTrack(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(trackCount, track + 1) }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  Track {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 rounded-md border border-input px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {cropped ? (
                <>
                  Using {usedLen.toFixed(1)}s of the {duration}s clip (cropped)
                </>
              ) : (
                <>Full clip · {duration}s</>
              )}
            </span>
            {cropped && (
              <button type="button" onClick={handleResetCrop} className="font-medium text-primary hover:underline">
                Reset crop
              </button>
            )}
          </div>
          <span className="text-muted-foreground">
            Drag the clip&apos;s edges on the timeline to crop it.
          </span>
          {block.linkGroupId && (
            <span className="text-amber-500">Linked copy — replacing this video updates all its copies.</span>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={handleSaveUpload} disabled={saving} className="w-full">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save block"
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Video block</h3>
        <Button variant="ghost" size="icon" onClick={handleDelete} title="Delete block">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="block-prompt">Prompt</Label>
        <Textarea id="block-prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Model</Label>
        <Select value={model} onValueChange={handleModelChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Showing models that support {duration}s clips.</p>
      </div>

      {selectedModel?.supportsAudioInput && (
        <div className="flex flex-col gap-1.5">
          <Toggle
            checked={lipsync}
            onChange={setLipsync}
            label="Send audio for lip-sync"
          />
          <p className="text-xs text-muted-foreground">
            This model can lip-sync. When on, the audio under this block on the timeline is sent so
            the subject lip-syncs to it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Duration</Label>
          <Select value={String(duration)} onValueChange={handleDurationChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {durationOptions.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Track</Label>
          <Select value={String(track)} onValueChange={(v) => setTrack(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(trackCount, track + 1) }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  Track {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Resolution</Label>
          <Select value={resolution} onValueChange={setResolution}>
            <SelectTrigger>
              <SelectValue placeholder="auto" />
            </SelectTrigger>
            <SelectContent>
              {resolutions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Aspect ratio</Label>
          <Select value={aspectRatio} onValueChange={setAspectRatio}>
            <SelectTrigger>
              <SelectValue placeholder="auto" />
            </SelectTrigger>
            <SelectContent>
              {aspectRatios.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-input px-3 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            {cropped ? (
              <>
                Using {(usedLen).toFixed(1)}s of the {duration}s clip (cropped)
              </>
            ) : (
              <>Full clip · {duration}s</>
            )}
          </span>
          {cropped && (
            <button
              type="button"
              onClick={handleResetCrop}
              className="font-medium text-primary hover:underline"
            >
              Reset crop
            </button>
          )}
        </div>
        <span className="text-muted-foreground">
          Drag the clip&apos;s edges on the timeline to crop it (the full clip is always kept).
        </span>
        {block.linkGroupId && (
          <span className="text-amber-500">
            Linked copy — editing or baking this clip updates all its copies.
          </span>
        )}
      </div>

      {/* Reference avatar — used as the reference image, and as the face-swap source below. */}
      <div className="flex flex-col gap-1.5">
        <Label>Reference avatar</Label>
        <Select value={String(safeSlot)} onValueChange={(v) => setAvatarSlot(Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {avatarLabels.map((_, i) => (
              <SelectItem key={i} value={String(i)}>
                {avatarName(i)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          This avatar is used as the reference image for the clip (and the face-swap source below).
        </p>
      </div>

      <p className="-mb-1 text-xs text-muted-foreground">
        Set a start/end frame by uploading an image, or grab the current preview frame: scrub the
        timeline so the program monitor shows the frame you want, then click “Use preview frame”.
        Face-swap below still applies to it.
      </p>

      <FileField
        label="Start frame (base image)"
        hint={block.startImageUrl ? "Replace the current start frame" : "Optional first frame"}
        file={startImage}
        onChange={setStartImage}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => void handleGrabFrame("start")}
        disabled={grabbing !== null}
        title="Use the frame currently shown in the preview as the start frame"
      >
        {grabbing === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        Use preview frame as start
      </Button>
      {block.startImageUrl && !startImage && (
        <img src={block.startImageUrl} alt="start frame" className="h-20 w-auto rounded-md object-cover" />
      )}
      <FileField
        label="End frame (base image)"
        hint={block.endImageUrl ? "Replace the current end frame" : "Optional last frame"}
        file={endImage}
        onChange={setEndImage}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => void handleGrabFrame("end")}
        disabled={grabbing !== null}
        title="Use the frame currently shown in the preview as the end frame"
      >
        {grabbing === "end" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        Use preview frame as end
      </Button>
      {block.endImageUrl && !endImage && (
        <img src={block.endImageUrl} alt="end frame" className="h-20 w-auto rounded-md object-cover" />
      )}

      <div className="flex flex-col gap-2">
        <Toggle
          checked={faceSwapStart}
          onChange={setFaceSwapStart}
          label={`Face-swap start frame with ${avatarName(safeSlot)}`}
        />
        <Toggle
          checked={faceSwapEnd}
          onChange={setFaceSwapEnd}
          label={`Face-swap end frame with ${avatarName(safeSlot)}`}
        />
      </div>

      {(faceSwapStart || faceSwapEnd) && (
        <div className="flex flex-col gap-1.5">
          <Label>Face swap model</Label>
          <Select
            value={swapModel === "" ? SWAP_DEFAULT : swapModel}
            onValueChange={(v) => setSwapModel(v === SWAP_DEFAULT ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SWAP_DEFAULT}>Server default</SelectItem>
              {swapModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Which engine produces this block&apos;s swap. Try a few with “Generate face swap” and keep
            the one you like — bake reuses the approved preview.
          </p>
        </div>
      )}

      {(faceSwapStart || faceSwapEnd) && swapModel !== "facefusion" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="block-swap-context">Swap context (optional)</Label>
          <Textarea
            id="block-swap-context"
            rows={2}
            value={swapContext}
            onChange={(e) => setSwapContext(e.target.value)}
            placeholder="e.g. keep the soft window lighting; neutral expression"
          />
          <p className="text-xs text-muted-foreground">
            Guidance for AI swap models (Gemini/FLUX). Ignored by the local FaceFusion swapper.
          </p>
        </div>
      )}

      {(faceSwapStart || faceSwapEnd) && (
        <div className="flex flex-col gap-2 rounded-md border border-input p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Face swap preview</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleGenerateSwap}
              disabled={
                swapping ||
                saving ||
                baking ||
                !((faceSwapStart && block.startImageUrl) || (faceSwapEnd && block.endImageUrl))
              }
              title="Generate the face swap so you can review it before baking"
            >
              {swapping ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />{" "}
                  {block.swappedStartUrl || block.swappedEndUrl ? "Regenerate face swap" : "Generate face swap"}
                </>
              )}
            </Button>
          </div>

          {block.swappedStartUrl || block.swappedEndUrl ? (
            <>
              <div className="flex flex-wrap gap-3">
                {block.swappedStartUrl && (
                  <figure className="flex flex-col gap-1">
                    <img src={block.swappedStartUrl} alt="swapped start" className="h-24 w-auto rounded-md object-cover" />
                    <figcaption className="text-[10px] text-muted-foreground">Start (swapped)</figcaption>
                  </figure>
                )}
                {block.swappedEndUrl && (
                  <figure className="flex flex-col gap-1">
                    <img src={block.swappedEndUrl} alt="swapped end" className="h-24 w-auto rounded-md object-cover" />
                    <figcaption className="text-[10px] text-muted-foreground">End (swapped)</figcaption>
                  </figure>
                )}
              </div>
              <p className="text-xs text-emerald-600">
                Looks good? Bake reuses this swap — it won&apos;t regenerate. Not happy? Tweak the swap
                context and regenerate.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Generate the swap to preview it before baking. Set a start/end frame and turn on its
              face-swap toggle first.
            </p>
          )}
        </div>
      )}

      {block.videoUrl && (
        <p className="text-xs text-emerald-500">
          This clip is baked — it plays in the preview monitor.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || baking || swapping} variant="secondary" className="flex-1">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save block"
          )}
        </Button>
        <Button onClick={handleBake} disabled={saving || baking || swapping} className="flex-1" title="Generate this clip">
          {baking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Baking…
            </>
          ) : (
            <>
              <Clapperboard className="h-4 w-4" /> {block.videoUrl ? "Re-bake" : "Bake"}
            </>
          )}
        </Button>
      </div>
      {baking && (
        <p className="text-xs text-muted-foreground">
          Generating this clip — this can take a few minutes.
        </p>
      )}
    </div>
  );
}
