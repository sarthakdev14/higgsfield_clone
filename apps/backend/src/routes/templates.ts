import { Router } from "express";
import { z } from "zod";
import { prisma } from "@repo/db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { runAndStoreRender } from "../lib/runRender.js";
import { serializeRender, serializeTemplate } from "../lib/templateSerialize.js";
import { actionCost, getBalance, refundCredits, spendCredits } from "../lib/credits.js";

export const templatesRouter: Router = Router();
export const templateRendersRouter: Router = Router();

// ---- Templates (published, read-only for users) ----

// List all published templates.
templatesRouter.get("/", requireAuth, async (_req, res) => {
  const templates = await prisma.template.findMany({
    where: { published: true },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { blocks: true } } },
  });
  res.json(
    templates.map((t) => ({
      ...serializeTemplate(t),
      blockCount: t._count.blocks,
    })),
  );
});

// A single published template.
templatesRouter.get("/:id", requireAuth, async (req, res) => {
  const template = await prisma.template.findFirst({
    where: { id: req.params.id, published: true },
    include: { _count: { select: { blocks: true } } },
  });
  if (!template) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ...serializeTemplate(template), blockCount: template._count.blocks });
});

// The current user's renders of a given template.
templatesRouter.get("/:id/renders", requireAuth, async (req: AuthedRequest, res) => {
  const renders = await prisma.templateRender.findMany({
    where: { templateId: req.params.id, userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(renders.map(serializeRender));
});

const renderSchema = z.object({
  avatarIds: z.array(z.string()).min(1).max(2),
});

// Generate a personalised video from a template using the user's own avatars.
templatesRouter.post("/:id/render", requireAuth, async (req: AuthedRequest, res) => {
  const template = await prisma.template.findFirst({
    where: { id: req.params.id, published: true },
    include: {
      blocks: { orderBy: { startSec: "asc" } },
      audioClips: { orderBy: { startSec: "asc" } },
    },
  });
  if (!template) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = renderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  if (template.blocks.length === 0) {
    res.status(400).json({ error: "This template has no video blocks." });
    return;
  }
  if (parsed.data.avatarIds.length !== template.avatarSlots) {
    res.status(400).json({ error: `This template needs exactly ${template.avatarSlots} avatar(s).` });
    return;
  }

  const avatars = await prisma.avatar.findMany({
    where: { id: { in: parsed.data.avatarIds }, userId: req.userId },
  });
  if (avatars.length !== parsed.data.avatarIds.length) {
    res.status(400).json({ error: "One or more selected avatars were not found." });
    return;
  }
  const orderedAvatars = parsed.data.avatarIds.map((id) => avatars.find((a) => a.id === id)!);

  // Credits: fixed price per template render. Reject up front if unaffordable.
  const cost = actionCost("template_render");
  if ((await getBalance(req.userId!)) < cost) {
    res.status(402).json({ error: `Not enough credits. A render costs ${cost} credits.` });
    return;
  }

  const render = await prisma.templateRender.create({
    data: {
      templateId: template.id,
      userId: req.userId!,
      avatarIds: parsed.data.avatarIds,
      avatars: { connect: parsed.data.avatarIds.map((id) => ({ id })) },
      status: "IN_PROGRESS",
    },
  });

  // Charge now that the render row exists; the background task refunds on failure.
  try {
    await spendCredits(req.userId!, cost, {
      referenceType: "template_render",
      referenceId: render.id,
      description: "Template render",
    });
  } catch {
    await prisma.templateRender.update({
      where: { id: render.id },
      data: { status: "FAILED", error: "Not enough credits." },
    });
    res.status(402).json({ error: `Not enough credits. A render costs ${cost} credits.` });
    return;
  }

  // Seed a progress row per block (in timeline order) so the live /generation/:id
  // page can show every block — starting QUEUED — the moment the user lands there.
  await prisma.templateRenderBlock.createMany({
    data: template.blocks.map((b, i) => ({
      renderId: render.id,
      blockId: b.id,
      order: i,
      startSec: b.startSec,
      endSec: b.endSec,
      label: b.sourceVideoKey
        ? "Uploaded clip"
        : b.prompt?.trim()
          ? b.prompt.trim().slice(0, 80)
          : `Clip ${i + 1}`,
      phase: "QUEUED",
    })),
  });

  // Run the render in the background and return immediately — the render takes
  // many minutes, so the client navigates to /generation/:id and polls for
  // progress instead of holding a long-lived request open.
  void runAndStoreRender({
    renderId: render.id,
    blocks: template.blocks,
    orderedAvatars,
    audioClips: template.audioClips,
    // Same as export: AI cover thumbnail from the template's description, with
    // the USER's avatar passed as the reference image so the actor appears.
    aiThumbnail: true,
    thumbnailPrompt: template.thumbnailPrompt,
    forceRegenerate: true,
    trackProgress: true,
  }).catch(async (err) => {
    console.error("Background template render failed:", err instanceof Error ? err.message : err);
    // The user got no video — refund the render's credits.
    await refundCredits(req.userId!, cost, {
      referenceType: "template_render",
      referenceId: render.id,
      description: "Refund: template render failed",
    }).catch((e) => console.error("Render refund failed:", e instanceof Error ? e.message : e));
  });

  res.status(201).json(serializeRender(render));
});

// ---- Renders (the user's generated template videos) ----

// List all of the current user's template renders, newest first.
templateRendersRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const renders = await prisma.templateRender.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } } },
  });
  res.json(
    renders.map((r) => ({ ...serializeRender(r), templateName: r.template.name })),
  );
});

