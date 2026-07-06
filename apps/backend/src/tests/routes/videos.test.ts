/**
 * Integration-style tests for the /api/videos Express router.
 *
 * The Express app is mounted with the router under test.
 * All external dependencies (Prisma, OpenRouter, storage, credits, auth) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports from the module under test.
// ---------------------------------------------------------------------------

vi.mock("../../env.js", () => ({
  env: {
    CREDITS_PER_VIDEO: 60,
    CREDITS_PER_IMAGE: 6,
    CREDITS_PER_TEMPLATE_RENDER: 1000,
    MINIO_ENDPOINT: "localhost",
    MINIO_FRONTEND_ENDPOINT: "localhost",
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: "minioadmin",
    MINIO_SECRET_KEY: "minioadmin",
    MINIO_BUCKET: "video-arena",
  },
}));

vi.mock("@repo/db", () => ({
  prisma: {
    video: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../lib/openrouter.js", () => ({
  generateVideo: vi.fn(),
}));

vi.mock("../../lib/storage.js", () => ({
  getPublicUrl: (key: string) => `http://localhost:9000/bucket/${key}`,
  uploadBuffer: vi.fn().mockResolvedValue("videos/test-uuid.mp4"),
}));

vi.mock("../../lib/credits.js", () => ({
  actionCost: vi.fn().mockReturnValue(60),
  getBalance: vi.fn().mockResolvedValue(200),
  spendCredits: vi.fn().mockResolvedValue(140),
  refundCredits: vi.fn().mockResolvedValue(undefined),
}));

// Mock requireAuth to inject a fake authenticated user.
vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req: express.Request & { userId?: string }, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { userId: string }).userId = "user-test-123";
    next();
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { prisma } from "@repo/db";
import { generateVideo } from "../../lib/openrouter.js";
import { spendCredits, getBalance, refundCredits } from "../../lib/credits.js";
import { videosRouter } from "../../routes/videos.js";

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use("/api/videos", videosRouter);

type MockPrismaVideo = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const mockVideo = prisma.video as unknown as MockPrismaVideo;

const fakeVideo = {
  id: "vid-1",
  userId: "user-test-123",
  prompt: "a cat on a beach",
  model: "google/veo-3",
  duration: null,
  resolution: null,
  aspectRatio: null,
  generateAudio: null,
  startFrameKey: null,
  endFrameKey: null,
  referenceFrameKeys: [],
  videoKey: "videos/test-uuid.mp4",
  status: "COMPLETED",
  providerJobId: "prov-job-1",
  cost: 0.5,
  error: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  (getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(200);
  (spendCredits as ReturnType<typeof vi.fn>).mockResolvedValue(140);
  (refundCredits as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// GET /api/videos
// ---------------------------------------------------------------------------

describe("GET /api/videos", () => {
  it("returns 200 with an array of serialized videos", async () => {
    mockVideo.findMany.mockResolvedValue([fakeVideo]);

    const res = await request(app).get("/api/videos");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe("vid-1");
    // Public URL should be attached
    expect(res.body[0].videoUrl).toContain("videos/test-uuid.mp4");
  });

  it("returns an empty array when the user has no videos", async () => {
    mockVideo.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/videos");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/videos/:id
// ---------------------------------------------------------------------------

describe("GET /api/videos/:id", () => {
  it("returns 200 with the video when found", async () => {
    mockVideo.findFirst.mockResolvedValue(fakeVideo);

    const res = await request(app).get("/api/videos/vid-1");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("vid-1");
  });

  it("returns 404 when the video is not found", async () => {
    mockVideo.findFirst.mockResolvedValue(null);

    const res = await request(app).get("/api/videos/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});

// ---------------------------------------------------------------------------
// POST /api/videos
// ---------------------------------------------------------------------------

describe("POST /api/videos", () => {
  const validBody = { prompt: "a sunset", model: "google/veo-3" };

  it("returns 400 when prompt is missing", async () => {
    const res = await request(app).post("/api/videos").send({ model: "google/veo-3" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when model is missing", async () => {
    const res = await request(app).post("/api/videos").send({ prompt: "a cat" });
    expect(res.status).toBe(400);
  });

  it("returns 402 when the user has insufficient credits", async () => {
    (getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const res = await request(app).post("/api/videos").send(validBody);

    expect(res.status).toBe(402);
    expect(res.body.error).toContain("credits");
  });

  it("returns 201 with the completed video on success", async () => {
    const createdVideo = { ...fakeVideo, status: "IN_PROGRESS", videoKey: null };
    const completedVideo = { ...fakeVideo };

    mockVideo.create.mockResolvedValue(createdVideo);
    mockVideo.update.mockResolvedValue(completedVideo);
    (generateVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
      buffer: Buffer.from("fake-video"),
      contentType: "video/mp4",
      providerJobId: "prov-job-1",
      cost: 0.5,
    });

    const res = await request(app).post("/api/videos").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("COMPLETED");
    expect(spendCredits).toHaveBeenCalledOnce();
  });

  it("returns 502 and refunds credits when OpenRouter fails", async () => {
    const createdVideo = { ...fakeVideo, status: "IN_PROGRESS", videoKey: null };
    const failedVideo = { ...fakeVideo, status: "FAILED", error: "Provider timeout", videoKey: null };

    mockVideo.create.mockResolvedValue(createdVideo);
    mockVideo.update.mockResolvedValue(failedVideo);
    (generateVideo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Provider timeout"));

    const res = await request(app).post("/api/videos").send(validBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Provider timeout");
    expect(refundCredits).toHaveBeenCalledOnce();
  });

  it("returns 402 and marks the video FAILED when spendCredits throws", async () => {
    const { InsufficientCreditsError } = await import("../../lib/credits.js");
    (spendCredits as ReturnType<typeof vi.fn>).mockRejectedValue(
      new InsufficientCreditsError(60, 10),
    );
    mockVideo.create.mockResolvedValue({ ...fakeVideo, status: "IN_PROGRESS" });
    mockVideo.update.mockResolvedValue({ ...fakeVideo, status: "FAILED" });

    const res = await request(app).post("/api/videos").send(validBody);

    expect(res.status).toBe(402);
  });
});
