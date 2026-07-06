/**
 * Generate landing-page showcase clips on OpenRouter and write them to the
 * frontend's public assets (apps/frontend/public/showcase).
 *
 *   bun run --cwd apps/backend scripts/generate-showcase.ts
 *
 * Each clip is generated at 4s. Source presets come from landing_videos.json;
 * Higgsfield model names are mapped to their OpenRouter equivalents:
 *   kling3_0          -> kwaivgi/kling-v3.0-std
 *   seedance_2_0      -> bytedance/seedance-2.0
 *   seedance_2_0_fast -> bytedance/seedance-2.0-fast
 *
 * Spends real money (~$0.34-$0.61 per clip). Writes manifest.json alongside the
 * MP4s with the metadata needed to populate LandingPage's SHOWCASE array.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (load it from apps/backend/.env).");
  process.exit(1);
}

const OUT_DIR = path.resolve(process.cwd(), "../frontend/public/showcase");
const DURATION = 4;
const RESOLUTION = "720p";
const CONCURRENCY = 4;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 10 * 60 * 1000;

type Aspect = "portrait" | "landscape" | "square" | "tall";
type Category = "Viral" | "Sport" | "Game";

interface Clip {
  slug: string;
  name: string;
  prompt: string;
  /** OpenRouter model id. */
  model: string;
  /** Short label shown as the grid badge. */
  modelLabel: string;
  aspectRatio: string;
  aspect: Aspect;
  /** Wall category (carried into the manifest for LandingPage's SHOWCASE array). */
  category?: Category;
}

/**
 * The showcase set. The first 10 are already generated (their MP4s live in
 * public/showcase); the script SKIPS any clip whose MP4 already exists and only
 * generates the rest, then MERGES the results into the existing manifest.json —
 * so re-running never re-spends on clips already on the wall.
 */
