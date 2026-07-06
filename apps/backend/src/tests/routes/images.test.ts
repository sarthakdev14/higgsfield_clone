/**
 * Integration-style tests for the /api/images Express router.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

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
    image: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../lib/openrouter.js", () => ({
  generateImage: vi.fn(),
}));

vi.mock("../../lib/storage.js", () => ({
  getPublicUrl: (key: string) => `http://localhost:9000/bucket/${key}`,
  uploadBuffer: vi.fn().mockResolvedValue("images/test-uuid.png"),
}));

vi.mock("../../lib/credits.js", () => ({
  actionCost: vi.fn().mockReturnValue(6),
  getBalance: vi.fn().mockResolvedValue(100),
  spendCredits: vi.fn().mockResolvedValue(94),
  refundCredits: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req: express.Request & { userId?: string }, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { userId: string }).userId = "user-test-123";
    next();
  },
}));

import { prisma } from "@repo/db";
import { generateImage } from "../../lib/openrouter.js";
import { getBalance, spendCredits, refundCredits } from "../../lib/credits.js";
import { imagesRouter } from "../../routes/images.js";

const app = express();
app.use(express.json());
app.use("/api/images", imagesRouter);

type MockPrismaImage = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const mockImage = prisma.image as unknown as MockPrismaImage;

const fakeImage = {
  id: "img-1",
  userId: "user-test-123",
  prompt: "a mountain landscape",
  model: "flux",
  resolution: null,
  aspectRatio: null,
  referenceImageKeys: [],
  imageKey: "images/test-uuid.png",
  status: "COMPLETED",
  providerJobId: null,
  cost: 0.05,
  error: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  (getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(100);
  (spendCredits as ReturnType<typeof vi.fn>).mockResolvedValue(94);
  (refundCredits as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// GET /api/images
// ---------------------------------------------------------------------------

describe("GET /api/images", () => {
  it("returns 200 with an array of serialized images", async () => {
    mockImage.findMany.mockResolvedValue([fakeImage]);

    const res = await request(app).get("/api/images");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe("img-1");
    expect(res.body[0].imageUrl).toContain("images/test-uuid.png");
  });

  it("returns an empty array when the user has no images", async () => {
    mockImage.findMany.mockResolvedValue([]);
    const res = await request(app).get("/api/images");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/images/:id
// ---------------------------------------------------------------------------

describe("GET /api/images/:id", () => {
  it("returns 200 with the image when found", async () => {
    mockImage.findFirst.mockResolvedValue(fakeImage);
    const res = await request(app).get("/api/images/img-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("img-1");
  });

  it("returns 404 when the image is not found", async () => {
    mockImage.findFirst.mockResolvedValue(null);
    const res = await request(app).get("/api/images/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});

// ---------------------------------------------------------------------------
// POST /api/images
// ---------------------------------------------------------------------------

describe("POST /api/images", () => {
  const validBody = { prompt: "a mountain", model: "flux" };

  it("returns 400 when prompt is missing", async () => {
    const res = await request(app).post("/api/images").send({ model: "flux" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when model is missing", async () => {
    const res = await request(app).post("/api/images").send({ prompt: "a cat" });
    expect(res.status).toBe(400);
  });

  it("returns 402 when balance is insufficient", async () => {
    (getBalance as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const res = await request(app).post("/api/images").send(validBody);
    expect(res.status).toBe(402);
    expect(res.body.error).toContain("credits");
  });

  it("returns 201 with the completed image on success", async () => {
    const createdImage = { ...fakeImage, status: "IN_PROGRESS", imageKey: null };
    const completedImage = { ...fakeImage };

    mockImage.create.mockResolvedValue(createdImage);
    mockImage.update.mockResolvedValue(completedImage);
    (generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      buffer: Buffer.from("fake-image"),
      contentType: "image/png",
      cost: 0.05,
    });

    const res = await request(app).post("/api/images").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("COMPLETED");
    expect(spendCredits).toHaveBeenCalledOnce();
  });

  it("returns 502 and refunds credits when image generation fails", async () => {
    const createdImage = { ...fakeImage, status: "IN_PROGRESS", imageKey: null };
    const failedImage = { ...fakeImage, status: "FAILED", error: "AI error", imageKey: null };

    mockImage.create.mockResolvedValue(createdImage);
    mockImage.update.mockResolvedValue(failedImage);
    (generateImage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("AI error"));

    const res = await request(app).post("/api/images").send(validBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("AI error");
    expect(refundCredits).toHaveBeenCalledOnce();
  });
});
