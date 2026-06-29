import { Router } from "express";
import {
  db,
  withdrawalsTable,
  merchantsTable,
  merchantWalletsTable,
  auditLogsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { eq, and, count, sum, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { requireModule } from "../middlewares/checkModule";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";
import {
  cashfreePayoutCreateTransfer,
  cashfreePayoutGetTransferStatus,
  normalizeCashfreePayoutStatus,
  type CashfreePayoutEnv,
} from "../helpers/cashfreePayout";
import { mutateWallet } from "./wallets";

const router = Router();
router.use(requireAuth);

function numStr(v: string | null | undefined): number {
  return v == null ? 0 : Number(v);
}

async function getPayoutConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV,
    SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map(r => [r.key, r.value]));
  return {
    clientId: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_ID) ?? "",
    clientSecret: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET) ?? "",
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENV) ?? "test") as CashfreePayoutEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_ENABLED) === "true",
  };
}

function mapWithdrawal(
  w: typeof withdrawalsTable.$inferSelect,
  merchantName?: string | null,
  isAdmin = false
) {
  return {
    id: w.id,
    merchantId: w.merchantId,
    merchantName: merchantName ?? null,
    amount: Number(w.amount),
    currency: w.currency,
    status: w.status,
    transferStatus: w.transferStatus,
    utr: w.transferStatus === "SUCCESS" ? w.utr : null,
    failureReason:
      isAdmin
        ? w.failureReason
        : ["FAILED", "REVERSED"].includes(w.transferStatus)
          ? w.failureReason
          : null,
    payoutMode: w.payoutMode,
    upiId: w.upiId,
    remarks: w.remarks,
    bankAccount: w.bankAccount,
    bankName: w.bankName,
    ifscCode: w.ifscCode,
    accountHolder: w.accountHolder,
    rejectionReason: w.rejectionReason,
    approvedAt: w.approvedAt?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

// GET /api/withdrawals
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, merchantId, transferStatus, page = "1", limit = "20" } =
    req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;
  const isAdmin = user.role === "admin";

  const conditions = [];
  if (!isAdmin) conditions.push(eq(withdrawalsTable.merchantId, user.merchantId!));
  if (status && status !== "all") conditions.push(eq(withdrawalsTable.status, status));
  if (transferStatus && transferStatus !== "all")
    conditions.push(eq(withdrawalsTable.transferStatus, transferStatus));
  if (merchantId && isAdmin)
    conditions.push(eq(withdrawalsTable.merchantId, parseInt(merchantId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [aggregates, rows] = await Promise.all([
    db
      .select({
        total: count(),
        totalVolume: sum(withdrawalsTable.amount),
        pendingCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'pending' THEN 1 END`),
        approvedCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'approved' THEN 1 END`),
        rejectedCount: count(sql`CASE WHEN ${withdrawalsTable.status} = 'rejected' THEN 1 END`),
        processingCount: count(
          sql`CASE WHEN ${withdrawalsTable.status} = 'approved' AND ${withdrawalsTable.transferStatus} IN ('INITIATED','PENDING','NOT_STARTED') THEN 1 END`
        ),
        successCount: count(
          sql`CASE WHEN ${withdrawalsTable.transferStatus} = 'SUCCESS' THEN 1 END`
        ),
        failedCount: count(
          sql`CASE WHEN ${withdrawalsTable.transferStatus} IN ('FAILED','REVERSED') THEN 1 END`
        ),
        lockedAmount: sum(
          sql`CASE WHEN ${withdrawalsTable.status} = 'approved' AND ${withdrawalsTable.transferStatus} NOT IN ('SUCCESS','FAILED','REVERSED') THEN ${withdrawalsTable.amount} ELSE 0 END`
        ),
      })
      .from(withdrawalsTable)
      .where(where),
    db
      .select({
        withdrawal: withdrawalsTable,
        merchantName: merchantsTable.businessName,
      })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(where)
      .limit(limitNum)
      .offset(offset)
      .orderBy(sql`${withdrawalsTable.createdAt} DESC`),
  ]);

  const agg = aggregates[0]!;
  res.json({
    data: rows.map(r => mapWithdrawal(r.withdrawal, r.merchantName, isAdmin)),
    total: agg.total,
    page: pageNum,
    limit: limitNum,
    stats: {
      totalVolume: Number(agg.totalVolume ?? 0),
      pendingCount: Number(agg.pendingCount),
      approvedCount: Number(agg.approvedCount),
      rejectedCount: Number(agg.rejectedCount),
      processingCount: Number(agg.processingCount),
      successCount: Number(agg.successCount),
      failedCount: Number(agg.failedCount),
      lockedAmount: Number(agg.lockedAmount ?? 0),
    },
  });
});

// POST /api/withdrawals — merchant creates payout request
router.post("/", requireModule("merchant_withdrawals"), async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Only merchants can request payouts" });
    return;
  }

  const { amount, bankAccount, bankName, ifscCode, accountHolder, payoutMode = "IMPS", upiId, remarks } =
    req.body;

  if (!amount || Number(amount) <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  if (payoutMode === "UPI") {
    if (!upiId?.trim()) {
      res.status(400).json({ error: "upiId required for UPI mode" });
      return;
    }
  } else {
    if (!bankAccount || !bankName || !ifscCode || !accountHolder) {
      res.status(400).json({
        error: "bankAccount, bankName, ifscCode, accountHolder required for bank transfer",
      });
      return;
    }
  }

  const limitCheck = await checkPlanLimit(user.merchantId!, "payout", user.id);
  if (!limitCheck.allowed) {
    rejectWithLimitError(res, limitCheck.message!);
    return;
  }

  const amt = Number(amount);

  await db
    .insert(merchantWalletsTable)
    .values({ merchantId: user.merchantId! })
    .onConflictDoNothing();
  const [wallet] = await db
    .select()
    .from(merchantWalletsTable)
    .where(eq(merchantWalletsTable.merchantId, user.merchantId!))
    .limit(1);

  if (!wallet || numStr(wallet.availableBalance) < amt) {
    res.status(400).json({ error: "Insufficient available balance" });
    return;
  }

  const [withdrawal] = await db
    .insert(withdrawalsTable)
    .values({
      merchantId: user.merchantId!,
      amount: String(amt),
      bankAccount: bankAccount ?? "",
      bankName: bankName ?? "",
      ifscCode: ifscCode ?? "",
      accountHolder: accountHolder ?? "",
      payoutMode,
      upiId: payoutMode === "UPI" ? (upiId?.trim() ?? null) : null,
      remarks: remarks?.trim() ?? null,
      status: "pending",
      transferStatus: "NOT_STARTED",
    })
    .returning();

  await mutateWallet(
    user.merchantId!,
    { availableDelta: -amt, holdDelta: amt },
    {
      txnType: "payout_hold",
      bucket: "available",
      amount: -amt,
      referenceType: "withdrawal",
      referenceId: withdrawal.id,
      description: `Payout request #${withdrawal.id} — ₹${amt.toFixed(2)} locked`,
      createdBy: null,
    }
  );

  req.log.info(
    { merchantId: user.merchantId, withdrawalId: withdrawal.id, amount: amt },
    "payout_requested"
  );
  res.status(201).json(mapWithdrawal(withdrawal, null, false));
});