const CLIPS: Clip[] = [
  {
    slug: "baseball-game",
    name: "BASEBALL GAME",
    prompt:
      "A baseball game broadcast shot — person sits in stadium stands in a team jersey, watching the field and posing softly like a viral stargirl moment caught on live TV.",
    model: "kwaivgi/kling-v3.0-std",
    modelLabel: "kling-v3.0",
    aspectRatio: "9:16",
    aspect: "tall",
  },
  {
    slug: "drift-racing",
    name: "DRIFT RACING",
    prompt:
      "Tokyo night street racing — cars drift and donut around the character, low angles and 35mm film grain, blockbuster reveal.",
    model: "bytedance/seedance-2.0-fast",
    modelLabel: "seedance-2.0-fast",
    aspectRatio: "16:9",
    aspect: "landscape",
  },
  {
    slug: "cgi-breakdown",
    name: "CGI BREAKDOWN",
    prompt:
      "CGI breakdown reveal — mesh to beauty pass, each render layer cuts in sequence, turntable camera, ending on the final polished visual",
    model: "bytedance/seedance-2.0",
    modelLabel: "seedance-2.0",
    aspectRatio: "16:9",
    aspect: "square",
  },
  {
    slug: "football-invader",
    name: "FOOTBALL INVADER",
    prompt:
      "Spectator sprints from the stands, jumps fences, evades security, charges onto the pitch and strikes — all in one continuous telephoto take.",
    model: "bytedance/seedance-2.0-fast",
    modelLabel: "seedance-2.0-fast",
    aspectRatio: "16:9",
    aspect: "landscape",
  },
  {
    slug: "final-serve",
    name: "FINAL SERVE",
    prompt:
      "Mid-2000s broadcast tennis final — match point won, raw exhaustion and emotion, crowd erupting, character waves in close-up.",
    model: "bytedance/seedance-2.0",
    modelLabel: "seedance-2.0",
    aspectRatio: "9:16",
    aspect: "portrait",
  },
  {
    slug: "storm-giant",
    name: "STORM GIANT",
    prompt:
      "Cinematic blockbuster opening — a giant emerges from storm clouds, casually deflects a fighter jet with a finger snap. Anamorphic, hyper-real.",
    model: "bytedance/seedance-2.0-fast",
    modelLabel: "seedance-2.0-fast",
    aspectRatio: "16:9",
    aspect: "landscape",
  },
  {
    slug: "nightline",
    name: "NIGHTLINE",
    prompt:
      "A retro polygonal cyberpunk noir character select screen - character in a glossy latex suit takes a boxing guard then draws a knife in a dim sepia-toned alley",
    model: "kwaivgi/kling-v3.0-std",
    modelLabel: "kling-v3.0",
    aspectRatio: "9:16",
    aspect: "portrait",
  },
  {
    slug: "apex-hunter",
    name: "APEX HUNTER",
    prompt:
      "A retro low-poly racing game cover — character rides a silver-white futuristic motorcycle down a night highway, accelerating into blue flames with chrome title and side menu UI",
    model: "kwaivgi/kling-v3.0-std",
    modelLabel: "kling-v3.0",
    aspectRatio: "9:16",
    aspect: "tall",
  },
  {
    slug: "dragon-fantasy",
    name: "DRAGON FANTASY",
    prompt:
      "A retro low-poly fantasy RPG scene - character in traditional robes commands a white serpent dragon, lands in a heroic pose with minimal HUD and dreamy lavender palette",
    model: "kwaivgi/kling-v3.0-std",
    modelLabel: "kling-v3.0",
    aspectRatio: "9:16",
    aspect: "portrait",
  },
  {
    slug: "night-vision",
    name: "NIGHT VISION",
    prompt:
      "A static night-vision monochrome green shot — person in a leather jacket walks into frame on a dark street, leans into the camera to check it, then walks away into the night",
    model: "bytedance/seedance-2.0",
    modelLabel: "seedance-2.0",
    aspectRatio: "16:9",
    aspect: "landscape",
  },

  // ---- New additions (generated in a later pass; ~$2.69 total) ----
  {
    slug: "summer-haze",
    name: "SUMMER HAZE",
    prompt:
      "A dreamy lomo-style home movie — friend handheld-films the person across mountains, lake, and grass fields in 6 hazy pastel shots with light leaks and soft film grain.",
    model: "bytedance/seedance-2.0-fast",
    modelLabel: "seedance-2.0-fast",
    aspectRatio: "9:16",
    aspect: "portrait",
    category: "Viral",
  },
  {
    slug: "kung-fu-hit",
    name: "KUNG FU HIT",
    prompt:
      "Dojo combat CGI — a single sensei strike sends the character recoiling in slow-motion, leaving solid energy copies before a final flash counter ends it.",
    model: "bytedance/seedance-2.0-fast",
    modelLabel: "seedance-2.0-fast",
    aspectRatio: "16:9",
    aspect: "landscape",
    category: "Viral",
  },
  {
    slug: "red-thread",
    name: "RED THREAD",
    prompt:
      "A dark cinematic game menu — androgynous figure with platinum hair and katana performs a sharp wuxia slash sequence amid drifting red threads.",
    model: "bytedance/seedance-2.0-fast",
    modelLabel: "seedance-2.0-fast",
    aspectRatio: "9:16",
    aspect: "tall",
    category: "Game",
  },
  {
    slug: "free-fall",
    name: "FREE FALL",
    prompt:
      "Android free-falls from a cyberpunk skyscraper, body parts snapping together mid-air — mechanical impacts, servo locks, and violent wind.",
    model: "bytedance/seedance-2.0",
    modelLabel: "seedance-2.0",
    aspectRatio: "9:16",
    aspect: "tall",
    category: "Viral",
  },
  {
    slug: "in-the-dark",
    name: "IN THE DARK",
    prompt:
      "An early-2000s polygonal survival-horror loading screen — character with a flashlight in a misty night forest, dim sodium light and fog.",
    model: "kwaivgi/kling-v3.0-std",
    modelLabel: "kling-v3.0",
    aspectRatio: "16:9",
    aspect: "landscape",
    category: "Game",
  },
];

