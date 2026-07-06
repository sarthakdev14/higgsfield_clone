import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import type { TemplateRender } from "@/lib/api";

interface Props {
  renders: TemplateRender[];
  loading: boolean;
  error: string | null;
}

export function MyTemplateRenders({ renders, loading, error }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your videos…
      </div>
    );
  }
  if (error) return <p className="py-16 text-center text-destructive">{error}</p>;
  if (renders.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        You haven&apos;t generated any template videos yet.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {renders.map((render) => (
        <Card
          key={render.id}
          className="group overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-xl hover:shadow-black/40"
        >
          <Link to={`/generation/${render.id}`} className="block aspect-video bg-black/40">
            {render.thumbnailUrl ? (
              <img src={render.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : render.videoUrl ? (
              <video src={render.videoUrl} muted className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {render.status === "FAILED" ? "Generation failed" : "Processing…"}
              </div>
            )}
          </Link>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="line-clamp-1 text-sm">
                <Link to={`/generation/${render.id}`} className="hover:underline">
                  {render.templateName ?? "Template video"}
                </Link>
              </CardTitle>
              <StatusBadge status={render.status} />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {render.error && <p className="text-xs text-destructive">{render.error}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
