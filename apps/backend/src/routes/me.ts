import { Router } from "express";
import { prisma } from "@repo/db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { resolveIsAdmin, isSuperAdminEmail } from "../middleware/requireAdmin.js";

export const meRouter: Router = Router();

// Current user's profile + admin status + credit balance (used by the frontend
// to gate admin UI and show the credit balance in the navbar).
meRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const [isAdmin, user] = await Promise.all([
    resolveIsAdmin(req.userId!, req.userEmail),
    prisma.user.findUnique({ where: { id: req.userId }, select: { credits: true } }),
  ]);
  res.json({
    id: req.userId,
    email: req.userEmail,
    isAdmin,
    isSuperAdmin: isSuperAdminEmail(req.userEmail),
    credits: user?.credits ?? 0,
  });
});
