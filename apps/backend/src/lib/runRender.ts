import { prisma, type Avatar, type TemplateAudioClip, type TemplateBlock } from "@repo/db";
import { uploadBuffer } from "./storage.js";
import { extFromMime } from "./uploads.js";
import {
  renderTemplate,
  type ArtifactsFn,
  type BlockResumeInfo,
  type ProgressFn,
} from "./templateRender.js";

/**
 * Execute a template render synchronously and persist the result on the given
 * TemplateRender row (marking it COMPLETED/FAILED). Returns the stored object
 * keys on success, or throws (after marking the row FAILED) on failure.
 */
export async function runAndStoreRender(params: {
  renderId: string;
  blocks: TemplateBlock[];
  orderedAvatars: Avatar[];
  audioClips?: TemplateAudioClip[];
  /** AI-generate the cover thumbnail (with the avatar as a reference image). */
  aiThumbnail?: boolean;
  /** Admin's thumbnail description (drives the AI thumbnail). */
  thumbnailPrompt?: string | null;
  /**
   * When true, re-generate every block even if a baked videoKey exists.
   * Set this for user renders so the user's avatar is applied instead of
   * the admin's baked clip.
   */
  forceRegenerate?: boolean;
  /**
   * When true, persist per-block phase updates to TemplateRenderBlock rows (which
   * the caller must have created up front) so the live /generation/:id page can
   * show each block's progress.
   */
  trackProgress?: boolean;
}): Promise<{ videoKey: string; thumbnailKey: string; cost: number }> {
  // All per-block row writes (phase updates + artifact keys) go through one
  // serialised chain so they apply in emission order — otherwise an earlier write
  // can land after a later one and leave a block showing a stale phase. The render
  // never awaits these, so a slow/failed write can't stall or break it.
  let writeChain: Promise<unknown> = Promise.resolve();
  const writeBlock = (blockId: string, data: Record<string, unknown>) => {
    if (!blockId) return;
    writeChain = writeChain
      .then(() => prisma.templateRenderBlock.updateMany({ where: { renderId: params.renderId, blockId }, data }))
      .catch((e) => console.warn("Block row update failed:", e));
  };

  const onProgress: ProgressFn | undefined = params.trackProgress
    ? (blockId, update) =>
        writeBlock(blockId, {
          ...(update.phase ? { phase: update.phase } : {}),
          ...(update.attempt != null ? { attempt: update.attempt } : {}),
          ...(update.error !== undefined ? { error: update.error } : {}),
        })
    : undefined;

  // Persist each block's produced artifacts (clip / swapped frames) so a later
  // retry can resume from them instead of regenerating.
  const onArtifacts: ArtifactsFn | undefined = params.trackProgress
    ? (blockId, artifacts) => writeBlock(blockId, { ...artifacts })
    : undefined;

  // Build the resume map from any artifacts a previous attempt already persisted.
  // A block with a stored clip is reused whole; stored swapped frames let an
  // unfinished block skip re-swapping.
  let resume: Map<string, BlockResumeInfo> | undefined;
  if (params.trackProgress) {
    const existing = await prisma.templateRenderBlock.findMany({
      where: { renderId: params.renderId },
    });
    resume = new Map(
      existing.map((row) => [
        row.blockId,
        {
          // Only reuse a clip from a block that actually completed.
          videoKey: row.phase === "COMPLETED" ? row.videoKey : null,
          swappedStartKey: row.swappedStartKey,
          swappedEndKey: row.swappedEndKey,
        },
      ]),
    );
  }

  try {
    const result = await renderTemplate({
      blocks: params.blocks,
      avatars: params.orderedAvatars.map((a) => ({ faceKey: a.faceKey })),
      audioClips: params.audioClips,
      aiThumbnail: params.aiThumbnail,
      thumbnailPrompt: params.thumbnailPrompt,
      forceRegenerate: params.forceRegenerate,
      onProgress,
      onArtifacts,
      resume,
    });

    const [videoKey, thumbnailKey] = await Promise.all([
      uploadBuffer(result.videoBuffer, result.contentType, "templates/renders", "mp4"),
      uploadBuffer(
        result.thumbnailBuffer,
        result.thumbnailContentType,
        "templates/thumbnails",
        extFromMime(result.thumbnailContentType),
      ),
    ]);

    await prisma.templateRender.update({
      where: { id: params.renderId },
      data: { status: "COMPLETED", videoKey, thumbnailKey, cost: result.cost },
    });
    return { videoKey, thumbnailKey, cost: result.cost };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template render failed";
    console.error("Template render failed:", message);
    await prisma.templateRender.update({
      where: { id: params.renderId },
      data: { status: "FAILED", error: message },
    });
    throw err instanceof Error ? err : new Error(message);
  }
}
