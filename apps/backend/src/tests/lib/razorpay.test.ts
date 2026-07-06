/**
 * Unit tests for src/lib/razorpay.ts
 *
 * External fetch calls are mocked; crypto is real (HMAC tested end-to-end).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------

vi.mock("../../env.js", () => ({
  env: {
    RAZORPAY_KEY_ID: "rzp_test_key_id",
    RAZORPAY_KEY_SECRET: "test_secret",
    RAZORPAY_WEBHOOK_SECRET: "webhook_secret",
  },
}));

import {
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
  createOrder,
} from "../lib/razorpay.js";

// ---------------------------------------------------------------------------
// isRazorpayConfigured
// ---------------------------------------------------------------------------

describe("isRazorpayConfigured", () => {
  it("returns true when both keys are set", () => {
    expect(isRazorpayConfigured()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyPaymentSignature
// ---------------------------------------------------------------------------

describe("verifyPaymentSignature", () => {
  function buildValidSignature(orderId: string, paymentId: string) {
    return crypto
      .createHmac("sha256", "test_secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
  }

  it("returns true for a valid HMAC signature", () => {
    const orderId = "order_abc";
    const paymentId = "pay_xyz";
    const signature = buildValidSignature(orderId, paymentId);
    expect(verifyPaymentSignature({ orderId, paymentId, signature })).toBe(true);
  });

  it("returns false for a tampered signature", () => {
    const orderId = "order_abc";
    const paymentId = "pay_xyz";
    const badSig = "0".repeat(64);
    expect(verifyPaymentSignature({ orderId, paymentId, signature: badSig })).toBe(false);
  });

  it("returns false for an empty signature string", () => {
    expect(
      verifyPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature: "" }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature", () => {
  function buildWebhookSig(body: string) {
    return crypto.createHmac("sha256", "webhook_secret").update(body).digest("hex");
  }

  it("returns true for a valid webhook signature", () => {
    const body = '{"event":"payment.captured"}';
    const sig = buildWebhookSig(body);
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("returns false for a bad webhook signature", () => {
    const body = '{"event":"payment.captured"}';
    expect(verifyWebhookSignature(body, "bad-signature")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createOrder (mocked fetch)
// ---------------------------------------------------------------------------

describe("createOrder", () => {
  const mockOrder = { id: "order_test_123", amount: 49900, currency: "INR", status: "created" };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOrder,
    } as unknown as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the Razorpay API and returns the order", async () => {
    const order = await createOrder({
      amount: 49900,
      currency: "INR",
      receipt: "rcpt_test",
      notes: { userId: "u-1", packId: "starter" },
    });

    expect(order.id).toBe("order_test_123");
    expect(order.amount).toBe(49900);
    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/orders");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("throws when the Razorpay API returns a non-OK status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    } as unknown as Response);

    await expect(
      createOrder({ amount: 100, currency: "INR", receipt: "rcpt" }),
    ).rejects.toThrow("Razorpay order creation failed");
  });
});
