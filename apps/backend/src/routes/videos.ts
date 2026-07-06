import { Router } from "express";
import { z } from "zod";
import { prisma, type Video } from "@repo/db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { generateVideo } from "../lib/openrouter.js";
import { getPublicUrl, uploadBuffer } from "../lib/storage.js";
import { extFromMime, toDataUrl, upload } from "../lib/uploads.js";
import { actionCost, getBalance, refundCredits, spendCredits } from "../lib/credits.js";

export const videosRouter: Router = Router();

const createSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  model: z.string().min(1, "Model is required"),
  duration: z.coerce.number().int().positive().optional(),
  resolution: z.string().optional(),
  aspectRatio: z.string().optional(),
  generateAudio: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

type UploadedFiles = Record<string, Express.Multer.File[] | undefined>;

/** Serialize a Video row, attaching public URLs for stored objects. */
function serializeVideo(video: Video) {
  return {
    ...video,
    videoUrl: video.videoKey ? getPublicUrl(video.videoKey) : null,
    startFrameUrl: video.startFrameKey ? getPublicUrl(video.startFrameKey) : null,
    endFrameUrl: video.endFrameKey ? getPublicUrl(video.endFrameKey) : null,
    referenceFrameUrls: video.referenceFrameKeys.map(getPublicUrl),
  };
}

// List the current user's videos.
videosRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const videos = await prisma.video.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(videos.map(serializeVideo));
});

// Fetch a single video owned by the current user.
videosRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const video = await prisma.video.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!video) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeVideo(video));
});

// Create a video: upload inputs, call OpenRouter synchronously, store output.
videosRouter.post(
  "/",
  requireAuth,
  upload.fields([
    { name: "startFrame", maxCount: 1 },
    { name: "endFrame", maxCount: 1 },
    { name: "referenceFrames", maxCount: 8 },
  ]),
  async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { prompt, model, duration, resolution, aspectRatio, generateAudio } = parsed.data;

    // Credits: fixed price per video. Reject up front if the user can't afford it
    // (avoids wasting input uploads), then charge once the row exists.
    const cost = actionCost("video");
    if ((await getBalance(req.userId!)) < cost) {
      res.status(402).json({ error: `Not enough credits. This video costs ${cost} credits.` });
      return;
    }

    const files = (req.files ?? {}) as UploadedFiles;
    const startFrame = files.startFrame?.[0];
    const endFrame = files.endFrame?.[0];
    const referenceFrames = files.referenceFrames ?? [];

    // 1. Persist uploaded input images to the object store.
    const [startFrameKey, endFrameKey, referenceFrameKeys] = await Promise.all([
      startFrame
        ? uploadBuffer(startFrame.buffer, startFrame.mimetype, "inputs", extFromMime(startFrame.mimetype))
        : Promise.resolve<string | undefined>(undefined),
      endFrame
        ? uploadBuffer(endFrame.buffer, endFrame.mimetype, "inputs", extFromMime(endFrame.mimetype))
        : Promise.resolve<string | undefined>(undefined),
      Promise.all(
        referenceFrames.map((f) => uploadBuffer(f.buffer, f.mimetype, "inputs", extFromMime(f.mimetype))),
      ),
    ]);

    // 2. Create the DB record up front.
    const video = await prisma.video.create({
      data: {
        userId: req.userId!,
        prompt,
        model,
        duration,
        resolution,
        aspectRatio,
        generateAudio,
        startFrameKey,
        endFrameKey,
        referenceFrameKeys,
        status: "IN_PROGRESS",
      },
    });

    // 2b. Charge credits now that we have a row to reference. A race could make
    // this fail even after the up-front check; if so, mark the row failed + 402.
    try {
      await spendCredits(req.userId!, cost, {
        referenceType: "video",
        referenceId: video.id,
        description: "Video generation",
      });
    } catch {
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "FAILED", error: "Not enough credits." },
      });
      res.status(402).json({ error: `Not enough credits. This video costs ${cost} credits.` });
      return;
    }

    // 3. Generate synchronously via OpenRouter, then store the output.
    try {
      const generated = await generateVideo({
        model,
        prompt,
        duration,
        resolution,
        aspectRatio,
        generateAudio,
        firstFrame: startFrame ? { url: toDataUrl(startFrame) } : undefined,
        lastFrame: endFrame ? { url: toDataUrl(endFrame) } : undefined,
        references: referenceFrames.map((f) => ({ url: toDataUrl(f) })),
      });

      const videoKey = await uploadBuffer(generated.buffer, generated.contentType, "videos", "mp4");

      const updated = await prisma.video.update({
        where: { id: video.id },
        data: {
          status: "COMPLETED",
          videoKey,
          providerJobId: generated.providerJobId,
          cost: generated.cost,
        },
      });
      res.status(201).json(serializeVideo(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Video generation failed";
      console.error("Video generation failed:", message);
      // Refund the credits we charged — the user got nothing.
      await refundCredits(req.userId!, cost, {
        referenceType: "video",
        referenceId: video.id,
        description: "Refund: video generation failed",
      });
      const failed = await prisma.video.update({
        where: { id: video.id },
        data: { status: "FAILED", error: message },
      });
      res.status(502).json({ error: message, video: serializeVideo(failed) });
    }
  },
);
