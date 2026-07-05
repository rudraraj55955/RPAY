/**
 * Generic dispatcher for admin-added custom payment gateways
 * (provider_integrations rows with isCustom = true).
 *
 * Unlike Cashfree/EKQR (fixed, known API shapes), a custom gateway's actual
 * API contract is unknown ahead of time — it's whatever the admin configured
 * as `webhookUrl` (used here as the gateway's base API endpoint) plus the
 * apiKey/apiSecret credential pair. This client implements one reasonable,
 * documented generic protocol and defensively normalizes the response so a
 * misbehaving/unreachable custom gateway degrades to a clean error instead of
 * crashing the caller.
 *
 * Generic protocol:
 *   POST {webhookUrl}/orders
 *     headers: x-api-key, x-api-secret, Content-Type: application/json
 *     body:    { order_id, amount, currency, customer: { phone, email, name } }
 *     expects: { order_id | id, payment_url | paymentUrl | checkout_url, status? }
 *
 *   GET {webhookUrl}/orders/{providerOrderId}
 *     headers: x-api-key, x-api-secret
 *     expects: { status } where status is a free-form string; caller maps it.
 *
 * White-label: never surface the raw gateway response or webhookUrl to
 * merchants/customers — this module is backend-only.
 */

import type { ProviderIntegration } from "@workspace/db";
import { decryptSecret } from "./cryptoUtils";
import { logger } from "../lib/logger";

const REQUEST_TIMEOUT_MS = 15000;

export interface CustomGatewayOrderParams {
  publicOrderId: string;
  amount: number;
  currency: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  note?: string | null;
}

export interface CustomGatewayOrderResult {
  ok: boolean;
  providerOrderId?: string;
  paymentUrl?: string;
  raw?: string;
  errorMessage?: string;
}

export interface CustomGatewayStatusResult {
  ok: boolean;
  status?: string;
  raw?: string;
  errorMessage?: string;
}

function credentials(integration: ProviderIntegration): { apiKey: string; apiSecret: string } | null {
  const apiKey = integration.apiKeyEncrypted ? decryptSecret(integration.apiKeyEncrypted) : null;
  const apiSecret = integration.apiSecretEncrypted ? decryptSecret(integration.apiSecretEncrypted) : null;
  if (!apiKey?.ok || !apiKey.value.trim()) return null;
  // apiSecret is optional for some gateways — allow empty but require the key.
  return { apiKey: apiKey.value.trim(), apiSecret: apiSecret?.ok ? apiSecret.value.trim() : "" };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(webhookUrl: string): string {
  return webhookUrl.replace(/\/+$/, "");
}

/**
 * Create an order/payment session against a custom gateway. Never throws —
 * all failure modes (missing config, network error, bad response) resolve to
 * `{ ok: false, errorMessage }` so callers can fall back cleanly.
 */
export async function createCustomGatewayOrder(
  integration: ProviderIntegration,
  params: CustomGatewayOrderParams,
): Promise<CustomGatewayOrderResult> {
  if (!integration.webhookUrl?.trim()) {
    return { ok: false, errorMessage: "Custom gateway has no API endpoint configured" };
  }
  const creds = credentials(integration);
  if (!creds) {
    return { ok: false, errorMessage: "Custom gateway API key is not configured" };
  }

  const url = `${normalizeBaseUrl(integration.webhookUrl)}/orders`;

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": creds.apiKey,
        "x-api-secret": creds.apiSecret,
      },
      body: JSON.stringify({
        order_id: params.publicOrderId,
        amount: params.amount,
        currency: params.currency,
        customer: {
          phone: params.customerPhone ?? undefined,
          email: params.customerEmail ?? undefined,
          name: params.customerName ?? undefined,
        },
        note: params.note ?? undefined,
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      logger.warn({ providerKey: integration.providerKey, httpStatus: res.status }, "Custom gateway order creation returned non-2xx");
      return { ok: false, raw, errorMessage: `Gateway responded with HTTP ${res.status}` };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, raw, errorMessage: "Gateway returned a non-JSON response" };
    }

    const providerOrderId = (parsed["order_id"] ?? parsed["id"] ?? parsed["orderId"]) as string | undefined;
    const paymentUrl = (parsed["payment_url"] ?? parsed["paymentUrl"] ?? parsed["checkout_url"] ?? parsed["checkoutUrl"]) as string | undefined;

    if (!providerOrderId) {
      return { ok: false, raw, errorMessage: "Gateway response did not include an order id" };
    }

    return { ok: true, providerOrderId, paymentUrl, raw };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ providerKey: integration.providerKey, err: errorMessage }, "Custom gateway order creation failed");
    return { ok: false, errorMessage: "Unable to reach custom gateway" };
  }
}

/**
 * Best-effort status check against a custom gateway. Used for polling only —
 * webhooks remain the source of truth for crediting a merchant's wallet.
 */
export async function checkCustomGatewayOrderStatus(
  integration: ProviderIntegration,
  providerOrderId: string,
): Promise<CustomGatewayStatusResult> {
  if (!integration.webhookUrl?.trim()) {
    return { ok: false, errorMessage: "Custom gateway has no API endpoint configured" };
  }
  const creds = credentials(integration);
  if (!creds) {
    return { ok: false, errorMessage: "Custom gateway API key is not configured" };
  }

  const url = `${normalizeBaseUrl(integration.webhookUrl)}/orders/${encodeURIComponent(providerOrderId)}`;

  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "x-api-key": creds.apiKey, "x-api-secret": creds.apiSecret },
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false, raw, errorMessage: `Gateway responded with HTTP ${res.status}` };

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, raw, errorMessage: "Gateway returned a non-JSON response" };
    }

    const status = (parsed["status"] ?? parsed["order_status"] ?? parsed["orderStatus"]) as string | undefined;
    return { ok: true, status, raw };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ providerKey: integration.providerKey, err: errorMessage }, "Custom gateway status check failed");
    return { ok: false, errorMessage: "Unable to reach custom gateway" };
  }
}
