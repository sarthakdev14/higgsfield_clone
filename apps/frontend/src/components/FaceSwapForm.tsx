import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileField } from "@/components/FileField";
import { createFaceSwap, type FaceSwap } from "@/lib/api";

interface Props {
  onCreated: (swap: FaceSwap) => void;
}

export function FaceSwapForm({ onCreated }: Props) {
  const [target, setTarget] = useState<File | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!target || !source) {
      setError("Please provide both a base image and a face image.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("target", target); // the base image being modified
      form.set("source", source); // the face to apply
      const swap = await createFaceSwap(form);
      onCreated(swap);
      setTarget(null);
      setSource(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run face swap");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <FileField
          label="Base image"
          hint="The photo whose face(s) will be replaced"
          file={target}
          onChange={setTarget}
        />
        <FileField
          label="Face image"
          hint="The face you want to apply onto the base image"
          file={source}
          onChange={setSource}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Swapping… this can take a few minutes
            </>
          ) : (
            "Swap face"
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Preview label="Base image" file={target} />
        <Preview label="Face" file={source} />
      </div>
    </form>
  );
}

function Preview({ label, file }: { label: string; file: File | null }) {
  const url = file ? URL.createObjectURL(file) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="aspect-square overflow-hidden rounded-lg border bg-black/40">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No image
          </div>
        )}
      </div>
    </div>
  );
}
