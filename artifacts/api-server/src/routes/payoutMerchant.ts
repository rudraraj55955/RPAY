/**
 * Payout Merchant routes — /api/payout-merchant/*
 *
 * These routes serve merchants whose merchantType is PAYOUT_ONLY or BOTH.
 * They reuse the same underlying DB tables as the normal payout engine.
 */
import { Router } from "express";
import {
  db,
  merchantsTable,
  merchantWalletsTable,
  withdrawalsTable,
  payoutBeneficiariesTable,
  walletLedgerTable,
} from "@workspace/db";
import { eq, and, desc, count, sql, inArray, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// ── Guard: payout merchant only ──────────────────────────────────────────────
async function requirePayoutMerchant(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Payout merchant access required" });
    return;
  }
  const [m] = await db
    .select({
      merchantType: merchantsTable.merchantType,
      payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
      status: merchantsTable.status,
    })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, user.merchantId))
    .limit(1);

  if (!m || (m.merchantType !== "PAYOUT_ONLY" && m.merchantType !== "BOTH")) {
    res.status(403).json({ error: "This account does not have payout merchant access" });
    return;
  }
  req.merchant = m;
  next();
}

// GET /api/payout-merchant/config
router.get("/config", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const [m] = await db
      .select({
        merchantType: merchantsTable.merchantType,
        payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
        payinServiceEnabled: merchantsTable.payinServiceEnabled,
        collectionServiceEnabled: merchantsTable.collectionServiceEnabled,
        approvedForPayoutAt: merchantsTable.approvedForPayoutAt,
        payoutLimitsJson: merchantsTable.payoutLimitsJson,
        payoutFeeJson: merchantsTable.payoutFeeJson,
        agentId: merchantsTable.agentId,
        businessName: merchantsTable.businessName,
        contactName: merchantsTable.contactName,
        email: merchantsTable.email,
        phone: merchantsTable.phone,
        status: merchantsTable.status,
        logoUrl: merchantsTable.logoUrl,
      })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId))
      .limit(1);

    if (!m) { res.status(404).json({ error: "Merchant not found" }); return; }

    res.json({
      merchantType: m.merchantType,
      payoutServiceEnabled: m.payoutServiceEnabled,
      payinServiceEnabled: m.payinServiceEnabled,
      collectionServiceEnabled: m.collectionServiceEnabled,
      approvedForPayoutAt: m.approvedForPayoutAt,
      payoutLimits: m.payoutLimitsJson ?? { minAmount: 1, maxAmount: 200000, dailyLimit: 1000000, monthlyLimit: 10000000 },
      payoutFee: m.payoutFeeJson ?? { feeType: "flat", fee: 0, gstRate: 18, providerCost: 0 },
      agentId: m.agentId,
      merchant: {
        businessName: m.businessName,
        contactName: m.contactName,
        email: m.email,
        phone: m.phone,
        status: m.status,
        logoUrl: m.logoUrl,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/payout-merchant/wallet
router.get("/wallet", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const [wallet] = await db
      .select()
      .from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId))
      .limit(1);

    if (!wallet) {
      res.json({ availableBalance: "0.00", holdBalance: "0.00", totalPayout: "0.00", currency: "INR" });
      return;
    }

    res.json({
      availableBalance: wallet.availableBalance,
      holdBalance: wallet.holdBalance,
      totalPayout: wallet.totalPayout,
      totalCollection: wallet.totalCollection,
      totalCharges: wallet.totalCharges,
      totalRefunds: wallet.totalRefunds,
      currency: wallet.currency,
    });
  } catch (err) { next(err); }
});

// GET /api/payout-merchant/payouts
router.get("/payouts", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
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

    const sanitized = rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      displayStatus: mapTransferStatus(r.transferStatus, r.status),
      payoutMode: r.payoutMode,
      accountHolder: r.accountHolder,
      bankAccountMasked: r.bankAccount ? maskAccount(r.bankAccount) : null,
      bankName: r.bankName,
      ifscCode: r.ifscCode,
      upiId: r.upiId,
      utr: r.transferStatus === "SUCCESS" ? r.utr : null,
      failureReason: (r.transferStatus === "FAILED" || r.transferStatus === "REVERSED") ? mapFailureReason(r.failureReason) : null,
      approvedAt: r.approvedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    }));

    res.json({ payouts: sanitized, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) { next(err); }
});

