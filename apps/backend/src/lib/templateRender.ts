import { env } from "../env.js";
import { faceSwap } from "./facefusion.js";
import {
  stitchTimeline,
  generateThumbnail,
  probeImageSize,
  mixAudioWindow,
  type AudioWindowPart,
  type TimelineSegment,
} from "./ffmpeg.js";
import { generateImage, generateVideo, supportsAudioLipsync, swapFaceWithImageModel } from "./openrouter.js";
import { downloadObject, getPublicUrl, uploadBuffer } from "./storage.js";

/** Per-block phase emitted via the progress callback (mirrors the DB enum). */
export type BlockPhase =
  | "QUEUED"
  | "FACE_SWAP"
  | "VIDEO_GENERATION"
  | "RETRYING"
  | "STITCHING"
  | "COMPLETED"
  | "REUSED"
  | "FELL_BACK"
  | "FAILED";

export interface BlockProgressUpdate {
  phase?: BlockPhase;
  attempt?: number;
  error?: string | null;
}

/** Reports a block's progress during a render (keyed by the block's id). */
export type ProgressFn = (blockId: string, update: BlockProgressUpdate) => void;

/** Artifacts a prior attempt persisted for a block, used to resume instead of redo. */
export interface BlockResumeInfo {
  /** A fully-generated clip from a prior attempt — reused as-is when present. */
  videoKey?: string | null;
  /** Swapped frames from a prior attempt — reused to skip re-swapping. */
  swappedStartKey?: string | null;
  swappedEndKey?: string | null;
}

/** Newly-produced artifacts for a block, reported so the caller can persist them. */
export interface BlockArtifacts {
  videoKey?: string;
  swappedStartKey?: string;
  swappedEndKey?: string;
}

/** Persists per-block artifacts as they're produced (keyed by the block's id). */
export type ArtifactsFn = (blockId: string, artifacts: BlockArtifacts) => void;

export interface RenderBlock {
  /** Source TemplateBlock id; used to key progress updates (optional). */
  id?: string;
  prompt: string;
  model: string;
  resolution?: string | null;
  aspectRatio?: string | null;
  startSec: number;
  endSec: number;
  track: number;
  duration?: number | null;
  cropStart?: number | null;
  cropEnd?: number | null;
  startImageKey?: string | null;
  endImageKey?: string | null;
  // Cached approved face-swap previews of the start/end frames (see "Generate face swap").
  swappedStartKey?: string | null;
  swappedEndKey?: string | null;
  videoKey?: string | null;
  // An admin-uploaded raw video used directly (no AI generation). Always takes
  // precedence over generation/baking, even on user renders.
  sourceVideoKey?: string | null;
  linkGroupId?: string | null;
  faceSwapStart: boolean;
  faceSwapEnd: boolean;
  avatarSlot: number;
  /** Optional guidance for the diffusion ("flux") swap provider. */
  swapContext?: string | null;
  /** Which engine performs the swap ("facefusion" | OpenRouter model id | null=server default). */
  swapModel?: string | null;
  /** Send the audio under this block to the model for lip-sync (capable models only). */
  lipsync?: boolean;
}

export interface RenderAvatar {
  faceKey: string | null;
}

export interface RenderAudioClip {
  audioKey: string;
  startSec: number;
  duration?: number | null;
  cropStart?: number | null;
  cropEnd?: number | null;
}

export interface RenderResult {
  videoBuffer: Buffer;
  contentType: string;
  thumbnailBuffer: Buffer;
  thumbnailContentType: string;
  cost: number;
}

export interface ClipResult {
  buffer: Buffer;
  contentType: string;
  cost: number;
}

/** Sniff an image mime type from the leading bytes (defaults to png). */
function sniffImageMime(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "image/png";
}

function ext(mime: string): string {
  return mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
}

const toDataUrl = (buffer: Buffer, mime: string) =>
  `data:${mime};base64,${buffer.toString("base64")}`;

