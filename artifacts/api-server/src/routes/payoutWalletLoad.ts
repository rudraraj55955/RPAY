/**
 * Payout Merchant — Wallet Load routes
 * /api/payout-merchant/wallet/...
 *
 * Security rules:
 * - provider_order_id, provider_payment_id are NEVER returned to the merchant.
 * - Wallet credit only happens via webhook (ONLINE) or admin approval (UTR/TOPUP).
 * - Frontend success redirect never triggers credit.
 * - Duplicate UTR is blocked via unique index.
 * - Row-level locking (SELECT FOR UPDATE) on the load order before crediting.
 */
import { Router } from "express";
import {
  db,
  merchantsTable,
  merchantWalletsTable,
  walletLedgerTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  payoutWalletLoadOrdersTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

// ─── helpers ──────────────────────────────────────────────────────────────────

function numStr(v: string | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}
function fmtNum(n: number): string { return n.toFixed(2); }

function makeLoadId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `WLOAD-${ts}-${rnd}`;
}

async function getWalletLoadSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: systemConfigTable.key, value: systemConfigTable.value })
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Calculates fee + GST and returns { feeAmount, gstAmount, netCreditAmount } */
function calcFee(amount: number, feeType: string, feeValue: number, gstOnFee: boolean) {
  let feeAmount = 0;
  if (feeType === "FLAT") {
    feeAmount = feeValue;
  } else if (feeType === "PERCENTAGE") {
    feeAmount = (amount * feeValue) / 100;
  }
  const gstAmount = gstOnFee ? feeAmount * 0.18 : 0;
  const netCreditAmount = Math.max(0, amount - feeAmount - gstAmount);
  return {
    feeAmount: parseFloat(feeAmount.toFixed(2)),
    gstAmount: parseFloat(gstAmount.toFixed(2)),
    netCreditAmount: parseFloat(netCreditAmount.toFixed(2)),
  };
}

/** Guard: payout merchant only — sets req.merchantId */
async function requirePayoutMerchantGuard(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || !user.merchantId) {
    res.status(403).json({ error: "Payout merchant access required" });
    return;
  }
  const [m] = await db
    .select({
      id: merchantsTable.id,
      merchantType: merchantsTable.merchantType,
      payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
      status: merchantsTable.status,
      businessName: merchantsTable.businessName,
    })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, user.merchantId))
    .limit(1);

  if (!m || (m.merchantType !== "PAYOUT_ONLY" && m.merchantType !== "BOTH")) {
    res.status(403).json({ error: "Payout merchant access required" });
    return;
  }
  if (m.status !== "approved") {
    res.status(403).json({ error: "Your account is not approved for payout operations" });
    return;
  }
  req.merchantId = m.id;
  req.merchant = m;
  next();
}

