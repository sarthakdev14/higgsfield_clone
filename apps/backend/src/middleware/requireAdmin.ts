import type { NextFunction, Response } from "express";
import { prisma } from "@repo/db";
import { env } from "../env.js";
import { requireAuth, type AuthedRequest } from "./requireAuth.js";

/** True when the email is in the SUPERADMIN_EMAILS allowlist. */
export function isSuperAdminEmail(email?: string): boolean {
  return !!email && env.SUPERADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Resolve whether a user is an admin, lazily promoting anyone whose email is in
 * the ADMIN_EMAILS (or SUPERADMIN_EMAILS) allowlist to the "admin" role.
 * Superadmins are always admins. Returns the effective flag.
 */
export async function resolveIsAdmin(userId: string, email?: string): Promise<boolean> {
  const inAllowlist =
    (!!email && env.ADMIN_EMAILS.includes(email.toLowerCase())) || isSuperAdminEmail(email);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "admin") return true;
  if (inAllowlist) {
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });
    return true;
  }
  return false;
}

/**
 * Express middleware that rejects non-admin requests. Runs `requireAuth` first,
 * then checks the user's role (promoting allowlisted emails on the way). Also
 * flags superadmins on the request (`req.isSuperAdmin`) so routes can widen
 * access to every admin's resources.
 */
export function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  void requireAuth(req, res, async () => {
    const isAdmin = await resolveIsAdmin(req.userId!, req.userEmail);
    if (!isAdmin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    req.isSuperAdmin = isSuperAdminEmail(req.userEmail);
    next();
  });
}
