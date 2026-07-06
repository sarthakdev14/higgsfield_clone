import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import type { FaceSwap } from "@/lib/api";

interface Props {
  swaps: FaceSwap[];
  loading: boolean;
  error: string | null;
}

export function MyFaceSwaps({ swaps, loading, error }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your face swaps…
      </div>
    );
  }

  if (error) {
    return <p className="py-16 text-center text-destructive">{error}</p>;
  }

  if (swaps.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        You haven&apos;t created any face swaps yet. Head to the “Create” tab to make one.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {swaps.map((swap) => (
        <Card
          key={swap.id}
          className="group overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-xl hover:shadow-black/40"
        >
          <div className="aspect-square overflow-hidden bg-black/40">
            {swap.outputUrl ? (
              <img
                src={swap.outputUrl}
                alt="Face swap result"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {swap.status === "FAILED" ? "Swap failed" : "Processing…"}
              </div>
            )}
          </div>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                <Thumb url={swap.targetUrl} label="base" />
                <Thumb url={swap.sourceUrl} label="face" />
              </div>
              <StatusBadge status={swap.status} />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {swap.error && <p className="text-xs text-destructive">{swap.error}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Thumb({ url, label }: { url: string; label: string }) {
  return (
    <img
      src={url}
      alt={label}
      title={label}
      className="h-8 w-8 rounded border object-cover"
    />
  );
}
