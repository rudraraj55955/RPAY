/**
 * Admin Payout Merchant Management — /api/admin/payout-merchants/*
 *
 * Dedicated admin routes for creating, viewing, and managing payout merchants.
 */
import { Router } from "express";
import {
  db,
  merchantsTable,
  usersTable,
  merchantWalletsTable,
  withdrawalsTable,
  walletLedgerTable,
  payoutBeneficiariesTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc, count, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import bcrypt from "bcryptjs";
import { mutateWallet } from "./wallets";

const router = Router();
router.use(requireAuth, requireAdmin);

// ── List payout merchants ─────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { page = "1", limit = "25", status } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [
      inArray(merchantsTable.merchantType as any, ["PAYOUT_ONLY", "BOTH"]),
    ];
    if (status) conditions.push(eq(merchantsTable.status, status));
    const where = and(...conditions);

    const [merchants, [{ total }]] = await Promise.all([
      db.select({
        id: merchantsTable.id,
        businessName: merchantsTable.businessName,
        contactName: merchantsTable.contactName,
        email: merchantsTable.email,
        phone: merchantsTable.phone,
        status: merchantsTable.status,
        merchantType: merchantsTable.merchantType,
        payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
        approvedForPayoutAt: merchantsTable.approvedForPayoutAt,
        agentId: merchantsTable.agentId,
        createdAt: merchantsTable.createdAt,
      }).from(merchantsTable)
        .where(where)
        .orderBy(desc(merchantsTable.createdAt))
        .limit(limitNum).offset(offset),
      db.select({ total: count() }).from(merchantsTable).where(where),
    ]);

    const ids = merchants.map((m) => m.id);
    const [wallets, payoutStats] = ids.length > 0 ? await Promise.all([
      db.select({
        merchantId: merchantWalletsTable.merchantId,
        availableBalance: merchantWalletsTable.availableBalance,
        holdBalance: merchantWalletsTable.holdBalance,
        totalPayout: merchantWalletsTable.totalPayout,
      }).from(merchantWalletsTable).where(inArray(merchantWalletsTable.merchantId, ids)),
      db.select({
        merchantId: withdrawalsTable.merchantId,
        total: count(),
        successCount: sql<string>`COUNT(CASE WHEN transfer_status='SUCCESS' THEN 1 END)`,
        failedCount: sql<string>`COUNT(CASE WHEN transfer_status IN ('FAILED','REVERSED') THEN 1 END)`,
        totalAmount: sql<string>`COALESCE(SUM(CASE WHEN transfer_status='SUCCESS' THEN amount ELSE 0 END),0)`,
      }).from(withdrawalsTable).where(inArray(withdrawalsTable.merchantId, ids))
        .groupBy(withdrawalsTable.merchantId),
    ]) : [[], []];

    const walletMap = new Map(wallets.map((w) => [w.merchantId, w]));
    const statsMap = new Map(payoutStats.map((s) => [s.merchantId, s]));

    res.json({
      merchants: merchants.map((m) => ({
        ...m,
        wallet: walletMap.get(m.id) ?? null,
        payoutStats: statsMap.get(m.id) ?? { total: 0, successCount: "0", failedCount: "0", totalAmount: "0" },
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) { next(err); }
});

// ── Create payout merchant ────────────────────────────────────────────────
router.post("/", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const { businessName, contactName, email, phone, website, password, agentId, payoutLimitsJson, payoutFeeJson } = req.body as Record<string, any>;

    if (!businessName || !contactName || !email || !phone || !password) {
      res.status(400).json({ error: "businessName, contactName, email, phone, password are required" }); return;
    }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, (email as string).toLowerCase())).limit(1);
    if (existing) { res.status(409).json({ error: "Email already registered" }); return; }

    const passwordHash = await bcrypt.hash(password as string, 12);

    const [merchant] = await db.insert(merchantsTable).values({
      businessName: businessName as string,
      contactName: contactName as string,
      email: (email as string).toLowerCase(),
      phone: phone as string,
      website: website ?? null,
      status: "pending",
      merchantType: "PAYOUT_ONLY",
      payoutServiceEnabled: false,
      payinServiceEnabled: false,
      collectionServiceEnabled: false,
      onboardingType: "PAYOUT_MERCHANT",
      agentId: agentId ?? null,
      payoutLimitsJson: payoutLimitsJson ?? null,
      payoutFeeJson: payoutFeeJson ?? null,
    } as any).returning();

    const [user] = await db.insert(usersTable).values({
      email: (email as string).toLowerCase(),
      passwordHash,
      role: "merchant",
      merchantId: merchant.id,
      name: contactName as string,
      isActive: true,
    } as any).returning({ id: usersTable.id });

    await db.insert(auditLogsTable).values({
      userId: admin.id,
      action: "payout_merchant_created",
      targetType: "merchant",
      targetId: String(merchant.id),
      details: { businessName, email, agentId: agentId ?? null },
    } as any).catch(() => {});

    req.log.info({ merchantId: merchant.id, adminId: admin.id }, "payout_merchant_created");
    res.status(201).json({ merchantId: merchant.id, userId: user.id });
  } catch (err) { next(err); }
});

