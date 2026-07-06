import { useEffect, useMemo, useRef } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  file: File | null;
  label: string;
  onPick: (f: File) => void;
  onClear: () => void;
  /** Tailwind aspect class for the slot (defaults to portrait 3/4). */
  aspectClass?: string;
}

/** A single labeled image picker: shows a preview + remove, or a dashed add box. */
export function ImageSlot({ file, label, onPick, onClear, aspectClass = "aspect-[3/4]" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]", aspectClass)}>
      {url ? (
        <>
          <img src={url} alt={label} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={onClear}
            className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-3 text-[10px] font-medium text-white">
            {label}
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground transition-colors hover:text-primary"
        >
          <Plus className="h-5 w-5" />
          <span className="px-2 text-center text-[11px] font-medium">{label}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
