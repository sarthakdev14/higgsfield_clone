import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "@repo/db";
import { requireAdmin } from "../middleware/requireAdmin.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";
import { downloadObject, uploadBuffer } from "../lib/storage.js";
import { audioUpload, extFromMime, videoUpload } from "../lib/uploads.js";
import { generateThumbnail, probeMediaDuration } from "../lib/ffmpeg.js";
import { runAndStoreRender } from "../lib/runRender.js";
import { applyFaceSwap, buildBlockLipsyncAudio, renderBlockClip } from "../lib/templateRender.js";
import { supportsAudioLipsync } from "../lib/openrouter.js";
import {
  serializeAudioClip,
  serializeBlock,
  serializeRender,
  serializeTemplate,
} from "../lib/templateSerialize.js";

export const adminTemplatesRouter: Router = Router();

const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

// Multipart fields arrive as a string (single value) or string[] (repeated).
const stringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

const templateMetaSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  avatarIds: stringArray,
  thumbnailPrompt: z.string().optional(),
});

const blockSchema = z.object({
  order: z.coerce.number().int().min(0).optional(),
  startSec: z.coerce.number().min(0),
  // Optional: the footprint is derived from the crop window over `duration`.
  endSec: z.coerce.number().min(0).optional(),
  track: z.coerce.number().int().min(0).optional(),
  duration: z.coerce.number().int().positive().optional(),
  // Crop window into the generated clip (Premiere-style trim).
  cropStart: z.coerce.number().min(0).optional(),
  cropEnd: z.coerce.number().min(0).optional(),
  // Required for AI-generated blocks; optional for admin-uploaded raw videos
  // (validated per-request: a block must be either generated or an upload).
  prompt: z.string().optional(),
  model: z.string().optional(),
  resolution: z.string().optional(),
  aspectRatio: z.string().optional(),
  faceSwapStart: bool,
  faceSwapEnd: bool,
  avatarSlot: z.coerce.number().int().min(0).max(1).optional(),
  swapContext: z.string().optional(),
  // "facefusion", an OpenRouter image model id, or "" (server default).
  swapModel: z.string().optional(),
  lipsync: bool,
});

const MIN_CLIP = 1; // minimum cropped clip length (seconds)

/** Clamp a crop window to [0, duration] with a minimum length. */
function clampCrop(cropStart: number, cropEnd: number, duration: number) {
  const cs = Math.min(Math.max(0, cropStart), Math.max(0, duration - MIN_CLIP));
  const ce = Math.min(Math.max( cs + MIN_CLIP, cropEnd), duration);
  return { cropStart: cs, cropEnd: ce };
}

const blockPatchSchema = blockSchema.partial();

type Files = Record<string, Express.Multer.File[] | undefined>;

/** Validate that the given avatar ids exist and belong to the user. Throws on mismatch. */
async function assertOwnedAvatars(avatarIds: string[], userId: string): Promise<void> {
  if (avatarIds.length < 1 || avatarIds.length > 2) {
    throw new Error("Select 1 or 2 avatars for the template.");
  }
  const found = await prisma.avatar.count({ where: { id: { in: avatarIds }, userId } });
  if (found !== avatarIds.length) {
    throw new Error("One or more selected avatars were not found.");
  }
}

async function uploadIfPresent(file?: Express.Multer.File, prefix = "templates") {
  if (!file) return undefined;
  return uploadBuffer(file.buffer, file.mimetype, prefix, extFromMime(file.mimetype));
}

/** Download the avatar face buffer for a block's slot (or null if none/unassigned). */
async function resolveBlockFace(
  avatarIds: string[],
  avatarSlot: number,
  userId: string,
): Promise<Buffer | null> {
  const avatarId = avatarIds[avatarSlot];
  if (!avatarId) return null;
  const avatar = await prisma.avatar.findFirst({ where: { id: avatarId, userId } });
  return avatar?.faceKey ? downloadObject(avatar.faceKey) : null;
}

