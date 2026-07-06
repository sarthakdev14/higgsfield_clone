import { useEffect, useState } from "react";
import { fetchCreditPacks } from "@/lib/api";

export interface ActionCosts {
  video: number;
  image: number;
  template_render: number;
}

// Action costs are static server config, so cache the first fetch across the app.
let cached: ActionCosts | null = null;
let inflight: Promise<ActionCosts> | null = null;

function load(): Promise<ActionCosts> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchCreditPacks()
      .then((r) => {
        cached = r.actionCosts;
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Per-generation credit costs (`null` until loaded). */
export function useActionCosts(): ActionCosts | null {
  const [costs, setCosts] = useState<ActionCosts | null>(cached);
  useEffect(() => {
    let active = true;
    load()
      .then((c) => active && setCosts(c))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return costs;
}
