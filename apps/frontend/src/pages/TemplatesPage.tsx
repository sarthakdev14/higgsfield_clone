import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import {
  fetchTemplateRenders,
  fetchTemplates,
  type Template,
  type TemplateRender,
} from "@/lib/api";
import { TemplateGallery } from "@/components/TemplateGallery";
import { MyTemplateRenders } from "@/components/MyTemplateRenders";
import { SignedOut } from "@/components/SignedOut";
import { cn } from "@/lib/utils";

export function TemplatesPage() {
  const { data: session, isPending } = useSession();
  const [tab, setTab] = useState<"browse" | "library">("browse");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [renders, setRenders] = useState<TemplateRender[]>([]);
  const [rendersLoading, setRendersLoading] = useState(false);
  const [rendersError, setRendersError] = useState<string | null>(null);

  const loadTemplates = useCallback(() => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    fetchTemplates()
      .then(setTemplates)
      .catch((err) => setTemplatesError(err.message))
      .finally(() => setTemplatesLoading(false));
  }, []);

  const loadRenders = useCallback(() => {
    setRendersLoading(true);
    setRendersError(null);
    fetchTemplateRenders()
      .then(setRenders)
      .catch((err) => setRendersError(err.message))
      .finally(() => setRendersLoading(false));
  }, []);

  useEffect(() => {
    if (session?.user) loadTemplates();
  }, [session?.user, loadTemplates]);

  if (isPending) return null;
  if (!session?.user) return <SignedOut />;

  const tabClass = (active: boolean) =>
    cn(
      "-mb-px border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors",
      active
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      {/* Hero */}
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-primary/15 via-card to-card p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-brand-2/10 blur-3xl" />
        <span className="relative text-xs font-bold uppercase tracking-[0.22em] text-primary">
          Templates
        </span>
        <h1 className="relative mt-2 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
          Star in a <span className="text-primary">famous video</span>.
        </h1>
        <p className="relative mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Pick a template, choose your avatar, and we render you straight into the scene — face,
          lighting and motion handled for you.
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex items-center gap-5 border-b border-white/[0.08]">
        <button className={tabClass(tab === "browse")} onClick={() => setTab("browse")}>
          Browse templates
        </button>
        <button
          className={tabClass(tab === "library")}
          onClick={() => {
            setTab("library");
            loadRenders();
          }}
        >
          My renders
        </button>
      </div>

      <div className="min-h-[55vh]">
        {tab === "browse" ? (
          <TemplateGallery
            templates={templates}
            loading={templatesLoading}
            error={templatesError}
            onRendered={(render) => {
              setRenders((prev) => [render, ...prev]);
              setTab("library");
            }}
          />
        ) : (
          <MyTemplateRenders renders={renders} loading={rendersLoading} error={rendersError} />
        )}
      </div>
    </div>
  );
}
