import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),

  // Public URL the backend is reachable at (used for auth callbacks).
  BACKEND_URL: z.string().url().default("http://localhost:4000"),
  // Frontend origin(s), used for CORS + auth trusted origins. Accepts a
  // comma-separated list so the app can be served from multiple domains
  // (e.g. "https://pixovid.com,https://video.100xdevs.com").
  FRONTEND_URL: z
    .string()
    .default("http://localhost:5173")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url()).min(1)),

  DATABASE_URL: z.string().url(),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Comma-separated list of emails that should be treated as admins. Users with
  // a matching email are promoted to the "admin" role on their next request.
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),

  // Comma-separated list of superadmin emails. Superadmins are admins who can
  // additionally see and manage EVERY admin's templates (not just their own).
  SUPERADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  // Image model used to AI-generate a template's cover thumbnail (from block prompts).
  OPENROUTER_THUMBNAIL_MODEL: z.string().default("google/gemini-3.1-flash-image"),
  // Fallback image models (comma-separated) tried in order if the primary
  // thumbnail model fails — provider/model outages (esp. Google) are common, so
  // we fall through to other reference-capable models before giving up.
  OPENROUTER_THUMBNAIL_FALLBACK_MODELS: z
    .string()
    .default("bytedance-seed/seedream-4.5,black-forest-labs/flux.2-klein-4b")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Face-swap provider for template frames:
  //  - "facefusion": classic pixel-level swap via the self-hosted service (precise,
  //    supports per-person targeting, no prompt/context).
  //  - "flux": diffusion identity edit via an OpenRouter image model (higher quality,
  //    accepts a per-block `swapContext` prompt, regenerates the frame).
  SWAP_PROVIDER: z.enum(["facefusion", "flux"]).default("facefusion"),
  // Image model used for the "flux" swap provider (must accept reference images).
  OPENROUTER_SWAP_MODEL: z.string().default("black-forest-labs/flux.2-klein-4b"),

  // Self-hosted FaceFusion face-swap service.
  // Use "localhost" for host-based dev, "facefusion" inside docker-compose.
  FACEFUSION_URL: z.string().url().default("http://localhost:7865"),

  // Max template blocks generated concurrently during a single render. Blocks
  // each hit OpenRouter (video gen) and the CPU-bound FaceFusion swap service, so
  // an uncapped render of many blocks floods them and they time out. Keep this
  // low; set to 1 to fully serialize.
  RENDER_BLOCK_CONCURRENCY: z.coerce.number().int().positive().default(3),

  // How many times to attempt a block's video generation before giving up. The
  // provider occasionally returns a transient error or a content-filtered empty
  // result that succeeds on a retry. Total attempts = this value (>=1).
  RENDER_VIDEO_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  // Razorpay (credit purchases). Without these the billing endpoints return a
  // clear 503; everything else still works. Get keys from the Razorpay dashboard.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // Optional webhook signing secret (Razorpay dashboard → Webhooks). Used to
  // verify `payment.captured` events as a backstop to client-side verification.
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // ---- Credit pricing (fixed price per action) ----
  // Each generation costs a flat number of credits regardless of model. Defaults
  // are tuned so that, even at the best-value pack's effective credit price,
  // revenue stays >= ~30% above the typical OpenRouter provider cost. If you
  // enable pricier models, raise these: pick credits >= providerCostUSD *
  // USD_INR_RATE * 1.72 (1 / 0.7 margin / 0.833 best-pack credit value).
  CREDITS_PER_IMAGE: z.coerce.number().int().positive().default(6),
  CREDITS_PER_VIDEO: z.coerce.number().int().positive().default(60),
  CREDITS_PER_TEMPLATE_RENDER: z.coerce.number().int().positive().default(1000),
  // USD→INR rate used only for documentation/estimates in the pricing helper.
  USD_INR_RATE: z.coerce.number().positive().default(86),

  // MinIO / S3-compatible object store
  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_FRONTEND_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("video-arena"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
