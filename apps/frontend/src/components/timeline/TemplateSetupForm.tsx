import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTemplate, fetchAvatars, type Avatar, type Template } from "@/lib/api";

const NONE = "__none__";

interface Props {
  onCreated: (template: Template) => void;
}

export function TemplateSetupForm({ onCreated }: Props) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar1, setAvatar1] = useState("");
  const [avatar2, setAvatar2] = useState(NONE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAvatars()
      .then((a) => {
        setAvatars(a);
        if (a[0]) setAvatar1(a[0].id);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("A template name is required.");
      return;
    }
    if (!avatar1) {
      setError("Select at least one avatar for the template.");
      return;
    }
    const avatarIds = [avatar1, avatar2 !== NONE ? avatar2 : null].filter(Boolean) as string[];
    if (new Set(avatarIds).size !== avatarIds.length) {
      setError("Avatar 1 and Avatar 2 must be different.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("name", name);
      if (description) form.set("description", description);
      avatarIds.forEach((id) => form.append("avatarIds", id));
      const template = await createTemplate(form);
      onCreated(template);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create template");
    } finally {
      setSubmitting(false);
    }
  }

  if (avatars.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-card/40 p-6">
        <h2 className="text-lg font-semibold">New template</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You need at least one avatar before creating a template. Avatars define who
          appears in the generated video.
        </p>
        <Button asChild className="mt-4 w-fit rounded-xl">
          <Link to="/user/avatar">Create an avatar</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Header card */}
      <div className="relative h-28 overflow-hidden rounded-xl border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-card to-card" />
        <div className="relative flex h-full flex-col justify-end p-3">
          <span className="text-xs font-extrabold uppercase tracking-wide text-primary">
            Template
          </span>
          <span className="text-sm font-medium text-foreground">New template</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-name">Name</Label>
        <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product launch hype reel" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-desc">Description</Label>
        <Textarea id="tpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Avatar 1</Label>
          <Select value={avatar1} onValueChange={setAvatar1}>
            <SelectTrigger>
              <SelectValue placeholder="Select an avatar" />
            </SelectTrigger>
            <SelectContent>
              {avatars.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Avatar 2 (optional)</Label>
          <Select value={avatar2} onValueChange={setAvatar2}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {avatars.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        These are your avatars used to test &amp; export. Users pick their own avatars when they
        generate from the published template.
      </p>

      <p className="text-xs text-muted-foreground">
        You&apos;ll start with an empty timeline — add video clips and upload audio in the editor.
        The timeline length grows automatically to fit your clips.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={submitting} className="w-full rounded-xl">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Creating…
          </>
        ) : (
          "Create & open editor"
        )}
      </Button>
    </form>
  );
}
