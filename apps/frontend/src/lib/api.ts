export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** Shared lifecycle status across videos, images, and face swaps. */
export type GenerationStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
export type VideoStatus = GenerationStatus;

/** Normalized model shape, shared by the video and image model pickers. */
export interface GenerationModel {
  id: string;
  name: string;
  description?: string;
  supported_resolutions?: string[];
  supported_aspect_ratios?: string[];
  /** Discrete clip lengths (seconds) a video model accepts, e.g. veo-3.1 → [4,6,8]. */
  supported_durations?: number[];
  /** True if the model accepts an audio input for lip-sync (e.g. Seedance 2.0). */
  supportsAudioInput?: boolean;
}
export type VideoModel = GenerationModel;

/** Durations (seconds) the UI offers; each is filtered to models that support it. */
export const ALLOWED_DURATIONS = [2, 3, 4, 5, 6, 8, 10];

/** Models from `all` that can generate the given duration (no constraint ⇒ all). */
export function modelsForDuration(all: VideoModel[], duration: number | null): VideoModel[] {
  if (!duration) return all;
  return all.filter((m) => !m.supported_durations?.length || m.supported_durations.includes(duration));
}

/** Allowed durations a specific model supports (intersection with ALLOWED_DURATIONS). */
export function durationsForModel(model: VideoModel | undefined): number[] {
  if (!model?.supported_durations?.length) return ALLOWED_DURATIONS;
  return ALLOWED_DURATIONS.filter((d) => model.supported_durations!.includes(d));
}

export interface Video {
  id: string;
  status: GenerationStatus;
  prompt: string;
  model: string;
  duration: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  generateAudio: boolean | null;
  error: string | null;
  cost: number | null;
  createdAt: string;
  videoUrl: string | null;
  startFrameUrl: string | null;
  endFrameUrl: string | null;
  referenceFrameUrls: string[];
}

export interface Image {
  id: string;
  status: GenerationStatus;
  prompt: string;
  model: string;
  resolution: string | null;
  aspectRatio: string | null;
  error: string | null;
  cost: number | null;
  createdAt: string;
  imageUrl: string | null;
  referenceImageUrls: string[];
}

export interface FaceSwap {
  id: string;
  status: GenerationStatus;
  error: string | null;
  createdAt: string;
  sourceUrl: string;
  targetUrl: string;
  outputUrl: string | null;
}

// ---- Templates ----

export interface Avatar {
  id: string;
  status: GenerationStatus;
  name: string;
  error: string | null;
  createdAt: string;
  faceUrl: string | null;
  sourceImageUrls: string[];
}

export interface TemplateBlock {
  id: string;
  order: number;
  startSec: number;
  endSec: number;
  track: number;
  duration: number | null;
  prompt: string;
  model: string;
  resolution: string | null;
  aspectRatio: string | null;
  cropStart: number;
  cropEnd: number | null;
  linkGroupId: string | null;
  faceSwapStart: boolean;
  faceSwapEnd: boolean;
  avatarSlot: number;
  swapContext: string | null;
  /** Face-swap engine: "facefusion", an OpenRouter model id, or null (server default). */
  swapModel: string | null;
  lipsync: boolean;
  startImageUrl: string | null;
  endImageUrl: string | null;
  /** Cached approved face-swap previews of the start/end frames (see "Generate face swap"). */
  swappedStartUrl: string | null;
  swappedEndUrl: string | null;
  videoUrl: string | null;
  /** When set, this block plays an admin-uploaded raw video instead of an AI clip. */
  sourceVideoUrl: string | null;
}