// ─── GET /api/payout-merchant/wallet/load-settings ───────────────────────────
// Returns display-safe settings (bank/UPI details, limits, fees).
router.get("/wallet/load-settings", requirePayoutMerchantGuard, async (req, res, next) => {
  try {
    const cfg = await getWalletLoadSettings([
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ONLINE_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MANUAL_UTR_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MIN_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MAX_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_TYPE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_VALUE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_GST_ON_FEE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_REQUIRE_SCREENSHOT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_BANK_NAME,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_NUMBER,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_IFSC,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_HOLDER,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_UPI_ID,
    ]);

    res.json({
      enabled:          cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_ENABLED] !== "false",
      onlineEnabled:    cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_ONLINE_ENABLED] !== "false",
      manualUtrEnabled: cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_MANUAL_UTR_ENABLED] !== "false",
      minAmount:        Number(cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_MIN_AMOUNT] ?? "100"),
      maxAmount:        Number(cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_MAX_AMOUNT] ?? "500000"),
      feeType:          cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_TYPE] ?? "NONE",
      feeValue:         Number(cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_VALUE] ?? "0"),
      gstOnFee:         cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_GST_ON_FEE] === "true",
      requireScreenshot: cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_REQUIRE_SCREENSHOT] === "true",
      bankDetails: {
        bankName:      cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_BANK_NAME] ?? "",
        accountNumber: cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_NUMBER] ?? "",
        ifsc:          cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_IFSC] ?? "",
        accountHolder: cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_ACCOUNT_HOLDER] ?? "",
        upiId:         cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_UPI_ID] ?? "",
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /api/payout-merchant/wallet/load/create ────────────────────────────
// Creates a wallet load order for ONLINE or BANK_TRANSFER_UTR methods.
router.post("/wallet/load/create", requirePayoutMerchantGuard, async (req: any, res, next) => {
  try {
    const merchantId: number = req.merchantId;
    const { amount, method, utr, payerName, payerReference, screenshotUrl } = req.body ?? {};

    // ── Validate method ──────────────────────────────────────────────────────
    if (!method || !["ONLINE", "BANK_TRANSFER_UTR"].includes(method)) {
      res.status(400).json({ error: "Invalid method. Must be ONLINE or BANK_TRANSFER_UTR" });
      return;
    }

    // ── Load settings ────────────────────────────────────────────────────────
    const cfg = await getWalletLoadSettings([
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_ONLINE_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MANUAL_UTR_ENABLED,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MIN_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_MAX_AMOUNT,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_TYPE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_VALUE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_GST_ON_FEE,
      SYSTEM_CONFIG_KEYS.WALLET_LOAD_REQUIRE_SCREENSHOT,
    ]);

    if (cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_ENABLED] === "false") {
      res.status(403).json({ error: "Wallet fund loading is currently disabled" });
      return;
    }
    if (method === "ONLINE" && cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_ONLINE_ENABLED] === "false") {
      res.status(403).json({ error: "Online wallet loading is currently disabled" });
      return;
    }
    if (method === "BANK_TRANSFER_UTR" && cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_MANUAL_UTR_ENABLED] === "false") {
      res.status(403).json({ error: "Manual UTR loading is currently disabled" });
      return;
    }

    // ── Amount validation ────────────────────────────────────────────────────
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }
    const minAmount = Number(cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_MIN_AMOUNT] ?? "100");
    const maxAmount = Number(cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_MAX_AMOUNT] ?? "500000");
    if (parsedAmount < minAmount) {
      res.status(400).json({ error: `Minimum load amount is ₹${minAmount}` });
      return;
    }
    if (parsedAmount > maxAmount) {
      res.status(400).json({ error: `Maximum load amount is ₹${maxAmount}` });
      return;
    }

    // ── UTR validation ───────────────────────────────────────────────────────
    if (method === "BANK_TRANSFER_UTR") {
      if (!utr || typeof utr !== "string" || utr.trim().length < 6) {
        res.status(400).json({ error: "UTR/reference number is required and must be at least 6 characters" });
        return;
      }
      if (!payerName || typeof payerName !== "string" || payerName.trim().length < 2) {
        res.status(400).json({ error: "Payer name is required" });
        return;
      }
      const requireScreenshot = cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_REQUIRE_SCREENSHOT] === "true";
      if (requireScreenshot && !screenshotUrl) {
        res.status(400).json({ error: "Payment screenshot is required" });
        return;
      }
      // Duplicate UTR check
      const [existing] = await db
        .select({ id: payoutWalletLoadOrdersTable.id, status: payoutWalletLoadOrdersTable.status })
        .from(payoutWalletLoadOrdersTable)
        .where(eq(payoutWalletLoadOrdersTable.utr, utr.trim().toUpperCase()))
        .limit(1);
      if (existing) {
        // Audit log duplicate UTR attempt
        await db.insert(auditLogsTable).values({
          adminId:    req.user.id,
          adminEmail: req.user.email ?? "system@rasokart.com",
          action:     "DUPLICATE_UTR_BLOCKED",
          targetType: "payout_wallet_load",
          targetId:   existing.id,
          details:    JSON.stringify({ utr, merchantId }),
        }).catch(() => {});
        res.status(409).json({ error: "This UTR has already been submitted. Duplicate UTR is not allowed." });
        return;
      }
    }

    // ── Fee calculation ──────────────────────────────────────────────────────
    const feeType  = cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_TYPE] ?? "NONE";
    const feeValue = Number(cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_FEE_VALUE] ?? "0");
    const gstOnFee = cfg[SYSTEM_CONFIG_KEYS.WALLET_LOAD_GST_ON_FEE] === "true";
    const { feeAmount, gstAmount, netCreditAmount } = calcFee(parsedAmount, feeType, feeValue, gstOnFee);

    // ── Create load order ────────────────────────────────────────────────────
    const loadId = makeLoadId();
    const internalOrderId = method === "ONLINE" ? `WLOAD_${loadId}` : null;
    const initialStatus   = method === "ONLINE" ? "CREATED" : "PENDING_VERIFICATION";

    const [loadOrder] = await db
      .insert(payoutWalletLoadOrdersTable)
      .values({
        loadId,
        merchantId,
        amount:         fmtNum(parsedAmount),
        feeAmount:      fmtNum(feeAmount),
        gstAmount:      fmtNum(gstAmount),
        netCreditAmount: fmtNum(netCreditAmount),
        method,
        status: initialStatus,
        internalOrderId,
        utr:            method === "BANK_TRANSFER_UTR" ? utr.trim().toUpperCase() : null,
        payerName:      method === "BANK_TRANSFER_UTR" ? payerName?.trim() ?? null : null,
        payerReference: payerReference?.trim() ?? null,
        screenshotUrl:  screenshotUrl ?? null,
      })
      .returning();

    // ── Audit log ────────────────────────────────────────────────────────────
    await db.insert(auditLogsTable).values({
      adminId:    req.user.id,
      adminEmail: req.user.email ?? "system@rasokart.com",
      action:     "WALLET_LOAD_CREATED",
      targetType: "payout_wallet_load",
      targetId:   loadOrder.id,
      details:    JSON.stringify({ loadId, method, amount: parsedAmount, merchantId }),
    }).catch(() => {});

    // ── For ONLINE: create Cashfree payment order ────────────────────────────
    let checkoutUrl: string | null = null;
    let paymentSessionId: string | null = null;

    if (method === "ONLINE") {
      try {
        // Fetch Cashfree credentials from system config
        const cfgKeys = [
          SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID,
          SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
          SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
          SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
          SYSTEM_CONFIG_KEYS.CASHFREE_API_VERSION,
        ];
        const cfCfg = await getWalletLoadSettings(cfgKeys);

        if (cfCfg[SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED] !== "true") {
          // Mark order as FAILED if Cashfree is not configured
          await db.update(payoutWalletLoadOrdersTable)
            .set({ status: "FAILED", updatedAt: new Date() })
            .where(eq(payoutWalletLoadOrdersTable.id, loadOrder.id));
          res.status(503).json({ error: "Online payment gateway is not configured. Please use Bank Transfer." });
          return;
        }

        const isLive   = cfCfg[SYSTEM_CONFIG_KEYS.CASHFREE_ENV] === "live";
        const baseUrl  = isLive ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
        const apiVer   = cfCfg[SYSTEM_CONFIG_KEYS.CASHFREE_API_VERSION] ?? "2025-01-01";
        const clientId = cfCfg[SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID] ?? "";
        const clientSec = cfCfg[SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET] ?? "";

        const orderPayload = {
          order_id: internalOrderId,
          order_amount: parsedAmount,
          order_currency: "INR",
          order_note: `RasoKart Wallet Load — ${loadId}`,
          customer_details: {
            customer_id: `PMKT_${merchantId}`,
            customer_name: req.merchant.businessName ?? "Payout Merchant",
            customer_email: req.user.email ?? "merchant@rasokart.com",
            customer_phone: "9999999999",
          },
          order_meta: {
            return_url: `${process.env.FRONTEND_BASE_URL ?? ""}/payout-merchant/wallet?load=${loadId}&status=pending`,
            notify_url: `${process.env.CASHFREE_WEBHOOK_URL ?? process.env.API_BASE_URL ?? ""}/api/payment/cashfree-webhook`,
          },
        };

        const cfRes = await fetch(`${baseUrl}/pg/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-client-id": clientId,
            "x-client-secret": clientSec,
            "x-api-version": apiVer,
          },
          body: JSON.stringify(orderPayload),
        });

        if (cfRes.ok) {
          const cfData = await cfRes.json() as any;
          paymentSessionId = cfData.payment_session_id ?? null;
          checkoutUrl      = cfData.payment_link ?? null;
          // Update order status to PROCESSING
          await db.update(payoutWalletLoadOrdersTable)
            .set({ status: "PROCESSING", updatedAt: new Date() })
            .where(eq(payoutWalletLoadOrdersTable.id, loadOrder.id));
        } else {
          const errBody = await cfRes.text();
          req.log.warn({ internalOrderId, errBody }, "Cashfree wallet load order creation failed");
          await db.update(payoutWalletLoadOrdersTable)
            .set({ status: "FAILED", updatedAt: new Date() })
            .where(eq(payoutWalletLoadOrdersTable.id, loadOrder.id));
          res.status(502).json({ error: "Payment gateway error. Please try again or use Bank Transfer." });
          return;
        }
      } catch (cfErr: any) {
        req.log.error({ err: cfErr.message, internalOrderId }, "Cashfree wallet load order error");
        await db.update(payoutWalletLoadOrdersTable)
          .set({ status: "FAILED", updatedAt: new Date() })
          .where(eq(payoutWalletLoadOrdersTable.id, loadOrder.id));
        res.status(502).json({ error: "Payment gateway error. Please try Bank Transfer instead." });
        return;
      }
    }

    res.status(201).json({
      loadId,
      method,
      amount:         parsedAmount,
      feeAmount,
      gstAmount,
      netCreditAmount,
      status: method === "ONLINE" ? "PROCESSING" : "PENDING_VERIFICATION",
      ...(method === "ONLINE" && { checkoutUrl, paymentSessionId }),
      message: method === "ONLINE"
        ? "Payment order created. Complete payment to load wallet."
        : "Request submitted. Admin will verify and approve your deposit.",
    });
  } catch (err: any) {
    if (err?.code === "23505" && err?.detail?.includes("pwlo_utr_uniq")) {
      res.status(409).json({ error: "This UTR has already been submitted. Duplicate UTR is not allowed." });
      return;
    }
    next(err);
  }
});

// ─── GET /api/payout-merchant/wallet/load-history ────────────────────────────
// Returns merchant's own load orders. Provider IDs are stripped.
router.get("/wallet/load-history", requirePayoutMerchantGuard, async (req: any, res, next) => {
  try {
    const merchantId: number = req.merchantId;
    const limit  = Math.min(parseInt((req.query.limit as string) ?? "20"), 100);
    const offset = parseInt((req.query.offset as string) ?? "0");

    const rows = await db
      .select({
        id:             payoutWalletLoadOrdersTable.id,
        loadId:         payoutWalletLoadOrdersTable.loadId,
        amount:         payoutWalletLoadOrdersTable.amount,
        feeAmount:      payoutWalletLoadOrdersTable.feeAmount,
        gstAmount:      payoutWalletLoadOrdersTable.gstAmount,
        netCreditAmount: payoutWalletLoadOrdersTable.netCreditAmount,
        method:         payoutWalletLoadOrdersTable.method,
        status:         payoutWalletLoadOrdersTable.status,
        utr:            payoutWalletLoadOrdersTable.utr,
        payerName:      payoutWalletLoadOrdersTable.payerName,
        payerReference: payoutWalletLoadOrdersTable.payerReference,
        rejectionReason: payoutWalletLoadOrdersTable.rejectionReason,
        creditedAt:     payoutWalletLoadOrdersTable.creditedAt,
        createdAt:      payoutWalletLoadOrdersTable.createdAt,
        updatedAt:      payoutWalletLoadOrdersTable.updatedAt,
      })
      .from(payoutWalletLoadOrdersTable)
      .where(eq(payoutWalletLoadOrdersTable.merchantId, merchantId))
      .orderBy(desc(payoutWalletLoadOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: rows, limit, offset, total: rows.length });
  } catch (err) { next(err); }
});

// ─── GET /api/payout-merchant/wallet/load/:loadId ────────────────────────────
router.get("/wallet/load/:loadId", requirePayoutMerchantGuard, async (req: any, res, next) => {
  try {
    const merchantId: number = req.merchantId;
    const loadId = req.params["loadId"] as string;

    const [row] = await db
      .select({
        id:             payoutWalletLoadOrdersTable.id,
        loadId:         payoutWalletLoadOrdersTable.loadId,
        amount:         payoutWalletLoadOrdersTable.amount,
        feeAmount:      payoutWalletLoadOrdersTable.feeAmount,
        gstAmount:      payoutWalletLoadOrdersTable.gstAmount,
        netCreditAmount: payoutWalletLoadOrdersTable.netCreditAmount,
        method:         payoutWalletLoadOrdersTable.method,
        status:         payoutWalletLoadOrdersTable.status,
        utr:            payoutWalletLoadOrdersTable.utr,
        payerName:      payoutWalletLoadOrdersTable.payerName,
        payerReference: payoutWalletLoadOrdersTable.payerReference,
        rejectionReason: payoutWalletLoadOrdersTable.rejectionReason,
        creditedAt:     payoutWalletLoadOrdersTable.creditedAt,
        createdAt:      payoutWalletLoadOrdersTable.createdAt,
      })
      .from(payoutWalletLoadOrdersTable)
      .where(
        and(
          eq(payoutWalletLoadOrdersTable.loadId, loadId),
          eq(payoutWalletLoadOrdersTable.merchantId, merchantId),
        )
      )
      .limit(1);

    if (!row) { res.status(404).json({ error: "Load order not found" }); return; }
    res.json(row);
  } catch (err) { next(err); }
});

/**
 * Exported helper: credit payout merchant wallet atomically.
 * Called by the Cashfree payin webhook when order_id starts with "WLOAD_".
 */
export async function creditWalletForLoad(
  loadOrder: { id: number; merchantId: number; netCreditAmount: string; loadId: string; providerPaymentId?: string | null },
  providerPaymentId: string | null
): Promise<"credited" | "duplicate" | "error"> {
  try {
    return await db.transaction(async (tx) => {
      // Atomic claim: only transition from PROCESSING → SUCCESS once
      const [claimed] = await tx
        .update(payoutWalletLoadOrdersTable)
        .set({
          status:            "SUCCESS",
          creditedAt:        new Date(),
          providerPaymentId: providerPaymentId ?? null,
          updatedAt:         new Date(),
        })
        .where(
          and(
            eq(payoutWalletLoadOrdersTable.id, loadOrder.id),
            inArray(payoutWalletLoadOrdersTable.status, ["CREATED", "PROCESSING"]),
          )
        )
        .returning({ id: payoutWalletLoadOrdersTable.id });

      if (!claimed) return "duplicate"; // already credited or wrong status

      // Ensure wallet row exists
      await tx
        .insert(merchantWalletsTable)
        .values({ merchantId: loadOrder.merchantId })
        .onConflictDoNothing();

      // Fetch current wallet for before-snapshot
      const [wallet] = await tx
        .select()
        .from(merchantWalletsTable)
        .where(eq(merchantWalletsTable.merchantId, loadOrder.merchantId))
        .for("update")
        .limit(1);

      const avBefore = numStr(wallet?.availableBalance);
      const netCredit = numStr(loadOrder.netCreditAmount);
      const avAfter  = avBefore + netCredit;

      // Credit available balance + bump total_collection
      await tx
        .update(merchantWalletsTable)
        .set({
          availableBalance: fmtNum(avAfter),
          totalCollection:  fmtNum(numStr(wallet?.totalCollection) + netCredit),
          updatedAt: new Date(),
        })
        .where(eq(merchantWalletsTable.merchantId, loadOrder.merchantId));

      // Ledger entry
      await tx.insert(walletLedgerTable).values({
        merchantId:    loadOrder.merchantId,
        txnType:       "wallet_load_credit",
        bucket:        "available",
        amount:        fmtNum(netCredit),
        availableBefore: fmtNum(avBefore),
        availableAfter:  fmtNum(avAfter),
        pendingBefore:   fmtNum(numStr(wallet?.pendingBalance)),
        pendingAfter:    fmtNum(numStr(wallet?.pendingBalance)),
        referenceType: "wallet_load",
        referenceId:   loadOrder.id,
        description:   `RasoKart Wallet Load — ${loadOrder.loadId}`,
        createdBy:     null,
      });

      // Audit
      await tx.insert(auditLogsTable).values({
        adminId:    0,
        adminEmail: "system@rasokart.com",
        action:     "WALLET_LOAD_SUCCESS_CREDITED",
        targetType: "payout_wallet_load",
        targetId:   loadOrder.id,
        details:    JSON.stringify({ loadId: loadOrder.loadId, netCredit, avBefore, avAfter }),
      }).catch(() => {});

      return "credited";
    });
  } catch (err: any) {
    logger.error({ err: err.message, loadId: loadOrder.loadId }, "wallet_load_credit_error");
    return "error";
  }
}

export default router;
