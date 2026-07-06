/**
 * Integration-style tests for the /api/credits Express router.
 *
 * Covers the balance endpoint, packs listing, checkout, verify, and the
 * Razorpay webhook handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../env.js", () => ({
  env: {
    RAZORPAY_KEY_ID: "rzp_test_id",
    RAZORPAY_KEY_SECRET: "test_secret",
    RAZORPAY_WEBHOOK_SECRET: "wh_secret",
    CREDITS_PER_VIDEO: 60,
    CREDITS_PER_IMAGE: 6,
    CREDITS_PER_TEMPLATE_RENDER: 1000,
  },
}));

vi.mock("@repo/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    creditTransaction: { findMany: vi.fn() },
    payment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../../lib/razorpay.js", () => ({
  isRazorpayConfigured: vi.fn().mockReturnValue(true),
  createOrder: vi.fn(),
  verifyPaymentSignature: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}));

vi.mock("../../lib/credits.js", () => ({
  CREDIT_PACKS: [
    { id: "starter", name: "Starter", description: "Try", priceInr: 499, amountPaise: 49900, baseCredits: 500, bonusCredits: 0 },
  ],
  actionCost: vi.fn().mockImplementation((action: string) => ({ video: 60, image: 6, template_render: 1000 }[action])),
  findPack: vi.fn(),
  packTotalCredits: vi.fn().mockReturnValue(500),
  addCredits: vi.fn().mockResolvedValue(500),
}));

vi.mock("../../middleware/requireAuth.js", () => ({
  requireAuth: (req: Request & { userId?: string }, _res: Response, next: express.NextFunction) => {
    (req as unknown as { userId: string }).userId = "user-test-123";
    next();
  },
}));

import { prisma } from "@repo/db";
import { createOrder, verifyPaymentSignature, verifyWebhookSignature, isRazorpayConfigured } from "../../lib/razorpay.js";
import { findPack, addCredits } from "../../lib/credits.js";
import { creditsRouter, creditsWebhookHandler } from "../../routes/credits.js";

const app = express();
app.use(express.json());
app.use("/api/credits", creditsRouter);
// Webhook needs raw body
app.post("/api/credits/webhook", express.raw({ type: "*/*" }), creditsWebhookHandler);

type MockPrismaUser = { findUnique: ReturnType<typeof vi.fn> };
type MockPrismaPayment = {
  create: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
};

