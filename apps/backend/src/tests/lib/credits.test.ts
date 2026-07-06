/**
 * Unit tests for src/lib/credits.ts
 *
 * Prisma and the env are fully mocked so no database connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @repo/db (prisma client) before importing the module under test.
// ---------------------------------------------------------------------------
vi.mock("@repo/db", () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    creditTransaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma };
});

// Mock env so the module can load without a real .env
vi.mock("../../env.js", () => ({
  env: {
    CREDITS_PER_VIDEO: 60,
    CREDITS_PER_IMAGE: 6,
    CREDITS_PER_TEMPLATE_RENDER: 1000,
  },
}));

import { prisma } from "@repo/db";
import {
  actionCost,
  CREDIT_PACKS,
  findPack,
  packTotalCredits,
  InsufficientCreditsError,
  getBalance,
  spendCredits,
  addCredits,
  refundCredits,
} from "../lib/credits.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  creditTransaction: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default $transaction: execute the callback with the same mock as tx.
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma as unknown as typeof prisma),
  );
});

// ---------------------------------------------------------------------------
// actionCost
// ---------------------------------------------------------------------------

describe("actionCost", () => {
  it("returns the configured cost for video", () => {
    expect(actionCost("video")).toBe(60);
  });

  it("returns the configured cost for image", () => {
    expect(actionCost("image")).toBe(6);
  });

  it("returns the configured cost for template_render", () => {
    expect(actionCost("template_render")).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// CREDIT_PACKS / findPack / packTotalCredits
// ---------------------------------------------------------------------------

describe("CREDIT_PACKS", () => {
  it("contains exactly three packs (starter, pro, studio)", () => {
    const ids = CREDIT_PACKS.map((p) => p.id);
    expect(ids).toEqual(["starter", "pro", "studio"]);
  });

  it("starter pack has 500 base credits and 0 bonus", () => {
    const pack = CREDIT_PACKS.find((p) => p.id === "starter")!;
    expect(pack.baseCredits).toBe(500);
    expect(pack.bonusCredits).toBe(0);
  });

  it("pro pack has 2000 base credits and 200 bonus", () => {
    const pack = CREDIT_PACKS.find((p) => p.id === "pro")!;
    expect(pack.baseCredits).toBe(2000);
    expect(pack.bonusCredits).toBe(200);
  });

  it("studio pack has 5000 base credits and 1000 bonus", () => {
    const pack = CREDIT_PACKS.find((p) => p.id === "studio")!;
    expect(pack.baseCredits).toBe(5000);
    expect(pack.bonusCredits).toBe(1000);
  });
});

describe("findPack", () => {
  it("returns the matching pack by id", () => {
    expect(findPack("pro")?.id).toBe("pro");
  });

  it("returns undefined for an unknown pack id", () => {
    expect(findPack("unknown")).toBeUndefined();
  });
});

describe("packTotalCredits", () => {
  it("sums base and bonus credits", () => {
    const pack = findPack("pro")!;
    expect(packTotalCredits(pack)).toBe(2200);
  });

  it("returns just baseCredits when bonus is 0", () => {
    const pack = findPack("starter")!;
    expect(packTotalCredits(pack)).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// InsufficientCreditsError
// ---------------------------------------------------------------------------

describe("InsufficientCreditsError", () => {
  it("is an instance of Error with the correct name", () => {
    const err = new InsufficientCreditsError(100, 40);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InsufficientCreditsError");
    expect(err.required).toBe(100);
    expect(err.available).toBe(40);
    expect(err.message).toContain("100");
    expect(err.message).toContain("40");
  });
});

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

describe("getBalance", () => {
  it("returns the user's credit balance", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ credits: 350 });
    const balance = await getBalance("user-1");
    expect(balance).toBe(350);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { credits: true },
    });
  });

  it("returns 0 when the user is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await getBalance("ghost-user")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// spendCredits
// ---------------------------------------------------------------------------

describe("spendCredits", () => {
  it("returns current balance immediately when amount is 0", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ credits: 200 });
    const result = await spendCredits("user-1", 0);
    expect(result).toBe(200);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("decrements balance and records a ledger row on success", async () => {
    // Inside the transaction, updateMany succeeds (count: 1), then findUnique
    // returns the new balance.
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.user.findUnique.mockResolvedValue({ credits: 140 });
    mockPrisma.creditTransaction.create.mockResolvedValue({});

    const result = await spendCredits("user-1", 60, {
      referenceType: "video",
      referenceId: "vid-123",
      description: "Video generation",
    });

    expect(result).toBe(140);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "user-1" }) }),
    );
    expect(mockPrisma.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "SPEND", amount: -60 }),
      }),
    );
  });

  it("throws InsufficientCreditsError when the user cannot afford it", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findUnique.mockResolvedValue({ credits: 10 });

    await expect(spendCredits("user-1", 60)).rejects.toBeInstanceOf(InsufficientCreditsError);
  });
});

// ---------------------------------------------------------------------------
// addCredits
// ---------------------------------------------------------------------------

describe("addCredits", () => {
  it("returns current balance immediately when amount is 0", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ credits: 100 });
    const result = await addCredits("user-1", 0, "BONUS");
    expect(result).toBe(100);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("increments balance and records a ledger row", async () => {
    mockPrisma.user.update.mockResolvedValue({ credits: 700 });
    mockPrisma.creditTransaction.create.mockResolvedValue({});

    const result = await addCredits("user-1", 200, "PURCHASE", {
      referenceType: "payment",
      referenceId: "pay-abc",
      description: "Starter pack",
    });

    expect(result).toBe(700);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { credits: { increment: 200 } },
      }),
    );
    expect(mockPrisma.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "PURCHASE", amount: 200, balanceAfter: 700 }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// refundCredits
// ---------------------------------------------------------------------------

describe("refundCredits", () => {
  it("is a no-op when amount is 0", async () => {
    await refundCredits("user-1", 0, { referenceType: "video", referenceId: "v-1" });
    expect(mockPrisma.creditTransaction.findMany).not.toHaveBeenCalled();
  });

  it("refunds the full outstanding amount when there is one SPEND and no prior refund", async () => {
    // SPEND of 60 → net = -60 → outstanding = 60.
    mockPrisma.creditTransaction.findMany.mockResolvedValue([{ type: "SPEND", amount: -60 }]);
    mockPrisma.user.update.mockResolvedValue({ credits: 60 });
    mockPrisma.creditTransaction.create.mockResolvedValue({});

    await refundCredits("user-1", 60, {
      referenceType: "video",
      referenceId: "vid-1",
      description: "Refund: video failed",
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { credits: { increment: 60 } } }),
    );
  });

  it("is idempotent: does not double-refund when the net is already 0", async () => {
    // SPEND -60 + REFUND +60 → net = 0 → outstanding = 0.
    mockPrisma.creditTransaction.findMany.mockResolvedValue([
      { type: "SPEND", amount: -60 },
      { type: "REFUND", amount: 60 },
    ]);

    await refundCredits("user-1", 60, { referenceType: "video", referenceId: "vid-1" });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("caps the refund at the outstanding balance (partial refund guard)", async () => {
    // Only SPEND -60 outstanding, but caller asks for 100.
    mockPrisma.creditTransaction.findMany.mockResolvedValue([{ type: "SPEND", amount: -60 }]);
    mockPrisma.user.update.mockResolvedValue({ credits: 60 });
    mockPrisma.creditTransaction.create.mockResolvedValue({});

    await refundCredits("user-1", 100, { referenceType: "video", referenceId: "vid-1" });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { credits: { increment: 60 } } }),
    );
  });
});
