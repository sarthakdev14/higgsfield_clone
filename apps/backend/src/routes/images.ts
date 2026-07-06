import { Router } from "express";
import { z } from "zod";
import { prisma, type Image } from "@repo/db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { generateImage } from "../lib/openrouter.js";
import { getPublicUrl, uploadBuffer } from "../lib/storage.js";
import { extFromMime, toDataUrl, upload } from "../lib/uploads.js";
import { actionCost, getBalance, refundCredits, spendCredits } from "../lib/credits.js";

export const imagesRouter: Router = Router();

const createSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  model: z.string().min(1, "Model is required"),
  resolution: z.string().optional(),
  aspectRatio: z.string().optional(),
});

/** Serialize an Image row, attaching public URLs for stored objects. */
function serializeImage(image: Image) {
  return {
    ...image,
    imageUrl: image.imageKey ? getPublicUrl(image.imageKey) : null,
    referenceImageUrls: image.referenceImageKeys.map(getPublicUrl),
  };
}

// List the current user's images.
imagesRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const images = await prisma.image.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(images.map(serializeImage));
});

// Fetch a single image owned by the current user.
imagesRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const image = await prisma.image.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!image) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeImage(image));
});

// Create an image: upload optional references, call OpenRouter, store output.
imagesRouter.post(
  "/",
  requireAuth,
  upload.fields([{ name: "referenceImages", maxCount: 8 }]),
  async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { prompt, model, resolution, aspectRatio } = parsed.data;

    // Credits: fixed price per image. Reject up front if unaffordable.
    const cost = actionCost("image");
    if ((await getBalance(req.userId!)) < cost) {
      res.status(402).json({ error: `Not enough credits. This image costs ${cost} credits.` });
      return;
    }

    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const referenceImages = files.referenceImages ?? [];

    // 1. Persist uploaded reference inputs to the object store.
    const referenceImageKeys = await Promise.all(
      referenceImages.map((f) => uploadBuffer(f.buffer, f.mimetype, "inputs", extFromMime(f.mimetype))),
    );

    // 2. Create the DB record up front.
    const image = await prisma.image.create({
      data: {
        userId: req.userId!,
        prompt,
        model,
        resolution,
        aspectRatio,
        referenceImageKeys,
        status: "IN_PROGRESS",
      },
    });

    // 2b. Charge credits now that the row exists (refunded on failure below).
    try {
      await spendCredits(req.userId!, cost, {
        referenceType: "image",
        referenceId: image.id,
        description: "Image generation",
      });
    } catch {
      await prisma.image.update({
        where: { id: image.id },
        data: { status: "FAILED", error: "Not enough credits." },
      });
      res.status(402).json({ error: `Not enough credits. This image costs ${cost} credits.` });
      return;
    }

    // 3. Generate synchronously via OpenRouter, then store the output.
    try {
      const generated = await generateImage({
        model,
        prompt,
        resolution,
        aspectRatio,
        references: referenceImages.map((f) => ({ url: toDataUrl(f) })),
      });

      const ext = extFromMime(generated.contentType);
      const imageKey = await uploadBuffer(generated.buffer, generated.contentType, "images", ext);

      const updated = await prisma.image.update({
        where: { id: image.id },
        data: { status: "COMPLETED", imageKey, cost: generated.cost },
      });
      res.status(201).json(serializeImage(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Image generation failed";
      console.error("Image generation failed:", message);
      await refundCredits(req.userId!, cost, {
        referenceType: "image",
        referenceId: image.id,
        description: "Refund: image generation failed",
      });
      const failed = await prisma.image.update({
        where: { id: image.id },
        data: { status: "FAILED", error: message },
      });
      res.status(502).json({ error: message, image: serializeImage(failed) });
    }
  },
);
