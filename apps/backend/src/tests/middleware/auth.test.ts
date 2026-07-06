/**
 * Unit tests for the middleware helpers:
 *  - src/middleware/requireAuth.ts
 *  - src/middleware/requireAdmin.ts  (isSuperAdminEmail, resolveIsAdmin)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../env.js", () => ({
  env: {
    ADMIN_EMAILS: ["admin@example.com"],
    SUPERADMIN_EMAILS: ["superadmin@example.com"],
  },
}));

vi.mock("@repo/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock better-auth/node — requireAuth calls auth.api.getSession
vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn().mockReturnValue({}),
}));

vi.mock("../auth.js", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { prisma } from "@repo/db";
import { auth } from "../auth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  isSuperAdminEmail,
  resolveIsAdmin,
} from "../middleware/requireAdmin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockUser = {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const mockUser = prisma.user as unknown as MockUser;
const mockGetSession = auth.api.getSession as ReturnType<typeof vi.fn>;

function makeReqRes(): {
  req: Request & { userId?: string; userEmail?: string };
  res: Partial<Response> & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  next: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = { headers: {} } as Request & { userId?: string; userEmail?: string };
  return { req, res: { status, json } as unknown as Partial<Response> & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }, next: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe("requireAuth", () => {
  it("calls next() and attaches userId when the session is valid", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });
    const { req, res, next } = makeReqRes();

    await requireAuth(req, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe("user-1");
    expect(req.userEmail).toBe("user@example.com");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const { req, res, next } = makeReqRes();

    await requireAuth(req, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when the session has no user", async () => {
    mockGetSession.mockResolvedValue({ user: null });
    const { req, res, next } = makeReqRes();

    await requireAuth(req, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when auth.api.getSession throws", async () => {
    mockGetSession.mockRejectedValue(new Error("Network error"));
    const { req, res, next } = makeReqRes();

    await requireAuth(req, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ---------------------------------------------------------------------------
// isSuperAdminEmail
// ---------------------------------------------------------------------------

describe("isSuperAdminEmail", () => {
  it("returns true for an email in the SUPERADMIN_EMAILS list", () => {
    expect(isSuperAdminEmail("superadmin@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSuperAdminEmail("SUPERADMIN@EXAMPLE.COM")).toBe(true);
  });

  it("returns false for a regular user email", () => {
    expect(isSuperAdminEmail("user@example.com")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isSuperAdminEmail(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveIsAdmin
// ---------------------------------------------------------------------------

describe("resolveIsAdmin", () => {
  it("returns true immediately when the user already has role='admin'", async () => {
    mockUser.findUnique.mockResolvedValue({ role: "admin" });

    const result = await resolveIsAdmin("user-1", "user@example.com");

    expect(result).toBe(true);
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("promotes and returns true for an email in ADMIN_EMAILS", async () => {
    mockUser.findUnique.mockResolvedValue({ role: "user" });
    mockUser.update.mockResolvedValue({ role: "admin" });

    const result = await resolveIsAdmin("user-1", "admin@example.com");

    expect(result).toBe(true);
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "admin" } }),
    );
  });

  it("promotes and returns true for an email in SUPERADMIN_EMAILS", async () => {
    mockUser.findUnique.mockResolvedValue({ role: "user" });
    mockUser.update.mockResolvedValue({ role: "admin" });

    const result = await resolveIsAdmin("user-1", "superadmin@example.com");

    expect(result).toBe(true);
  });

  it("returns false for a regular user not in any allowlist", async () => {
    mockUser.findUnique.mockResolvedValue({ role: "user" });

    const result = await resolveIsAdmin("user-1", "normal@example.com");

    expect(result).toBe(false);
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("returns false when the user is not found in the database", async () => {
    mockUser.findUnique.mockResolvedValue(null);

    const result = await resolveIsAdmin("ghost-user", "normal@example.com");

    expect(result).toBe(false);
  });
});
