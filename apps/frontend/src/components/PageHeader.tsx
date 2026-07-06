import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: PageHeaderProps) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-card/60 p-6 shadow-xl shadow-black/30 backdrop-blur-xl sm:p-8">
      <div className="absolute -right-16 -top-24 h-56 w-56 rounded-full bg-brand/20 blur-3xl" />
      <div className="absolute -bottom-24 left-12 h-56 w-56 rounded-full bg-brand-2/10 blur-3xl" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="mb-3 inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand">
            {eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-gradient sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
        </div>
        {children}
      </div>
    </section>
  );
}
