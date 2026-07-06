import { Router } from "express";
import { z } from "zod";
import { prisma, type Avatar } from "@repo/db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { getPublicUrl, uploadBuffer } from "../lib/storage.js";
import { extFromMime, upload } from "../lib/uploads.js";

export const avatarsRouter: Router = Router();

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

/** Serialize an Avatar row, attaching public URLs for stored objects. */
export function serializeAvatar(avatar: Avatar) {
  return {
    ...avatar,
    faceUrl: avatar.faceKey ? getPublicUrl(avatar.faceKey) : null,
    sourceImageUrls: avatar.sourceImageKeys.map(getPublicUrl),
  };
}

// List the current user's avatars.
avatarsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const avatars = await prisma.avatar.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(avatars.map(serializeAvatar));
});

// Fetch a single avatar owned by the current user.
avatarsRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const avatar = await prisma.avatar.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!avatar) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeAvatar(avatar));
});

// Create an avatar from 1-2 photos. The first photo becomes the primary face
// image used for face swaps + references when rendering templates.
avatarsRouter.post(
  "/",
  requireAuth,
  upload.fields([{ name: "images", maxCount: 2 }]),
  async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const images = files.images ?? [];
    if (images.length < 1) {
      res.status(400).json({ error: "At least one photo is required." });
      return;
    }

    const sourceImageKeys = await Promise.all(
      images.map((f) => uploadBuffer(f.buffer, f.mimetype, "avatars", extFromMime(f.mimetype))),
    );

    const avatar = await prisma.avatar.create({
      data: {
        userId: req.userId!,
        name: parsed.data.name,
        sourceImageKeys,
        faceKey: sourceImageKeys[0],
        status: "COMPLETED",
      },
    });
    res.status(201).json(serializeAvatar(avatar));
  },
);

// Delete an avatar owned by the current user.
avatarsRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const avatar = await prisma.avatar.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!avatar) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.avatar.delete({ where: { id: avatar.id } });
  res.status(204).end();
});
