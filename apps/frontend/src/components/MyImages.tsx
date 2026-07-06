import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import type { Image } from "@/lib/api";

interface Props {
  images: Image[];
  loading: boolean;
  error: string | null;
}

export function MyImages({ images, loading, error }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your images…
      </div>
    );
  }

  if (error) {
    return <p className="py-16 text-center text-destructive">{error}</p>;
  }

  if (images.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        You haven&apos;t generated any images yet. Head to the “Text to Image” tab to create one.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((image) => (
        <Card
          key={image.id}
          className="group overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-xl hover:shadow-black/40"
        >
          <div className="aspect-square overflow-hidden bg-black/40">
            {image.imageUrl ? (
              <img
                src={image.imageUrl}
                alt={image.prompt}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {image.status === "FAILED" ? "Generation failed" : "Processing…"}
              </div>
            )}
          </div>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="line-clamp-1 text-sm">{image.model}</CardTitle>
              <StatusBadge status={image.status} />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="line-clamp-2 text-sm text-muted-foreground">{image.prompt}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {image.resolution && <span>{image.resolution}</span>}
              {image.aspectRatio && <span>· {image.aspectRatio}</span>}
            </div>
            {image.error && <p className="mt-2 text-xs text-destructive">{image.error}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
