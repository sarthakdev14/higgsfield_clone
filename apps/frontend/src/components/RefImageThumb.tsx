import { useEffect, useMemo } from "react";
import { X } from "lucide-react";

/** A square reference-image thumbnail with a hover-to-remove button. */
export function RefImageThumb({ file, onClear }: { file: File; onClear: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10">
      <img src={url} alt="" className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onClear}
        className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