/** Map an aspect ratio to output dimensions for the stitched video. */
function aspectToDims(aspectRatio?: string | null): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 720, height: 1280 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "4:3":
      return { width: 960, height: 720 };
    case "3:4":
      return { width: 720, height: 960 };
    case "16:9":
    default:
      return { width: 1280, height: 720 };
  }
}

/**
 * AI-generate a cover thumbnail. Uses the admin's `thumbnailPrompt` when provided
 * (else falls back to a description built from the block prompts), and passes the
 * avatar face image(s) as references so the actor appears in the thumbnail. Throws
 * on a provider error so the caller can fall back to a frame grab.
 */
async function generateAiThumbnail(
  blocks: RenderBlock[],
  aspectRatio: string | null | undefined,
  opts: { thumbnailPrompt?: string | null; faces?: Buffer[]; model?: string } = {},
): Promise<{ buffer: Buffer; contentType: string; cost: number }> {
  const scenes = [...blocks]
    .sort((a, b) => a.startSec - b.startSec)
    .map((b) => b.prompt?.trim())
    .filter((p): p is string => !!p);

  const custom = opts.thumbnailPrompt?.trim();
  if (!custom && scenes.length === 0) {
    throw new Error("No thumbnail description or block prompts to build a thumbnail from.");
  }

  let instruction: string;
  if (custom) {
    instruction = custom;
  } else {
    let joined = scenes.join("; ");
    if (joined.length > 1500) joined = `${joined.slice(0, 1500)}…`;
    instruction = `Design a single, eye-catching cover thumbnail image that represents this short video. The video's scenes are: ${joined}.`;
  }

  const faces = opts.faces ?? [];
  const refNote = faces.length
    ? " Feature the person shown in the reference image(s) as the main subject, preserving their exact likeness and identity."
    : "";
  // Only forbid text for the auto-generated description; a custom thumbnail
  // prompt may deliberately ask for a title/caption in the image.
  const quality = custom
    ? " Cinematic, high quality, cohesive composition."
    : " Cinematic, high quality, cohesive composition, no text, captions or watermarks.";
  const prompt = `${instruction}${refNote}${quality}`;

  const img = await generateImage({
    model: opts.model ?? env.OPENROUTER_THUMBNAIL_MODEL,
    prompt,
    aspectRatio: aspectRatio ?? "16:9",
    references: faces.length
      ? faces.map((f) => ({ url: toDataUrl(f, sniffImageMime(f)) }))
      : undefined,
  });
  return { buffer: img.buffer, contentType: img.contentType, cost: img.cost ?? 0 };
}

/** Supported diffusion output aspect ratios (numeric value → enum string). */
const ASPECT_RATIOS: { label: string; value: number }[] = [
  { label: "21:9", value: 21 / 9 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:2", value: 3 / 2 },
  { label: "4:3", value: 4 / 3 },
  { label: "5:4", value: 5 / 4 },
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "3:4", value: 3 / 4 },
  { label: "2:3", value: 2 / 3 },
  { label: "9:16", value: 9 / 16 },
];

/** Snap actual pixel dimensions to the closest supported aspect-ratio string. */
function nearestAspectRatio(width: number, height: number): string {
  const r = width / height;
  return ASPECT_RATIOS.reduce((best, a) =>
    Math.abs(a.value - r) < Math.abs(best.value - r) ? a : best,
  ).label;
}

/**
 * Resolve the effective swap engine for a block. `swapModel` may be:
 *  - "facefusion" → the local FaceFusion service,
 *  - an OpenRouter image model id → diffusion edit via that model,
 *  - null/undefined → fall back to the server default (SWAP_PROVIDER / OPENROUTER_SWAP_MODEL).
 */
function resolveSwapEngine(swapModel?: string | null): { flux: false } | { flux: true; model: string } {
  if (swapModel === "facefusion") return { flux: false };
  if (swapModel) return { flux: true, model: swapModel };
  return env.SWAP_PROVIDER === "flux" ? { flux: true, model: env.OPENROUTER_SWAP_MODEL } : { flux: false };
}