/**
 * Scope a single-template lookup by id. A superadmin can address any template;
 * a regular admin is restricted to templates they created.
 */
function templateScope(req: AuthedRequest) {
  return req.isSuperAdmin
    ? { id: req.params.id }
    : { id: req.params.id, creatorId: req.userId };
}

/** Ensure the template exists and the requester may act on it (owner or superadmin). */
async function ownedTemplate(req: AuthedRequest, res: Response) {
  const template = await prisma.template.findFirst({ where: templateScope(req) });
  if (!template) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return template;
}

// ---- Templates ----

// List templates: a superadmin sees every admin's templates; a regular admin
// sees only their own (with block counts).
adminTemplatesRouter.get("/", requireAdmin, async (req: AuthedRequest, res) => {
  const templates = await prisma.template.findMany({
    where: req.isSuperAdmin ? {} : { creatorId: req.userId },
    orderBy: { updatedAt: "desc" },
    include: { blocks: true },
  });
  res.json(templates.map((t) => serializeTemplate(t)));
});

// Full template with ordered blocks + audio clips.
adminTemplatesRouter.get("/:id", requireAdmin, async (req: AuthedRequest, res) => {
  const template = await prisma.template.findFirst({
    where: templateScope(req),
    include: {
      blocks: { orderBy: { startSec: "asc" } },
      audioClips: { orderBy: { startSec: "asc" } },
    },
  });
  if (!template) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeTemplate(template));
});

// Create a template. The admin assigns 1-2 of their own avatars to the slots
// up front; these become "Avatar 1"/"Avatar 2" for blocks + the admin's export.
// The timeline starts empty — videos and audio are added later in the editor.
adminTemplatesRouter.post(
  "/",
  requireAdmin,
  audioUpload.none(),
  async (req: AuthedRequest, res) => {
    const parsed = templateMetaSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.name) {
      res.status(400).json({ error: parsed.success ? { name: ["Name is required"] } : parsed.error.flatten().fieldErrors });
      return;
    }
    const avatarIds = parsed.data.avatarIds ?? [];
    try {
      await assertOwnedAvatars(avatarIds, req.userId!);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid avatars" });
      return;
    }

    const template = await prisma.template.create({
      data: {
        creatorId: req.userId!,
        name: parsed.data.name,
        description: parsed.data.description,
        avatarIds,
        avatarSlots: avatarIds.length,
        thumbnailPrompt: parsed.data.thumbnailPrompt,
      },
      include: { blocks: true, audioClips: true },
    });
    res.status(201).json(serializeTemplate(template));
  },
);

// Update template metadata: name/description and/or the assigned avatars
// (which resets avatarSlots). Audio is managed via the audio-clip routes below.
adminTemplatesRouter.patch(
  "/:id",
  requireAdmin,
  audioUpload.none(),
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;

    const parsed = templateMetaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const avatarIds = parsed.data.avatarIds;
    if (avatarIds) {
      try {
        // Avatars are validated against the template's creator (so a superadmin
        // editing another admin's template assigns that admin's avatars).
        await assertOwnedAvatars(avatarIds, template.creatorId);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid avatars" });
        return;
      }
    }

    const updated = await prisma.template.update({
      where: { id: template.id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        thumbnailPrompt: parsed.data.thumbnailPrompt,
        ...(avatarIds ? { avatarIds, avatarSlots: avatarIds.length } : {}),
      },
      include: {
        blocks: { orderBy: { startSec: "asc" } },
        audioClips: { orderBy: { startSec: "asc" } },
      },
    });
    res.json(serializeTemplate(updated));
  },
);

adminTemplatesRouter.delete("/:id", requireAdmin, async (req: AuthedRequest, res) => {
  const template = await ownedTemplate(req, res);
  if (!template) return;
  await prisma.template.delete({ where: { id: template.id } });
  res.status(204).end();
});

// ---- Blocks ----

