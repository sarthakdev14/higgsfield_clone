import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Download,
  Film,
  Loader2,
  RotateCw,
  ScanFace,
  X,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import {
  fetchRender,
  retryRender,
  type RenderBlockPhase,
  type RenderBlockProgress,
  type TemplateRender,
} from "@/lib/api";
import { SignedOut } from "@/components/SignedOut";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_MS = 2500;

/** Phases that count as "this block is finished with generation". */
const DONE_PHASES: RenderBlockPhase[] = ["COMPLETED", "REUSED", "FELL_BACK"];
const ACTIVE_PHASES: RenderBlockPhase[] = ["FACE_SWAP", "VIDEO_GENERATION", "RETRYING"];

interface PhaseConfig {
  label: string;
  icon: typeof Clock;
  /** Tailwind classes for the badge. */
  badge: string;
  /** Border accent for the block tile. */
  accent: string;
  spin?: boolean;
}

const PHASES: Record<RenderBlockPhase, PhaseConfig> = {
  QUEUED: { label: "Queued", icon: Clock, badge: "bg-white/10 text-muted-foreground", accent: "border-white/10" },
  FACE_SWAP: { label: "Face swap", icon: ScanFace, badge: "bg-violet-500/15 text-violet-300", accent: "border-violet-500/40" },
  VIDEO_GENERATION: { label: "Generating", icon: Film, badge: "bg-blue-500/15 text-blue-300", accent: "border-blue-500/40", spin: false },
  RETRYING: { label: "Retrying", icon: RotateCw, badge: "bg-amber-500/15 text-amber-300", accent: "border-amber-500/40", spin: true },
  STITCHING: { label: "Stitching", icon: Loader2, badge: "bg-indigo-500/15 text-indigo-300", accent: "border-indigo-500/40", spin: true },
  COMPLETED: { label: "Generated", icon: Check, badge: "bg-green-500/15 text-green-400", accent: "border-green-500/40" },
  REUSED: { label: "Ready", icon: Check, badge: "bg-teal-500/15 text-teal-300", accent: "border-teal-500/30" },
  FELL_BACK: { label: "Used original", icon: AlertTriangle, badge: "bg-amber-500/15 text-amber-300", accent: "border-amber-500/40" },
  FAILED: { label: "Failed", icon: X, badge: "bg-destructive/15 text-destructive", accent: "border-destructive/50" },
};

function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function BlockTile({ block, index }: { block: RenderBlockProgress; index: number }) {
  const cfg = PHASES[block.phase] ?? PHASES.QUEUED;
  const Icon = cfg.icon;
  const active = ACTIVE_PHASES.includes(block.phase);
  return (
    <div
      className={cn(
        "flex w-44 shrink-0 flex-col gap-2 rounded-xl border bg-card/60 p-3 transition-colors",
        cfg.accent,
        active && "ring-1 ring-inset ring-white/10",
      )}
    >
      <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
        <span className="font-medium text-foreground/80">Clip {index + 1}</span>
        <span className="tabular-nums">
          {formatTime(block.startSec)}–{formatTime(block.endSec)}
        </span>
      </div>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
          cfg.badge,
        )}
      >
        <Icon className={cn("h-3 w-3", (cfg.spin || (active && block.phase === "VIDEO_GENERATION")) && "animate-spin")} />
        {cfg.label}
        {block.phase === "RETRYING" && block.attempt > 1 ? ` (#${block.attempt})` : ""}
      </div>
    </div>
  );
}

