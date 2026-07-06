import { useEffect, useMemo, useRef, useState } from "react";
import { Gem, Loader2, Plus, RectangleHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RefImageThumb } from "@/components/RefImageThumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createImage, fetchImageModels, type GenerationModel, type Image } from "@/lib/api";
import { refreshCredits } from "@/lib/useMe";
import { useActionCosts } from "@/lib/useActionCosts";

const FALLBACK_RESOLUTIONS = ["512", "1K", "2K", "4K"];
const FALLBACK_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

interface Props {
  onCreated: (image: Image) => void;
}

export function TextToImageForm({ onCreated }: Props) {
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [referenceImages, setReferenceImages] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const costs = useActionCosts();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchImageModels()
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
      if (resolution) form.set("resolution", resolution);
      if (aspectRatio) form.set("aspectRatio", aspectRatio);
      referenceImages.forEach((f) => form.append("referenceImages", f));

      const image = await createImage(form);
      refreshCredits();
      onCreated(image);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate image");
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
            {selectedModel?.name ?? "Text to Image"}
          </span>
        </div>
      </div>

      {/* Reference images */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Reference images <span className="text-muted-foreground/60">(optional)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {referenceImages.map((file, i) => (
            <RefImageThumb
              key={i}
              file={file}
              onClear={() => setReferenceImages((prev) => prev.filter((_, idx) => idx !== i))}
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
              setReferenceImages((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Prompt */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <Label htmlFor="image-prompt" className="text-xs text-muted-foreground">
          Prompt
        </Label>
        <Textarea
          id="image-prompt"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A red panda astronaut floating in space, studio lighting…"
          className="mt-1.5 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        />
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
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Aspect / resolution */}
      <div className="grid grid-cols-2 gap-2">
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Generate */}
      <Button type="submit" size="lg" disabled={submitting} className="mt-1 w-full rounded-xl">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Generating…
          </>
        ) : (
          <>Generate{costs ? ` (${costs.image} credits)` : ""}</>
        )}
      </Button>
    </form>
  );
}
