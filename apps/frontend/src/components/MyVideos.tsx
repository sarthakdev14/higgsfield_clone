import { useState } from "react";
import { AlertTriangle, Download, Loader2, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { friendlyError } from "@/lib/utils";
import type { Video } from "@/lib/api";

interface Props {
  videos: Video[];
  loading: boolean;
  error: string | null;
}

function MetaRow({ video }: { video: Video }) {
  const bits = [
    video.resolution,
    video.aspectRatio,
    video.duration ? `${video.duration}s` : null,
    video.generateAudio != null ? (video.generateAudio ? "audio" : "muted") : null,
  ].filter(Boolean) as string[];
  if (bits.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {bits.map((b, i) => (
        <span key={i}>
          {i > 0 && <span className="mr-2 text-white/20">·</span>}
          {b}
        </span>
      ))}
    </div>
  );
}

function VideoCard({ video, onOpen }: { video: Video; onOpen: () => void }) {
  const failed = video.status === "FAILED";
  const done = video.status === "COMPLETED" && video.videoUrl;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-card text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-black/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative aspect-video overflow-hidden bg-black/40">
        {done ? (
          <>
            <video
              src={video.videoUrl!}
              muted
              loop
              playsInline
              preload="metadata"
              onMouseEnter={(e) => void e.currentTarget.play()}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 backdrop-blur">
                <Play className="h-5 w-5 fill-white text-white" />
              </span>
            </span>
          </>
        ) : failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center text-destructive">
            <AlertTriangle className="h-6 w-6" />
            <span className="text-xs font-medium">Generation failed</span>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Processing…</span>
          </div>
        )}
        <span className="absolute left-2 top-2">
          <StatusBadge status={video.status} />
        </span>
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        <div className="truncate text-sm font-semibold">{video.model}</div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{video.prompt}</p>
        {failed ? (
          <p className="line-clamp-2 text-xs text-destructive/90">{friendlyError(video.error)}</p>
        ) : (
          <MetaRow video={video} />
        )}
      </div>
    </button>
  );
}

function VideoModal({ video, onClose }: { video: Video | null; onClose: () => void }) {
  const open = !!video;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{video?.model ?? "Video"}</DialogTitle>
        </DialogHeader>
        {video && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="aspect-video w-full shrink-0 bg-black">
              {video.status === "COMPLETED" && video.videoUrl ? (
                <video src={video.videoUrl} controls autoPlay className="h-full w-full" />
              ) : video.status === "FAILED" ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-destructive" />
                  <p className="max-w-md text-sm font-medium text-destructive">
                    {friendlyError(video.error)}
                  </p>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" /> Processing…
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold">{video.model}</div>
                  <MetaRow video={video} />
                </div>
                <StatusBadge status={video.status} />
              </div>

              <p className="text-sm text-muted-foreground">{video.prompt}</p>

              {video.status === "FAILED" && video.error && (
                <details className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none font-medium text-foreground">
                    Technical details
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted-foreground">
                    {video.error}
                  </pre>
                </details>
              )}

              {video.status === "COMPLETED" && video.videoUrl && (
                <Button asChild className="w-fit rounded-xl">
                  <a href={video.videoUrl} download={`video-${video.id}.mp4`}>
                    <Download className="h-4 w-4" /> Download
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MyVideos({ videos, loading, error }: Props) {
  const [active, setActive] = useState<Video | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your videos…
      </div>
    );
  }

  if (error) {
    return <p className="py-16 text-center text-destructive">{error}</p>;
  }

  if (videos.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        You haven&apos;t generated any videos yet. Use the panel on the left to create one.
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} onOpen={() => setActive(video)} />
        ))}
      </div>
      <VideoModal video={active} onClose={() => setActive(null)} />
    </>
  );
}
