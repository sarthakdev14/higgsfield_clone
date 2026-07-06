import { useCallback, useEffect, useState } from "react";
import { BookOpen, FolderClock, ImagePlus, LayoutGrid, Sparkles } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { fetchVideos, type Video } from "@/lib/api";
import { TextToVideoForm } from "@/components/TextToVideoForm";
import { MyVideos } from "@/components/MyVideos";
import { SignedOut } from "@/components/SignedOut";
import { cn } from "@/lib/utils";

type View = "intro" | "library";

function Step({
  icon,
  badge,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  badge: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <span className="absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {badge}
        </span>
        {children}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h3 className="text-sm font-bold uppercase tracking-wide">{title}</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function IntroPanel() {
  return (
    <div className="p-6 sm:p-10">
      <h2 className="text-3xl font-extrabold uppercase tracking-tight sm:text-4xl">
        Make videos in one click
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Choose a model, describe the shot and add an optional reference image — or just
        write a prompt for pure text-to-video.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Step
          badge="1"
          icon={<ImagePlus className="h-4 w-4" />}
          title="Add a prompt"
          description="Describe the shot, or drop a reference image to animate."
        >
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImagePlus className="h-7 w-7" />
            <span className="text-sm font-semibold uppercase tracking-wide">Upload image</span>
            <span className="text-xs">optional</span>
          </div>
        </Step>
        <Step
          badge="2"
          icon={<LayoutGrid className="h-4 w-4" />}
          title="Pick a model"
          description="Tune duration, aspect ratio and resolution to taste."
        >
          <div className="grid grid-cols-2 gap-2 p-4">
            {["seedance-2.0", "kling-v3.0", "seedance-2.0-fast", "more…"].map((m) => (
              <span
                key={m}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-3 text-center text-xs font-medium text-muted-foreground"
              >
                {m}
              </span>
            ))}
          </div>
        </Step>
        <Step
          badge="3"
          icon={<Sparkles className="h-4 w-4" />}
          title="Get video"
          description="Hit Generate to render your final clip — it lands in History."
        >
          <video
            className="h-full w-full rounded-xl border-2 border-white/80 object-cover"
            src="/showcase/drift-racing.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
        </Step>
      </div>
    </div>
  );
}

export function VideoPage() {
  const { data: session, isPending } = useSession();
  const [view, setView] = useState<View>("intro");
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVideos = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchVideos()
      .then(setVideos)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (session?.user) loadVideos();
  }, [session?.user, loadVideos]);

  if (isPending) return null;
  if (!session?.user) return <SignedOut />;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      {/* Tab bar */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            className={cn(
              "border-b-2 px-1 pb-2 text-sm font-semibold transition-colors",
              "border-primary text-foreground",
            )}
          >
            Create Video
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setView("library");
              loadVideos();
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-sm font-medium transition-colors",
              view === "library" ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:bg-white/[0.06]",
            )}
          >
            <FolderClock className="h-4 w-4" />
            History
          </button>
          <button
            onClick={() => setView("intro")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-sm font-medium transition-colors",
              view === "intro" ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:bg-white/[0.06]",
            )}
          >
            <BookOpen className="h-4 w-4" />
            How it works
          </button>
        </div>
      </div>

      {/* Two-column workspace */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Control rail */}
        <aside className="w-full shrink-0 lg:w-[340px]">
          <div className="lg:sticky lg:top-20">
            <TextToVideoForm
              onCreated={(video) => {
                setVideos((prev) => [video, ...prev]);
                setView("library");
              }}
            />
          </div>
        </aside>

        {/* Main panel */}
        <main className="min-h-[60vh] flex-1 overflow-hidden rounded-2xl border border-white/[0.08] bg-card/40">
          {view === "library" ? (
            <div className="p-6">
              <MyVideos videos={videos} loading={loading} error={error} />
            </div>
          ) : (
            <IntroPanel />
          )}
        </main>
      </div>
    </div>
  );
}
