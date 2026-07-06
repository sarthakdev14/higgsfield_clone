import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

const STORAGE_KEY = "va_promo_dismissed";

/**
 * Full-width electric-lime promo bar pinned above the navbar (Higgsfield-style).
 * Dismissible; the choice is remembered in localStorage.
 */
export function PromoBanner() {
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1",
  );
  if (dismissed) return null;

  return (
    <div className="relative z-50 flex items-center justify-center bg-primary px-10 py-2 text-primary-foreground">
      <Link
        to="/billing"
        className="group flex items-center gap-3 text-center text-sm font-semibold tracking-wide"
      >
        <span className="hidden group-hover:underline sm:inline">
          SIGN UP AND GET ADDITIONAL DISCOUNT ON PREMIUM PLANS
        </span>
        <span className="group-hover:underline sm:hidden">EXTRA DISCOUNT ON PREMIUM PLANS</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-2 px-2.5 py-0.5 text-xs font-bold text-white">
          EXTRA DISCOUNT
        </span>
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, "1");
          setDismissed(true);
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-primary-foreground/70 transition-colors hover:bg-black/10 hover:text-primary-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