// A single render owned by the user, with per-block progress (for /generation/:id).
templateRendersRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const render = await prisma.templateRender.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: {
      template: { select: { name: true } },
      blocks: { orderBy: { order: "asc" } },
    },
  });
  if (!render) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ...serializeRender(render), templateName: render.template.name });
});

// Retry a failed render IN PLACE: keep blocks that already completed (their clips
// are reused) and re-run only the rest. Resumes the same render id.
templateRendersRouter.post("/:id/retry", requireAuth, async (req: AuthedRequest, res) => {
  const render = await prisma.templateRender.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!render) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (render.status === "IN_PROGRESS") {
    res.status(409).json({ error: "This render is still in progress." });
    return;
  }

  const template = await prisma.template.findFirst({
    where: { id: render.templateId, published: true },
    include: {
      blocks: { orderBy: { startSec: "asc" } },
      audioClips: { orderBy: { startSec: "asc" } },
    },
  });
  if (!template || template.blocks.length === 0) {
    res.status(400).json({ error: "This template is no longer available." });
    return;
  }

  // The render's avatars must still exist and belong to the user.
  const avatars = await prisma.avatar.findMany({
    where: { id: { in: render.avatarIds }, userId: req.userId },
  });
  if (avatars.length !== render.avatarIds.length) {
    res.status(400).json({ error: "One or more of this render's avatars no longer exist." });
    return;
  }
  const orderedAvatars = render.avatarIds.map((id) => avatars.find((a) => a.id === id)!);

  // Credits: a FAILED render was already refunded, so retrying it re-charges.
  // (Retrying a COMPLETED render reuses the existing paid result — no charge.)
  const cost = actionCost("template_render");
  const shouldCharge = render.status === "FAILED";
  if (shouldCharge && (await getBalance(req.userId!)) < cost) {
    res.status(402).json({ error: `Not enough credits. A render costs ${cost} credits.` });
    return;
  }

  // Reset the render + only the blocks that didn't already complete (completed
  // ones keep their stored clip and are reused by runAndStoreRender's resume map).
  await prisma.templateRender.update({
    where: { id: render.id },
    data: { status: "IN_PROGRESS", error: null },
  });

  if (shouldCharge) {
    try {
      await spendCredits(req.userId!, cost, {
        referenceType: "template_render",
        referenceId: render.id,
        description: "Template render (retry)",
      });
    } catch {
      await prisma.templateRender.update({
        where: { id: render.id },
        data: { status: "FAILED", error: "Not enough credits." },
      });
      res.status(402).json({ error: `Not enough credits. A render costs ${cost} credits.` });
      return;
    }
  }
  await prisma.templateRenderBlock.updateMany({
    where: { renderId: render.id, phase: { not: "COMPLETED" } },
    data: { phase: "QUEUED", attempt: 0, error: null },
  });

  void runAndStoreRender({
    renderId: render.id,
    blocks: template.blocks,
    orderedAvatars,
    audioClips: template.audioClips,
    aiThumbnail: true,
    thumbnailPrompt: template.thumbnailPrompt,
    forceRegenerate: true,
    trackProgress: true,
  }).catch(async (err) => {
    console.error("Background template retry failed:", err instanceof Error ? err.message : err);
    if (shouldCharge) {
      await refundCredits(req.userId!, cost, {
        referenceType: "template_render",
        referenceId: render.id,
        description: "Refund: template render failed",
      }).catch((e) => console.error("Render refund failed:", e instanceof Error ? e.message : e));
    }
  });

  const updated = await prisma.templateRender.findUnique({
    where: { id: render.id },
    include: { template: { select: { name: true } }, blocks: { orderBy: { order: "asc" } } },
  });
  res.json({ ...serializeRender(updated!), templateName: updated!.template.name });
});
