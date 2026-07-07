import { Router } from "express";
import { db, cashfreePaymentOrdersTable, providerIntegrationsTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { cashfreeCreateOrder, cashfreeGetOrder } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";
import { requireAuth } from "../middlewares/auth";
import { loadPayinConfig } from "../helpers/payinConfig";
import { ensurePayinOrdersSchemaGuard } from "../helpers/payinSchemaGuard";
import { getMerchantDailyPaidTotal } from "../helpers/payinDailyLimit";
import { insertPayinOrderWithFallback } from "../helpers/payinOrderInsert";
import { selectProvider, recordRoutingResult } from "../helpers/smartRouter";
import { createCustomGatewayOrder } from "../helpers/customGatewayClient";

const router = Router();

// providerKey values reserved for the built-in Cashfree payin flow — a smart
// routing rule using one of these just re-selects the existing hardcoded path.
const CASHFREE_PROVIDER_KEYS = new Set(["cashfree_payin", "cashfree"]);

// ─────────────────────────────────────────────────────────────────────────────
// White-label merchant Payin routes (RasoKart UPI Deposit).
// No "Cashfree", cf_order_id, payment_session_id, or raw provider payloads are
// ever exposed here — only RasoKart-branded fields.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/merchant/payin/status
 * White-label: whether RasoKart UPI deposits are available to this merchant.
 */
router.get("/payin/status", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const cfg = await loadPayinConfig();
    res.json({
      enabled: cfg.enabled && cfg.upiEnabled && cfg.merchantPayinEnabled,
      minAmount: cfg.minAmount,
      maxAmount: cfg.maxAmount,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/merchant/payin/orders
 * Creates a RasoKart UPI deposit order. Enforces admin-configured min/max/daily limits.
 * Response never includes cf_order_id, payment_session_id, or raw provider fields.
 */
router.post("/payin/orders", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const merchantId: number | undefined = user?.merchantId;

  // Generic, safe response used for every failure path below — never leaks
  // raw SQL/DB errors, provider responses, or internal identifiers.
  const genericFailure = () => {
    res.status(500).json({ error: "Deposit order could not be created. Please try again." });
  };

  try {
    if (user.role !== "merchant" || !merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    req.log.info({ event: "payin_deposit_create_started", merchantId }, "payin_deposit_create_started");

    req.log.info({ event: "payin_schema_guard_started", merchantId }, "payin_schema_guard_started");
    try {
      await ensurePayinOrdersSchemaGuard();
      req.log.info({ event: "payin_schema_guard_success", merchantId }, "payin_schema_guard_success");
    } catch (guardErr) {
      req.log.error({ event: "payin_schema_guard_failed", merchantId }, "payin_schema_guard_failed");
      genericFailure();
      return;
    }

    const { amount, customerPhone, customerName, customerEmail } = req.body as {
      amount?: number;
      customerPhone?: string;
      customerName?: string;
      customerEmail?: string;
    };

    const depositAmount = Number(amount);
    if (!amount || isNaN(depositAmount) || depositAmount <= 0) {
      res.status(400).json({ error: "Valid amount is required" });
      return;
    }
    if (!customerPhone) {
      res.status(400).json({ error: "Customer phone is required" });
      return;
    }

    const cfg = await loadPayinConfig();
    if (!cfg.enabled || !cfg.upiEnabled || !cfg.merchantPayinEnabled) {
      res.status(400).json({ error: "UPI deposits are not available right now. Please try again later." });
      return;
    }
    if (depositAmount < cfg.minAmount || depositAmount > cfg.maxAmount) {
      res.status(400).json({ error: `Amount must be between ₹${cfg.minAmount} and ₹${cfg.maxAmount}` });
      return;
    }

    // Daily limit check — sum of this merchant's PAID payin orders "today".
    // Uses paid_at when present; older rows from before paid_at was populated
    // fall back to created_at so the query never crashes or silently under/
    // over-counts on a partially-migrated table. COALESCE(SUM(...), 0) plus
    // the `?? 0` below guarantees a safe numeric result even when zero rows
    // match (fresh merchant, empty table, etc) — this must never throw.
    req.log.info({ event: "payin_daily_limit_check_started", merchantId }, "payin_daily_limit_check_started");
    let dailyTotal: number;
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      dailyTotal = await getMerchantDailyPaidTotal(merchantId, startOfDay);
      req.log.info({ event: "payin_daily_limit_check_success", merchantId, dailyTotal }, "payin_daily_limit_check_success");
    } catch (limitErr) {
      req.log.error({ event: "payin_daily_limit_check_failed", merchantId }, "payin_daily_limit_check_failed");
      genericFailure();
      return;
    }

    if (dailyTotal + depositAmount > cfg.dailyLimit) {
      res.status(400).json({ error: "Daily deposit limit reached. Please try again tomorrow or contact support." });
      return;
    }

    // ── Smart routing: multi-provider retry loop ─────────────────────────────
    // Walk through all enabled smart routing rules in order. Each rule may
    // specify isFallbackOnly (skip until a primary has been attempted) and
    // maxRetries (how many times to try this provider before moving on).
    //
    // IMPORTANT: Cashfree is only used as the final step when:
    //   a) The router explicitly selects it as a routing rule, OR
    //   b) No routing config exists at all (routingWasConfigured stays false).
    // When a routing config IS present and all its rules fail, we stop — we do
    // NOT silently append implicit Cashfree. Admins control the chain entirely.
    req.log.info({ event: "payin_smart_routing_started", merchantId }, "payin_smart_routing_started");

    // Large safety cap so the loop can never run indefinitely even if there is
    // a bug in the exclusion logic. In practice selectProvider returns null
    // once every provider has hit its maxRetries budget — this cap is never
    // reached under normal operation regardless of how many rules/retries are
    // configured (5 rules × 5 maxRetries each = 25 max real iterations).
    const ROUTING_SAFETY_CAP = 50;
    const excludedProviders: string[] = [];           // providers that have exhausted maxRetries
    const providerAttemptCounts: Record<string, number> = {}; // per-provider dispatch counter
    let primaryAttempted = false;     // has at least one non-fallback rule been tried?
    let routingWasConfigured = false; // did selectProvider return a non-null result?
    let cashfreeRoutingLogId: number | null = null;   // log ID when Cashfree is in the routing chain

    for (let attempt = 1; attempt <= ROUTING_SAFETY_CAP; attempt++) {
      const decision = await selectProvider(
        { merchantId, amount: depositAmount, paymentMode: "upi", logger: req.log },
        excludedProviders,
        attempt,
        primaryAttempted, // allow fallback-only rules only after a primary has been tried
      ).catch(() => null);

      if (!decision) break; // no more eligible providers — chain exhausted

      // First non-null decision signals that routing is configured.
      routingWasConfigured = true;

      // Cashfree built-in path — record the log ID and let the hardcoded
      // flow below handle the actual dispatch, then stop the loop.
      if (CASHFREE_PROVIDER_KEYS.has(decision.providerKey)) {
        cashfreeRoutingLogId = decision.routingLogId;
        break;
      }

      // Track per-provider attempts
      providerAttemptCounts[decision.providerKey] = (providerAttemptCounts[decision.providerKey] ?? 0) + 1;
      if (!decision.isFallbackOnly) primaryAttempted = true;

      // Dispatch to the custom gateway
      const [integration] = await db.select().from(providerIntegrationsTable)
        .where(and(
          eq(providerIntegrationsTable.providerKey, decision.providerKey),
          eq(providerIntegrationsTable.isEnabled, true),
        )).limit(1);

      if (!integration) {
        req.log.warn({ event: "payin_custom_gateway_not_found", merchantId, providerKey: decision.providerKey }, "payin_custom_gateway_not_found");
        await recordRoutingResult({ routingLogId: decision.routingLogId, providerKey: decision.providerKey, result: "skipped", errorMessage: "Integration not found or disabled" });
        excludedProviders.push(decision.providerKey);
        continue;
      }

      const publicOrderId = `RKPAYIN_${merchantId}_${Date.now()}`;
      const startedAt = Date.now();
      const gatewayResult = await createCustomGatewayOrder(integration, {
        publicOrderId,
        amount: depositAmount,
        currency: "INR",
        customerPhone,
        customerEmail: customerEmail ?? null,
        customerName: customerName ?? null,
        note: "RasoKart UPI Deposit",
      });
      const responseTimeMs = Date.now() - startedAt;

      if (gatewayResult.ok && gatewayResult.providerOrderId) {
        try {
          await db.insert(cashfreePaymentOrdersTable).values({
            merchantId,
            publicOrderId,
            providerKey: decision.providerKey,
            cashfreeOrderId: gatewayResult.providerOrderId,
            paymentSessionId: gatewayResult.paymentUrl ?? gatewayResult.providerOrderId,
            amount: depositAmount.toFixed(2),
            currency: "INR",
            status: PAYIN_ORDER_STATUS.CREATED,
            paymentMethod: "upi",
            customerPhone,
            customerEmail: customerEmail ?? null,
            rawPayload: gatewayResult.raw ?? null,
          }).onConflictDoNothing();
        } catch (insertErr) {
          req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "db_insert_failed" }, "payin_deposit_order_create_failed");
          await recordRoutingResult({ routingLogId: decision.routingLogId, providerKey: decision.providerKey, result: "failed", responseTimeMs, errorMessage: "db_insert_failed" });
          genericFailure();
          return;
        }

        await recordRoutingResult({
          routingLogId: decision.routingLogId,
          providerKey: decision.providerKey,
          result: "success",
          responseTimeMs,
          publicReferenceId: publicOrderId,
          providerReferenceId: gatewayResult.providerOrderId,
        });

        req.log.info({ event: "payin_deposit_order_created", merchantId, amount: depositAmount, routedVia: "custom_gateway", providerKey: decision.providerKey, attempt }, "payin_deposit_order_created");

        const customCheckoutUrl =
          gatewayResult.paymentUrl && /^https?:\/\//i.test(gatewayResult.paymentUrl)
            ? gatewayResult.paymentUrl
            : null;

        const safeToken = gatewayResult.paymentUrl ?? gatewayResult.providerOrderId;
        res.json({
          publicOrderId,
          paymentToken: safeToken,
          paymentSessionId: safeToken,
          checkoutUrl: customCheckoutUrl,
          amount: depositAmount,
          status: PAYIN_ORDER_STATUS.CREATED,
          checkoutLabel: "RasoKart Secure Checkout",
          message: "Deposit order created. Complete the payment via UPI to add funds to your wallet.",
          safeMessage: "Deposit order created. Complete the payment via UPI to add funds to your wallet.",
        });
        return;
      }

      // Dispatch failed — record it and decide whether to retry this provider
      req.log.warn({ event: "payin_custom_gateway_dispatch_failed", merchantId, providerKey: decision.providerKey, attempt }, "payin_custom_gateway_dispatch_failed");
      await recordRoutingResult({
        routingLogId: decision.routingLogId,
        providerKey: decision.providerKey,
        result: "failed",
        responseTimeMs,
        errorMessage: gatewayResult.errorMessage ?? "Custom gateway order creation failed",
      });

      // Exhaust this provider when its maxRetries budget is spent
      if (providerAttemptCounts[decision.providerKey] >= decision.maxRetries) {
        excludedProviders.push(decision.providerKey);
      }
    }

    // ── Post-loop routing gate ────────────────────────────────────────────────
    // If the routing chain was active (had at least one decision) but did NOT
    // select Cashfree, all configured providers are exhausted — fail the order
    // instead of silently falling through to an implicit Cashfree attempt the
    // admin never configured. This makes the failover chain authoritative.
    if (routingWasConfigured && cashfreeRoutingLogId === null) {
      req.log.warn({ event: "payin_routing_chain_exhausted", merchantId }, "payin_routing_chain_exhausted");
      res.status(503).json({ error: "Payment is temporarily unavailable. All configured gateways could not process the request. Please try again later or contact support." });
      return;
    }

    // No routing config at all, or Cashfree was explicitly selected by the
    // router — proceed to the hardcoded Cashfree path below.

    if (!cfg.clientId || !cfg.rawClientSecret) {
      res.status(400).json({ error: "UPI deposits are not available right now. Please try again later." });
      return;
    }
    const decrypted = decryptSecret(cfg.rawClientSecret);
    if (!decrypted.ok || !decrypted.value.trim()) {
      req.log.warn({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "decrypt_failed" }, "payin_deposit_order_create_failed");
      genericFailure();
      return;
    }

    const publicOrderId = `RKPAYIN_${merchantId}_${Date.now()}`;

    let raw: string;
    let parsed: Awaited<ReturnType<typeof cashfreeCreateOrder>>["parsed"];
    req.log.info({ event: "payin_provider_create_order_started", merchantId }, "payin_provider_create_order_started");
    try {
      ({ raw, parsed } = await cashfreeCreateOrder(cfg.clientId, decrypted.value, cfg.env, {
        order_id: publicOrderId,
        order_amount: depositAmount,
        order_currency: "INR",
        customer_details: {
          customer_id: `merchant-${merchantId}`,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
        },
        order_note: "RasoKart UPI Deposit",
      }, { baseUrl: cfg.baseUrl, apiVersion: cfg.apiVersion }));
      req.log.info({ event: "payin_provider_create_order_success", merchantId }, "payin_provider_create_order_success");
    } catch (providerErr) {
      req.log.error({ event: "payin_provider_create_order_failed", merchantId, safeReason: "provider_request_error" }, "payin_provider_create_order_failed");
      req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "provider_request_error" }, "payin_deposit_order_create_failed");
      genericFailure();
      return;
    }

    if (!parsed.payment_session_id) {
      req.log.warn({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "provider_no_session_id" }, "payin_deposit_order_create_failed");
      res.status(502).json({ error: "Unable to start deposit right now. Please try again." });
      return;
    }

    const insertResult = await insertPayinOrderWithFallback({
      merchantId,
      publicOrderId,
      cashfreeOrderId: parsed.order_id ?? publicOrderId,
      paymentSessionId: parsed.payment_session_id,
      amount: depositAmount.toFixed(2),
      customerPhone,
      customerEmail: customerEmail ?? null,
      rawPayload: raw,
    }, req.log);

    if (!insertResult.ok) {
      req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "db_insert_failed" }, "payin_deposit_order_create_failed");
      genericFailure();
      return;
    }

    req.log.info({ event: "payin_deposit_order_created", merchantId, amount: depositAmount }, "payin_deposit_order_created");

    if (cashfreeRoutingLogId != null) {
      await recordRoutingResult({
        routingLogId: cashfreeRoutingLogId,
        providerKey: "cashfree_payin",
        result: "success",
        publicReferenceId: publicOrderId,
        providerReferenceId: parsed.order_id ?? publicOrderId,
      });
    }

    // checkoutUrl / paymentToken point to our own branded checkout — never expose provider internals.
    const checkoutEnv = cfg.env === "live" ? "prod" : "sandbox";
    const checkoutUrl = `/checkout?token=${encodeURIComponent(parsed.payment_session_id)}&env=${checkoutEnv}&amount=${encodeURIComponent(depositAmount.toFixed(2))}`;

    const cashfreeSafeMessage = "Deposit order created. Complete the payment via UPI to add funds to your wallet.";
    res.json({
      publicOrderId,
      paymentToken: parsed.payment_session_id,
      paymentSessionId: parsed.payment_session_id,
      checkoutUrl,
      amount: depositAmount,
      status: PAYIN_ORDER_STATUS.CREATED,
      checkoutLabel: "RasoKart Secure Checkout",
      message: cashfreeSafeMessage,
      safeMessage: cashfreeSafeMessage,
    });
  } catch (err) {
    req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "unexpected_error" }, "payin_deposit_order_create_failed");
    genericFailure();
  }
});

