import { cn } from "@/lib/utils";
import type { GenerationStatus } from "@/lib/api";

const statusStyles: Record<GenerationStatus, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-500",
  IN_PROGRESS: "bg-blue-500/15 text-blue-400",
  COMPLETED: "bg-green-500/15 text-green-500",
  FAILED: "bg-destructive/15 text-destructive",
};

/** Coloured pill showing a generation's lifecycle status. Shared across galleries. */
export function StatusBadge({ status }: { status: GenerationStatus }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[status])}>
      {status.toLowerCase()}
    </span>
  );
}
