import { Router } from "express";
import { db, qrCodesTable, transactionsTable, qrPaymentEventsTable, merchantsTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ekqrClientTxnId } from "../helpers/ekqr";

const router = Router();

/**
 * POST /api/payment/webhook
 *
 * Public endpoint — called by EKQR when a payment is confirmed.
 * Verifies the client_txn_id maps to a known QR code, marks it as used,
 * creates a pending deposit transaction, and fires the merchant callback.
 *
 * EKQR webhook payload (documented at https://ekqr.in):
 *   { client_txn_id, amount, status, upi_txn_id, txn_id,
 *     p_info, customer_name, customer_email, customer_mobile }
 *
 * status values: SUCCESS | FAILED | PENDING
 */
router.post("/", async (req, res) => {
  const raw = JSON.stringify(req.body);
  const body = req.body as Record<string, string>;

  const { client_txn_id, amount, status, upi_txn_id, txn_id } = body;

  req.log.info({ client_txn_id, status }, "EKQR payment webhook received");

  // Always acknowledge immediately so EKQR doesn't retry
  res.json({ success: true });

  try {
    // Guard: EKQR must be enabled
    const [ekqrEnabledRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.EKQR_ENABLED))
      .limit(1);

    if (ekqrEnabledRow?.value !== "true") {
      logger.warn({ client_txn_id }, "EKQR webhook received but EKQR is disabled — ignoring");
      return;
    }

    // Only credit on success
    if (!status || status.toUpperCase() !== "SUCCESS") {
      logger.info({ client_txn_id, status }, "EKQR webhook: non-success status — ignoring");
      return;
    }

    if (!client_txn_id) {
      logger.warn({ body }, "EKQR webhook: missing client_txn_id");
      return;
    }

    // Locate the QR code by ekqrOrderId (stored as our client_txn_id)
    const [qr] = await db
      .select()
      .from(qrCodesTable)
      .where(eq(qrCodesTable.ekqrOrderId, client_txn_id))
      .limit(1);

    if (!qr) {
      // Fallback: try parsing qr code ID from client_txn_id pattern "EKQR-{id}"
      const match = /^EKQR-(\d+)$/.exec(client_txn_id);
      if (match) {
        const qrId = parseInt(match[1]);
        const [byId] = await db
          .select()
          .from(qrCodesTable)
          .where(and(eq(qrCodesTable.id, qrId), eq(qrCodesTable.status, "active")))
          .limit(1);
        if (!byId) {
          logger.warn({ client_txn_id }, "EKQR webhook: QR code not found or already used");
          return;
        }
        await processEkqrPayment(byId, amount, upi_txn_id, txn_id, raw, body);
      } else {
        logger.warn({ client_txn_id }, "EKQR webhook: could not resolve QR code");
      }
      return;
    }

    await processEkqrPayment(qr, amount, upi_txn_id, txn_id, raw, body);

  } catch (err) {
    logger.error({ err, client_txn_id }, "EKQR webhook processing error");
  }
});

async function processEkqrPayment(
  qr: typeof qrCodesTable.$inferSelect,
  amount: string | undefined,
  upiTxnId: string | undefined,
  ekqrTxnId: string | undefined,
  rawPayload: string,
  body: Record<string, string>,
) {
  if (qr.status !== "active") {
    logger.info({ qrId: qr.id, status: qr.status }, "EKQR webhook: QR code already processed");
    return;
  }

  const paidAmount = amount ?? qr.amount ?? "0";

  // Mark QR as used
  await db
    .update(qrCodesTable)
    .set({ status: "used" })
    .where(eq(qrCodesTable.id, qr.id));

  // Generate a unique UTR: prefer upiTxnId, else use ekqrTxnId, else generate one
  const utr = upiTxnId || ekqrTxnId || `EKQR-${qr.id}-${Date.now()}`;

  // Insert a deposit transaction (auto-credit the merchant)
  const [tx] = await db.insert(transactionsTable).values({
    merchantId: qr.merchantId,
    qrCodeId: qr.id,
    provider: "ekqr",
    type: "deposit",
    status: "success",
    amount: paidAmount,
    currency: "INR",
    utr,
    referenceId: ekqrTxnId ?? null,
    description: `EKQR payment — ${body["p_info"] ?? qr.label ?? "QR Payment"}`,
    metadata: rawPayload,
  }).returning().catch((err: unknown) => {
    logger.warn({ err, utr }, "EKQR webhook: failed to insert transaction (possible duplicate UTR)");
    return [] as (typeof transactionsTable.$inferSelect)[];
  });

  // Record a QR payment event
  db.insert(qrPaymentEventsTable).values({
    qrCodeId: qr.id,
    merchantId: qr.merchantId,
    transactionId: tx?.id ?? null,
    amount: paidAmount,
    orderId: qr.orderId ?? null,
    merchantReference: qr.merchantReference ?? null,
  }).catch((err: unknown) => {
    logger.warn({ err, qrId: qr.id }, "EKQR webhook: failed to insert qr_payment_event");
  });

  logger.info({ qrId: qr.id, merchantId: qr.merchantId, amount: paidAmount, utr }, "EKQR payment credited");

  // Fire merchant's callbackUrl if configured
  if (qr.callbackUrl) {
    const callbackPayload = JSON.stringify({
      event: "payment.received",
      provider: "ekqr",
      qrCodeId: qr.id,
      merchantId: qr.merchantId,
      orderId: qr.orderId ?? null,
      merchantReference: qr.merchantReference ?? null,
      amount: paidAmount,
      utr,
      ekqrTxnId: ekqrTxnId ?? null,
      upiTxnId: upiTxnId ?? null,
      status: "success",
    });

    fetch(qr.callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: callbackPayload,
    }).catch((err: unknown) => {
      logger.warn({ err, callbackUrl: qr.callbackUrl, qrId: qr.id }, "EKQR webhook: merchant callbackUrl fire failed");
    });
  }
}

export default router;
