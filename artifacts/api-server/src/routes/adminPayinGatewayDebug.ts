import { Router } from "express";
import { cashfreeCreateOrder, resolveCashfreeBaseUrl, CASHFREE_API_VERSION } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { loadPayinConfig } from "../helpers/payinConfig";
import { isValidHttpsUrl, sanitizeDiagnosticMessage, sanitizeSubCode } from "../helpers/payinDiagnosticSanitize";

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

export default router;
