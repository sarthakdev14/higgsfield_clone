import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AuthForm } from "./AuthForm";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Sign up</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2">
          {/* Auth column */}
          <div className="p-7 sm:p-8">
            <AuthForm onSuccess={() => onOpenChange(false)} />
          </div>

          {/* Showcase column */}
          <div className="relative hidden md:block">
            <video
              className="h-full w-full object-cover"
              src="/showcase/apex-hunter.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6">
              <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-extrabold text-primary-foreground">
                4K Resolution
              </span>
              <h3 className="mt-3 text-2xl font-extrabold uppercase tracking-tight text-white">
                Kling 3.0 &amp; Seedance 2.0
              </h3>
              <p className="mt-1 text-sm text-white/80">
                The best video models, for the best price — only on Pixovid.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