// ── Get payout merchant detail ────────────────────────────────────────────
router.get("/:merchantId", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    const [merchant] = await db.select().from(merchantsTable)
      .where(and(eq(merchantsTable.id, merchantId), inArray(merchantsTable.merchantType as any, ["PAYOUT_ONLY", "BOTH"]))).limit(1);
    if (!merchant) { res.status(404).json({ error: "Payout merchant not found" }); return; }

    const [[user], [wallet], [stats], [benCount]] = await Promise.all([
      db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, isActive: usersTable.isActive, createdAt: usersTable.createdAt })
        .from(usersTable).where(and(eq(usersTable.merchantId, merchantId), eq(usersTable.role, "merchant"))).limit(1),
      db.select().from(merchantWalletsTable).where(eq(merchantWalletsTable.merchantId, merchantId)).limit(1),
      db.select({
        total: count(),
        totalAmount: sql<string>`COALESCE(SUM(amount),0)`,
        successCount: sql<string>`COUNT(CASE WHEN transfer_status='SUCCESS' THEN 1 END)`,
        failedCount: sql<string>`COUNT(CASE WHEN transfer_status IN ('FAILED','REVERSED') THEN 1 END)`,
        pendingCount: sql<string>`COUNT(CASE WHEN status='pending' THEN 1 END)`,
      }).from(withdrawalsTable).where(eq(withdrawalsTable.merchantId, merchantId)),
      db.select({ count: count() }).from(payoutBeneficiariesTable)
        .where(eq(payoutBeneficiariesTable.merchantId, merchantId)),
    ]);

    res.json({
      merchant,
      user: user ?? null,
      wallet: wallet ?? null,
      payoutStats: stats ?? null,
      beneficiaryCount: benCount?.count ?? 0,
    });
  } catch (err) { next(err); }
});

