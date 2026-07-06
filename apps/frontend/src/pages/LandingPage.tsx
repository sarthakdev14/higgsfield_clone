import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Play, Sparkles } from "lucide-react";
import { AuthModal } from "@/components/AuthModal";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

/**
 * Higgsfield-style landing page.
 *
 * A featured carousel of cinematic AI clips sits above a dense, autoplaying
 * masonry wall. Every clip is real Pixovid output generated on OpenRouter
 * and stored in apps/frontend/public/showcase (regenerate via
 * `bun run --cwd apps/backend scripts/generate-showcase.ts`).
 */
type Aspect = "portrait" | "landscape" | "square" | "tall";
type Category = "Viral" | "Sport" | "Game";

interface ShowcaseClip {
  /** Uppercase display title shown on the card. */
  title: string;
  /** The prompt that generated the clip (shown as a caption / on hover). */
  prompt: string;
  /** Model label shown as a lime badge, e.g. "kling-v3.0". */
  model: string;
  category: Category;
  aspect: Aspect;
  /** Public video URL served from /public. */
  src: string;
}

const SHOWCASE: ShowcaseClip[] = [
  {
    title: "STORM GIANT",
    prompt:
      "Cinematic blockbuster opening — a giant emerges from storm clouds, casually deflects a fighter jet with a finger snap. Anamorphic, hyper-real.",
    model: "seedance-2.0-fast",
    category: "Viral",
    aspect: "landscape",
    src: "/showcase/storm-giant.mp4",
  },
  {
    title: "DRIFT RACING",
    prompt:
      "Tokyo night street racing — cars drift and donut around the character, low angles and 35mm film grain, blockbuster reveal.",
    model: "seedance-2.0-fast",
    category: "Viral",
    aspect: "landscape",
    src: "/showcase/drift-racing.mp4",
  },
  {
    title: "FOOTBALL INVADER",
    prompt:
      "Spectator sprints from the stands, jumps fences, evades security, charges onto the pitch and strikes — all in one continuous telephoto take.",
    model: "seedance-2.0-fast",
    category: "Sport",
    aspect: "landscape",
    src: "/showcase/football-invader.mp4",
  },
  {
    title: "NIGHT VISION",
    prompt:
      "A static night-vision monochrome green shot — person in a leather jacket walks into frame, leans into the camera, then walks away into the night.",
    model: "seedance-2.0",
    category: "Viral",
    aspect: "landscape",
    src: "/showcase/night-vision.mp4",
  },
  {
    title: "BASEBALL GAME",
    prompt:
      "A baseball game broadcast shot — person sits in stadium stands in a team jersey, posing softly like a viral stargirl moment caught on live TV.",
    model: "kling-v3.0",
    category: "Viral",
    aspect: "tall",
    src: "/showcase/baseball-game.mp4",
  },
  {
    title: "CGI BREAKDOWN",
    prompt:
      "CGI breakdown reveal — mesh to beauty pass, each render layer cuts in sequence, turntable camera, ending on the final polished visual.",
    model: "seedance-2.0",
    category: "Viral",
    aspect: "square",
    src: "/showcase/cgi-breakdown.mp4",
  },
  {
    title: "FINAL SERVE",
    prompt:
      "Mid-2000s broadcast tennis final — match point won, raw exhaustion and emotion, crowd erupting, character waves in close-up.",
    model: "seedance-2.0",
    category: "Sport",
    aspect: "portrait",
    src: "/showcase/final-serve.mp4",
  },
  {
    title: "NIGHTLINE",
    prompt:
      "A retro polygonal cyberpunk noir character select screen — character in a glossy latex suit takes a boxing guard then draws a knife in a dim sepia alley.",
    model: "kling-v3.0",
    category: "Game",
    aspect: "portrait",
    src: "/showcase/nightline.mp4",
  },
  {
    title: "APEX HUNTER",
    prompt:
      "A retro low-poly racing game cover — character rides a silver-white futuristic motorcycle down a night highway, accelerating into blue flames.",
    model: "kling-v3.0",
    category: "Game",
    aspect: "tall",
    src: "/showcase/apex-hunter.mp4",
  },
  {
    title: "DRAGON FANTASY",
    prompt:
      "A retro low-poly fantasy RPG scene — character in traditional robes commands a white serpent dragon, lands in a heroic pose with a dreamy lavender palette.",
    model: "kling-v3.0",
    category: "Game",
    aspect: "portrait",
    src: "/showcase/dragon-fantasy.mp4",
  },
  {
    title: "KUNG FU HIT",
    prompt:
      "Dojo combat CGI — a single sensei strike sends the character recoiling in slow-motion, leaving solid energy copies before a final flash counter ends it.",
    model: "seedance-2.0-fast",
    category: "Viral",
    aspect: "landscape",
    src: "/showcase/kung-fu-hit.mp4",
  },
  {
    title: "FREE FALL",
    prompt:
      "Android free-falls from a cyberpunk skyscraper, body parts snapping together mid-air — mechanical impacts, servo locks, and violent wind.",
    model: "seedance-2.0",
    category: "Viral",
    aspect: "tall",
    src: "/showcase/free-fall.mp4",
  },
  {
    title: "RED THREAD",
    prompt:
      "A dark cinematic game menu — androgynous figure with platinum hair and katana performs a sharp wuxia slash sequence amid drifting red threads.",
    model: "seedance-2.0-fast",
    category: "Game",
    aspect: "tall",
    src: "/showcase/red-thread.mp4",
  },
  {
    title: "SUMMER HAZE",
    prompt:
      "A dreamy lomo-style home movie — friend handheld-films the person across mountains, lake, and grass fields in 6 hazy pastel shots with light leaks and soft film grain.",
    model: "seedance-2.0-fast",
    category: "Viral",
    aspect: "portrait",
    src: "/showcase/summer-haze.mp4",
  },
  {
    title: "IN THE DARK",
    prompt:
      "An early-2000s polygonal survival-horror loading screen — character with a flashlight in a misty night forest, dim sodium light and fog.",
    model: "kling-v3.0",
    category: "Game",
    aspect: "landscape",
    src: "/showcase/in-the-dark.mp4",
  },
];