// GET /api/payout-merchant/payouts/:id
router.get("/payouts/:id", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const id = parseInt(req.params["id"] as string);
    const [r] = await db.select().from(withdrawalsTable)
      .where(and(eq(withdrawalsTable.id, id), eq(withdrawalsTable.merchantId, merchantId))).limit(1);
    if (!r) { res.status(404).json({ error: "Payout not found" }); return; }
    res.json({
      id: r.id, amount: r.amount, currency: r.currency, status: r.status,
      displayStatus: mapTransferStatus(r.transferStatus, r.status),
      payoutMode: r.payoutMode,
      accountHolder: r.accountHolder,
      bankAccountMasked: r.bankAccount ? maskAccount(r.bankAccount) : null,
      bankName: r.bankName, ifscCode: r.ifscCode, upiId: r.upiId,
      utr: r.transferStatus === "SUCCESS" ? r.utr : null,
      failureReason: (r.transferStatus === "FAILED" || r.transferStatus === "REVERSED") ? mapFailureReason(r.failureReason) : null,
      approvedAt: r.approvedAt, completedAt: r.completedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
    });
  } catch (err) { next(err); }
});

// GET /api/payout-merchant/beneficiaries
router.get("/beneficiaries", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const rows = await db.select({
      id: payoutBeneficiariesTable.id,
      accountHolder: payoutBeneficiariesTable.accountHolder,
      payoutMode: payoutBeneficiariesTable.payoutMode,
      bankAccount: payoutBeneficiariesTable.bankAccount,
      ifscCode: payoutBeneficiariesTable.ifscCode,
      bankName: payoutBeneficiariesTable.bankName,
      upiId: payoutBeneficiariesTable.upiId,
      label: payoutBeneficiariesTable.label,
      localStatus: payoutBeneficiariesTable.localStatus,
      providerStatus: payoutBeneficiariesTable.providerStatus,
      env: payoutBeneficiariesTable.env,
      createdAt: payoutBeneficiariesTable.createdAt,
    }).from(payoutBeneficiariesTable)
      .where(and(
        eq(payoutBeneficiariesTable.merchantId, merchantId),
        ne(payoutBeneficiariesTable.localStatus, "disabled")
      ))
      .orderBy(desc(payoutBeneficiariesTable.createdAt));

    const sanitized = rows.map((r) => ({
      ...r,
      bankAccountMasked: r.bankAccount ? maskAccount(r.bankAccount) : null,
      bankAccount: undefined,
      verificationStatus: r.providerStatus === "created" ? "VERIFIED" : r.providerStatus === "failed" ? "FAILED" : "PENDING",
    }));
    res.json({ beneficiaries: sanitized });
  } catch (err) { next(err); }
});

// GET /api/payout-merchant/ledger
router.get("/ledger", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const { page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const payoutTxnTypes = ["withdrawal_request", "payout_hold", "withdrawal_debit", "withdrawal_refund", "payout_reversal", "admin_credit", "admin_debit", "wallet_credit", "wallet_debit"];

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(walletLedgerTable)
        .where(and(
          eq(walletLedgerTable.merchantId, merchantId),
          inArray(walletLedgerTable.txnType as any, payoutTxnTypes)
        ))
        .orderBy(desc(walletLedgerTable.createdAt)).limit(limitNum).offset(offset),
      db.select({ total: count() }).from(walletLedgerTable)
        .where(and(
          eq(walletLedgerTable.merchantId, merchantId),
          inArray(walletLedgerTable.txnType as any, payoutTxnTypes)
        )),
    ]);

    res.json({ entries: rows, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) { next(err); }
});