// ── Approve payout merchant ───────────────────────────────────────────────
router.post("/:merchantId/approve", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const merchantId = parseInt(req.params["merchantId"] as string);
    const { notes } = req.body as { notes?: string };

    await db.update(merchantsTable).set({
      status: "approved",
      payoutServiceEnabled: true,
      approvedForPayoutAt: new Date(),
    } as any).where(and(eq(merchantsTable.id, merchantId), inArray(merchantsTable.merchantType as any, ["PAYOUT_ONLY", "BOTH"])));

    await db.insert(auditLogsTable).values({
      userId: admin.id,
      action: "payout_merchant_approved",
      targetType: "merchant",
      targetId: String(merchantId),
      details: { notes: notes ?? null, adminEmail: admin.email },
    } as any).catch(() => {});

    req.log.info({ merchantId, adminId: admin.id }, "payout_merchant_approved");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Update settings ───────────────────────────────────────────────────────
router.patch("/:merchantId/settings", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const merchantId = parseInt(req.params["merchantId"] as string);
    const { payoutServiceEnabled, payoutLimitsJson, payoutFeeJson, agentId, merchantType, status } = req.body as Record<string, any>;

    const updatePayload: Record<string, unknown> = {};
    if (payoutServiceEnabled !== undefined) updatePayload["payoutServiceEnabled"] = Boolean(payoutServiceEnabled);
    if (payoutLimitsJson !== undefined) updatePayload["payoutLimitsJson"] = payoutLimitsJson;
    if (payoutFeeJson !== undefined) updatePayload["payoutFeeJson"] = payoutFeeJson;
    if (agentId !== undefined) updatePayload["agentId"] = agentId ?? null;
    if (merchantType !== undefined && ["PAYOUT_ONLY", "NORMAL", "BOTH"].includes(merchantType as string)) {
      updatePayload["merchantType"] = merchantType;
    }
    if (status !== undefined && ["pending", "approved", "rejected", "suspended"].includes(status as string)) {
      updatePayload["status"] = status;
    }

    if (Object.keys(updatePayload).length === 0) {
      res.status(400).json({ error: "No valid fields to update" }); return;
    }

    await db.update(merchantsTable).set(updatePayload as any).where(eq(merchantsTable.id, merchantId));

    await db.insert(auditLogsTable).values({
      userId: admin.id,
      action: "payout_merchant_settings_updated",
      targetType: "merchant",
      targetId: String(merchantId),
      details: { changes: updatePayload, adminEmail: admin.email },
    } as any).catch(() => {});

    req.log.info({ merchantId, adminId: admin.id, changes: Object.keys(updatePayload) }, "payout_merchant_settings_updated");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Admin wallet credit ───────────────────────────────────────────────────
router.post("/:merchantId/wallet/credit", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const merchantId = parseInt(req.params["merchantId"] as string);
    const { amount, reason } = req.body as { amount?: number; reason?: string };

    if (!amount || amount <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }
    if (!reason?.trim()) { res.status(400).json({ error: "reason is required" }); return; }

    const [merchant] = await db.select({ id: merchantsTable.id })
      .from(merchantsTable).where(and(
        eq(merchantsTable.id, merchantId),
        inArray(merchantsTable.merchantType as any, ["PAYOUT_ONLY", "BOTH"])
      )).limit(1);
    if (!merchant) { res.status(404).json({ error: "Payout merchant not found" }); return; }

    await mutateWallet(merchantId,
      { availableDelta: amount },
      {
        txnType: "admin_credit",
        bucket: "available",
        amount,
        description: `Admin credit: ${reason.trim()}`,
        referenceType: "admin",
        referenceId: admin.id,
        createdBy: admin.id,
      }
    );

    await db.insert(auditLogsTable).values({
      userId: admin.id,
      action: "payout_wallet_credit",
      targetType: "merchant",
      targetId: String(merchantId),
      details: { amount, reason: reason.trim(), adminEmail: admin.email },
    } as any).catch(() => {});

    req.log.info({ merchantId, amount, adminId: admin.id }, "payout_wallet_credited");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Admin wallet debit ────────────────────────────────────────────────────
router.post("/:merchantId/wallet/debit", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const merchantId = parseInt(req.params["merchantId"] as string);
    const { amount, reason } = req.body as { amount?: number; reason?: string };

    if (!amount || amount <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }
    if (!reason?.trim()) { res.status(400).json({ error: "reason is required" }); return; }

    const [merchant] = await db.select({ id: merchantsTable.id })
      .from(merchantsTable).where(and(
        eq(merchantsTable.id, merchantId),
        inArray(merchantsTable.merchantType as any, ["PAYOUT_ONLY", "BOTH"])
      )).limit(1);
    if (!merchant) { res.status(404).json({ error: "Payout merchant not found" }); return; }

    await mutateWallet(merchantId,
      { availableDelta: -amount },
      {
        txnType: "admin_debit",
        bucket: "available",
        amount,
        description: `Admin debit: ${reason.trim()}`,
        referenceType: "admin",
        referenceId: admin.id,
        createdBy: admin.id,
      }
    );

    await db.insert(auditLogsTable).values({
      userId: admin.id,
      action: "payout_wallet_debit",
      targetType: "merchant",
      targetId: String(merchantId),
      details: { amount, reason: reason.trim(), adminEmail: admin.email },
    } as any).catch(() => {});

    req.log.info({ merchantId, amount, adminId: admin.id }, "payout_wallet_debited");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Payout history for a merchant ─────────────────────────────────────────
router.get("/:merchantId/payouts", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    const { page = "1", limit = "25", status, transferStatus } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [eq(withdrawalsTable.merchantId, merchantId)];
    if (status) conditions.push(eq(withdrawalsTable.status, status));
    if (transferStatus) conditions.push(eq(withdrawalsTable.transferStatus, transferStatus));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(withdrawalsTable).where(where).orderBy(desc(withdrawalsTable.createdAt)).limit(limitNum).offset(offset),
      db.select({ total: count() }).from(withdrawalsTable).where(where),
    ]);

    res.json({ payouts: rows, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) { next(err); }
});

// ── Ledger for a merchant ─────────────────────────────────────────────────
router.get("/:merchantId/ledger", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    const { page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(walletLedgerTable).where(eq(walletLedgerTable.merchantId, merchantId))
        .orderBy(desc(walletLedgerTable.createdAt)).limit(limitNum).offset(offset),
      db.select({ total: count() }).from(walletLedgerTable).where(eq(walletLedgerTable.merchantId, merchantId)),
    ]);
    res.json({ entries: rows, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) { next(err); }
});

// ── Beneficiaries for a merchant ──────────────────────────────────────────
router.get("/:merchantId/beneficiaries", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    const rows = await db.select().from(payoutBeneficiariesTable)
      .where(eq(payoutBeneficiariesTable.merchantId, merchantId))
      .orderBy(desc(payoutBeneficiariesTable.createdAt));
    res.json({ beneficiaries: rows });
  } catch (err) { next(err); }
});

export default router;