const FEATURED = SHOWCASE.filter((c) => c.aspect === "landscape" || c.aspect === "square");

const ASPECT_CLASS: Record<Aspect, string> = {
  portrait: "aspect-[3/4]",
  landscape: "aspect-video",
  square: "aspect-square",
  tall: "aspect-[9/16]",
};

function Clip({ src, className }: { src: string; className?: string }) {
  return (
    <video
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
    />
  );
}

/** A large featured card with a title/caption below it (Higgsfield hero row). */
function FeaturedCard({ clip }: { clip: ShowcaseClip }) {
  return (
    <div className="group w-[300px] shrink-0 snap-start sm:w-[440px] lg:w-[520px]">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-card">
        <Clip
          src={clip.src}
          className="aspect-video h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <span className="absolute bottom-3 right-3 rounded-md bg-primary px-2 py-0.5 text-xs font-extrabold tracking-tight text-primary-foreground">
          4K
        </span>
        <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
          {clip.model}
        </span>
      </div>
      <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-foreground">
        {clip.title}
      </h3>
      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{clip.prompt}</p>
    </div>
  );
}

function MasonryTile({ clip }: { clip: ShowcaseClip }) {
  return (
    <div className="group relative mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-white/[0.08] bg-card shadow-lg shadow-black/30">
      <div className={`relative w-full ${ASPECT_CLASS[clip.aspect]}`}>
        <Clip
          src={clip.src}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
          {clip.model}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">
          {clip.category}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-4">
          <h4 className="text-sm font-bold uppercase tracking-wide text-white drop-shadow">
            {clip.title}
          </h4>
          <p className="mt-1 line-clamp-2 max-h-0 overflow-hidden text-sm leading-5 text-white/85 opacity-0 transition-all duration-300 group-hover:max-h-20 group-hover:opacity-100">
            {clip.prompt}
          </p>
        </div>
      </div>
    </div>
  );
}

interface Banner {
  title: string;
  kicker: string;
  subtitle: string;
  src: string;
}

/** Big featured template banners (Higgsfield "SEEDANCE 2.0" hero style). */
const TEMPLATE_BANNERS: Banner[] = [
  {
    title: "DIDI",
    kicker: "DHURANDHAR · TEMPLATE",
    subtitle: "Put yourself in the scene",
    src: "/showcase/templates/dhurandhar.mp4",
  },
  {
    title: "BOYFRIEND",
    kicker: "KARAN AUJLA · TEMPLATE",
    subtitle: "Star in the music video",
    src: "/showcase/templates/boyfriend.mp4",
  },
];