// GET /api/payout-merchant/stats
router.get("/stats", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const [pending, success, failed, wallet] = await Promise.all([
      db.select({ count: count(), total: sql<string>`COALESCE(SUM(amount),0)` })
        .from(withdrawalsTable).where(and(eq(withdrawalsTable.merchantId, merchantId), eq(withdrawalsTable.status, "pending"))),
      db.select({ count: count(), total: sql<string>`COALESCE(SUM(amount),0)` })
        .from(withdrawalsTable).where(and(eq(withdrawalsTable.merchantId, merchantId), eq(withdrawalsTable.transferStatus, "SUCCESS"))),
      db.select({ count: count() })
        .from(withdrawalsTable).where(and(eq(withdrawalsTable.merchantId, merchantId), inArray(withdrawalsTable.transferStatus as any, ["FAILED", "REVERSED"]))),
      db.select({ availableBalance: merchantWalletsTable.availableBalance, holdBalance: merchantWalletsTable.holdBalance })
        .from(merchantWalletsTable).where(eq(merchantWalletsTable.merchantId, merchantId)).limit(1),
    ]);
    res.json({
      pendingCount: pending[0]?.count ?? 0,
      pendingTotal: pending[0]?.total ?? "0",
      successCount: success[0]?.count ?? 0,
      successTotal: success[0]?.total ?? "0",
      failedCount: failed[0]?.count ?? 0,
      walletAvailable: wallet[0]?.availableBalance ?? "0",
      walletHold: wallet[0]?.holdBalance ?? "0",
    });
  } catch (err) { next(err); }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function maskAccount(acct: string): string {
  if (acct.length <= 4) return "****";
  return "*".repeat(Math.max(acct.length - 4, 4)) + acct.slice(-4);
}

function mapTransferStatus(transferStatus: string | null | undefined, status: string | null): string {
  if (status === "rejected") return "Rejected";
  if (status === "pending") return "Processing";
  if (transferStatus === "SUCCESS") return "Sent";
  if (transferStatus === "FAILED") return "Failed";
  if (transferStatus === "REVERSED") return "Reversed";
  if (transferStatus === "INITIATED" || transferStatus === "PENDING") return "Processing";
  return "Processing";
}

// GET /api/payout-merchant/auto-payout — merchant reads their own auto-payout status (sanitized)
router.get("/auto-payout", requirePayoutMerchant, async (req, res, next) => {
  try {
    const merchantId: number = (req as any).user.merchantId;
    const [merchant] = await db
      .select({
        autoPayoutEnabled: (merchantsTable as any).autoPayoutEnabled,
        autoPayoutMaxSingleAmount: (merchantsTable as any).autoPayoutMaxSingleAmount,
        autoPayoutDailyLimit: (merchantsTable as any).autoPayoutDailyLimit,
        autoPayoutMonthlyLimit: (merchantsTable as any).autoPayoutMonthlyLimit,
        autoPayoutOnlyVerifiedBeneficiaries: (merchantsTable as any).autoPayoutOnlyVerifiedBeneficiaries,
        autoPayoutPaused: (merchantsTable as any).autoPayoutPaused,
        autoPayoutAllowedModes: (merchantsTable as any).autoPayoutAllowedModes,
      })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId))
      .limit(1);

    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    let allowedModes: string[] = ["IMPS", "NEFT", "RTGS", "UPI"];
    try {
      const raw = merchant.autoPayoutAllowedModes;
      if (raw) allowedModes = typeof raw === "string" ? JSON.parse(raw) : (raw as string[]);
    } catch { /* use default */ }

    res.json({
      autoPayoutEnabled: merchant.autoPayoutEnabled ?? false,
      autoPayoutPaused: merchant.autoPayoutPaused ?? false,
      autoPayoutMaxSingleAmount: merchant.autoPayoutMaxSingleAmount != null ? Number(merchant.autoPayoutMaxSingleAmount) : null,
      autoPayoutDailyLimit: merchant.autoPayoutDailyLimit != null ? Number(merchant.autoPayoutDailyLimit) : null,
      autoPayoutMonthlyLimit: merchant.autoPayoutMonthlyLimit != null ? Number(merchant.autoPayoutMonthlyLimit) : null,
      autoPayoutOnlyVerifiedBeneficiaries: merchant.autoPayoutOnlyVerifiedBeneficiaries ?? true,
      autoPayoutAllowedModes: allowedModes,
    });
  } catch (err) { next(err); }
});

function mapFailureReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const knownReasons: Record<string, string> = {
    "beneficiary_not_verified": "Beneficiary account could not be verified. Please re-add the beneficiary.",
    "beneficiary_not_found": "Beneficiary not found. Please add a beneficiary first.",
    "INSUFFICIENT_BALANCE": "Insufficient wallet balance at time of transfer.",
    "INVALID_IFSC": "IFSC code is invalid.",
    "INVALID_ACCOUNT": "Bank account number is invalid.",
    "BANK_REJECTED": "Bank rejected the transfer. Please try again or use a different account.",
    "TIMED_OUT": "Transfer timed out. Please contact support.",
  };
  return knownReasons[reason] ?? "Transfer could not be completed. Please contact support.";
}

export default router;