export function GenerationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isPending } = useSession();
  const [render, setRender] = useState<TemplateRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetchRender(id);
      setRender(r);
      setError(null);
      if (r.status === "IN_PROGRESS" || r.status === "PENDING") {
        timer.current = setTimeout(poll, POLL_MS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load render");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!session?.user) return;
    // Reset when navigating between renders (e.g. after a retry → new :id).
    setRender(null);
    setError(null);
    setRetryError(null);
    setRetrying(false);
    setLoading(true);
    poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [session?.user, poll]);

  // Retry this render in place: completed blocks are kept (their clips reused) and
  // only the failed/incomplete ones re-run. Resumes polling on the same render.
  const handleRetry = useCallback(async () => {
    if (!render) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const updated = await retryRender(render.id);
      setRender(updated);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(poll, POLL_MS);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Couldn't restart this render");
    } finally {
      setRetrying(false);
    }
  }, [render, poll]);

  if (isPending) return null;
  if (!session?.user) return <SignedOut />;

  const blocks = render?.blocks ?? [];
  const total = blocks.length;
  const done = blocks.filter((b) => DONE_PHASES.includes(b.phase)).length;
  const inProgress = render?.status === "IN_PROGRESS" || render?.status === "PENDING";
  // All blocks finished generating but the render is still running → stitching.
  const stitching = inProgress && total > 0 && done === total;
  const completed = render?.status === "COMPLETED";
  const failed = render?.status === "FAILED";

  const name = render?.templateName;
  const headerTitle = completed
    ? name
      ? `Generated “${name}”`
      : "Your video is ready"
    : failed
      ? name
        ? `Couldn’t generate “${name}”`
        : "Generation failed"
      : name
        ? `Generating “${name}”`
        : "Generating your video";
  const headerDescription = completed
    ? "Your video is ready to watch and download below."
    : failed
      ? "Something went wrong. You can try again with the same avatars."
      : "Each clip is generated individually — face-swapping your avatar, then rendering the video — before they're stitched into your final video.";

  // Once the render is done, just show the final video — nothing else.
  if (completed && render?.videoUrl) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <video
          src={render.videoUrl}
          controls
          autoPlay
          poster={render.thumbnailUrl ?? undefined}
          className="w-full rounded-2xl border border-white/[0.08] bg-black"
        />
        <div className="mt-4 flex justify-center">
          <Button asChild size="lg" className="rounded-full px-6">
            <a href={render.videoUrl} download={`${render.templateName ?? "video"}.mp4`}>
              <Download className="h-4 w-4" /> Download
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:py-10">
      <PageHeader
        eyebrow="Generation"
        title={headerTitle}
        description={headerDescription}
      >
        {render && <StatusBadge status={render.status} />}
      </PageHeader>

      <Link
        to="/user/templates"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to templates
      </Link>

      {loading && !render ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : error && !render ? (
        <p className="py-20 text-center text-destructive">{error}</p>
      ) : !render ? (
        <p className="py-20 text-center text-muted-foreground">Render not found.</p>
      ) : (
        <div className="space-y-8">
          {/* Overall progress — only while generating or after a failure. */}
          {!completed && (
            <div className="rounded-2xl border border-white/[0.08] bg-card/50 p-5">
              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">
                  {failed
                    ? "Generation failed"
                    : stitching
                      ? "Stitching final video…"
                      : `Generating clips — ${done} of ${total} ready`}
                </span>
                {inProgress && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> live
                  </span>
                )}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    failed ? "bg-destructive" : "bg-brand",
                  )}
                  style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }}
                />
              </div>
              {render.error && <p className="mt-3 text-sm text-destructive">{render.error}</p>}
              {failed && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button onClick={handleRetry} disabled={retrying}>
                    {retrying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Restarting…
                      </>
                    ) : (
                      <>
                        <RotateCw className="h-4 w-4" /> Try again
                      </>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Starts a fresh render with the same avatars.
                  </span>
                  {retryError && <span className="text-sm text-destructive">{retryError}</span>}
                </div>
              )}
            </div>
          )}

          {/* Per-block stages, laid out left → right in timeline order */}
          {total > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Clips</h2>
              <div className="flex items-stretch gap-2 overflow-x-auto pb-3">
                {blocks.map((b, i) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <BlockTile block={b} index={i} />
                    {i < blocks.length - 1 && (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
