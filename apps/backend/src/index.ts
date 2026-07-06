import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { prisma } from "@repo/db";
import { env } from "./env.js";
import { auth } from "./auth.js";
import { ensureBucket } from "./lib/storage.js";
import { videosRouter } from "./routes/videos.js";
import { imagesRouter } from "./routes/images.js";
import { faceSwapsRouter } from "./routes/faceswaps.js";
import { modelsRouter } from "./routes/models.js";
import { meRouter } from "./routes/me.js";
import { avatarsRouter } from "./routes/avatars.js";
import { templatesRouter, templateRendersRouter } from "./routes/templates.js";
import { adminTemplatesRouter } from "./routes/adminTemplates.js";
import { creditsRouter, creditsWebhookHandler } from "./routes/credits.js";
import { uploadErrorHandler } from "./lib/uploads.js";

const app = express();

app.use(
  cors({
    // env.FRONTEND_URL is a list of allowed origins (multiple domains).
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);

// Better-auth handler must be mounted BEFORE express.json().
app.all("/api/auth/*", toNodeHandler(auth));

// The Razorpay webhook must verify the signature against the raw request bytes,
// so it needs the raw body and must be mounted BEFORE express.json().
app.post(
  "/api/credits/webhook",
  express.raw({ type: "*/*" }),
  creditsWebhookHandler,
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/videos", videosRouter);
app.use("/api/images", imagesRouter);
app.use("/api/faceswaps", faceSwapsRouter);
app.use("/api/models", modelsRouter);
app.use("/api/me", meRouter);
app.use("/api/avatars", avatarsRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/template-renders", templateRendersRouter);
app.use("/api/admin/templates", adminTemplatesRouter);
app.use("/api/credits", creditsRouter);

// Turn multer upload failures into clean 400s (mounted after all routers).
app.use(uploadErrorHandler);

/**
 * Template renders run in this process (a detached background task), so any
 * restart/crash/redeploy orphans an in-flight render — it can never resume and
 * would otherwise sit at IN_PROGRESS forever. On boot, mark any such renders (and
 * their non-terminal blocks) FAILED so they surface a clear error + Retry option.
 */
async function failOrphanedRenders() {
  try {
    const orphaned = await prisma.templateRender.findMany({
      where: { status: "IN_PROGRESS" },
      select: { id: true },
    });
    if (orphaned.length === 0) return;
    const ids = orphaned.map((r) => r.id);
    await prisma.templateRender.updateMany({
      where: { id: { in: ids } },
      data: { status: "FAILED", error: "Render was interrupted by a server restart. Please try again." },
    });
    await prisma.templateRenderBlock.updateMany({
      where: {
        renderId: { in: ids },
        phase: { in: ["QUEUED", "FACE_SWAP", "VIDEO_GENERATION", "RETRYING", "STITCHING"] },
      },
      data: { phase: "FAILED", error: "Interrupted by server restart" },
    });
    console.log(`↺ Marked ${ids.length} interrupted render(s) as failed on startup.`);
  } catch (err) {
    console.error("⚠️  Could not reconcile interrupted renders:", err instanceof Error ? err.message : err);
  }
}

async function start() {
  await ensureBucket().catch((err) => {
    console.error("⚠️  Could not ensure object-store bucket exists:", err.message);
  });
  await failOrphanedRenders();
  app.listen(env.PORT, () => {
    console.log(`🚀 Backend listening on ${env.BACKEND_URL} (port ${env.PORT}) Started`);
  });
}

start();