export interface TemplateAudioClip {
  id: string;
  order: number;
  startSec: number;
  endSec: number;
  track: number;
  audioUrl: string;
  name: string | null;
  duration: number;
  cropStart: number;
  cropEnd: number | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  avatarSlots: number;
  avatarIds: string[];
  published: boolean;
  thumbnailPrompt: string | null;
  previewVideoUrl: string | null;
  thumbnailUrl: string | null;
  blocks?: TemplateBlock[];
  audioClips?: TemplateAudioClip[];
  blockCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Per-block phase within a render (mirrors the backend RenderBlockPhase enum). */
export type RenderBlockPhase =
  | "QUEUED"
  | "FACE_SWAP"
  | "VIDEO_GENERATION"
  | "RETRYING"
  | "STITCHING"
  | "COMPLETED"
  | "REUSED"
  | "FELL_BACK"
  | "FAILED";

export interface RenderBlockProgress {
  id: string;
  blockId: string;
  order: number;
  startSec: number;
  endSec: number;
  label: string | null;
  phase: RenderBlockPhase;
  attempt: number;
  error: string | null;
}

export interface TemplateRender {
  id: string;
  templateId: string;
  templateName?: string;
  status: GenerationStatus;
  avatarIds: string[];
  videoUrl: string | null;
  thumbnailUrl: string | null;
  cost: number | null;
  error: string | null;
  createdAt: string;
  /** Per-block progress (present on the single-render endpoint). */
  blocks?: RenderBlockProgress[];
}

export interface Me {
  id: string;
  email: string;
  isAdmin: boolean;
  /** Spendable credit balance. */
  credits: number;
}

// ---- Credits & billing ----

export type CreditTxnType = "PURCHASE" | "SPEND" | "REFUND" | "BONUS" | "ADJUSTMENT";

export interface CreditTransaction {
  id: string;
  type: CreditTxnType;
  amount: number;
  balanceAfter: number;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface CreditPack {
  id: string;
  name: string;
  description: string;
  priceInr: number;
  credits: number;
  baseCredits: number;
  bonusCredits: number;
}

export interface CreditPacksResponse {
  currency: string;
  razorpayConfigured: boolean;
  razorpayKeyId: string | null;
  packs: CreditPack[];
  actionCosts: { video: number; image: number; template_render: number };
}

export interface CreditBalance {
  balance: number;
  transactions: CreditTransaction[];
}

export interface CheckoutOrder {
  orderId: string;
  amount: number;
  currency: string;
  razorpayKeyId: string;
  packId: string;
  packName: string;
  credits: number;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // String errors (e.g. "Not enough credits.") are shown verbatim; object
    // errors (zod field maps) are stringified so the message is still useful.
    const message =
      typeof body.error === "string"
        ? body.error
        : body.error
          ? JSON.stringify(body.error)
          : `Request failed (${res.status})`;
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T>(path: string) =>
  fetch(`${API_URL}${path}`, { credentials: "include" }).then(handle<T>);

const post = <T>(path: string, form: FormData) =>
  fetch(`${API_URL}${path}`, { method: "POST", credentials: "include", body: form }).then(handle<T>);

const postJson = <T>(path: string, body: unknown) =>
  fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(handle<T>);

const patch = <T>(path: string, form: FormData) =>
  fetch(`${API_URL}${path}`, { method: "PATCH", credentials: "include", body: form }).then(handle<T>);

const del = (path: string) =>
  fetch(`${API_URL}${path}`, { method: "DELETE", credentials: "include" }).then(handle<void>);

// ---- Models ----
export const fetchModels = () => get<VideoModel[]>("/api/models/video");
export const fetchImageModels = () => get<GenerationModel[]>("/api/models/image");

/** A selectable face-swap engine: local FaceFusion or an OpenRouter edit model. */
export interface SwapModelOption {
  id: string;
  name: string;
  local: boolean;
}
export const fetchSwapModels = () => get<SwapModelOption[]>("/api/models/swap");

// ---- Videos ----
export const fetchVideos = () => get<Video[]>("/api/videos");
export const createVideo = (form: FormData) => post<Video>("/api/videos", form);

// ---- Images ----
export const fetchImages = () => get<Image[]>("/api/images");
export const createImage = (form: FormData) => post<Image>("/api/images", form);

// ---- Face swaps ----
export const fetchFaceSwaps = () => get<FaceSwap[]>("/api/faceswaps");
export const createFaceSwap = (form: FormData) => post<FaceSwap>("/api/faceswaps", form);

// ---- Me ----
export const fetchMe = () => get<Me>("/api/me");

// ---- Avatars ----
export const fetchAvatars = () => get<Avatar[]>("/api/avatars");
export const createAvatar = (form: FormData) => post<Avatar>("/api/avatars", form);
export const deleteAvatar = (id: string) => del(`/api/avatars/${id}`);

// ---- Templates (users) ----
export const fetchTemplates = () => get<Template[]>("/api/templates");
export const fetchTemplate = (id: string) => get<Template>(`/api/templates/${id}`);
export const renderTemplate = (id: string, avatarIds: string[]) =>
  postJson<TemplateRender>(`/api/templates/${id}/render`, { avatarIds });
export const fetchTemplateRenders = () => get<TemplateRender[]>("/api/template-renders");
export const fetchRender = (id: string) => get<TemplateRender>(`/api/template-renders/${id}`);
/** Retry a failed render in place — keeps completed blocks, re-runs the rest. */
export const retryRender = (id: string) =>
  postJson<TemplateRender>(`/api/template-renders/${id}/retry`, {});

// ---- Templates (admin) ----
export const fetchAdminTemplates = () => get<Template[]>("/api/admin/templates");
export const fetchAdminTemplate = (id: string) => get<Template>(`/api/admin/templates/${id}`);
export const createTemplate = (form: FormData) => post<Template>("/api/admin/templates", form);
export const updateTemplate = (id: string, form: FormData) =>
  patch<Template>(`/api/admin/templates/${id}`, form);
export const deleteTemplate = (id: string) => del(`/api/admin/templates/${id}`);
export const createBlock = (templateId: string, form: FormData) =>
  post<TemplateBlock>(`/api/admin/templates/${templateId}/blocks`, form);
export const updateBlock = (templateId: string, blockId: string, form: FormData) =>
  patch<TemplateBlock>(`/api/admin/templates/${templateId}/blocks/${blockId}`, form);
export const deleteBlock = (templateId: string, blockId: string) =>
  del(`/api/admin/templates/${templateId}/blocks/${blockId}`);
export const copyBlock = (templateId: string, blockId: string, startSec: number, track: number) =>
  postJson<{ block: TemplateBlock; source: TemplateBlock }>(
    `/api/admin/templates/${templateId}/blocks/${blockId}/copy`,
    { startSec, track },
  );
export const bakeBlock = (templateId: string, blockId: string) =>
  postJson<TemplateBlock>(`/api/admin/templates/${templateId}/blocks/${blockId}/bake`, {});
export const generateBlockSwap = (templateId: string, blockId: string) =>
  postJson<TemplateBlock>(`/api/admin/templates/${templateId}/blocks/${blockId}/swap`, {});
export const captureBlockFrame = (
  templateId: string,
  blockId: string,
  body: { sourceBlockId: string; atSec: number; slot: "start" | "end" },
) => postJson<TemplateBlock>(`/api/admin/templates/${templateId}/blocks/${blockId}/frame`, body);
export const exportTemplate = (id: string) =>
  postJson<Template>(`/api/admin/templates/${id}/export`, {});

// ---- Credits & billing ----
export const fetchCredits = () => get<CreditBalance>("/api/credits");
export const fetchCreditPacks = () => get<CreditPacksResponse>("/api/credits/packs");
export const startCheckout = (packId: string) =>
  postJson<CheckoutOrder>("/api/credits/checkout", { packId });
export const verifyPayment = (body: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}) => postJson<{ balance: number }>("/api/credits/verify", body);

// ---- Template audio clips (admin) ----
export const createAudioClip = (templateId: string, form: FormData) =>
  post<TemplateAudioClip>(`/api/admin/templates/${templateId}/audio`, form);
export const updateAudioClip = (templateId: string, clipId: string, form: FormData) =>
  patch<TemplateAudioClip>(`/api/admin/templates/${templateId}/audio/${clipId}`, form);
export const deleteAudioClip = (templateId: string, clipId: string) =>
  del(`/api/admin/templates/${templateId}/audio/${clipId}`);
