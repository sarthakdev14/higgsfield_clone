import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  label: string;
  hint: string;
  file: File | null;
  onChange: (f: File | null) => void;
  /** Accepted file types (defaults to images). */
  accept?: string;
}

/** Single-file picker with a label and a hint/filename line. Reused across forms. */
export function FileField({ label, hint, file, onChange, accept = "image/*" }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input type="file" accept={accept} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <p className="text-xs text-muted-foreground">{file ? file.name : hint}</p>
    </div>
  );
}
