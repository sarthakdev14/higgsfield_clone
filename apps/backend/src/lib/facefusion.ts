import { env } from "../env.js";

export interface FaceSwapInput {
  buffer: Buffer;
  mimetype: string;
  filename: string;
}

export interface FaceSwapResult {
  buffer: Buffer;
  contentType: string;
}

// Face swapping (downloading models + processing) can take a while on CPU.
const FACE_SWAP_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Run a face swap via the self-hosted FaceFusion service.
 *
 * `source` is the face to apply; `target` is the base image being modified.
 * The wrapper service runs FaceFusion's `headless-run` and returns the result.
 */
export async function faceSwap(
  source: FaceSwapInput,
  target: FaceSwapInput,
): Promise<FaceSwapResult> {
  const toBlob = (input: FaceSwapInput) =>
    new Blob([new Uint8Array(input.buffer)], { type: input.mimetype });

  const form = new FormData();
  form.append("source", toBlob(source), source.filename);
  form.append("target", toBlob(target), target.filename);

  let res: Response;
  try {
    res = await fetch(`${env.FACEFUSION_URL}/swap`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(FACE_SWAP_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach the FaceFusion service at ${env.FACEFUSION_URL} (${reason}). ` +
        `Start it with \`docker compose --profile facefusion up -d facefusion\`.`,
    );
  }

  if (!res.ok) {
    throw new Error(`FaceFusion swap failed: ${res.status} ${await res.text()}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    buffer,
    contentType: res.headers.get("content-type") ?? "image/jpeg",
  };
}
