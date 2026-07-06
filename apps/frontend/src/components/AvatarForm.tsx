import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageSlot } from "@/components/ImageSlot";
import { createAvatar, type Avatar } from "@/lib/api";

interface Props {
  onCreated: (avatar: Avatar) => void;
}

export function AvatarForm({ onCreated }: Props) {
  const [name, setName] = useState("");
  const [photo1, setPhoto1] = useState<File | null>(null);
  const [photo2, setPhoto2] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !photo1) {
      setError("A name and at least one photo are required.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("name", name);
      form.append("images", photo1);
      if (photo2) form.append("images", photo2);
      const avatar = await createAvatar(form);
      onCreated(avatar);
      setName("");
      setPhoto1(null);
      setPhoto2(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create avatar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      {/* Header card */}
      <div className="relative h-28 overflow-hidden rounded-xl border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-card to-card" />
        <div className="relative flex h-full flex-col justify-end p-3">
          <span className="text-xs font-extrabold uppercase tracking-wide text-primary">
            Avatar
          </span>
          <span className="text-sm font-medium text-foreground">New avatar</span>
        </div>
      </div>

      {/* Quality tip */}
      <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs leading-5 text-foreground">
          <span className="font-semibold">The better the input, the better the output.</span>{" "}
          Upload clear, sharp, well-lit photos — high-resolution, front-facing and unobstructed
          faces give the most convincing results.
        </p>
      </div>

      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="avatar-name" className="text-xs text-muted-foreground">
          Avatar name
        </Label>
        <Input
          id="avatar-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Me, on stage"
          className="rounded-xl"
        />
      </div>

      {/* Photos */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Photos <span className="text-muted-foreground/60">(1st = face source)</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ImageSlot
            file={photo1}
            label="Face photo"
            onPick={setPhoto1}
            onClear={() => setPhoto1(null)}
          />
          <ImageSlot
            file={photo2}
            label="Second angle"
            onPick={setPhoto2}
            onClear={() => setPhoto2(null)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" size="lg" disabled={submitting} className="mt-1 w-full rounded-xl">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Creating…
          </>
        ) : (
          "Create avatar"
        )}
      </Button>
    </form>
  );
}