// POST /api/withdrawals/:id/approve
router.post("/:id/approve", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
    .from(withdrawalsTable)
    .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
    .where(eq(withdrawalsTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  if (row.withdrawal.status !== "pending") {
    res.status(400).json({ error: `Payout is already ${row.withdrawal.status}` });
    return;
  }

  const w = row.withdrawal;
  const merchantName = row.merchantName ?? null;
  const amt = Number(w.amount);
  const cfg = await getPayoutConfig();

  let transferStatus = "INITIATED";
  let providerReferenceId: string | null = null;
  let utr: string | null = null;
  let failureReason: string | null = null;

  if (cfg.enabled && cfg.clientId && cfg.clientSecret) {
    const transferId = `RKPAY_${id}_${Date.now()}`;
    try {
      const result = await cashfreePayoutCreateTransfer(
        cfg.clientId,
        cfg.clientSecret,
        cfg.env,
        {
          transferId,
          referenceId: transferId,
          beneficiaryName: w.accountHolder || merchantName || "Merchant",
          accountNumber: w.bankAccount || undefined,
          ifsc: w.ifscCode || undefined,
          upiId: w.payoutMode === "UPI" ? (w.upiId ?? undefined) : undefined,
          amount: amt,
          remark: `Payout #${id}`,
        }
      );
      providerReferenceId = transferId;
      const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
      if (normalized === "SUCCESS") {
        transferStatus = "SUCCESS";
        utr = result.parsed?.utr ?? null;
      } else if (normalized === "FAILED") {
        transferStatus = "FAILED";
        failureReason = result.parsed?.message ?? "Transfer failed";
      } else {
        transferStatus = "PENDING";
      }
    } catch (err: any) {
      req.log.warn({ err, withdrawalId: id }, "cashfree_payout_create_error");
      transferStatus = "INITIATED";
      providerReferenceId = `RKPAY_${id}_${Date.now()}`;
    }
  }

  const now = new Date();
  const isTerminal = ["SUCCESS", "FAILED", "REVERSED"].includes(transferStatus);

  const [updated] = await db
    .update(withdrawalsTable)
    .set({
      status: "approved",
      transferStatus,
      providerReferenceId,
      utr,
      failureReason,
      approvedByAdminId: user.id,
      approvedAt: now,
      completedAt: isTerminal ? now : null,
    })
    .where(eq(withdrawalsTable.id, id))
    .returning();

  if (transferStatus === "SUCCESS") {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, totalPayoutDelta: amt },
      {
        txnType: "payout_success",
        bucket: "hold",
        amount: -amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} successful — ₹${amt.toFixed(2)} settled`,
        createdBy: user.id,
      }
    );
  } else if (transferStatus === "FAILED" || transferStatus === "REVERSED") {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
      {
        txnType: "payout_failed_release",
        bucket: "hold",
        amount: amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} failed — ₹${amt.toFixed(2)} released back`,
        createdBy: user.id,
      }
    );
  }

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_approved",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({ amount: amt, transferStatus, providerReferenceId }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info({ withdrawalId: id, transferStatus, adminId: user.id }, "payout_approved");
  res.json(mapWithdrawal(updated, merchantName, true));
});

