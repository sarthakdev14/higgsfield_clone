import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Coins, LogOut, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "@/lib/auth-client";
import { useMe } from "@/lib/useMe";
import { AuthModal } from "./AuthModal";

interface NavLink {
  to: string;
  label: string;
  badge?: string;
}

const NAV_LINKS: NavLink[] = [
  { to: "/video", label: "Video" },
  { to: "/image", label: "Image" },
  { to: "/user/templates", label: "Templates", badge: "New" },
  { to: "/user/avatar", label: "Avatar" },
];

export function Navbar() {
  const { data: session, isPending } = useSession();
  const { me } = useMe();
  const [authOpen, setAuthOpen] = useState(false);
  const location = useLocation();

  const links: NavLink[] = me?.isAdmin
    ? [...NAV_LINKS, { to: "/admin/template/create", label: "Admin" }]
    : NAV_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 lg:px-6">
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
            Pixovid
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <Link
            to="/"
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              location.pathname === "/"
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Explore
          </Link>
          {links.map(({ to, label, badge }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                location.pathname === to
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="whitespace-nowrap">{label}</span>
              {badge && (
                <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
                  {badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-3">
          {isPending ? null : session?.user ? (
            <>
              <Link
                to="/billing"
                title="Credits & billing"
                className={cn(
                  "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/[0.08]",
                  location.pathname === "/billing" && "border-primary/40 text-primary",
                )}
              >
                <Coins className="h-4 w-4 text-primary" />
                <span className="tabular-nums">{me?.credits ?? 0}</span>
                <span className="hidden text-muted-foreground sm:inline">credits</span>
              </Link>
              <div className="flex items-center gap-2">
                {session.user.image ? (
                  <img
                    src={session.user.image}
                    alt={session.user.name}
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-medium">
                    {session.user.name?.charAt(0).toUpperCase() ?? "U"}
                  </div>
                )}
                <span className="hidden max-w-28 truncate text-sm sm:inline">
                  {session.user.name}
                </span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => signOut()} title="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Link
                to="/billing"
                className="relative hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.08] sm:flex"
              >
                <Tag className="h-3.5 w-3.5" />
                Pricing
                <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-2 px-1.5 py-px text-[9px] font-bold leading-none text-white">
                  30% OFF
                </span>
              </Link>
              <span className="hidden h-5 w-px bg-white/10 sm:block" />
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Login
              </button>
              <Button className="rounded-full px-5" onClick={() => setAuthOpen(true)}>
                Sign up
              </Button>
            </>
          )}
        </div>
      </div>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </header>
  );
}