/**
 * GET /api/merchant/payin/orders/:publicOrderId
 * White-label status check. UTR is only ever included once status is "paid".
 */
router.get("/payin/orders/:publicOrderId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const publicOrderId = req.params["publicOrderId"] as string;

    const [order] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(and(
        eq(cashfreePaymentOrdersTable.publicOrderId, publicOrderId),
        eq(cashfreePaymentOrdersTable.merchantId, user.merchantId),
      ))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Deposit order not found" });
      return;
    }

    // Optionally refresh status from provider if still pending (best-effort, never surfaces raw errors).
    if (order.status === PAYIN_ORDER_STATUS.CREATED || order.status === PAYIN_ORDER_STATUS.PENDING) {
      try {
        const cfg = await loadPayinConfig();
        if (cfg.clientId && cfg.rawClientSecret) {
          const decrypted = decryptSecret(cfg.rawClientSecret);
          if (decrypted.ok && decrypted.value.trim()) {
            const { parsed } = await cashfreeGetOrder(cfg.clientId, decrypted.value, cfg.env, order.cashfreeOrderId, { baseUrl: cfg.baseUrl, apiVersion: cfg.apiVersion });
            const providerStatus = (parsed.order_status ?? "").toUpperCase();
            if (providerStatus === "ACTIVE") {
              // still pending — no change
            } else if (providerStatus && providerStatus !== "PAID") {
              await db.update(cashfreePaymentOrdersTable)
                .set({ rawProviderStatus: providerStatus })
                .where(eq(cashfreePaymentOrdersTable.id, order.id));
            }
          }
        }
      } catch {
        // Best-effort refresh only; webhook remains source of truth for "paid".
      }
    }

    const [fresh] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(eq(cashfreePaymentOrdersTable.id, order.id))
      .limit(1);

    const isPaid = fresh?.status === PAYIN_ORDER_STATUS.PAID;
    res.json({
      publicOrderId,
      amount: Number(fresh?.amount ?? order.amount),
      status: fresh?.status ?? order.status,
      utr: isPaid ? (fresh?.utr ?? null) : null,
      paidAt: isPaid ? fresh?.paidAt ?? null : null,
      createdAt: fresh?.createdAt ?? order.createdAt,
    });
  } catch (err) {
    req.log.error({ event: "payin_order_status_check_failed" }, "payin_order_status_check_failed");
    res.status(500).json({ error: "Unable to check deposit status. Please try again." });
  }
});

export default router;