/**
 * Apply a face swap onto a single frame using the block's chosen engine
 * (`swapModel`): a diffusion identity edit (honors `context`) via an OpenRouter
 * model, or the classic FaceFusion pixel swap. Returns the swapped bytes + mime.
 *
 * For the diffusion path the output aspect ratio is taken from the FRAME's actual
 * dimensions (so the original framing is preserved), not the block's config.
 */
export async function applyFaceSwap(
  face: Buffer,
  frame: Buffer,
  frameMime: string,
  opts: { swapModel?: string | null; context?: string | null; aspectRatio?: string | null } = {},
): Promise<{ buffer: Buffer; mime: string }> {
  const faceMime = sniffImageMime(face);
  const engine = resolveSwapEngine(opts.swapModel);
  if (engine.flux) {
    // Preserve the frame's real aspect ratio rather than forcing the block's.
    let aspect = opts.aspectRatio ?? undefined;
    try {
      const { width, height } = await probeImageSize(frame);
      aspect = nearestAspectRatio(width, height);
    } catch {
      /* fall back to the provided aspect ratio (or none) */
    }
    const result = await swapFaceWithImageModel({
      model: engine.model,
      face: { buffer: face, mime: faceMime },
      frame: { buffer: frame, mime: frameMime },
      context: opts.context ?? undefined,
      aspectRatio: aspect,
    });
    return { buffer: result.buffer, mime: result.contentType };
  }
  const result = await faceSwap(
    { buffer: face, mimetype: faceMime, filename: `face.${ext(faceMime)}` },
    { buffer: frame, mimetype: frameMime, filename: `frame.${ext(frameMime)}` },
  );
  return { buffer: result.buffer, mime: result.contentType };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying up to `attempts` times (total) on any error with a short
 * linear backoff. Used for video generation, which the provider occasionally
 * fails transiently or returns a content-filtered empty result that succeeds on
 * a retry. Throws the last error if every attempt fails.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  label: string,
  onRetry?: (nextAttempt: number) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) {
        console.warn(`${label}: attempt ${attempt}/${attempts} failed, retrying — ${msg}`);
        onRetry?.(attempt + 1);
        await sleep(2000 * attempt);
      } else {
        console.error(`${label}: all ${attempts} attempts failed — ${msg}`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Generate a single block's video clip: face-swap the avatar onto the start/end
 * frames when enabled, pass the avatar as a reference, then call the model.
 * `face` is the avatar face buffer for this block's slot (or null for none).
 *
 * When `opts.useSwapCache` is set, an already-generated swap preview
 * (`swappedStartKey`/`swappedEndKey`) is reused instead of swapping again — so an
 * admin who clicked "Generate face swap" and approved it isn't charged twice.
 * User renders pass `useSwapCache: false` so the user's own avatar is applied.
 */
export async function renderBlockClip(
  block: RenderBlock,
  face: Buffer | null,
  opts: {
    useSwapCache?: boolean;
    lipsyncAudioUrl?: string;
    /** Reports this block's phase as it progresses (face swap → generation → …). */
    onPhase?: (phase: BlockPhase, attempt?: number) => void;
    /** Pre-swapped frames from a prior attempt — when set, skip swapping that side. */
    cachedSwap?: { start?: Buffer; end?: Buffer };
    /**
     * Invoked right after the frames are swapped (before video generation) with
     * any FRESHLY swapped frames, so the caller can persist them for resume.
     */
    onSwapped?: (frames: {
      start: { buffer: Buffer; mime: string } | null;
      end: { buffer: Buffer; mime: string } | null;
    }) => void | Promise<void>;
  } = {},
): Promise<ClipResult> {
  // Resolve the start/end frames, face-swapping the avatar on when requested.
  const prepareFrame = async (
    key: string | null | undefined,
    swap: boolean,
    swappedKey: string | null | undefined,
  ): Promise<{ buffer: Buffer; mime: string } | null> => {
    if (!key) return null;
    if (swap && opts.useSwapCache && swappedKey) {
      const cached = await downloadObject(swappedKey);
      return { buffer: cached, mime: sniffImageMime(cached) };
    }
    const buffer = await downloadObject(key);
    const mime = sniffImageMime(buffer);
    if (swap && face) {
      return applyFaceSwap(face, buffer, mime, {
        swapModel: block.swapModel,
        context: block.swapContext,
        aspectRatio: block.aspectRatio,
      });
    }
    return { buffer, mime };
  };

  // Whether each side still needs swapping (a prior attempt may have done it).
  const swapStartFresh = block.faceSwapStart && !!block.startImageKey && !!face && !opts.cachedSwap?.start;
  const swapEndFresh = block.faceSwapEnd && !!block.endImageKey && !!face && !opts.cachedSwap?.end;
  if (swapStartFresh || swapEndFresh) opts.onPhase?.("FACE_SWAP");

  // Use a previously-swapped frame when provided, else resolve/swap it now.
  const startFrame = opts.cachedSwap?.start
    ? { buffer: opts.cachedSwap.start, mime: sniffImageMime(opts.cachedSwap.start) }
    : await prepareFrame(block.startImageKey, block.faceSwapStart, block.swappedStartKey);
  const endFrame = opts.cachedSwap?.end
    ? { buffer: opts.cachedSwap.end, mime: sniffImageMime(opts.cachedSwap.end) }
    : await prepareFrame(block.endImageKey, block.faceSwapEnd, block.swappedEndKey);

  // Persist freshly-swapped frames (only the sides we swapped this run) so a later
  // retry can skip the swap.
  if (opts.onSwapped) {
    await opts.onSwapped({
      start: swapStartFresh ? startFrame : null,
      end: swapEndFresh ? endFrame : null,
    });
  }

  // Reference: the block's selected avatar (used both as a face-swap source
  // above and as an OpenRouter reference image, to keep the person consistent).
  const references: { url: string }[] = [];
  if (face) references.push({ url: toDataUrl(face, sniffImageMime(face)) });

  const duration = block.duration ?? Math.max(1, Math.round(block.endSec - block.startSec));

  // Lip-sync: feed the block's audio to capable models so the subject syncs to it.
  const audioReference =
    block.lipsync && opts.lipsyncAudioUrl && supportsAudioLipsync(block.model)
      ? { url: opts.lipsyncAudioUrl }
      : undefined;

  // Retry transient/content-filtered video failures (often succeed on a retry).
  opts.onPhase?.("VIDEO_GENERATION");
  const generated = await withRetry(
    () =>
      generateVideo({
        model: block.model,
        prompt: block.prompt,
        duration,
        resolution: block.resolution ?? undefined,
        aspectRatio: block.aspectRatio ?? undefined,
        firstFrame: startFrame ? { url: toDataUrl(startFrame.buffer, startFrame.mime) } : undefined,
        lastFrame: endFrame ? { url: toDataUrl(endFrame.buffer, endFrame.mime) } : undefined,
        references: references.length > 0 ? references : undefined,
        audioReference,
        // Keep the provided lip-sync audio rather than the model inventing its own.
        generateAudio: audioReference ? undefined : false,
      }),
    env.RENDER_VIDEO_MAX_ATTEMPTS,
    `Video generation (model ${block.model})`,
    (nextAttempt) => opts.onPhase?.("RETRYING", nextAttempt),
  );

  return { buffer: generated.buffer, contentType: generated.contentType, cost: generated.cost ?? 0 };
}

/**
 * Build the audio that plays under a block's time window (mixing all overlapping
 * timeline audio clips), upload it, and return its public URL — or null if no
 * audio overlaps the block. Used to drive lip-sync for capable models.
 */
export async function buildBlockLipsyncAudio(
  audioClips: RenderAudioClip[],
  block: { startSec: number; endSec: number },
): Promise<string | null> {
  const windowLen = block.endSec - block.startSec;
  if (windowLen <= 0 || audioClips.length === 0) return null;

  const overlapping = audioClips.flatMap((clip) => {
    const dur = clip.duration ?? 0;
    const cropStart = clip.cropStart ?? 0;
    const cropEnd = clip.cropEnd ?? (dur > 0 ? dur : 0);
    const footprint = Math.max(0, cropEnd - cropStart);
    if (footprint <= 0) return [];
    const clipEnd = clip.startSec + footprint;
    const overlapStart = Math.max(block.startSec, clip.startSec);
    const overlapEnd = Math.min(block.endSec, clipEnd);
    const length = overlapEnd - overlapStart;
    if (length <= 0.05) return [];
    return [
      {
        audioKey: clip.audioKey,
        inPoint: cropStart + (overlapStart - clip.startSec),
        length,
        delaySec: overlapStart - block.startSec,
      },
    ];
  });
  if (overlapping.length === 0) return null;

  const parts: AudioWindowPart[] = await Promise.all(
    overlapping.map(async (p) => ({
      buffer: await downloadObject(p.audioKey),
      inPoint: p.inPoint,
      length: p.length,
      delaySec: p.delaySec,
    })),
  );
  const mixed = await mixAudioWindow(parts, windowLen);
  const key = await uploadBuffer(mixed, "audio/mpeg", "templates/lipsync", "mp3");
  return getPublicUrl(key);
}

/**
 * Resolve overlapping, multi-track blocks into a flat list of timeline segments.
 * Boundaries are taken at every block edge (and 0); for each resulting slice the
 * visible block is the one on the highest track that fully spans it (ties broken
 * by the later start, then later index). Uncovered slices become black gaps.
 */
export function buildTimelineSegments(blocks: RenderBlock[]): TimelineSegment[] {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const total = round(Math.max(...blocks.map((b) => b.endSec)));
  if (total <= 0) return [];

  const bounds = new Set<number>([0, total]);
  for (const b of blocks) {
    if (b.startSec > 0 && b.startSec < total) bounds.add(round(b.startSec));
    if (b.endSec > 0 && b.endSec < total) bounds.add(round(b.endSec));
  }
  const points = [...bounds].sort((a, b) => a - b);

  const segments: TimelineSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i]!;
    const e = points[i + 1]!;
    const length = round(e - s);
    if (length <= 0) continue;

    // Topmost block fully spanning [s, e).
    let chosen: { block: RenderBlock; idx: number } | null = null;
    blocks.forEach((block, idx) => {
      if (block.startSec - 1e-3 <= s && block.endSec + 1e-3 >= e) {
        if (
          !chosen ||
          block.track > chosen.block.track ||
          (block.track === chosen.block.track && block.startSec >= chosen.block.startSec)
        ) {
          chosen = { block, idx };
        }
      }
    });

    if (chosen) {
      const sel = chosen as { block: RenderBlock; idx: number };
      // Map timeline time to clip time, accounting for the crop in-point.
      const cropStart = sel.block.cropStart ?? 0;
      segments.push({ clip: sel.idx, inPoint: round(cropStart + (s - sel.block.startSec)), length });
    } else {
      segments.push({ clip: null, inPoint: 0, length });
    }
  }
  return segments;
}

