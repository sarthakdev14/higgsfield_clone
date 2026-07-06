import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Gem, Loader2, Plus, RectangleHorizontal, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RefImageThumb } from "@/components/RefImageThumb";
import { ImageSlot } from "@/components/ImageSlot";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { refreshCredits } from "@/lib/useMe";
import { useActionCosts } from "@/lib/useActionCosts";
import {
  ALLOWED_DURATIONS,
  createVideo,
  fetchModels,
  modelsForDuration,
  type Video,
  type VideoModel,
} from "@/lib/api";

const FALLBACK_RESOLUTIONS = ["480p", "720p", "1080p"];
const FALLBACK_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

interface Props {
  onCreated: (video: Video) => void;
}

export function TextToVideoForm({ onCreated }: Props) {
  const [models, setModels] = useState<VideoModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("");
  const [resolution, setResolution] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [startFrame, setStartFrame] = useState<File | null>(null);
  const [endFrame, setEndFrame] = useState<File | null>(null);
  const [referenceFrames, setReferenceFrames] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const costs = useActionCosts();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchModels()
      .then((m) => {
        setModels(m);
        if (m[0]) setModel(m[0].id);
      })
      .catch((err) => setModelsError(err.message));
  }, []);

  const selectedModel = useMemo(() => models.find((m) => m.id === model), [models, model]);
  const resolutions = selectedModel?.supported_resolutions?.length
    ? selectedModel.supported_resolutions
    : FALLBACK_RESOLUTIONS;
  const aspectRatios = selectedModel?.supported_aspect_ratios?.length
    ? selectedModel.supported_aspect_ratios
    : FALLBACK_ASPECT_RATIOS;

  // Only show models that support the chosen duration (spec 09).
  const availableModels = useMemo(
    () => modelsForDuration(models, duration ? Number(duration) : null),
    [models, duration],
  );

  function handleDurationChange(value: string) {
    setDuration(value);
    const allowed = modelsForDuration(models, value ? Number(value) : null);
    if (model && !allowed.some((m) => m.id === model)) {
      setModel(allowed[0]?.id ?? "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!model || !prompt.trim()) {
      setError("Model and prompt are required.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      if (duration) form.set("duration", duration);
      if (resolution) form.set("resolution", resolution);
      if (aspectRatio) form.set("aspectRatio", aspectRatio);
      form.set("generateAudio", String(generateAudio));
      if (startFrame) form.set("startFrame", startFrame);
      if (endFrame) form.set("endFrame", endFrame);
      referenceFrames.forEach((f) => form.append("referenceFrames", f));

      const video = await createVideo(form);
      refreshCredits();
      onCreated(video);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate video");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      {/* Preset / mode header card */}
      <div className="relative h-28 overflow-hidden rounded-xl border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-card to-card" />
        <div className="relative flex h-full flex-col justify-end p-3">
          <span className="text-xs font-extrabold uppercase tracking-wide text-primary">
            General
          </span>
          <span className="text-sm font-medium text-foreground">
            {selectedModel?.name ?? "Text to Video"}
          </span>
        </div>
      </div>

      {/* Start / end frames (image-to-video) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Frames <span className="text-muted-foreground/60">(optional, for image-to-video)</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ImageSlot
            file={startFrame}
            label="Start frame"
            aspectClass="aspect-video"
            onPick={setStartFrame}
            onClear={() => setStartFrame(null)}
          />
          <ImageSlot
            file={endFrame}
            label="End frame"
            aspectClass="aspect-video"
            onPick={setEndFrame}
            onClear={() => setEndFrame(null)}
          />
        </div>
      </div>

      {/* Reference images */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Reference images <span className="text-muted-foreground/60">(optional)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {referenceFrames.map((file, i) => (
            <RefImageThumb
              key={i}
              file={file}
              onClear={() => setReferenceFrames((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/20 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="h-5 w-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              setReferenceFrames((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Prompt */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <Label htmlFor="prompt" className="text-xs text-muted-foreground">
          Prompt
        </Label>
        <Textarea
          id="prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A golden retriever playing fetch on a sunny beach…"
          className="mt-1.5 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex items-center gap-2 border-t border-white/[0.06] pt-2">
          <button
            type="button"
            onClick={() => setGenerateAudio((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/[0.08]"
          >
            {generateAudio ? (
              <Volume2 className="h-3.5 w-3.5 text-primary" />
            ) : (
              <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            Audio {generateAudio ? "On" : "Off"}
          </button>
        </div>
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Model</Label>
        {modelsError ? (
          <p className="text-sm text-destructive">{modelsError}</p>
        ) : (
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="rounded-xl">
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
        )}
      </div>

      {/* Duration / aspect / resolution */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" /> Duration
          </Label>
          <Select value={duration || "auto"} onValueChange={(v) => handleDurationChange(v === "auto" ? "" : v)}>
            <SelectTrigger className="rounded-xl px-2.5">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {ALLOWED_DURATIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <RectangleHorizontal className="h-3 w-3" /> Aspect
          </Label>
          <Select value={aspectRatio || "auto"} onValueChange={(v) => setAspectRatio(v === "auto" ? "" : v)}>
            <SelectTrigger className="rounded-xl px-2.5">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {aspectRatios.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Gem className="h-3 w-3" /> Resolution
          </Label>
          <Select value={resolution || "auto"} onValueChange={(v) => setResolution(v === "auto" ? "" : v)}>
            <SelectTrigger className="rounded-xl px-2.5">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {resolutions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {duration && (
        <p className="-mt-1 text-[11px] text-muted-foreground">
          Showing models that support {duration}s clips.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Generate */}
      <Button type="submit" size="lg" disabled={submitting} className="mt-1 w-full rounded-xl">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Generating…
          </>
        ) : (
          <>Generate{costs ? ` (${costs.video} credits)` : ""}</>
        )}
      </Button>
    </form>
  );
}