const authHeaders = () => ({
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface JobResponse {
  id: string;
  polling_url?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: string;
}

interface Result {
  slug: string;
  name: string;
  prompt: string;
  modelLabel: string;
  aspect: Aspect;
  file: string;
  cost?: number;
  category?: Category;
}

async function generate(clip: Clip): Promise<Result> {
  const body = {
    model: clip.model,
    prompt: clip.prompt,
    duration: DURATION,
    resolution: RESOLUTION,
    aspect_ratio: clip.aspectRatio,
  };

  const submitRes = await fetch(`${BASE_URL}/videos`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!submitRes.ok) {
    throw new Error(`submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }
  let status = (await submitRes.json()) as JobResponse;
  const jobId = status.id;
  const pollingUrl = status.polling_url ?? `${BASE_URL}/videos/${jobId}`;
  console.log(`  [${clip.slug}] submitted (${clip.model}) job=${jobId}`);

  const deadline = Date.now() + MAX_POLL_MS;
  while (status.status === "pending" || status.status === "in_progress") {
    if (Date.now() > deadline) throw new Error(`timed out (job ${jobId})`);
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(pollingUrl, { headers: authHeaders() });
    if (!pollRes.ok) throw new Error(`poll failed: ${pollRes.status} ${await pollRes.text()}`);
    status = (await pollRes.json()) as JobResponse;
  }
  if (status.status !== "completed") {
    throw new Error(status.error ?? `generation ${status.status} (job ${jobId})`);
  }

  const contentUrl = status.unsigned_urls?.[0] ?? `${BASE_URL}/videos/${jobId}/content?index=0`;
  const videoRes = await fetch(contentUrl, { headers: authHeaders() });
  if (!videoRes.ok) throw new Error(`download failed: ${videoRes.status}`);
  const buffer = Buffer.from(await videoRes.arrayBuffer());

  const file = `${clip.slug}.mp4`;
  await writeFile(path.join(OUT_DIR, file), buffer);
  const cost = status.usage?.cost;
  console.log(`  [${clip.slug}] done -> ${file} (${(buffer.length / 1e6).toFixed(1)}MB${cost != null ? `, $${cost.toFixed(4)}` : ""})`);

  return {
    slug: clip.slug,
    name: clip.name,
    prompt: clip.prompt,
    modelLabel: clip.modelLabel,
    aspect: clip.aspect,
    file,
    cost,
    category: clip.category,
  };
}

/** Run tasks with a fixed concurrency cap. */
async function runPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: Array<{ item: T; value?: R; error?: unknown }> = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx]!;
      try {
        results[idx] = { item, value: await fn(item) };
      } catch (error) {
        results[idx] = { item, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Read the existing manifest (so we can merge into it), or [] if none. */
async function readManifest(manifestPath: string): Promise<Result[]> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as Result[];
  } catch {
    return [];
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const existing = await readManifest(manifestPath);

  // Only generate clips whose MP4 isn't already on disk — never re-spend on
  // clips already on the wall.
  const todo = CLIPS.filter((c) => !existsSync(path.join(OUT_DIR, `${c.slug}.mp4`)));
  const skipped = CLIPS.length - todo.length;

  if (todo.length === 0) {
    console.log(`Nothing to generate — all ${CLIPS.length} clips already exist.`);
    return;
  }
  console.log(
    `Generating ${todo.length} new showcase clip(s) (${DURATION}s, ${RESOLUTION}) -> ${OUT_DIR}` +
      (skipped ? `  [skipping ${skipped} already present]` : "") +
      `\n`,
  );

  const results = await runPooled(todo, CONCURRENCY, generate);

  const ok: Result[] = [];
  const failed: { slug: string; error: string }[] = [];
  for (const r of results) {
    if (r.value) ok.push(r.value);
    else failed.push({ slug: r.item.slug, error: r.error instanceof Error ? r.error.message : String(r.error) });
  }

  // Merge new results into the existing manifest by slug (new wins), preserving
  // order: existing entries first, then any brand-new ones.
  const bySlug = new Map<string, Result>(existing.map((r) => [r.slug, r]));
  for (const r of ok) bySlug.set(r.slug, r);
  const merged: Result[] = [
    ...existing.map((r) => bySlug.get(r.slug)!),
    ...ok.filter((r) => !existing.some((e) => e.slug === r.slug)),
  ];
  await writeFile(manifestPath, JSON.stringify(merged, null, 2));

  const total = ok.reduce((s, r) => s + (r.cost ?? 0), 0);
  console.log(`\n✅ ${ok.length}/${todo.length} new clip(s) succeeded. New spend: $${total.toFixed(4)}`);
  console.log(`   Manifest now has ${merged.length} clip(s).`);
  if (failed.length) {
    console.log(`❌ ${failed.length} failed:`);
    for (const f of failed) console.log(`   - ${f.slug}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