// POST /api/withdrawals/:id/reject
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const { reason } = req.body;
  if (!reason?.trim()) {
    res.status(400).json({ error: "Rejection reason required" });
    return;
  }

  const [row] = await db
    .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
    .from(withdrawalsTable)
    .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
    .where(eq(withdrawalsTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  if (row.withdrawal.status !== "pending") {
    res.status(400).json({ error: `Payout is already ${row.withdrawal.status}` });
    return;
  }

  const w = row.withdrawal;
  const merchantName = row.merchantName ?? null;
  const amt = Number(w.amount);

  await mutateWallet(
    w.merchantId,
    { holdDelta: -amt, availableDelta: amt },
    {
      txnType: "payout_release",
      bucket: "hold",
      amount: amt,
      referenceType: "withdrawal",
      referenceId: id,
      description: `Payout #${id} rejected — ₹${amt.toFixed(2)} released back`,
      createdBy: user.id,
    }
  );

  const [updated] = await db
    .update(withdrawalsTable)
    .set({ status: "rejected", rejectionReason: reason.trim() })
    .where(eq(withdrawalsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_rejected",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({ amount: amt, reason: reason.trim() }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info({ withdrawalId: id, adminId: user.id }, "payout_rejected");
  res.json(mapWithdrawal(updated, merchantName, true));
});

// POST /api/withdrawals/:id/refresh-status
router.post("/:id/refresh-status", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
    .from(withdrawalsTable)
    .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
    .where(eq(withdrawalsTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  const w = row.withdrawal;
  const merchantName = row.merchantName ?? null;

  if (w.status !== "approved") {
    res.status(400).json({ error: "Can only refresh approved payouts" });
    return;
  }
  if (!w.providerReferenceId) {
    res.status(400).json({ error: "No provider reference — payout was not dispatched to provider" });
    return;
  }

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId) {
    res.status(400).json({ error: "Cashfree payout not configured" });
    return;
  }

  const result = await cashfreePayoutGetTransferStatus(
    cfg.clientId,
    cfg.clientSecret,
    cfg.env,
    w.providerReferenceId
  );
  const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
  const prevStatus = w.transferStatus;
  const amt = Number(w.amount);
  const now = new Date();

  const newTransferStatus =
    normalized === "SUCCESS" ? "SUCCESS" : normalized === "FAILED" ? "FAILED" : w.transferStatus;
  const utr = normalized === "SUCCESS" ? (result.parsed?.utr ?? w.utr) : w.utr;
  const failureReason =
    normalized === "FAILED"
      ? (result.parsed?.message ?? "Transfer failed")
      : w.failureReason;
  const completedAt =
    normalized === "SUCCESS" || normalized === "FAILED" ? now : (w.completedAt ?? null);

  if (prevStatus !== "SUCCESS" && normalized === "SUCCESS") {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, totalPayoutDelta: amt },
      {
        txnType: "payout_success",
        bucket: "hold",
        amount: -amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} confirmed successful — ₹${amt.toFixed(2)} settled`,
        createdBy: user.id,
      }
    );
  } else if (!["FAILED", "REVERSED"].includes(prevStatus) && normalized === "FAILED") {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
      {
        txnType: "payout_failed_release",
        bucket: "hold",
        amount: amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} confirmed failed — ₹${amt.toFixed(2)} released back`,
        createdBy: user.id,
      }
    );
  }

  const [updated] = await db
    .update(withdrawalsTable)
    .set({ transferStatus: newTransferStatus, utr, failureReason, completedAt })
    .where(eq(withdrawalsTable.id, id))
    .returning();

  req.log.info({ withdrawalId: id, prevStatus, newTransferStatus }, "payout_status_refreshed");
  res.json(mapWithdrawal(updated, merchantName, true));
});

