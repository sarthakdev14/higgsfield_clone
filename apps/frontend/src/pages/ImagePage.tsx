import { useCallback, useEffect, useState } from "react";
import { BookOpen, FolderClock, ImageIcon, LayoutGrid, Wand2 } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { fetchImages, type Image } from "@/lib/api";
import { TextToImageForm } from "@/components/TextToImageForm";
import { MyImages } from "@/components/MyImages";
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
        Generate images in one click
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Pick an image model, describe the visual and add optional reference images to keep
        your direction consistent.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Step
          badge="1"
          icon={<Wand2 className="h-4 w-4" />}
          title="Write a prompt"
          description="Describe the still, or drop reference images for style/identity."
        >
          <img src="/showcase/stills/img-1.jpg" alt="" className="h-full w-full object-cover" />
        </Step>
        <Step
          badge="2"
          icon={<LayoutGrid className="h-4 w-4" />}
          title="Pick a model"
          description="Choose aspect ratio and resolution to taste."
        >
          <div className="grid grid-cols-2 gap-2 p-4">
            {["nano-banana", "flux.2", "seedream", "more…"].map((m) => (
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
          icon={<ImageIcon className="h-4 w-4" />}
          title="Get image"
          description="Hit Generate to render — it lands in History."
        >
          <div className="grid h-full w-full grid-cols-2 gap-1 p-1">
            <img src="/showcase/stills/img-2.jpg" alt="" className="h-full w-full rounded-lg object-cover" />
            <img src="/showcase/stills/img-3.jpg" alt="" className="h-full w-full rounded-lg object-cover" />
            <img src="/showcase/stills/img-4.jpg" alt="" className="h-full w-full rounded-lg object-cover" />
            <img src="/showcase/stills/img-1.jpg" alt="" className="h-full w-full rounded-lg object-cover" />
          </div>
        </Step>
      </div>
    </div>
  );
}

export function ImagePage() {
  const { data: session, isPending } = useSession();
  const [view, setView] = useState<View>("intro");
  const [images, setImages] = useState<Image[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadImages = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchImages()
      .then(setImages)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (session?.user) loadImages();
  }, [session?.user, loadImages]);

  if (isPending) return null;
  if (!session?.user) return <SignedOut />;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      {/* Tab bar */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button className="border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground">
            Create Image
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setView("library");
              loadImages();
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
        <aside className="w-full shrink-0 lg:w-[340px]">
          <div className="lg:sticky lg:top-20">
            <TextToImageForm
              onCreated={(image) => {
                setImages((prev) => [image, ...prev]);
                setView("library");
              }}
            />
          </div>
        </aside>

        <main className="min-h-[60vh] flex-1 overflow-hidden rounded-2xl border border-white/[0.08] bg-card/40">
          {view === "library" ? (
            <div className="p-6">
              <MyImages images={images} loading={loading} error={error} />
            </div>
          ) : (
            <IntroPanel />
          )}
        </main>
      </div>
    </div>
  );
}
