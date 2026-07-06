import { useState } from "react";
import { Film, Loader2, Sparkles, Wand2 } from "lucide-react";
import { TemplateRenderDialog } from "@/components/TemplateRenderDialog";
import type { Template, TemplateRender } from "@/lib/api";

interface Props {
  templates: Template[];
  loading: boolean;
  error: string | null;
  onRendered: (render: TemplateRender) => void;
}

function TemplateCard({ template, onSelect }: { template: Template; onSelect: () => void }) {
  const clips = template.blockCount ?? template.blocks?.length ?? 0;
  return (
    <button
      onClick={onSelect}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-card text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-black/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative aspect-video overflow-hidden bg-black/40">
        {template.previewVideoUrl ? (
          <video
            src={template.previewVideoUrl}
            muted
            loop
            playsInline
            preload="metadata"
            poster={template.thumbnailUrl ?? undefined}
            onMouseEnter={(e) => void e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : template.thumbnailUrl ? (
          <img
            src={template.thumbnailUrl}
            alt={template.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Film className="h-8 w-8" />
          </div>
        )}

        {/* Meta chip */}
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          {clips} clip{clips === 1 ? "" : "s"} · {template.avatarSlots} avatar
          {template.avatarSlots === 1 ? "" : "s"}
        </span>

        {/* Hover CTA */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg">
            <Wand2 className="h-4 w-4" /> Generate with my avatar
          </span>
        </div>
      </div>

      <div className="p-3">
        <div className="truncate text-sm font-semibold">{template.name}</div>
        {template.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{template.description}</p>
        )}
      </div>
    </button>
  );
}

function ComingSoonCard() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-6 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04] text-muted-foreground/70">
        <Sparkles className="h-5 w-5" />
      </span>
      <span className="text-sm font-medium text-muted-foreground">More coming soon</span>
      <span className="text-xs text-muted-foreground/60">New templates drop every week</span>
    </div>
  );
}

export function TemplateGallery({ templates, loading, error, onRendered }: Props) {
  const [active, setActive] = useState<Template | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading templates…
      </div>
    );
  }
  if (error) return <p className="py-16 text-center text-destructive">{error}</p>;
  if (templates.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No templates are available yet. Check back soon.
      </p>
    );
  }

  // While the catalog is small, pad the grid with "coming soon" tiles so it
  // reads as intentional rather than empty.
  const placeholders = Math.max(0, 6 - templates.length);

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} onSelect={() => setActive(template)} />
        ))}
        {Array.from({ length: placeholders }).map((_, i) => (
          <ComingSoonCard key={`soon-${i}`} />
        ))}
      </div>

      {active && (
        <TemplateRenderDialog
          template={active}
          open={!!active}
          onOpenChange={(o) => !o && setActive(null)}
          onRendered={onRendered}
        />
      )}
    </>
  );
}
