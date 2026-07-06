import { useEffect, useState } from "react";
import { AudioLines, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileField } from "@/components/FileField";
import {
  deleteAudioClip as deleteAudioClipApi,
  updateAudioClip as updateAudioClipApi,
  type TemplateAudioClip,
} from "@/lib/api";

interface Props {
  templateId: string;
  /** Number of audio lanes available (for the track picker). */
  audioTrackCount: number;
  clip: TemplateAudioClip;
  onSaved: (clip: TemplateAudioClip) => void;
  onDeleted: (id: string) => void;
}

export function AudioClipInspector({ templateId, audioTrackCount, clip, onSaved, onDeleted }: Props) {
  const [track, setTrack] = useState(clip.track);
  const [audio, setAudio] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTrack(clip.track);
    setAudio(null);
    setError(null);
  }, [clip]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const form = new FormData();
      form.set("startSec", String(clip.startSec));
      form.set("track", String(track));
      if (audio) form.set("audio", audio);
      onSaved(await updateAudioClipApi(templateId, clip.id, form));
      setAudio(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save audio clip");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetCrop() {
    const form = new FormData();
    form.set("cropStart", "0");
    form.set("cropEnd", String(clip.duration));
    try {
      onSaved(await updateAudioClipApi(templateId, clip.id, form));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset crop");
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this audio clip?")) return;
    await deleteAudioClipApi(templateId, clip.id).catch(() => {});
    onDeleted(clip.id);
  }

  const usedLen = clip.endSec - clip.startSec;
  const cropped = clip.cropStart > 0.001 || usedLen < clip.duration - 0.001;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <AudioLines className="h-4 w-4 text-emerald-500" /> Audio clip
        </h3>
        <Button variant="ghost" size="icon" onClick={handleDelete} title="Delete audio clip">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <p className="truncate text-sm font-medium">{clip.name || "Audio clip"}</p>
      <audio key={clip.audioUrl} src={clip.audioUrl} controls className="w-full" />

      <FileField
        label="Replace audio"
        hint={audio ? audio.name : "Upload a new file (MP3 / WAV / M4A)"}
        accept="audio/*"
        file={audio}
        onChange={setAudio}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Track</Label>
        <Select value={String(track)} onValueChange={(v) => setTrack(Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: Math.max(audioTrackCount, track + 1) }, (_, i) => (
              <SelectItem key={i} value={String(i)}>
                Audio {i + 1}
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
                Using {usedLen.toFixed(1)}s of the {clip.duration.toFixed(1)}s clip (cropped)
              </>
            ) : (
              <>Full clip · {clip.duration.toFixed(1)}s</>
            )}
          </span>
          {cropped && (
            <button type="button" onClick={handleResetCrop} className="font-medium text-primary hover:underline">
              Reset crop
            </button>
          )}
        </div>
        <span className="text-muted-foreground">
          Drag the clip&apos;s edges on the timeline to crop it. Overlapping audio is mixed together.
        </span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          "Save clip"
        )}
      </Button>
    </div>
  );
}
