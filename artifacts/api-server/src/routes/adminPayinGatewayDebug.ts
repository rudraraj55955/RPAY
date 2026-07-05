import { Router } from "express";
import { db, cashfreePaymentOrdersTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cashfreeCreateOrder, resolveCashfreeBaseUrl, CASHFREE_API_VERSION } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { loadPayinConfig } from "../helpers/payinConfig";
import { isValidHttpsUrl, sanitizeDiagnosticMessage, sanitizeSubCode, sanitizeDbError } from "../helpers/payinDiagnosticSanitize";
import { ensurePayinOrdersSchemaGuard } from "../helpers/payinSchemaGuard";

const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * POST /api/admin/payin-gateway/debug-create-order
 *
 * Admin-only diagnostic: fires a small, real create-order request at the
 * live Cashfree Payin gateway using the exact settings configured in the
 * admin panel, so an admin can tell whether a broken deposit flow is a
 * gateway-config problem (bad base URL / expired credentials / disabled
 * account) vs. an application bug — without ever seeing a raw provider
 * response, secret, client id, or payment_session_id.
 *
 * This never writes to `cashfree_payment_orders` — it is a read-only
 * diagnostic against the live provider, not a real deposit.
 */
router.post("/debug-create-order", async (req, res) => {
  const admin = (req as any).user;
  const body = req.body as { merchantId?: number; amount?: number };
  const merchantId = Number(body?.merchantId);
  const amount = body?.amount != null ? Number(body.amount) : 1;

  try {
    if (!merchantId || !Number.isFinite(merchantId) || merchantId <= 0) {
      res.status(400).json({ error: "merchantId is required" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }

    const cfg = await loadPayinConfig();
    const resolvedBaseUrl = resolveCashfreeBaseUrl(cfg.env, cfg.baseUrl);
    const baseUrlValid = isValidHttpsUrl(resolvedBaseUrl);
    const apiVersion = cfg.apiVersion ?? CASHFREE_API_VERSION;

    if (!cfg.clientId || !cfg.rawClientSecret) {
      res.json({
        baseUrlValid, apiVersion, env: cfg.env, merchantId, amount,
        httpStatus: null, safeSubCode: "credentials_missing",
        safeMessage: "Gateway credentials are not configured.", orderCreated: false,
      });
      return;
    }

    const decrypted = decryptSecret(cfg.rawClientSecret);
    if (!decrypted.ok || !decrypted.value.trim()) {
      res.json({
        baseUrlValid, apiVersion, env: cfg.env, merchantId, amount,
        httpStatus: null, safeSubCode: "credential_decrypt_failed",
        safeMessage: "Stored credentials could not be decrypted.", orderCreated: false,
      });
      return;
    }

    const testOrderId = `RKDEBUG_${merchantId}_${Date.now()}`;
    req.log.info({ event: "payin_provider_create_order_started", adminId: admin?.id, diagnostic: true }, "payin_provider_create_order_started");

    let httpStatus: number;
    let safeSubCode: string | null;
    let safeMessage: string | null;
    let orderCreated: boolean;
    try {
      const { parsed, status } = await cashfreeCreateOrder(cfg.clientId, decrypted.value, cfg.env, {
        order_id: testOrderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: `admin-diagnostic-${merchantId}`,
          customer_phone: "9999999999",
        },
        order_note: "RasoKart Admin Diagnostic Test Order",
      }, { baseUrl: cfg.baseUrl, apiVersion: cfg.apiVersion });

      httpStatus = status;
      safeSubCode = sanitizeSubCode(parsed.code);
      safeMessage = sanitizeDiagnosticMessage(parsed.message, [cfg.clientId, decrypted.value]);
      orderCreated = Boolean(parsed.payment_session_id);
      req.log.info({ event: "payin_provider_create_order_success", adminId: admin?.id, diagnostic: true, orderCreated }, "payin_provider_create_order_success");
    } catch (providerErr) {
      req.log.error({ event: "payin_provider_create_order_failed", adminId: admin?.id, diagnostic: true, safeReason: "provider_request_error" }, "payin_provider_create_order_failed");
      res.json({
        baseUrlValid, apiVersion, env: cfg.env, merchantId, amount,
        httpStatus: null, safeSubCode: "provider_request_error",
        safeMessage: "Could not reach the payment provider.", orderCreated: false,
      });
      return;
    }

    res.json({ baseUrlValid, apiVersion, env: cfg.env, merchantId, amount, httpStatus, safeSubCode, safeMessage, orderCreated });
  } catch (err) {
    req.log.error({ event: "payin_provider_create_order_failed", adminId: admin?.id, diagnostic: true, safeReason: "unexpected_error" }, "payin_provider_create_order_failed");
    res.status(500).json({ error: "Diagnostic check failed. Please try again." });
  }
});

/**
 * POST /api/admin/payin-gateway/debug-db-insert
 *
 * Admin-only diagnostic: runs the `cashfree_payment_orders` schema guard,
 * then attempts a minimal insert of a throwaway test row inside a
 * transaction that is always rolled back — so this never leaves any trace
 * in the table and never touches a real merchant/order. Lets an admin tell
 * whether a broken deposit flow is a DB-schema problem (the exact
 * "provider succeeded, DB insert failed" incident class) independent of
 * the live provider entirely.
 *
 * Returns only sanitized schema-identifier fields — never a raw SQL
 * message, stack trace, or row value.
 */
router.post("/debug-db-insert", async (req, res) => {
  const admin = (req as any).user;
  let schemaOk = false;
  let insertOk = false;
  let safeDbCode: string | null = null;
  let safeColumn: string | null = null;
  let safeConstraint: string | null = null;

  try {
    try {
      await ensurePayinOrdersSchemaGuard();
      schemaOk = true;
    } catch (guardErr) {
      const safe = sanitizeDbError(guardErr);
      safeDbCode = safe.safeDbCode;
      safeColumn = safe.safeColumn;
      safeConstraint = safe.safeConstraint;
      req.log.error({ event: "payin_db_insert_failed", adminId: admin?.id, diagnostic: true, ...safe }, "payin_db_insert_failed");
      res.json({ schemaOk, insertOk, safeDbCode, safeColumn, safeConstraint });
      return;
    }

    const testOrderId = `RKDEBUGDB_${admin?.id ?? "admin"}_${Date.now()}`;
    req.log.info({ event: "payin_db_insert_started", adminId: admin?.id, diagnostic: true }, "payin_db_insert_started");

    try {
      await db.transaction(async (tx) => {
        await tx.insert(cashfreePaymentOrdersTable).values({
          merchantId: -1,
          publicOrderId: testOrderId,
          providerKey: "cashfree",
          cashfreeOrderId: testOrderId,
          paymentSessionId: "diagnostic-session",
          amount: "1.00",
          currency: "INR",
          status: PAYIN_ORDER_STATUS.CREATED,
          customerPhone: "9999999999",
        });
        // Always roll back — this is a schema/insert probe, never a real row.
        await tx.execute(sql`SELECT 1`);
        throw new Error("__diagnostic_rollback__");
      });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === "__diagnostic_rollback__") {
        insertOk = true;
        req.log.info({ event: "payin_db_insert_minimal_retry_success", adminId: admin?.id, diagnostic: true }, "payin_db_insert_minimal_retry_success");
      } else {
        const safe = sanitizeDbError(txErr);
        safeDbCode = safe.safeDbCode;
        safeColumn = safe.safeColumn;
        safeConstraint = safe.safeConstraint;
        req.log.error({ event: "payin_db_insert_minimal_retry_failed", adminId: admin?.id, diagnostic: true, ...safe }, "payin_db_insert_minimal_retry_failed");
      }
    }

    res.json({ schemaOk, insertOk, safeDbCode, safeColumn, safeConstraint });
  } catch (err) {
    req.log.error({ event: "payin_db_insert_failed", adminId: admin?.id, diagnostic: true, safeReason: "unexpected_error" }, "payin_db_insert_failed");
    res.status(500).json({ error: "Diagnostic check failed. Please try again." });
  }
});

export default router;
