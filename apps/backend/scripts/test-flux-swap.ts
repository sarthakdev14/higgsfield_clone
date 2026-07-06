/**
 * Verify the configured "flux" swap model honors reference images.
 *
 *   # Free metadata check (no credits spent): is the model listed + what inputs?
 *   bun run --cwd apps/backend scripts/test-flux-swap.ts
 *
 *   # Real swap (spends a few cents): grab two images and write the result.
 *   bun run --cwd apps/backend scripts/test-flux-swap.ts <faceImg> <frameImg> [context]
 *
 * <faceImg>/<frameImg> may be local file paths or http(s) URLs.
 */
import { readFile, writeFile } from "node:fs/promises";
import { env } from "../src/env.js";
import { swapFaceWithImageModel } from "../src/lib/openrouter.js";

function sniffMime(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "image/png";
}

async function load(src: string): Promise<Buffer> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch ${src}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(src);
}

async function metadataCheck() {
  const res = await fetch(`${env.OPENROUTER_BASE_URL}/images/models`, {
    headers: env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } : {},
  });
  if (!res.ok) {
    console.error(`Could not list image models: ${res.status} ${await res.text()}`);
    return;
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const model = (json.data ?? []).find((m) => m.id === env.OPENROUTER_SWAP_MODEL);
  if (!model) {
    console.warn(`⚠️  Model "${env.OPENROUTER_SWAP_MODEL}" not found in /images/models. It may not be available on your account.`);
    return;
  }
  console.log(`✅ Model "${env.OPENROUTER_SWAP_MODEL}" is available. Metadata:`);
  console.log(JSON.stringify(model, null, 2));
  console.log(
    "\nLook for image/reference input support in the metadata above (e.g. input modalities or " +
      "supported_parameters mentioning references). If unsure, run the real swap test below.",
  );
}

async function main() {
  if (!env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set in apps/backend/.env");
    process.exit(1);
  }
  console.log(`Swap model: ${env.OPENROUTER_SWAP_MODEL}\n`);

  const [faceArg, frameArg, context] = process.argv.slice(2);
  if (!faceArg || !frameArg) {
    console.log("No images provided — running a free metadata check only.\n");
    await metadataCheck();
    console.log(
      "\nTo run a real swap: bun run --cwd apps/backend scripts/test-flux-swap.ts <faceImg> <frameImg> [context]",
    );
    return;
  }

  const [face, frame] = await Promise.all([load(faceArg), load(frameArg)]);
  console.log(`Swapping face (${face.length} bytes) onto frame (${frame.length} bytes)…`);
  const result = await swapFaceWithImageModel({
    model: env.OPENROUTER_SWAP_MODEL,
    face: { buffer: face, mime: sniffMime(face) },
    frame: { buffer: frame, mime: sniffMime(frame) },
    context,
  });
  const ext = result.contentType.includes("png") ? "png" : result.contentType.includes("webp") ? "webp" : "jpg";
  const out = `swap-test-output.${ext}`;
  await writeFile(out, result.buffer);
  console.log(
    `✅ Wrote ${out} (${result.contentType}, ${result.buffer.length} bytes), cost=${result.cost ?? "n/a"}.\n` +
      "Open it and confirm the avatar's face was applied to the frame.",
  );
}

main().catch((err) => {
  console.error("❌ Test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
