import { db, cashfreePaymentOrdersTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import type { Logger } from "pino";
import { sanitizeDbError } from "./payinDiagnosticSanitize";

export interface PayinOrderInsertInput {
  merchantId: number;
  publicOrderId: string;
  cashfreeOrderId: string;
  paymentSessionId: string;
  amount: string;
  customerPhone: string;
  customerEmail: string | null;
  rawPayload: string;
}

export type PayinOrderInsertResult =
  | { ok: true; mode: "full" | "minimal" }
  | { ok: false };

/**
 * Inserts a newly-created deposit order row. Tries the full insert (every
 * column the app can populate) first. If that fails — most commonly because
 * the live table is missing an optional column or has a stricter constraint
 * than expected — retries with a minimal insert containing only the columns
 * that are guaranteed to exist after `ensurePayinOrdersSchemaGuard()` and
 * that are strictly required to reconcile the deposit later (merchant,
 * provider/public order ids, session id, amount, currency, status,
 * provider key, customer phone, timestamps).
 *
 * Never logs raw provider payloads, secrets, or DB error message/detail —
 * only sanitized schema-identifier fields (code/table/column/constraint).
 */
export async function insertPayinOrderWithFallback(
  input: PayinOrderInsertInput,
  log: Logger,
): Promise<PayinOrderInsertResult> {
  const { merchantId } = input;

  log.info({ event: "payin_db_insert_started", merchantId }, "payin_db_insert_started");
  try {
    await db.insert(cashfreePaymentOrdersTable).values({
      merchantId,
      publicOrderId: input.publicOrderId,
      providerKey: "cashfree",
      cashfreeOrderId: input.cashfreeOrderId,
      paymentSessionId: input.paymentSessionId,
      amount: input.amount,
      currency: "INR",
      status: PAYIN_ORDER_STATUS.CREATED,
      paymentMethod: "upi",
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      rawPayload: input.rawPayload,
    }).onConflictDoNothing();
    return { ok: true, mode: "full" };
  } catch (fullErr) {
    const safe = sanitizeDbError(fullErr);
    log.error({ event: "payin_db_insert_failed", merchantId, ...safe }, "payin_db_insert_failed");
  }

  log.info({ event: "payin_db_insert_minimal_retry_started", merchantId }, "payin_db_insert_minimal_retry_started");
  try {
    await db.insert(cashfreePaymentOrdersTable).values({
      merchantId,
      publicOrderId: input.publicOrderId,
      providerKey: "cashfree",
      cashfreeOrderId: input.cashfreeOrderId,
      paymentSessionId: input.paymentSessionId,
      amount: input.amount,
      currency: "INR",
      status: PAYIN_ORDER_STATUS.CREATED,
      customerPhone: input.customerPhone,
    }).onConflictDoNothing();
    log.info({ event: "payin_db_insert_minimal_retry_success", merchantId }, "payin_db_insert_minimal_retry_success");
    return { ok: true, mode: "minimal" };
  } catch (minimalErr) {
    const safe = sanitizeDbError(minimalErr);
    log.error({ event: "payin_db_insert_minimal_retry_failed", merchantId, ...safe }, "payin_db_insert_minimal_retry_failed");
    return { ok: false };
  }
}
