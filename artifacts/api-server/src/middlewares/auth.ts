import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET || "rasokart-secret-key-change-in-production";

export interface AuthPayload {
  userId: number;
  role: string;
  iat?: number;
  exp?: number;
}

export function generateToken(payload: { userId: number; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.passwordUpdatedAt && payload.iat != null && payload.iat * 1000 < user.passwordUpdatedAt.getTime()) {
      res.status(401).json({ error: "Session expired. Please log in again." });
      return;
    }
    (req as any).user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/** Super Admin is an admin with the isSuperAdmin flag set — a strict superset of requireAdmin. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "admin" || !user.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can update company settings" });
    return;
  }
  next();
}

/** Payout Admin or Payout Super Admin — can manage payout operations. */
export function requirePayoutAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || (user.role !== "payout_admin" && user.role !== "payout_super_admin" && user.role !== "admin")) {
    res.status(403).json({ error: "Payout Admin access required" });
    return;
  }
  next();
}

/** Payout Super Admin only — has broader payout admin powers (e.g. provider config if granted). */
export function requirePayoutSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || (user.role !== "payout_super_admin" && user.role !== "admin")) {
    res.status(403).json({ error: "Payout Super Admin access required" });
    return;
  }
  next();
}

/** Agent — can only see their own merchants and commission data. */
export function requireAgent(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "agent") {
    res.status(403).json({ error: "Agent access required" });
    return;
  }
  next();
}

/** Payout Merchant — a merchant that uses payout-only services. */
export function requirePayoutMerchant(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "payout_merchant") {
    res.status(403).json({ error: "Payout Merchant access required" });
    return;
  }
  next();
}

/**
 * Admin OR Payout Admin — for routes accessible to both main admins and payout admins.
 * Payout admins should only see payout-related data (enforced by route logic, not this middleware).
 */
export function requireAnyAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  const adminRoles = ["admin", "payout_admin", "payout_super_admin"];
  if (!user || !adminRoles.includes(user.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