const blockUpload = videoUpload.fields([
  { name: "startImage", maxCount: 1 },
  { name: "endImage", maxCount: 1 },
  // A raw video the admin wants to use directly instead of generating a clip.
  { name: "sourceVideo", maxCount: 1 },
]);

// Add a video block to a template.
adminTemplatesRouter.post("/:id/blocks", requireAdmin, blockUpload, async (req: AuthedRequest, res) => {
  const template = await ownedTemplate(req, res);
  if (!template) return;

  const parsed = blockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const files = (req.files ?? {}) as Files;
  const sourceVideoFile = files.sourceVideo?.[0];

  // An admin-uploaded raw video is used as-is: no prompt/model needed, and its
  // duration comes from the file itself. AI blocks still require a prompt+model.
  let sourceVideoKey: string | undefined;
  let uploadedDuration: number | undefined;
  if (sourceVideoFile) {
    try {
      uploadedDuration = Math.max(1, Math.round(await probeMediaDuration(sourceVideoFile.buffer)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid video upload" });
      return;
    }
    sourceVideoKey = await uploadBuffer(
      sourceVideoFile.buffer,
      sourceVideoFile.mimetype,
      "templates/uploads",
      sourceVideoFile.originalname.split(".").pop() ?? "mp4",
    );
  } else if (!parsed.data.prompt?.trim() || !parsed.data.model?.trim()) {
    res.status(400).json({ error: { prompt: ["Prompt and model are required for generated clips."] } });
    return;
  }

  const [startImageKey, endImageKey] = await Promise.all([
    uploadIfPresent(files.startImage?.[0]),
    uploadIfPresent(files.endImage?.[0]),
  ]);

  const count = await prisma.templateBlock.count({ where: { templateId: template.id } });
  const slot = Math.min(parsed.data.avatarSlot ?? 0, Math.max(0, template.avatarSlots - 1));
  const duration =
    uploadedDuration ??
    parsed.data.duration ??
    (parsed.data.endSec != null
      ? Math.max(1, Math.round(parsed.data.endSec - parsed.data.startSec))
      : 4);
  // Crop window (defaults to the whole clip); footprint = cropEnd - cropStart.
  const { cropStart, cropEnd } = clampCrop(
    parsed.data.cropStart ?? 0,
    parsed.data.cropEnd ?? duration,
    duration,
  );
  const block = await prisma.templateBlock.create({
    data: {
      templateId: template.id,
      order: parsed.data.order ?? count,
      startSec: parsed.data.startSec,
      endSec: parsed.data.startSec + (cropEnd - cropStart),
      track: parsed.data.track ?? 0,
      duration,
      cropStart,
      cropEnd,
      prompt: parsed.data.prompt ?? "",
      model: parsed.data.model ?? "",
      resolution: parsed.data.resolution,
      aspectRatio: parsed.data.aspectRatio,
      faceSwapStart: parsed.data.faceSwapStart ?? false,
      faceSwapEnd: parsed.data.faceSwapEnd ?? false,
      avatarSlot: slot,
      swapContext: parsed.data.swapContext,
      swapModel: parsed.data.swapModel || null,
      lipsync: parsed.data.lipsync ?? false,
      startImageKey,
      endImageKey,
      sourceVideoKey,
    },
  });
  res.status(201).json(serializeTemplate({ ...template, blocks: [block] }).blocks![0]);
});

// Update a block (only provided fields/images change).
adminTemplatesRouter.patch(
  "/:id/blocks/:blockId",
  requireAdmin,
  blockUpload,
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;
    const existing = await prisma.templateBlock.findFirst({
      where: { id: req.params.blockId, templateId: template.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Block not found" });
      return;
    }
    const parsed = blockPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const files = (req.files ?? {}) as Files;
    const startImageKey = await uploadIfPresent(files.startImage?.[0]);
    const endImageKey = await uploadIfPresent(files.endImage?.[0]);

    // A replaced raw video: re-probe its duration and reset the crop to the
    // whole new clip (the old crop window may no longer fit).
    const sourceVideoFile = files.sourceVideo?.[0];
    let sourceVideoKey: string | undefined;
    let uploadedDuration: number | undefined;
    if (sourceVideoFile) {
      try {
        uploadedDuration = Math.max(1, Math.round(await probeMediaDuration(sourceVideoFile.buffer)));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid video upload" });
        return;
      }
      sourceVideoKey = await uploadBuffer(
        sourceVideoFile.buffer,
        sourceVideoFile.mimetype,
        "templates/uploads",
        sourceVideoFile.originalname.split(".").pop() ?? "mp4",
      );
    }

    const slot =
      parsed.data.avatarSlot === undefined
        ? undefined
        : Math.min(parsed.data.avatarSlot, Math.max(0, template.avatarSlots - 1));

    const startSec = parsed.data.startSec ?? existing.startSec;
    const duration =
      uploadedDuration ??
      parsed.data.duration ??
      existing.duration ??
      Math.max(1, Math.round(existing.endSec - existing.startSec));
    // Resolve + clamp the crop window; footprint = cropEnd - cropStart. A newly
    // uploaded clip resets the crop to its full length.
    const { cropStart, cropEnd } = clampCrop(
      uploadedDuration !== undefined ? 0 : parsed.data.cropStart ?? existing.cropStart,
      uploadedDuration !== undefined ? duration : parsed.data.cropEnd ?? existing.cropEnd ?? duration,
      duration,
    );

    // A cached swap preview is invalidated when its base frame is replaced, the
    // avatar slot changes, or the swap model changes (different engine → re-swap).
    const newSwapModel =
      parsed.data.swapModel !== undefined ? parsed.data.swapModel || null : undefined;
    const avatarChanged = slot !== undefined && slot !== existing.avatarSlot;
    const swapModelChanged = newSwapModel !== undefined && newSwapModel !== existing.swapModel;
    const clearSwappedStart = !!startImageKey || avatarChanged || swapModelChanged;
    const clearSwappedEnd = !!endImageKey || avatarChanged || swapModelChanged;

    // Content fields are shared across a link group; position/crop are per-block.
    const content = {
      ...(parsed.data.prompt !== undefined ? { prompt: parsed.data.prompt } : {}),
      ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
      ...(parsed.data.duration !== undefined || uploadedDuration !== undefined ? { duration } : {}),
      ...(parsed.data.resolution !== undefined ? { resolution: parsed.data.resolution } : {}),
      ...(parsed.data.aspectRatio !== undefined ? { aspectRatio: parsed.data.aspectRatio } : {}),
      ...(parsed.data.faceSwapStart !== undefined ? { faceSwapStart: parsed.data.faceSwapStart } : {}),
      ...(parsed.data.faceSwapEnd !== undefined ? { faceSwapEnd: parsed.data.faceSwapEnd } : {}),
      ...(slot !== undefined ? { avatarSlot: slot } : {}),
      ...(parsed.data.swapContext !== undefined ? { swapContext: parsed.data.swapContext } : {}),
      ...(newSwapModel !== undefined ? { swapModel: newSwapModel } : {}),
      ...(parsed.data.lipsync !== undefined ? { lipsync: parsed.data.lipsync } : {}),
      ...(startImageKey ? { startImageKey } : {}),
      ...(endImageKey ? { endImageKey } : {}),
      ...(clearSwappedStart ? { swappedStartKey: null } : {}),
      ...(clearSwappedEnd ? { swappedEndKey: null } : {}),
      ...(sourceVideoKey ? { sourceVideoKey } : {}),
    };

    const block = await prisma.templateBlock.update({
      where: { id: existing.id },
      data: {
        ...content,
        order: parsed.data.order,
        startSec,
        track: parsed.data.track,
        cropStart,
        cropEnd,
        endSec: startSec + (cropEnd - cropStart),
      },
    });

    // Propagate shared content (incl. a duration change) to linked siblings,
    // re-clamping each one's own crop window + footprint.
    if (existing.linkGroupId && Object.keys(content).length > 0) {
      const siblings = await prisma.templateBlock.findMany({
        where: { linkGroupId: existing.linkGroupId, id: { not: existing.id } },
      });
      await Promise.all(
        siblings.map((s) => {
          const c = clampCrop(s.cropStart, s.cropEnd ?? duration, duration);
          return prisma.templateBlock.update({
            where: { id: s.id },
            data: { ...content, cropStart: c.cropStart, cropEnd: c.cropEnd, endSec: s.startSec + (c.cropEnd - c.cropStart) },
          });
        }),
      );
    }

    res.json(serializeTemplate({ ...template, blocks: [block] }).blocks![0]);
  },
);

adminTemplatesRouter.delete(
  "/:id/blocks/:blockId",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;
    const existing = await prisma.templateBlock.findFirst({
      where: { id: req.params.blockId, templateId: template.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Block not found" });
      return;
    }
    await prisma.templateBlock.delete({ where: { id: existing.id } });
    res.status(204).end();
  },
);

const copySchema = z.object({
  startSec: z.coerce.number().min(0),
  track: z.coerce.number().int().min(0).optional(),
});

// Copy/paste: clone a block's *content* into a new, linked block at a new
// position. Linked blocks share generation content, so editing/re-baking any of
// them updates the rest. The source is given a linkGroupId on first copy.
adminTemplatesRouter.post(
  "/:id/blocks/:blockId/copy",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;
    const source = await prisma.templateBlock.findFirst({
      where: { id: req.params.blockId, templateId: template.id },
    });
    if (!source) {
      res.status(404).json({ error: "Block not found" });
      return;
    }
    const parsed = copySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    // Ensure the source belongs to a link group (create one on first copy).
    const linkGroupId = source.linkGroupId ?? randomUUID();
    let updatedSource = source;
    if (!source.linkGroupId) {
      updatedSource = await prisma.templateBlock.update({
        where: { id: source.id },
        data: { linkGroupId },
      });
    }

    const count = await prisma.templateBlock.count({ where: { templateId: template.id } });
    const footprint = (source.cropEnd ?? source.duration ?? 4) - source.cropStart;
    const copy = await prisma.templateBlock.create({
      data: {
        templateId: template.id,
        order: count,
        startSec: parsed.data.startSec,
        endSec: parsed.data.startSec + footprint,
        track: parsed.data.track ?? source.track,
        duration: source.duration,
        cropStart: source.cropStart,
        cropEnd: source.cropEnd,
        linkGroupId,
        prompt: source.prompt,
        model: source.model,
        resolution: source.resolution,
        aspectRatio: source.aspectRatio,
        faceSwapStart: source.faceSwapStart,
        faceSwapEnd: source.faceSwapEnd,
        avatarSlot: source.avatarSlot,
        swapContext: source.swapContext,
        swapModel: source.swapModel,
        lipsync: source.lipsync,
        startImageKey: source.startImageKey,
        endImageKey: source.endImageKey,
        swappedStartKey: source.swappedStartKey,
        swappedEndKey: source.swappedEndKey,
        videoKey: source.videoKey,
        sourceVideoKey: source.sourceVideoKey,
      },
    });
    res.status(201).json({ block: serializeBlock(copy), source: serializeBlock(updatedSource) });
  },
);

// "Bake" a single block: generate just this clip (face-swapping the template's
// avatar onto the frames when enabled) so the admin can preview it on the
// timeline. Stores the clip on the block and returns the updated block.
adminTemplatesRouter.post(
  "/:id/blocks/:blockId/bake",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    const template = await prisma.template.findFirst({ where: templateScope(req) });
    if (!template) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const block = await prisma.templateBlock.findFirst({
      where: { id: req.params.blockId, templateId: template.id },
    });
    if (!block) {
      res.status(404).json({ error: "Block not found" });
      return;
    }
    if (block.sourceVideoKey) {
      res.status(400).json({ error: "This block uses an uploaded video — there's nothing to bake." });
      return;
    }

    // Resolve the avatar face for this block's slot (avatars belong to the
    // template's creator, so resolve against that user, not the requester).
    const face = await resolveBlockFace(template.avatarIds, block.avatarSlot, template.creatorId);

    // Lip-sync: build the audio under this block from the template's audio clips.
    let lipsyncAudioUrl: string | undefined;
    if (block.lipsync && supportsAudioLipsync(block.model)) {
      const audioClips = await prisma.templateAudioClip.findMany({ where: { templateId: template.id } });
      lipsyncAudioUrl = (await buildBlockLipsyncAudio(audioClips, block)) ?? undefined;
    }

    try {
      // Reuse the admin's approved swap preview (if any) instead of swapping again.
      const clip = await renderBlockClip(block, face, { useSwapCache: true, lipsyncAudioUrl });
      const videoKey = await uploadBuffer(clip.buffer, clip.contentType, "templates/blocks", "mp4");
      const updated = await prisma.templateBlock.update({
        where: { id: block.id },
        data: { videoKey },
      });
      // Linked copies share the same baked clip.
      if (block.linkGroupId) {
        await prisma.templateBlock.updateMany({
          where: { linkGroupId: block.linkGroupId, id: { not: block.id } },
          data: { videoKey },
        });
      }
      res.json(serializeBlock(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to bake block";
      console.error("Block bake failed:", message);
      res.status(502).json({ error: message });
    }
  },
);

// "Generate face swap": run only the face swap on the block's start/end frame(s)
// (for the enabled sides) and cache the result so the admin can review it before
// committing to a full bake. The cached preview is reused by bake/export.
adminTemplatesRouter.post(
  "/:id/blocks/:blockId/swap",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    const template = await prisma.template.findFirst({ where: templateScope(req) });
    if (!template) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const block = await prisma.templateBlock.findFirst({
      where: { id: req.params.blockId, templateId: template.id },
    });
    if (!block) {
      res.status(404).json({ error: "Block not found" });
      return;
    }

    const wantStart = block.faceSwapStart && !!block.startImageKey;
    const wantEnd = block.faceSwapEnd && !!block.endImageKey;
    if (!wantStart && !wantEnd) {
      res.status(400).json({
        error: "Enable a face-swap toggle and set the matching start/end frame first.",
      });
      return;
    }

    const face = await resolveBlockFace(template.avatarIds, block.avatarSlot, template.creatorId);
    if (!face) {
      res.status(400).json({ error: "This block's avatar slot has no avatar assigned." });
      return;
    }

    const sniff = (b: Buffer) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
        ? "image/jpeg"
        : b.length >= 12 && b.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : "image/png";

    const swapSide = async (frameKey: string) => {
      const base = await downloadObject(frameKey);
      const swapped = await applyFaceSwap(face, base, sniff(base), {
        swapModel: block.swapModel,
        context: block.swapContext,
        aspectRatio: block.aspectRatio,
      });
      return uploadBuffer(swapped.buffer, swapped.mime, "templates/swaps", extFromMime(swapped.mime));
    };

    try {
      const data: { swappedStartKey?: string; swappedEndKey?: string } = {};
      if (wantStart) data.swappedStartKey = await swapSide(block.startImageKey!);
      if (wantEnd) data.swappedEndKey = await swapSide(block.endImageKey!);

      const updated = await prisma.templateBlock.update({ where: { id: block.id }, data });
      // Shared content across a link group.
      if (block.linkGroupId) {
        await prisma.templateBlock.updateMany({
          where: { linkGroupId: block.linkGroupId, id: { not: block.id } },
          data,
        });
      }
      res.json(serializeBlock(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate face swap";
      console.error("Face swap generation failed:", message);
      res.status(502).json({ error: message });
    }
  },
);

// Capture a still frame from a source clip (another block's baked/uploaded video)
// at a given clip-time offset, and set it as this block's start/end frame. The
// block's face-swap toggles still apply at render/bake time.
const frameSchema = z.object({
  sourceBlockId: z.string().min(1),
  atSec: z.coerce.number().min(0),
  slot: z.enum(["start", "end"]),
});

adminTemplatesRouter.post(
  "/:id/blocks/:blockId/frame",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;
    const target = await prisma.templateBlock.findFirst({
      where: { id: req.params.blockId, templateId: template.id },
    });
    if (!target) {
      res.status(404).json({ error: "Block not found" });
      return;
    }
    const parsed = frameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const source = await prisma.templateBlock.findFirst({
      where: { id: parsed.data.sourceBlockId, templateId: template.id },
    });
    const sourceKey = source?.sourceVideoKey ?? source?.videoKey;
    if (!source || !sourceKey) {
      res.status(400).json({ error: "The previewed clip has no video to grab a frame from." });
      return;
    }

    try {
      const clip = await downloadObject(sourceKey);
      const frame = await generateThumbnail(clip, parsed.data.atSec);
      const frameKey = await uploadBuffer(frame, "image/jpeg", "templates/frames", "jpg");
      const field = parsed.data.slot === "start" ? "startImageKey" : "endImageKey";
      // Replacing the base frame invalidates that side's cached swap preview.
      const swapField = parsed.data.slot === "start" ? "swappedStartKey" : "swappedEndKey";
      const data = { [field]: frameKey, [swapField]: null };
      const updated = await prisma.templateBlock.update({ where: { id: target.id }, data });
      // The start/end frame is shared content across a link group.
      if (target.linkGroupId) {
        await prisma.templateBlock.updateMany({
          where: { linkGroupId: target.linkGroupId, id: { not: target.id } },
          data,
        });
      }
      res.json(serializeBlock(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to capture frame";
      console.error("Frame capture failed:", message);
      res.status(502).json({ error: message });
    }
  },
);

// ---- Audio clips ----

const audioClipSchema = z.object({
  order: z.coerce.number().int().min(0).optional(),
  startSec: z.coerce.number().min(0).optional(),
  track: z.coerce.number().int().min(0).optional(),
  cropStart: z.coerce.number().min(0).optional(),
  cropEnd: z.coerce.number().min(0).optional(),
});

// Add an audio clip to the timeline. The uploaded file's real length becomes the
// clip's `duration` (probed via ffprobe), so it can be cropped/moved like a clip.
adminTemplatesRouter.post(
  "/:id/audio",
  requireAdmin,
  audioUpload.single("audio"),
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "An audio file is required." });
      return;
    }
    const parsed = audioClipSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    let duration: number;
    try {
      duration = await probeMediaDuration(file.buffer);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid audio upload" });
      return;
    }
    const audioKey = await uploadBuffer(
      file.buffer,
      file.mimetype,
      "templates/audio",
      file.originalname.split(".").pop() ?? "mp3",
    );

    const startSec = parsed.data.startSec ?? 0;
    const { cropStart, cropEnd } = clampCrop(
      parsed.data.cropStart ?? 0,
      parsed.data.cropEnd ?? duration,
      duration,
    );
    const count = await prisma.templateAudioClip.count({ where: { templateId: template.id } });
    const clip = await prisma.templateAudioClip.create({
      data: {
        templateId: template.id,
        order: parsed.data.order ?? count,
        startSec,
        endSec: startSec + (cropEnd - cropStart),
        track: parsed.data.track ?? 0,
        audioKey,
        name: file.originalname,
        duration,
        cropStart,
        cropEnd,
      },
    });
    res.status(201).json(serializeAudioClip(clip));
  },
);

// Update an audio clip's position/crop, or replace its file (resets the crop).
adminTemplatesRouter.patch(
  "/:id/audio/:clipId",
  requireAdmin,
  audioUpload.single("audio"),
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;
    const existing = await prisma.templateAudioClip.findFirst({
      where: { id: req.params.clipId, templateId: template.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Audio clip not found" });
      return;
    }
    const parsed = audioClipSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    // A replaced file re-probes its duration and resets the crop to the full clip.
    let audioKey: string | undefined;
    let newDuration: number | undefined;
    if (req.file) {
      try {
        newDuration = await probeMediaDuration(req.file.buffer);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid audio upload" });
        return;
      }
      audioKey = await uploadBuffer(
        req.file.buffer,
        req.file.mimetype,
        "templates/audio",
        req.file.originalname.split(".").pop() ?? "mp3",
      );
    }

    const duration = newDuration ?? existing.duration;
    const startSec = parsed.data.startSec ?? existing.startSec;
    const { cropStart, cropEnd } = clampCrop(
      newDuration !== undefined ? 0 : parsed.data.cropStart ?? existing.cropStart,
      newDuration !== undefined ? duration : parsed.data.cropEnd ?? existing.cropEnd ?? duration,
      duration,
    );

    const clip = await prisma.templateAudioClip.update({
      where: { id: existing.id },
      data: {
        order: parsed.data.order,
        startSec,
        track: parsed.data.track,
        cropStart,
        cropEnd,
        endSec: startSec + (cropEnd - cropStart),
        ...(audioKey ? { audioKey, duration, name: req.file?.originalname } : {}),
      },
    });
    res.json(serializeAudioClip(clip));
  },
);

adminTemplatesRouter.delete(
  "/:id/audio/:clipId",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    const template = await ownedTemplate(req, res);
    if (!template) return;
    const existing = await prisma.templateAudioClip.findFirst({
      where: { id: req.params.clipId, templateId: template.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Audio clip not found" });
      return;
    }
    await prisma.templateAudioClip.delete({ where: { id: existing.id } });
    res.status(204).end();
  },
);

// ---- Export (render with the template's assigned avatars + publish) ----

adminTemplatesRouter.post("/:id/export", requireAdmin, async (req: AuthedRequest, res) => {
  const template = await prisma.template.findFirst({
    where: templateScope(req),
    include: {
      blocks: { orderBy: { startSec: "asc" } },
      audioClips: { orderBy: { startSec: "asc" } },
    },
  });
  if (!template) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (template.blocks.length === 0) {
    res.status(400).json({ error: "Add at least one video block before exporting." });
    return;
  }
  if (template.avatarIds.length === 0) {
    res.status(400).json({ error: "Assign avatars to this template before exporting." });
    return;
  }

  // The template's avatars belong to its creator (a superadmin may be exporting
  // another admin's template), so resolve + attribute the render to that user.
  const avatars = await prisma.avatar.findMany({
    where: { id: { in: template.avatarIds }, userId: template.creatorId },
  });
  if (avatars.length !== template.avatarIds.length) {
    res.status(400).json({ error: "One or more of the template's avatars were not found." });
    return;
  }
  // Preserve slot order from the template.
  const orderedAvatars = template.avatarIds.map((id) => avatars.find((a) => a.id === id)!);

  const render = await prisma.templateRender.create({
    data: {
      templateId: template.id,
      userId: template.creatorId,
      avatarIds: template.avatarIds,
      avatars: { connect: template.avatarIds.map((id) => ({ id })) },
      status: "IN_PROGRESS",
    },
  });

  try {
    const { videoKey, thumbnailKey } = await runAndStoreRender({
      renderId: render.id,
      blocks: template.blocks,
      orderedAvatars,
      audioClips: template.audioClips,
      aiThumbnail: true, // export → AI-generate the cover thumbnail (avatar as reference)
      thumbnailPrompt: template.thumbnailPrompt,
    });

    const updated = await prisma.template.update({
      where: { id: template.id },
      data: { published: true, previewVideoKey: videoKey, thumbnailKey },
      include: {
        blocks: { orderBy: { startSec: "asc" } },
        audioClips: { orderBy: { startSec: "asc" } },
      },
    });
    res.json(serializeTemplate(updated));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template export failed";
    const failed = await prisma.templateRender.findUnique({ where: { id: render.id } });
    res.status(502).json({ error: message, render: failed ? serializeRender(failed) : null });
  }
});
