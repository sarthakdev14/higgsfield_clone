import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Film, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchAvatars,
  renderTemplate as renderTemplateApi,
  type Avatar,
  type Template,
  type TemplateRender,
} from "@/lib/api";
import { refreshCredits } from "@/lib/useMe";
import { useActionCosts } from "@/lib/useActionCosts";

interface Props {
  template: Template;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRendered: (render: TemplateRender) => void;
}

export function TemplateRenderDialog({ template, open, onOpenChange, onRendered }: Props) {
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const costs = useActionCosts();

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchAvatars()
      .then(setAvatars)
      .catch((err) => setError(err.message));
  }, [open]);

  const slots = Array.from({ length: template.avatarSlots }, (_, i) => i);

  function setSlot(i: number, avatarId: string) {
    setSelected((prev) => {
      const next = [...prev];
      next[i] = avatarId;
      return next;
    });
  }

  async function handleGenerate() {
    setError(null);
    const ids = slots.map((i) => selected[i]);
    if (ids.some((id) => !id)) {
      setError(`Pick an avatar for each of the ${template.avatarSlots} slot(s).`);
      return;
    }
    setSubmitting(true);
    try {
      const render = await renderTemplateApi(template.id, ids as string[]);
      refreshCredits();
      onRendered(render);
      onOpenChange(false);
      setSelected([]);
      // The render now runs in the background — take the user to the live
      // progress page where they can watch each block generate.
      navigate(`/generation/${render.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate video");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Generate {template.name}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-[360px_1fr]">
          {/* Original preview (right on desktop, top on mobile) */}
          <div className="relative order-first aspect-video bg-black md:order-last md:aspect-auto md:min-h-[560px]">
            {template.previewVideoUrl ? (
              <video
                src={template.previewVideoUrl}
                controls
                autoPlay
                loop
                muted
                playsInline
                poster={template.thumbnailUrl ?? undefined}
                className="h-full w-full object-contain"
              />
            ) : template.thumbnailUrl ? (
              <img
                src={template.thumbnailUrl}
                alt={template.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Film className="h-8 w-8" />
              </div>
            )}
            <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur">
              Original template
            </span>
          </div>

          {/* Controls sidebar */}
          <div className="flex flex-col gap-4 p-6 sm:p-7">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{template.name}</h2>
              {template.description && (
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                  {template.description}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Preview the original on the {" "}
                <span className="md:hidden">top</span>
                <span className="hidden md:inline">right</span>, then pick{" "}
                {template.avatarSlots === 1 ? "an avatar" : `${template.avatarSlots} avatars`} to
                star in your version.
              </p>
            </div>

            {avatars.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-muted-foreground">
                You don&apos;t have any avatars yet.
                <Button asChild variant="link" className="h-auto px-1 py-0 text-primary">
                  <Link to="/user/avatar">Create one first.</Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {slots.map((i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <Label>Avatar {template.avatarSlots > 1 ? i + 1 : ""}</Label>
                    <Select value={selected[i] ?? ""} onValueChange={(v) => setSlot(i, v)}>
                      <SelectTrigger className="rounded-xl">
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
                ))}
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              size="lg"
              className="mt-auto w-full rounded-xl"
              onClick={handleGenerate}
              disabled={submitting || avatars.length === 0}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Starting…
                </>
              ) : (
                <>Generate my video{costs ? ` (${costs.template_render} credits)` : ""}</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
