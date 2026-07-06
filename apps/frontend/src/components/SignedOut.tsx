import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthModal } from "@/components/AuthModal";

export function SignedOut() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:py-28">
      <div className="pointer-events-none absolute left-1/2 top-10 -z-10 h-64 w-64 -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" />
      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-muted-foreground shadow-sm backdrop-blur">
        <Sparkles className="h-4 w-4 text-brand" />
        Sign in to unlock the studio
      </div>
      <h1 className="text-4xl font-semibold tracking-tight text-balance text-gradient sm:text-5xl">
        Generate videos, images and template renders from one creative
        workspace.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
        Create AI videos with model controls, reference frames, reusable avatars
        and a personal generation library.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          className="rounded-full px-6"
          onClick={() => setOpen(true)}
        >
          Get started
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="rounded-full bg-background/60 px-6"
        >
          <Link to="/">View landing page</Link>
        </Button>
      </div>
      <AuthModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
