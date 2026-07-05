import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db, cashfreePaymentOrdersTable, cashfreePaymentLogsTable, ledgerEntriesTable, merchantsTable, providerIntegrationsTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { decryptSecret } from "../helpers/cryptoUtils";

const router = Router();

/**
 * POST /api/webhooks/payin/custom/:providerKey
 *
 * Generic webhook endpoint for admin-added custom payin gateways. Mirrors the
 * atomic idempotent credit pattern used by /webhooks/payin/cashfree: a
 * conditional UPDATE (WHERE status != 'paid') gates the wallet credit + ledger
 * entry so duplicate/concurrent deliveries never double-credit a merchant.
 *
 * Expected generic payload shape (documented for custom gateway admins):
 *   { order_id: string, status: "SUCCESS" | "FAILED" | "PENDING", amount?: number|string,
 *     utr?: string, signature?: string }
 *
 * Signature verification is MANDATORY (fail-closed): the integration must have a
 * webhookSecretEncrypted configured, and every request must include a
 * `x-webhook-signature` header equal to HMAC-SHA256(rawBody, secret) in hex (or the
 * request body's own `signature` field must match). Requests are rejected with 401
 * if no secret is configured for the integration, or if the signature is missing/
 * invalid — this endpoint credits merchant wallets, so it must never trust an
 * unauthenticated caller.
 *
 * The credited amount always comes from the order stored in our own DB
 * (never from the webhook payload) so a forged/tampered payload amount cannot be
 * used to over-credit a merchant.
 */