function TemplateBanner({ banner, cta }: { banner: Banner; cta: React.ReactNode }) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40">
      <video
        className="aspect-[16/11] w-full object-cover transition-transform duration-700 group-hover:scale-105 sm:aspect-[16/6]"
        src={banner.src}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      {/* Localized scrim only in the bottom-left corner — keeps most of the video bright. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/80 via-black/15 to-transparent" />

      <span className="absolute right-4 top-4 -skew-x-6 rounded bg-primary px-2.5 py-0.5 text-base font-extrabold tracking-tight text-primary-foreground sm:right-6 sm:top-6 sm:text-xl">
        4K
      </span>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex max-w-2xl flex-col items-start p-5 text-left sm:p-8">
        <span className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur sm:text-xs">
          {banner.kicker}
        </span>
        <h3 className="mt-2 text-3xl font-extrabold uppercase tracking-tight text-primary drop-shadow-[0_2px_18px_rgba(0,0,0,0.8)] sm:text-5xl">
          {banner.title}
        </h3>
        <p className="mt-1 text-sm font-bold uppercase tracking-wide text-white/90 drop-shadow sm:text-base">
          {banner.subtitle}
        </p>
        <div className="pointer-events-auto mt-4">{cta}</div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { data: session } = useSession();
  const [authOpen, setAuthOpen] = useState(false);
  const signedIn = Boolean(session?.user);

  const tryTemplate = signedIn ? (
    <Button asChild size="lg" className="rounded-full px-8">
      <Link to="/user/templates">Try template</Link>
    </Button>
  ) : (
    <Button size="lg" className="rounded-full px-8" onClick={() => setAuthOpen(true)}>
      Try template
    </Button>
  );

  const startCreating = signedIn ? (
    <Button asChild size="lg" className="rounded-full px-6">
      <Link to="/video">
        Start creating
        <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  ) : (
    <Button size="lg" className="rounded-full px-6" onClick={() => setAuthOpen(true)}>
      Start creating
      <ArrowRight className="h-4 w-4" />
    </Button>
  );

  return (
    <div className="overflow-hidden">
      {/* Compact hero */}
      <section className="mx-auto max-w-[1600px] px-4 pt-12 pb-8 lg:px-6">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          Real clips, real prompts — generated in Pixovid
        </div>
        <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          The arena where <span className="text-primary">AI video</span> comes to life.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
          Browse a living wall of cinematic clips, then jump in and generate your own with
          model controls, references and audio — all in one focused workspace.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          {startCreating}
          <Button asChild variant="outline" size="lg" className="rounded-full px-6">
            <Link to={signedIn ? "/user/templates" : "/video"}>
              Explore the studio
              <Play className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Dhurandhar template banner */}
      <section className="mx-auto max-w-[1600px] px-4 pb-12 lg:px-6">
        <h2 className="mb-4 text-lg font-semibold">Featured template</h2>
        <TemplateBanner banner={TEMPLATE_BANNERS[0]!} cta={tryTemplate} />
      </section>

      {/* Featured carousel */}
      <section className="mx-auto max-w-[1600px] px-4 pb-12 lg:px-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Featured</h2>
          <span className="text-sm text-muted-foreground">Made with Seedance 2.0 &amp; Kling 3.0</span>
        </div>
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
          {FEATURED.map((clip) => (
            <FeaturedCard key={clip.title} clip={clip} />
          ))}
        </div>
      </section>

      {/* Masonry wall */}
      <section className="mx-auto max-w-[1600px] px-4 pb-12 lg:px-6">
        <h2 className="mb-4 text-lg font-semibold">Explore the wall</h2>
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
          {SHOWCASE.map((clip) => (
            <MasonryTile key={clip.title} clip={clip} />
          ))}
        </div>
      </section>

      {/* Karan Aujla template banner */}
      <section className="mx-auto max-w-[1600px] px-4 pb-12 lg:px-6">
        <TemplateBanner banner={TEMPLATE_BANNERS[1]!} cta={tryTemplate} />
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-[1600px] px-4 pb-24 lg:px-6">
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-white/[0.08] bg-card p-10 text-center">
          <h2 className="text-2xl font-semibold sm:text-3xl">Your next clip is one prompt away.</h2>
          <p className="max-w-xl text-muted-foreground">
            Pick a model, describe the shot, and render production-ready video, images and
            template renders in minutes.
          </p>
          {startCreating}
        </div>
      </section>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}
