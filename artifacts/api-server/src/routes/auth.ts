import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, usersTable, merchantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken, requireAuth } from "../middlewares/auth";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = generateToken({ userId: user.id, role: user.role });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        merchantId: user.merchantId,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/register
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, businessName, contactName, phone, website } = req.body;
    if (!email || !password || !businessName || !contactName || !phone) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [merchant] = await db.insert(merchantsTable).values({
      businessName,
      contactName,
      email: email.toLowerCase(),
      phone,
      website: website || null,
      status: "pending",
    }).returning();
    const [user] = await db.insert(usersTable).values({
      email: email.toLowerCase(),
      passwordHash,
      name: contactName,
      role: "merchant",
      isActive: true,
      merchantId: merchant.id,
    }).returning();
    const token = generateToken({ userId: user.id, role: user.role });
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        merchantId: user.merchantId,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    let merchantStatus: string | null = null;
    if (user.role === "merchant" && user.merchantId) {
      const [merchant] = await db.select({ status: merchantsTable.status }).from(merchantsTable).where(eq(merchantsTable.id, user.merchantId)).limit(1);
      merchantStatus = merchant?.status ?? null;
    }
    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      isActive: user.isActive,
      merchantId: user.merchantId,
      merchantStatus,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.json({ message: "Logged out successfully" });
});

export default router;
