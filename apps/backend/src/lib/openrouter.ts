import { env } from "../env.js";

const BASE_URL = env.OPENROUTER_BASE_URL;

function authHeaders(): Record<string, string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Set it in the backend .env to generate videos.",
    );
  }
  return {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export interface VideoModel {
  id: string;
  name: string;
  description?: string;
  supported_resolutions?: string[];
  supported_aspect_ratios?: string[];
  supported_sizes?: string[];
  /** Discrete clip lengths (seconds) the model accepts, e.g. veo-3.1 → [4, 6, 8]. */
  supported_durations?: number[];
  /** True if the model honors an audio input reference (for audio-driven lip-sync). */
  supportsAudioInput?: boolean;
  /** True if the model accepts reference images (usable as a face-swap edit model). */
  supportsReferences?: boolean;
}

/**
 * Whether a video model honors an audio `input_references` entry (audio-driven
 * lip-sync). Per OpenRouter, audio references are currently only honored by
 * BytePlus/ByteDance Seedance 2.0. Update this as more providers add support.
 */
export function supportsAudioLipsync(modelId: string): boolean {
  return /seedance-2/i.test(modelId);
}

/** List the video-generation models available on OpenRouter. */
export async function listVideoModels(): Promise<VideoModel[]> {
  const res = await fetch(`${BASE_URL}/videos/models`, {
    headers: env.OPENROUTER_API_KEY ? authHeaders() : { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to list video models: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: VideoModel[] };
  return (json.data ?? []).map((m) => ({ ...m, supportsAudioInput: supportsAudioLipsync(m.id) }));
}

interface ImageRef {
  /** A data URL (data:image/png;base64,...) or a publicly reachable URL. */
  url: string;
}

// ---------------------------------------------------------------------------
// Image generation (dedicated OpenRouter Image API)
// ---------------------------------------------------------------------------

interface CapabilityDescriptor {
  type?: string;
  values?: string[];
}

interface RawImageModel {
  id: string;
  name?: string;
  description?: string;
  supported_parameters?: Record<string, CapabilityDescriptor | undefined>;
}

/**
 * List image-generation models. We normalise the response into the same shape
 * the video models use so the frontend can share one model-picker component.
 */
export async function listImageModels(): Promise<VideoModel[]> {
  const res = await fetch(`${BASE_URL}/images/models`, {
    headers: env.OPENROUTER_API_KEY ? authHeaders() : { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to list image models: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: RawImageModel[] };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    description: m.description,
    supported_resolutions: m.supported_parameters?.resolution?.values,
    supported_aspect_ratios: m.supported_parameters?.aspect_ratio?.values,
    supportsReferences: !!m.supported_parameters?.input_references,
  }));
}

/** A selectable face-swap model: the local FaceFusion service or an OpenRouter edit model. */
export interface SwapModelOption {
  /** "facefusion" for the local service, otherwise an OpenRouter image model id. */
  id: string;
  name: string;
  /** True for the local (FaceFusion) option. */
  local: boolean;
}

/**
 * The face-swap models the admin can choose per block: the local FaceFusion
 * service plus every OpenRouter image model that accepts reference images.
 */
export async function listSwapModels(): Promise<SwapModelOption[]> {
  const images = await listImageModels();
  const openrouter = images
    .filter((m) => m.supportsReferences)
    .map((m) => ({ id: m.id, name: m.name, local: false }));
  return [{ id: "facefusion", name: "FaceFusion (local)", local: true }, ...openrouter];
}

export interface GenerateImageParams {
  model: string;
  prompt: string;
  resolution?: string;
  aspectRatio?: string;
  references?: ImageRef[];
}

export interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
  cost?: number;
}

interface ImageGenerationResponse {
  data?: { b64_json?: string; url?: string }[];
  usage?: { cost?: number };
  error?: string | { message?: string };
}

/** Guess an image content type from the leading bytes of the buffer. */
function detectImageContentType(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "image/png";
}

/** Generate an image synchronously and return the decoded bytes. */
export async function generateImage(params: GenerateImageParams): Promise<GeneratedImage> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
  };
  if (params.resolution) body.resolution = params.resolution;
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (params.references && params.references.length > 0) {
    body.input_references = params.references.map((ref) => ({
      type: "image_url",
      image_url: { url: ref.url },
    }));
  }

  const res = await fetch(`${BASE_URL}/images`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter image generation failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as ImageGenerationResponse;
  const first = json.data?.[0];

  if (first?.b64_json) {
    const buffer = Buffer.from(first.b64_json, "base64");
    return { buffer, contentType: detectImageContentType(buffer), cost: json.usage?.cost };
  }
  if (first?.url) {
    const imgRes = await fetch(first.url);
    if (!imgRes.ok) {
      throw new Error(`Failed to download generated image: ${imgRes.status}`);
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return {
      buffer,
      contentType: imgRes.headers.get("content-type") ?? detectImageContentType(buffer),
      cost: json.usage?.cost,
    };
  }

  const message =
    typeof json.error === "string" ? json.error : json.error?.message ?? "No image returned";
  throw new Error(message);
}

const asDataUrl = (buffer: Buffer, mime: string) => `data:${mime};base64,${buffer.toString("base64")}`;

export interface SwapFaceParams {
  model: string;
  /** The face to apply (avatar). */
  face: { buffer: Buffer; mime: string };
  /** The frame being edited (the face is swapped onto this). */
  frame: { buffer: Buffer; mime: string };
  /** Optional natural-language guidance, e.g. "keep the soft window lighting". */
  context?: string;
  aspectRatio?: string;
}

/**
 * Face swap via a diffusion image-edit model (e.g. FLUX.2): the frame is the base
 * image and the avatar is a reference, so the model re-renders the frame with the
 * person's face. Unlike FaceFusion this accepts a `context` prompt.
 */
export async function swapFaceWithImageModel(params: SwapFaceParams): Promise<GeneratedImage> {
  const base =
    "You are given two images. IMAGE 1 is the scene to edit. IMAGE 2 is a reference photo of a " +
    "different person. Task: change the identity of the main face in IMAGE 1 so it becomes the " +
    "person from IMAGE 2 — copy IMAGE 2's facial features, bone structure, eyes, nose, mouth and " +
    "overall likeness. " +
    "Keep EVERYTHING ELSE from IMAGE 1 unchanged: the body, pose, the existing hair and beard, " +
    "clothing, framing, camera angle, lighting and background. " +
    "Do NOT import the hair, beard, glasses/sunglasses or accessories from IMAGE 2, and do not add " +
    "any that aren't already in IMAGE 1. " +
    "Match the skin tone and color to IMAGE 1's lighting so the face blends seamlessly. " +
    "Output a photorealistic result with a natural, neutral expression and change nothing other " +
    "than the facial identity. Preserve IMAGE 1's exact framing and aspect ratio.";
  const prompt = params.context?.trim()
    ? `${base}\n\nAdditional guidance from the creator: ${params.context.trim()}`
    : base;
  return generateImage({
    model: params.model,
    prompt,
    aspectRatio: params.aspectRatio,
    references: [
      { url: asDataUrl(params.frame.buffer, params.frame.mime) },
      { url: asDataUrl(params.face.buffer, params.face.mime) },
    ],
  });
}

export interface GenerateVideoParams {
  model: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
  firstFrame?: ImageRef;
  lastFrame?: ImageRef;
  references?: ImageRef[];
  /** Audio track the video should lip-sync to (only honored by capable models). */
  audioReference?: { url: string };
}

export interface GeneratedVideo {
  buffer: Buffer;
  contentType: string;
  providerJobId: string;
  cost?: number;
}

type JobStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";

interface JobResponse {
  id: string;
  polling_url?: string;
  status: JobStatus;
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: string;
}

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate a video synchronously: submit the job, poll until it reaches a
 * terminal state, then download and return the resulting video bytes.
 */
export async function generateVideo(params: GenerateVideoParams): Promise<GeneratedVideo> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
  };
  if (params.duration) body.duration = params.duration;
  if (params.resolution) body.resolution = params.resolution;
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (params.generateAudio !== undefined) body.generate_audio = params.generateAudio;

  const frameImages: unknown[] = [];
  if (params.firstFrame) {
    frameImages.push({
      type: "image_url",
      image_url: { url: params.firstFrame.url },
      frame_type: "first_frame",
    });
  }
  if (params.lastFrame) {
    frameImages.push({
      type: "image_url",
      image_url: { url: params.lastFrame.url },
      frame_type: "last_frame",
    });
  }
  if (frameImages.length > 0) body.frame_images = frameImages;

  const inputReferences: unknown[] = (params.references ?? []).map((ref) => ({
    type: "image_url",
    image_url: { url: ref.url },
  }));
  // Audio reference for lip-sync (honored only by capable models, e.g. Seedance 2.0).
  if (params.audioReference) {
    inputReferences.push({ type: "audio_url", audio_url: { url: params.audioReference.url } });
  }
  if (inputReferences.length > 0) body.input_references = inputReferences;

  // Step 1: submit
  const submitRes = await fetch(`${BASE_URL}/videos`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!submitRes.ok) {
    throw new Error(`OpenRouter submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }
  const submitted = (await submitRes.json()) as JobResponse;
  const jobId = submitted.id;
  const pollingUrl = submitted.polling_url ?? `${BASE_URL}/videos/${jobId}`;

  // Step 2: poll until terminal
  const deadline = Date.now() + MAX_POLL_MS;
  let status: JobResponse = submitted;
  while (status.status === "pending" || status.status === "in_progress") {
    if (Date.now() > deadline) {
      throw new Error(`Video generation timed out after ${MAX_POLL_MS / 1000}s (job ${jobId})`);
    }
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(pollingUrl, { headers: authHeaders() });
    if (!pollRes.ok) {
      throw new Error(`OpenRouter poll failed: ${pollRes.status} ${await pollRes.text()}`);
    }
    status = (await pollRes.json()) as JobResponse;
  }

  if (status.status !== "completed") {
    throw new Error(status.error ?? `Video generation ${status.status} (job ${jobId})`);
  }

  // Step 3: download the content
  const contentUrl = status.unsigned_urls?.[0] ?? `${BASE_URL}/videos/${jobId}/content?index=0`;
  const videoRes = await fetch(contentUrl, { headers: authHeaders() });
  if (!videoRes.ok) {
    throw new Error(`Failed to download generated video: ${videoRes.status}`);
  }
  const arrayBuffer = await videoRes.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: videoRes.headers.get("content-type") ?? "video/mp4",
    providerJobId: jobId,
    cost: status.usage?.cost,
  };
}
