import { prisma, type CreditTxnType } from "@repo/db";
import { env } from "../env.js";

/**
 * Credits & billing helpers.
 *
 * Users buy credits (Razorpay) and spend a FIXED number of credits per action
 * — independent of which model they pick. The fixed prices live in env
 * (CREDITS_PER_*) and are tuned to keep a healthy margin over the underlying
 * OpenRouter provider cost. Credit mutations always go through this module so
 * the User.credits balance and the CreditTransaction ledger stay consistent.
 */

/** The billable generation actions and their fixed credit price. */
export type GenerationAction = "video" | "image" | "template_render";

/** Fixed credit cost for one generation of the given kind. */
export function actionCost(action: GenerationAction): number {
  switch (action) {
    case "video":
      return env.CREDITS_PER_VIDEO;
    case "image":
      return env.CREDITS_PER_IMAGE;
    case "template_render":
      return env.CREDITS_PER_TEMPLATE_RENDER;
  }
}

/** The reference type stored on ledger rows for each action (matches DB rows). */
export const REFERENCE_TYPE: Record<GenerationAction, string> = {
  video: "video",
  image: "image",
  template_render: "template_render",
};

// ---------------------------------------------------------------------------
// Credit packs (what users can buy)
// ---------------------------------------------------------------------------

export interface CreditPack {
  id: string;
  name: string;
  description: string;
  /** Price the user pays, in rupees (display) and paise (charged via Razorpay). */
  priceInr: number;
  amountPaise: number;
  /** Base credits + promotional bonus = total credits granted on success. */
  baseCredits: number;
  bonusCredits: number;
}

/**
 * Three fixed top-up tiers. Base value is ~₹1/credit at the Starter tier; larger
 * packs add a bonus (better value) but are still priced so the per-action credit
 * costs above keep >= ~30% margin even at the most generous (Studio) tier.
 */
export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Enough credits to try things out.",
    priceInr: 499,
    amountPaise: 499_00,
    baseCredits: 500,
    bonusCredits: 0,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Best for regular creators — 10% bonus credits.",
    priceInr: 1999,
    amountPaise: 1999_00,
    baseCredits: 2000,
    bonusCredits: 200,
  },
  {
    id: "studio",
    name: "Studio",
    description: "For heavy use — 20% bonus credits.",
    priceInr: 4999,
    amountPaise: 4999_00,
    baseCredits: 5000,
    bonusCredits: 1000,
  },
];

export function findPack(packId: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === packId);
}

export const packTotalCredits = (pack: CreditPack): number =>
  pack.baseCredits + pack.bonusCredits;

// ---------------------------------------------------------------------------
// Ledger operations
// ---------------------------------------------------------------------------

/** Thrown when a user tries to spend more credits than they have. */
export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number,
  ) {
    super(`Insufficient credits: need ${required}, have ${available}.`);
    this.name = "InsufficientCreditsError";
  }
}

/** Current spendable balance for a user. */
export async function getBalance(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
  return user?.credits ?? 0;
}

interface LedgerRef {
  referenceType?: string;
  referenceId?: string;
  description?: string;
}

/**
 * Atomically spend `amount` credits. Uses a conditional update so concurrent
 * requests can't drive the balance negative. Throws InsufficientCreditsError if
 * the user doesn't have enough. Returns the new balance.
 */
export async function spendCredits(
  userId: string,
  amount: number,
  ref: LedgerRef = {},
): Promise<number> {
  if (amount <= 0) return getBalance(userId);
  return prisma.$transaction(async (tx) => {
    // Conditional decrement: only succeeds if the user still has enough.
    const updated = await tx.user.updateMany({
      where: { id: userId, credits: { gte: amount } },
      data: { credits: { decrement: amount } },
    });
    if (updated.count === 0) {
      const available = (
        await tx.user.findUnique({ where: { id: userId }, select: { credits: true } })
      )?.credits ?? 0;
      throw new InsufficientCreditsError(amount, available);
    }
    const after = (
      await tx.user.findUnique({ where: { id: userId }, select: { credits: true } })
    )!.credits;
    await tx.creditTransaction.create({
      data: {
        userId,
        type: "SPEND",
        amount: -amount,
        balanceAfter: after,
        description: ref.description,
        referenceType: ref.referenceType,
        referenceId: ref.referenceId,
      },
    });
    return after;
  });
}

/**
 * Add credits to a user and record a ledger row. Used for purchases, refunds,
 * bonuses and admin adjustments. Returns the new balance.
 */
export async function addCredits(
  userId: string,
  amount: number,
  type: CreditTxnType,
  ref: LedgerRef = {},
): Promise<number> {
  if (amount <= 0) return getBalance(userId);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
      select: { credits: true },
    });
    await tx.creditTransaction.create({
      data: {
        userId,
        type,
        amount,
        balanceAfter: user.credits,
        description: ref.description,
        referenceType: ref.referenceType,
        referenceId: ref.referenceId,
      },
    });
    return user.credits;
  });
}

/**
 * Refund credits previously spent on a generation. Idempotent and retry-safe:
 * it never refunds more than the net amount still outstanding for this reference
 * (sum of SPEND minus prior REFUNDs). So a double failure-callback won't
 * double-refund, yet a charge→refund→re-charge (retry) cycle refunds correctly.
 * Safe to call even if nothing was charged.
 */
export async function refundCredits(
  userId: string,
  amount: number,
  ref: { referenceType: string; referenceId: string; description?: string },
): Promise<void> {
  if (amount <= 0) return;
  const rows = await prisma.creditTransaction.findMany({
    where: {
      userId,
      referenceType: ref.referenceType,
      referenceId: ref.referenceId,
      type: { in: ["SPEND", "REFUND"] },
    },
    select: { type: true, amount: true },
  });
  // SPEND amounts are negative; REFUND amounts are positive. Outstanding is the
  // net the user is still down for this reference.
  const net = rows.reduce((sum, r) => sum + r.amount, 0); // <= 0 if still owed
  const outstanding = -net;
  const toRefund = Math.min(amount, outstanding);
  if (toRefund <= 0) return;
  await addCredits(userId, toRefund, "REFUND", {
    referenceType: ref.referenceType,
    referenceId: ref.referenceId,
    description: ref.description ?? "Refund for failed generation",
  });
}
