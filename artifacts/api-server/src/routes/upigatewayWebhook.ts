/**
 * POST /api/webhooks/upigateway
 *
 * Public endpoint — called by UPIGateway / EKQR when a payin order is confirmed.
 *
 * White-label: never returns provider IDs, raw payload, or internal keys to the caller.
 * The caller receives only { success: true } on 200.
 *
 * Flow:
 *  1. Signature verification (HMAC-SHA256 if webhookSecret configured; fail-closed in live mode)
 *  2. Look up cashfree_payment_orders by cashfreeOrderId = client_txn_id, providerKey = 'upigateway'
 *  3. Atomic status transition + wallet credit + ledger entry (idempotent)
 *  4. Log to cashfree_payment_logs
 */

import { Router } from "express";
import {
  db, cashfreePaymentOrdersTable, cashfreePaymentLogsTable,
  ledgerEntriesTable, merchantsTable, PAYIN_ORDER_STATUS, SYSTEM_CONFIG_KEYS, systemConfigTable,
} from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyUpigatewayWebhookSignature } from "../helpers/upigatewayPayin";

const router = Router();

const PROVIDER_KEY = "upigateway";

router.post("/", async (req, res) => {
  const rawPayload = JSON.stringify(req.body);
  const body = req.body as Record<string, string>;

  const { client_txn_id, amount, status, upi_txn_id, txn_id } = body;

  // ── Signature verification ─────────────────────────────────────────────────
  const [secretRow] = await db
    .select({ value: systemConfigTable.value })
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.UPIGATEWAY_WEBHOOK_SECRET))
    .limit(1);

  const encryptedSecret = secretRow?.value ?? "";
  let webhookSecret = "";
  if (encryptedSecret.startsWith("enc:v1:")) {
    const { decryptSecret } = await import("../helpers/cryptoUtils");
    const r = decryptSecret(encryptedSecret);
    webhookSecret = r.ok ? r.value : "";
  }

  const [envRow] = await db
    .select({ value: systemConfigTable.value })
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.UPIGATEWAY_ENV))
    .limit(1);
  const isLive = (envRow?.value ?? "test") === "live";

  if (webhookSecret) {
    const valid = verifyUpigatewayWebhookSignature(body, webhookSecret);
    if (!valid) {
      logger.warn({ client_txn_id }, "upigateway webhook rejected: invalid signature");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  } else if (isLive) {
    logger.warn({ client_txn_id }, "upigateway webhook rejected: no webhook secret configured in live mode");
    res.status(401).json({ error: "Webhook secret not configured" });
    return;
  }

  logger.info({ client_txn_id, status }, "upigateway payin webhook received");

  // Acknowledge immediately — wallet credit is async below
  res.json({ success: true });

  let processingResult: "credited" | "duplicate" | "ignored" | "error" = "ignored";
  let errorMessage: string | null = null;
  let localOrderId: number | null = null;

  try {
    // ── Guard: UPIGateway payin must be enabled ────────────────────────────
    const [enabledRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.UPIGATEWAY_PAYIN_ENABLED))
      .limit(1);

    if (enabledRow?.value !== "true") {
      logger.warn({ client_txn_id }, "upigateway webhook: payin disabled — ignoring");
      processingResult = "ignored";
      errorMessage = "UPIGateway payin disabled";
      await insertLog({ client_txn_id: client_txn_id ?? "", localOrderId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage, signatureVerified: !!webhookSecret });
      return;
    }

    // Only credit on SUCCESS
    if (!status || status.toUpperCase() !== "SUCCESS") {
      logger.info({ client_txn_id, status }, "upigateway webhook: non-success status — ignoring");
      processingResult = "ignored";
      errorMessage = "Non-success status";
      await insertLog({ client_txn_id: client_txn_id ?? "", localOrderId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage, signatureVerified: !!webhookSecret });
      return;
    }

    if (!client_txn_id) {
      logger.warn({ body }, "upigateway webhook: missing client_txn_id");
      processingResult = "error";
      errorMessage = "Missing client_txn_id";
      await insertLog({ client_txn_id: "", localOrderId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage, signatureVerified: !!webhookSecret });
      return;
    }

    // ── Locate the payin order ─────────────────────────────────────────────
    const [order] = await db.select()
      .from(cashfreePaymentOrdersTable)
      .where(and(
        eq(cashfreePaymentOrdersTable.cashfreeOrderId, client_txn_id),
        eq(cashfreePaymentOrdersTable.providerKey, PROVIDER_KEY),
      ))
      .limit(1);

    if (!order) {
      logger.warn({ client_txn_id }, "upigateway webhook: order not found");
      processingResult = "error";
      errorMessage = "Order not found";
      await insertLog({ client_txn_id, localOrderId: null, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage, signatureVerified: !!webhookSecret });
      return;
    }

    localOrderId = order.id;
    const merchantId = order.merchantId;
    const depositAmt = Number(amount ?? order.amount ?? 0);
    const utr = upi_txn_id || txn_id || `UGPAYIN${client_txn_id}`;

    // ── Atomic idempotent credit ──────────────────────────────────────────────
    const creditResult = await db.transaction(async (trx) => {
      const updated = await trx
        .update(cashfreePaymentOrdersTable)
        .set({
          status: PAYIN_ORDER_STATUS.PAID,
          utr,
          paymentMethod: "upi",
          rawProviderStatus: status,
          paidAt: new Date(),
          rawPayload,
        })
        .where(and(
          eq(cashfreePaymentOrdersTable.id, order.id),
          ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
        ))
        .returning({ id: cashfreePaymentOrdersTable.id });

      if (!updated.length) return { credited: false };

      const [merchant] = await trx
        .select({ id: merchantsTable.id, balance: merchantsTable.balance })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, merchantId))
        .limit(1);

      if (!merchant) throw new Error("Merchant not found");

      const balanceBefore = Number(merchant.balance ?? 0);
      const balanceAfter = balanceBefore + depositAmt;

      await trx.update(merchantsTable).set({
        balance: sql`CAST(COALESCE(balance, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
        totalDeposits: sql`CAST(COALESCE(total_deposits, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
        updatedAt: new Date(),
      }).where(eq(merchantsTable.id, merchant.id));

      await trx.insert(ledgerEntriesTable).values({
        merchantId: merchant.id,
        type: "deposit",
        amount: depositAmt.toFixed(2),
        balanceBefore: balanceBefore.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        referenceType: "payin_order",
        referenceId: order.id,
        description: `RasoKart UPI deposit — order ${order.publicOrderId ?? client_txn_id}`,
        createdBy: null,
      });

      return { credited: true };
    });

    if (!creditResult.credited) {
      processingResult = "duplicate";
      errorMessage = "Order already credited";
    } else {
      processingResult = "credited";
    }

    logger.info({ client_txn_id, processingResult, merchantId }, "upigateway payin webhook processed");
    await insertLog({ client_txn_id, localOrderId, merchantId, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage, signatureVerified: !!webhookSecret });

  } catch (err) {
    processingResult = "error";
    errorMessage = "Internal processing error";
    logger.error({ err, client_txn_id }, "upigateway webhook processing error");
    await insertLog({ client_txn_id: client_txn_id ?? "", localOrderId, merchantId: null, status: status ?? null, amount: amount ?? null, rawPayload, processingResult, errorMessage, signatureVerified: !!webhookSecret }).catch(() => {});
  }
});

async function insertLog(params: {
  client_txn_id: string;
  localOrderId: number | null;
  merchantId: number | null;
  status: string | null;
  amount: string | null;
  rawPayload: string;
  processingResult: string;
  errorMessage: string | null;
  signatureVerified: boolean;
}) {
  try {
    await db.insert(cashfreePaymentLogsTable).values({
      eventType: `upigateway_${params.status?.toLowerCase() ?? "unknown"}`,
      cashfreeOrderId: params.client_txn_id || null,
      merchantId: params.merchantId,
      amount: params.amount,
      status: params.processingResult,
      rawPayload: params.rawPayload,
      processingResult: params.processingResult,
      errorMessage: params.errorMessage,
    });
  } catch (err) {
    logger.warn({ err }, "upigateway webhook: failed to insert log");
  }
}

export default router;