const mockUser = prisma.user as unknown as MockPrismaUser;
const mockPayment = prisma.payment as unknown as MockPrismaPayment;
const mockCreditTransaction = prisma.creditTransaction as unknown as { findMany: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  (isRazorpayConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// GET /api/credits — balance + recent transactions
// ---------------------------------------------------------------------------

describe("GET /api/credits", () => {
  it("returns the user balance and transactions", async () => {
    mockUser.findUnique.mockResolvedValue({ credits: 350 });
    mockCreditTransaction.findMany.mockResolvedValue([
      { id: "t1", type: "PURCHASE", amount: 500, balanceAfter: 500, createdAt: new Date() },
    ]);

    const res = await request(app).get("/api/credits");

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(350);
    expect(res.body.transactions).toHaveLength(1);
  });

  it("returns 0 balance when user is not found", async () => {
    mockUser.findUnique.mockResolvedValue(null);
    mockCreditTransaction.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/credits");

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/credits/packs
// ---------------------------------------------------------------------------

describe("GET /api/credits/packs", () => {
  it("returns the available packs and action costs", async () => {
    const res = await request(app).get("/api/credits/packs");

    expect(res.status).toBe(200);
    expect(res.body.razorpayConfigured).toBe(true);
    expect(Array.isArray(res.body.packs)).toBe(true);
    expect(res.body.actionCosts.video).toBe(60);
    expect(res.body.actionCosts.image).toBe(6);
    expect(res.body.actionCosts.template_render).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// POST /api/credits/checkout
// ---------------------------------------------------------------------------

describe("POST /api/credits/checkout", () => {
  it("returns 400 when packId is missing", async () => {
    const res = await request(app).post("/api/credits/checkout").send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when the pack is not found", async () => {
    (findPack as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const res = await request(app).post("/api/credits/checkout").send({ packId: "nonexistent" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when Razorpay is not configured", async () => {
    (isRazorpayConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const res = await request(app).post("/api/credits/checkout").send({ packId: "starter" });
    expect(res.status).toBe(503);
  });

  it("returns 201 with order details on success", async () => {
    (findPack as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "starter",
      name: "Starter",
      amountPaise: 49900,
      baseCredits: 500,
      bonusCredits: 0,
    });
    (createOrder as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "order_123",
      amount: 49900,
      currency: "INR",
    });
    mockPayment.create.mockResolvedValue({});

    const res = await request(app).post("/api/credits/checkout").send({ packId: "starter" });

    expect(res.status).toBe(201);
    expect(res.body.orderId).toBe("order_123");
  });
});

// ---------------------------------------------------------------------------
// POST /api/credits/verify
// ---------------------------------------------------------------------------

describe("POST /api/credits/verify", () => {
  const verifyBody = {
    razorpay_order_id: "order_123",
    razorpay_payment_id: "pay_abc",
    razorpay_signature: "valid_sig",
  };

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/credits/verify")
      .send({ razorpay_order_id: "order_123" }); // missing paymentId and signature
    expect(res.status).toBe(400);
  });

  it("returns 400 when the signature is invalid", async () => {
    (verifyPaymentSignature as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockPayment.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post("/api/credits/verify").send(verifyBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("signature");
  });

  it("returns 404 when the payment order is not found for this user", async () => {
    (verifyPaymentSignature as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockPayment.findUnique.mockResolvedValue({ userId: "OTHER_USER" });

    const res = await request(app).post("/api/credits/verify").send(verifyBody);
    expect(res.status).toBe(404);
  });

  it("grants credits and returns the new balance on success", async () => {
    (verifyPaymentSignature as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockPayment.findUnique
      .mockResolvedValueOnce({ userId: "user-test-123" }) // ownership check
      .mockResolvedValueOnce({ id: "pay-row-1", userId: "user-test-123", packId: "starter", credits: 500, razorpayOrderId: "order_123" }); // fulfillment lookup
    mockPayment.updateMany.mockResolvedValue({ count: 1 });
    (findPack as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "starter",
      name: "Starter",
      baseCredits: 500,
      bonusCredits: 0,
    });
    (addCredits as ReturnType<typeof vi.fn>).mockResolvedValue(500);
    mockUser.findUnique.mockResolvedValue({ credits: 500 });

    const res = await request(app).post("/api/credits/verify").send(verifyBody);

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/credits/webhook
// ---------------------------------------------------------------------------

describe("creditsWebhookHandler (POST /api/credits/webhook)", () => {
  function buildWebhookSig(body: string) {
    return crypto.createHmac("sha256", "wh_secret").update(body).digest("hex");
  }

  it("returns 400 for an invalid webhook signature", async () => {
    (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const res = await request(app)
      .post("/api/credits/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "bad-sig")
      .send(Buffer.from('{"event":"test"}'));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("signature");
  });

  it("processes payment.captured and returns ok", async () => {
    (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const event = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { order_id: "order_123", id: "pay_abc" } } },
    });

    // Simulate no-op fulfilment (payment already processed)
    mockPayment.findUnique.mockResolvedValue({
      id: "pay-row-1",
      userId: "user-test-123",
      packId: "starter",
      credits: 500,
      razorpayOrderId: "order_123",
    });
    mockPayment.updateMany.mockResolvedValue({ count: 0 }); // already fulfilled

    const res = await request(app)
      .post("/api/credits/webhook")
      .set("Content-Type", "application/octet-stream")
      .set("x-razorpay-signature", buildWebhookSig(event))
      .send(Buffer.from(event));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