// POST /api/withdrawals/:id/retry
router.post("/:id/retry", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const [row] = await db
    .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
    .from(withdrawalsTable)
    .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
    .where(eq(withdrawalsTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  const w = row.withdrawal;
  const merchantName = row.merchantName ?? null;

  if (w.status !== "approved") {
    res.status(400).json({ error: "Can only retry approved payouts" });
    return;
  }
  if (!["FAILED", "REVERSED", "INITIATED"].includes(w.transferStatus)) {
    res.status(400).json({
      error: `Payout transfer status is ${w.transferStatus} — only FAILED/REVERSED/INITIATED can be retried`,
    });
    return;
  }

  const cfg = await getPayoutConfig();
  if (!cfg.enabled || !cfg.clientId) {
    res.status(400).json({ error: "Cashfree payout not configured" });
    return;
  }

  const amt = Number(w.amount);
  const wasReleased = ["FAILED", "REVERSED"].includes(w.transferStatus);

  if (wasReleased) {
    await db
      .insert(merchantWalletsTable)
      .values({ merchantId: w.merchantId })
      .onConflictDoNothing();
    const [wallet] = await db
      .select()
      .from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, w.merchantId))
      .limit(1);
    if (!wallet || numStr(wallet.availableBalance) < amt) {
      res.status(400).json({ error: "Insufficient available balance to retry payout" });
      return;
    }
    await mutateWallet(
      w.merchantId,
      { availableDelta: -amt, holdDelta: amt },
      {
        txnType: "payout_hold",
        bucket: "available",
        amount: -amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} retry — ₹${amt.toFixed(2)} re-locked`,
        createdBy: user.id,
      }
    );
  }

  const newTransferId = `RKPAY_${id}_RETRY_${Date.now()}`;
  let transferStatus = "INITIATED";
  let utr: string | null = null;
  let failureReason: string | null = null;

  try {
    const result = await cashfreePayoutCreateTransfer(
      cfg.clientId,
      cfg.clientSecret,
      cfg.env,
      {
        transferId: newTransferId,
        referenceId: newTransferId,
        beneficiaryName: w.accountHolder || merchantName || "Merchant",
        accountNumber: w.bankAccount || undefined,
        ifsc: w.ifscCode || undefined,
        upiId: w.payoutMode === "UPI" ? (w.upiId ?? undefined) : undefined,
        amount: amt,
        remark: `Payout #${id} retry`,
      }
    );
    const normalized = normalizeCashfreePayoutStatus(result.parsed?.status);
    if (normalized === "SUCCESS") {
      transferStatus = "SUCCESS";
      utr = result.parsed?.utr ?? null;
    } else if (normalized === "FAILED") {
      transferStatus = "FAILED";
      failureReason = result.parsed?.message ?? "Transfer failed";
      if (wasReleased) {
        await mutateWallet(
          w.merchantId,
          { holdDelta: -amt, availableDelta: amt, totalReversalsDelta: amt },
          {
            txnType: "payout_failed_release",
            bucket: "hold",
            amount: amt,
            referenceType: "withdrawal",
            referenceId: id,
            description: `Payout #${id} retry failed — ₹${amt.toFixed(2)} released back`,
            createdBy: user.id,
          }
        );
      }
    } else {
      transferStatus = "PENDING";
    }
  } catch (err: any) {
    req.log.warn({ err, withdrawalId: id }, "cashfree_payout_retry_error");
    transferStatus = "INITIATED";
  }

  if (transferStatus === "SUCCESS") {
    await mutateWallet(
      w.merchantId,
      { holdDelta: -amt, totalPayoutDelta: amt },
      {
        txnType: "payout_success",
        bucket: "hold",
        amount: -amt,
        referenceType: "withdrawal",
        referenceId: id,
        description: `Payout #${id} retry successful — ₹${amt.toFixed(2)} settled`,
        createdBy: user.id,
      }
    );
  }

  const now = new Date();
  const isTerminal = ["SUCCESS", "FAILED", "REVERSED"].includes(transferStatus);
  const [updated] = await db
    .update(withdrawalsTable)
    .set({
      transferStatus,
      providerReferenceId: newTransferId,
      utr,
      failureReason,
      completedAt: isTerminal ? now : null,
    })
    .where(eq(withdrawalsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action: "payout_retried",
    targetType: "withdrawal",
    targetId: id,
    details: JSON.stringify({ transferStatus, newTransferId }),
    ipAddress: (req as any).ip ?? null,
  });

  req.log.info({ withdrawalId: id, transferStatus }, "payout_retried");
  res.json(mapWithdrawal(updated, merchantName, true));
});

export default router;