/**
 * Map over `items` running at most `limit` tasks concurrently, preserving input
 * order in the results. Rejects on the first task error, like `Promise.all`.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Render a template end-to-end: generate every block (face-swapping the avatar
 * onto the start/end frames when enabled, and passing the avatar as a reference),
 * then composite the clips across tracks (higher track wins on overlap) over the
 * base audio and produce a thumbnail.
 *
 * Throws on the first block that fails so callers can mark the render FAILED.
 */
export async function renderTemplate(params: {
  blocks: RenderBlock[];
  avatars: (RenderAvatar | undefined)[];
  /** Audio clips placed on the timeline, mixed together over the video. */
  audioClips?: RenderAudioClip[];
  /** When true, the cover thumbnail is AI-generated (with the avatar as a reference). */
  aiThumbnail?: boolean;
  /** Admin's thumbnail description (drives the AI thumbnail; avatar is added as a reference). */
  thumbnailPrompt?: string | null;
  /**
   * When true, always re-generate every block via OpenRouter even if a baked
   * videoKey exists on the block. Use this for user renders so the user's own
   * avatar is applied rather than the admin's baked clip.
   */
  forceRegenerate?: boolean;
  /** Optional callback reporting each block's phase as the render progresses. */
  onProgress?: ProgressFn;
  /** Artifacts persisted by a prior attempt, keyed by block id — enables resume. */
  resume?: Map<string, BlockResumeInfo>;
  /** Reports per-block artifacts (clip / swapped frames) as they're produced. */
  onArtifacts?: ArtifactsFn;
}): Promise<RenderResult> {
  const blocks = [...params.blocks];
  if (blocks.length === 0) throw new Error("Template has no video blocks to render.");

  // Pre-download all required avatar face buffers in parallel.
  const uniqueSlots = [...new Set(blocks.map((b) => b.avatarSlot))];
  const faceCache = new Map<number, Buffer | null>();
  await Promise.all(
    uniqueSlots.map(async (slot) => {
      const avatar = params.avatars[slot];
      if (avatar?.faceKey) {
        faceCache.set(slot, await downloadObject(avatar.faceKey));
      } else {
        faceCache.set(slot, null);
      }
    }),
  );
  const avatarFace = (slot: number): Buffer | null => faceCache.get(slot) ?? null;

  // Deduplicate generation by linkGroupId + avatarSlot: blocks that share a
  // linkGroupId reference the same generated content, so we only call
  // OpenRouter once per unique group and reuse the result for the rest.
  // Key: "<linkGroupId>:<slot>" for linked blocks, or null (always generate).
  const linkClipCache = new Map<string, Promise<ClipResult>>();

  // Generate clips with bounded concurrency: each block hits OpenRouter (video
  // generation) and the CPU-bound FaceFusion swap service, so generating all of
  // them at once floods those services until they time out. Cap how many blocks
  // are in flight at once (RENDER_BLOCK_CONCURRENCY).
  let totalCost = 0;
  const clipResults = await mapLimit(blocks, env.RENDER_BLOCK_CONCURRENCY, async (block, idx) => {
    const report = (update: BlockProgressUpdate) => {
      if (block.id) params.onProgress?.(block.id, update);
    };
    const onPhase = (phase: BlockPhase, attempt?: number) =>
      report({ phase, ...(attempt != null ? { attempt } : {}) });

    const blockId = block.id ?? "";
    const resumeInfo = blockId ? params.resume?.get(blockId) : undefined;

    // Admin-uploaded raw video: use it as-is, always (even on user renders).
    if (block.sourceVideoKey) {
      const buffer = await downloadObject(block.sourceVideoKey);
      report({ phase: "REUSED" });
      return { buffer, cost: 0 };
    }

    // Reuse admin-baked clip only when not forcing regeneration.
    if (block.videoKey && !params.forceRegenerate) {
      const buffer = await downloadObject(block.videoKey);
      report({ phase: "REUSED" });
      return { buffer, cost: 0 };
    }

    // Resume: this block already produced a clip in a prior attempt — reuse it
    // verbatim instead of regenerating (the big retry win).
    if (resumeInfo?.videoKey) {
      const buffer = await downloadObject(resumeInfo.videoKey);
      params.onArtifacts?.(blockId, { videoKey: resumeInfo.videoKey });
      report({ phase: "COMPLETED" });
      return { buffer, cost: 0 };
    }

    const face = avatarFace(block.avatarSlot);

    // Load any swapped frames persisted by a prior attempt so we can skip swapping.
    const cachedSwap: { start?: Buffer; end?: Buffer } = {};
    if (resumeInfo?.swappedStartKey) cachedSwap.start = await downloadObject(resumeInfo.swappedStartKey);
    if (resumeInfo?.swappedEndKey) cachedSwap.end = await downloadObject(resumeInfo.swappedEndKey);

    // Persist freshly-swapped frames as soon as they're produced (before video
    // generation) so an interrupt mid-generation doesn't lose the swap.
    const onSwapped = async (frames: {
      start: { buffer: Buffer; mime: string } | null;
      end: { buffer: Buffer; mime: string } | null;
    }) => {
      const artifacts: BlockArtifacts = {};
      if (frames.start)
        artifacts.swappedStartKey = await uploadBuffer(
          frames.start.buffer,
          frames.start.mime,
          "templates/render-frames",
          ext(frames.start.mime),
        );
      if (frames.end)
        artifacts.swappedEndKey = await uploadBuffer(
          frames.end.buffer,
          frames.end.mime,
          "templates/render-frames",
          ext(frames.end.mime),
        );
      if (artifacts.swappedStartKey || artifacts.swappedEndKey) params.onArtifacts?.(blockId, artifacts);
    };

    try {
      // Lip-sync clips depend on the audio under their specific position, so they
      // can't share a generated clip across a link group — build per-block + skip dedupe.
      const lipsync = !!block.lipsync && supportsAudioLipsync(block.model);
      let clip: ClipResult;
      if (lipsync) {
        const lipsyncAudioUrl =
          (await buildBlockLipsyncAudio(params.audioClips ?? [], block)) ?? undefined;
        clip = await renderBlockClip(block, face, {
          useSwapCache: !params.forceRegenerate,
          lipsyncAudioUrl,
          onPhase,
          cachedSwap,
          onSwapped,
        });
      } else {
        // For linked blocks, deduplicate the OpenRouter call.
        const dedupeKey = block.linkGroupId
          ? `${block.linkGroupId}:${block.avatarSlot}`
          : null;

        let clipPromise: Promise<ClipResult>;
        if (dedupeKey && linkClipCache.has(dedupeKey)) {
          // Sharing a linked sibling's generated clip (no own swap/generation).
          report({ phase: "VIDEO_GENERATION" });
          clipPromise = linkClipCache.get(dedupeKey)!;
        } else {
          // Reuse the admin's approved swap preview on export, but never on a forced
          // user re-render (that must swap the user's own avatar fresh).
          clipPromise = renderBlockClip(block, face, {
            useSwapCache: !params.forceRegenerate,
            onPhase,
            cachedSwap,
            onSwapped,
          });
          if (dedupeKey) linkClipCache.set(dedupeKey, clipPromise);
        }

        clip = await clipPromise;
      }

      // Persist the generated clip so a future retry can reuse it.
      const videoKey = await uploadBuffer(clip.buffer, clip.contentType, "templates/render-clips", "mp4");
      params.onArtifacts?.(blockId, { videoKey });
      report({ phase: "COMPLETED" });
      return { buffer: clip.buffer, cost: clip.cost };
    } catch (err) {
      // Generation failed even after retries (e.g. the provider persistently
      // content-filters this block). Don't sink the entire render — fall back to
      // the admin's baked clip for this block when one exists.
      const msg = err instanceof Error ? err.message : String(err);
      if (block.videoKey) {
        console.error(`Block ${idx} generation failed, falling back to baked clip — ${msg}`);
        const buffer = await downloadObject(block.videoKey);
        report({ phase: "FELL_BACK", error: msg });
        return { buffer, cost: 0 };
      }
      report({ phase: "FAILED", error: msg });
      throw err;
    }
  });

  const clips: Buffer[] = clipResults.map((r) => r.buffer);
  for (const r of clipResults) totalCost += r.cost;

  const segments = buildTimelineSegments(blocks);

  // Resolve the audio parts: trim each clip's crop window and place it at its
  // start time. All parts are mixed together over the video on stitch.
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const audioClips = params.audioClips ?? [];
  const audioParts = await Promise.all(
    audioClips.map(async (clip) => {
      const dur = clip.duration ?? 0;
      const cropStart = clip.cropStart ?? 0;
      const cropEnd = clip.cropEnd ?? (dur > 0 ? dur : undefined);
      const length = cropEnd != null ? Math.max(0.05, cropEnd - cropStart) : undefined;
      return {
        buffer: await downloadObject(clip.audioKey),
        startSec: round(Math.max(0, clip.startSec)),
        inPoint: round(Math.max(0, cropStart)),
        // Fall back to the clip's footprint when its duration is unknown.
        length: round(length ?? 1),
      };
    }),
  );

  // The timeline runs to the furthest clip — video or audio. If audio extends
  // past the video, pad the video with a trailing black segment to cover it.
  const videoEnd = round(Math.max(0, ...blocks.map((b) => b.endSec)));
  const audioEnd = round(Math.max(0, ...audioParts.map((a) => a.startSec + a.length)));
  if (audioEnd > videoEnd + 0.001) {
    segments.push({ clip: null, inPoint: 0, length: round(audioEnd - videoEnd) });
  }

  // Output dimensions follow the base (earliest, lowest-track) block.
  const base = [...blocks].sort(
    (a, b) => a.startSec - b.startSec || a.track - b.track,
  )[0]!;
  const { width, height } = aspectToDims(base.aspectRatio);

  const videoBuffer = await stitchTimeline(clips, segments, audioParts, { width, height });

  // Cover thumbnail: AI-generated (with the avatar as a reference so the actor
  // appears), else a frame grab.
  let thumbnailBuffer: Buffer;
  let thumbnailContentType = "image/jpeg";
  if (params.aiThumbnail) {
    // A single image model/call has no retry of its own, so a transient blip
    // (timeout / 429) or a flaky provider (Google image models fail fairly
    // often) used to immediately drop to a frame grab. Try the primary model
    // then fall through to the configured fallback models, with a couple of
    // attempts each, before giving up.
    const models = [
      env.OPENROUTER_THUMBNAIL_MODEL,
      ...env.OPENROUTER_THUMBNAIL_FALLBACK_MODELS,
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);
    const ATTEMPTS_PER_MODEL = 2;

    // Download the avatar face(s) once (resiliently — a missing/failed face just
    // means the thumbnail is generated without that reference).
    const faces = (
      await Promise.all(
        params.avatars.map((a) =>
          a?.faceKey
            ? downloadObject(a.faceKey).catch(() => null)
            : Promise.resolve(null),
        ),
      )
    ).filter((b): b is Buffer => b != null);

    const ai = await (async () => {
      for (const model of models) {
        for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
          try {
            return await generateAiThumbnail(blocks, base.aspectRatio, {
              thumbnailPrompt: params.thumbnailPrompt,
              faces,
              model,
            });
          } catch (err) {
            console.warn(
              `AI thumbnail failed (model ${model}, attempt ${attempt}/${ATTEMPTS_PER_MODEL}):`,
              err instanceof Error ? err.message : err,
            );
            if (attempt < ATTEMPTS_PER_MODEL) {
              await new Promise((r) => setTimeout(r, 1200 * attempt));
            }
          }
        }
        console.warn(`AI thumbnail: giving up on "${model}", trying the next model…`);
      }
      return null;
    })();

    if (ai) {
      thumbnailBuffer = ai.buffer;
      thumbnailContentType = ai.contentType;
      totalCost += ai.cost;
    } else {
      console.warn(
        "AI thumbnail generation failed across all models — using a video frame grab.",
      );
      thumbnailBuffer = await generateThumbnail(videoBuffer);
    }
  } else {
    thumbnailBuffer = await generateThumbnail(videoBuffer);
  }

  return { videoBuffer, contentType: "video/mp4", thumbnailBuffer, thumbnailContentType, cost: totalCost };
}
