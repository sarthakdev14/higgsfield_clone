import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@repo/db";
import { env } from "../env.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import {
  CREDIT_PACKS,
  actionCost,
  addCredits,
  findPack,
  packTotalCredits,
} from "../lib/credits.js";
import {
  createOrder,
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "../lib/razorpay.js";

export const creditsRouter: Router = Router();

// Current balance + recent ledger entries.
creditsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId }, select: { credits: true } }),
    prisma.creditTransaction.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  res.json({ balance: user?.credits ?? 0, transactions });
});

// Available packs + per-action prices + checkout config for the frontend.
creditsRouter.get("/packs", requireAuth, async (_req, res) => {
  res.json({
    currency: "INR",
    razorpayConfigured: isRazorpayConfigured(),
    // The key id is a publishable identifier; safe to send to the browser.
    razorpayKeyId: env.RAZORPAY_KEY_ID ?? null,
    packs: CREDIT_PACKS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceInr: p.priceInr,
      credits: packTotalCredits(p),
      baseCredits: p.baseCredits,
      bonusCredits: p.bonusCredits,
    })),
    actionCosts: {
      video: actionCost("video"),
      image: actionCost("image"),
      template_render: actionCost("template_render"),
    },
  });
});

const checkoutSchema = z.object({ packId: z.string().min(1) });

// Create a Razorpay order for a pack and persist a pending Payment row.
creditsRouter.post("/checkout", requireAuth, async (req: AuthedRequest, res) => {
  if (!isRazorpayConfigured()) {
    res.status(503).json({ error: "Payments are not configured on this server." });
    return;
  }
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const pack = findPack(parsed.data.packId);
  if (!pack) {
    res.status(404).json({ error: "Unknown pack." });
    return;
  }

  try {
    const credits = packTotalCredits(pack);
    const order = await createOrder({
      amount: pack.amountPaise,
      currency: "INR",
      // Razorpay caps receipt at 40 chars, so a userId+timestamp overflows. Use a
      // short unique token (37 chars); the userId/pack live in `notes` below.
      receipt: `rcpt_${randomUUID().replace(/-/g, "")}`,
      notes: { userId: req.userId!, packId: pack.id, credits: String(credits) },
    });

    await prisma.payment.create({
      data: {
        userId: req.userId!,
        packId: pack.id,
        amount: pack.amountPaise,
        currency: "INR",
        credits,
        razorpayOrderId: order.id,
        status: "CREATED",
      },
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      razorpayKeyId: env.RAZORPAY_KEY_ID,
      packId: pack.id,
      packName: pack.name,
      credits,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start checkout";
    console.error("Checkout failed:", message);
    res.status(502).json({ error: message });
  }
});

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/**
 * Grant a paid order's credits exactly once. Flips CREATED→PAID atomically; if
 * it was already PAID (e.g. the webhook beat us) we just return the balance.
 */
async function fulfillPayment(params: {
  orderId: string;
  paymentId: string;
  signature?: string;
}): Promise<{ granted: boolean; userId: string } | null> {
  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId: params.orderId },
  });
  if (!payment) return null;

  // Atomically claim the order for fulfillment (only one caller wins).
  const claimed = await prisma.payment.updateMany({
    where: { razorpayOrderId: params.orderId, status: { not: "PAID" } },
    data: {
      status: "PAID",
      razorpayPaymentId: params.paymentId,
      razorpaySignature: params.signature ?? null,
    },
  });
  if (claimed.count === 0) {
    // Already fulfilled by another path — idempotent success.
    return { granted: false, userId: payment.userId };
  }

  const pack = findPack(payment.packId);
  const baseCredits = pack?.baseCredits ?? payment.credits;
  const bonusCredits = pack?.bonusCredits ?? 0;

  await addCredits(payment.userId, baseCredits, "PURCHASE", {
    referenceType: "payment",
    referenceId: payment.id,
    description: `${pack?.name ?? "Credit"} pack`,
  });
  if (bonusCredits > 0) {
    await addCredits(payment.userId, bonusCredits, "BONUS", {
      referenceType: "payment",
      referenceId: payment.id,
      description: `${pack?.name ?? "Credit"} pack bonus`,
    });
  }
  return { granted: true, userId: payment.userId };
}

// Verify a completed Checkout payment and grant credits.
creditsRouter.post("/verify", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  const ok = verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });
  if (!ok) {
    await prisma.payment.updateMany({
      where: { razorpayOrderId: razorpay_order_id, status: "CREATED" },
      data: { status: "FAILED" },
    });
    res.status(400).json({ error: "Payment signature verification failed." });
    return;
  }

  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId: razorpay_order_id },
    select: { userId: true },
  });
  if (!payment || payment.userId !== req.userId) {
    res.status(404).json({ error: "Order not found." });
    return;
  }

  const result = await fulfillPayment({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });
  if (!result) {
    res.status(404).json({ error: "Order not found." });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { credits: true },
  });
  res.json({ balance: user?.credits ?? 0 });
});

/**
 * Razorpay webhook backstop (mounted with a raw body parser BEFORE express.json
 * so the signature can be verified against the exact bytes). Grants credits on
 * `payment.captured` in case the browser never returned to /verify.
 */
export async function creditsWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.header("x-razorpay-signature") ?? "";
  const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : "";
  if (!verifyWebhookSignature(rawBody, signature)) {
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }
  try {
    const event = JSON.parse(rawBody) as {
      event?: string;
      payload?: { payment?: { entity?: { order_id?: string; id?: string } } };
    };
    if (event.event === "payment.captured") {
      const entity = event.payload?.payment?.entity;
      if (entity?.order_id && entity.id) {
        await fulfillPayment({ orderId: entity.order_id, paymentId: entity.id });
      }
    }
    res.json({ status: "ok" });
  } catch (err) {
    console.error("Webhook handling failed:", err instanceof Error ? err.message : err);
    res.status(200).json({ status: "ignored" });
  }
}
