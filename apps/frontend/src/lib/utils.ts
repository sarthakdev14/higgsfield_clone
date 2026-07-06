import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Turn a raw provider error (often deeply nested/escaped JSON) into a short,
 * human-readable sentence. Falls back to a generic message.
 */
export function friendlyError(raw?: string | null): string {
  if (!raw) return "Something went wrong during generation.";
  // Unescape common JSON escaping so nested messages become readable.
  const unescaped = raw.replace(/\\n/g, " ").replace(/\\"/g, '"');
  const messages = [...unescaped.matchAll(/"message"\s*:\s*"([^"]+)"/g)].map((m) =>
    m[1]!.replace(/^HTTP\s+\d+:\s*/i, "").trim(),
  );
  // Prefer the most specific (innermost) message; skip empty/HTTP-status echoes.
  const meaningful = messages.reverse().find((m) => m && !/^\{?$/.test(m));
  const msg = (meaningful ?? messages[0] ?? raw).replace(/^HTTP\s+\d+:\s*/i, "").trim();
  return msg || "Something went wrong during generation.";
}