router.post("/:providerKey", async (req, res) => {
  const providerKey = req.params["providerKey"] as string;
  const rawBodyBuffer = (req as any).rawBody as Buffer | undefined;
  const rawBody = rawBodyBuffer ? rawBodyBuffer.toString("utf8") : "";
  const body = req.body as Record<string, unknown>;

  let processingResult: "credited" | "duplicate" | "ignored" | "error" = "ignored";
  let errorMessage: string | null = null;
  let merchantId: number | null = null;

  logger.info({ event: "payin_custom_webhook_received", providerKey, rawBodyLength: rawBody.length }, "payin_custom_webhook_received");

  try {
    const [integration] = await db.select().from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, providerKey)).limit(1);

    if (!integration || !integration.isEnabled) {
      logger.warn({ event: "payin_custom_webhook_processed", providerKey, processingResult: "ignored", httpStatus: 200 }, "payin_custom_webhook_processed");
      res.json({ success: true, message: "Gateway not configured" });
      await insertLog({ providerKey, providerOrderId: null, merchantId: null, amount: null, status: null, rawPayload: rawBody, processingResult: "ignored", errorMessage: "Integration not found or disabled" });
      return;
    }

    // Mandatory, fail-closed signature verification — this endpoint credits merchant
    // wallets, so a missing/unconfigured secret or an invalid signature must always
    // reject the request rather than fall back to trusting an unauthenticated caller.
    const decrypted = integration.webhookSecretEncrypted ? decryptSecret(integration.webhookSecretEncrypted) : null;
    const secret = decrypted?.ok ? decrypted.value.trim() : "";
    if (!secret) {
      logger.warn({ event: "payin_custom_webhook_no_secret_configured", providerKey, httpStatus: 401 }, "payin_custom_webhook_no_secret_configured");
      res.status(401).json({ error: "Webhook secret not configured for this gateway" });
      await insertLog({ providerKey, providerOrderId: null, merchantId: null, amount: null, status: null, rawPayload: rawBody, processingResult: "error", errorMessage: "No webhook secret configured — request rejected" });
      return;
    }
    {
      const incoming = (req.headers["x-webhook-signature"] as string | undefined) ?? (body["signature"] as string | undefined) ?? "";
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      let valid = false;
      try {
        valid = incoming.length > 0 && Buffer.from(incoming, "utf8").length === Buffer.from(expected, "utf8").length
          && timingSafeEqual(Buffer.from(incoming, "utf8"), Buffer.from(expected, "utf8"));
      } catch { valid = false; }
      if (!valid) {
        logger.warn({ event: "payin_custom_webhook_signature_check_failed", providerKey, httpStatus: 401 }, "payin_custom_webhook_signature_check_failed");
        res.status(401).json({ error: "Invalid webhook signature" });
        await insertLog({ providerKey, providerOrderId: null, merchantId: null, amount: null, status: null, rawPayload: rawBody, processingResult: "error", errorMessage: "Invalid webhook signature" });
        return;
      }
    }

    const providerOrderId = (body["order_id"] as string | undefined) ?? (body["orderId"] as string | undefined) ?? null;
    const status = (body["status"] as string | undefined) ?? null;
    const amount = (body["amount"] as string | number | undefined)?.toString() ?? null;
    const utrIn = (body["utr"] as string | undefined) ?? null;

    if (!providerOrderId) {
      res.json({ success: true, message: "Webhook received, no order id in payload" });
      processingResult = "ignored";
      errorMessage = "Missing order_id in payload";
      await insertLog({ providerKey, providerOrderId: null, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    const [order] = await db.select().from(cashfreePaymentOrdersTable)
      .where(and(
        eq(cashfreePaymentOrdersTable.cashfreeOrderId, providerOrderId),
        eq(cashfreePaymentOrdersTable.providerKey, providerKey),
      )).limit(1);

    if (!order) {
      res.json({ success: true, message: "Webhook received, order not found" });
      processingResult = "ignored";
      errorMessage = "Order not found in DB";
      await insertLog({ providerKey, providerOrderId, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    if ((status ?? "").toUpperCase() !== "SUCCESS") {
      res.json({ success: true });
      processingResult = "ignored";
      errorMessage = `Non-success payment status: ${status}`;
      await db.update(cashfreePaymentOrdersTable)
        .set({ rawProviderStatus: status ?? null, failureReason: status ? `Payment ${status}` : null })
        .where(eq(cashfreePaymentOrdersTable.id, order.id));
      await insertLog({ providerKey, providerOrderId, merchantId: order.merchantId, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    // Acknowledge immediately — the credit transaction below is fast and idempotent.
    res.json({ success: true });

    merchantId = order.merchantId;
    const utr = utrIn ?? `RKPAYIN${providerOrderId}`;
    // Always credit from the amount we stored when the order was created — never from
    // the webhook payload, which is attacker-controlled input even after signature
    // verification (a legitimate gateway could still report a mismatched amount).
    const paidAmount = order.amount?.toString() ?? "0";
    const depositAmt = Number(paidAmount);
    if (amount != null && Number(amount) !== depositAmt) {
      logger.warn({ event: "payin_custom_webhook_amount_mismatch", providerKey, providerOrderId, payloadAmount: amount, orderAmount: paidAmount }, "payin_custom_webhook_amount_mismatch");
    }

    const creditResult = await db.transaction(async (trx) => {
      const updated = await trx.update(cashfreePaymentOrdersTable)
        .set({ status: PAYIN_ORDER_STATUS.PAID, utr, rawProviderStatus: status, paidAt: new Date() })
        .where(and(
          eq(cashfreePaymentOrdersTable.id, order.id),
          ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
        ))
        .returning({ id: cashfreePaymentOrdersTable.id });

      if (!updated.length) return { credited: false };

      const [merchant] = await trx.select({ id: merchantsTable.id, balance: merchantsTable.balance })
        .from(merchantsTable).where(eq(merchantsTable.id, order.merchantId)).limit(1);
      if (!merchant) throw new Error("Merchant not found for payin order");

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
        referenceId: updated[0]!.id,
        description: `RasoKart UPI deposit — order ${order.publicOrderId ?? providerOrderId}`,
        createdBy: null,
      });

      return { credited: true };
    });

    processingResult = creditResult.credited ? "credited" : "duplicate";
    errorMessage = creditResult.credited ? null : "Order already credited";
    logger.info({ event: "payin_custom_webhook_processed", providerKey, processingResult, httpStatus: 200 }, "payin_custom_webhook_processed");
    await insertLog({ providerKey, providerOrderId, merchantId, amount: paidAmount, status, rawPayload: rawBody, processingResult, errorMessage });
  } catch (err) {
    processingResult = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ event: "payin_custom_webhook_processed", providerKey, processingResult, httpStatus: res.headersSent ? res.statusCode : 500 }, "payin_custom_webhook_processed");
    if (!res.headersSent) {
      res.json({ success: true });
    }
    try {
      await insertLog({ providerKey, providerOrderId: null, merchantId, amount: null, status: null, rawPayload: rawBody, processingResult: "error", errorMessage });
    } catch (logErr) {
      logger.warn({ logErr }, "Custom payin webhook: failed to insert log after error");
    }
  }
});

async function insertLog(params: {
  providerKey: string;
  providerOrderId: string | null;
  merchantId: number | null;
  amount: string | null;
  status: string | null;
  rawPayload: string;
  processingResult: "credited" | "duplicate" | "ignored" | "error";
  errorMessage: string | null;
}) {
  try {
    await db.insert(cashfreePaymentLogsTable).values({
      eventType: `custom:${params.providerKey}`,
      cashfreeOrderId: params.providerOrderId ?? undefined,
      merchantId: params.merchantId ?? undefined,
      amount: params.amount ?? undefined,
      status: params.status ?? undefined,
      rawPayload: params.rawPayload,
      processingResult: params.processingResult,
      errorMessage: params.errorMessage ?? undefined,
    });
  } catch (err) {
    logger.warn({ err }, "Custom payin webhook: failed to insert log");
  }
}

export default router;
