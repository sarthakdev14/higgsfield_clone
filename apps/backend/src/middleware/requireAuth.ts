import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

export interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
  // Set by requireAdmin: true when the user's email is in SUPERADMIN_EMAILS.
  isSuperAdmin?: boolean;
}

/** Express middleware that rejects unauthenticated requests. */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = session.user.id;
    req.userEmail = session.user.email;
    next();
  } catch (err) {
    console.error("Auth check failed:", err);
    res.status(401).json({ error: "Unauthorized" });
  }
}
