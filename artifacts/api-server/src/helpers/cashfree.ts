import { createHmac, timingSafeEqual } from "crypto";

export const CASHFREE_API_BASE_PROD = "https://api.cashfree.com/pg";
export const CASHFREE_API_BASE_TEST = "https://sandbox.cashfree.com/pg";
export const CASHFREE_API_VERSION = "2023-08-01";

export type CashfreeEnv = "test" | "live";

function baseUrl(env: CashfreeEnv): string {
  return env === "live" ? CASHFREE_API_BASE_PROD : CASHFREE_API_BASE_TEST;
}

function headers(clientId: string, clientSecret: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-client-id": clientId,
    "x-client-secret": clientSecret,
    "x-api-version": CASHFREE_API_VERSION,
  };
}

export interface CashfreeOrderRequest {
  order_id: string;
  order_amount: number;
  order_currency: string;
  customer_details: {
    customer_id: string;
    customer_name?: string;
    customer_email?: string;
    customer_phone: string;
  };
  order_meta?: {
    return_url?: string;
    notify_url?: string;
  };
  order_note?: string;
}

export interface CashfreeOrderResponse {
  cf_order_id?: string;
  order_id?: string;
  order_status?: string;
  payment_session_id?: string;
  order_expiry_time?: string;
  message?: string;
  code?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Create a Cashfree payment order.
 *
 * Cashfree API: POST /pg/orders
 * Docs: https://docs.cashfree.com/docs/create-order
 *
 * On success, returns payment_session_id used to redirect the customer.
 * Test environment: https://sandbox.cashfree.com/pg/orders
 * Live environment: https://api.cashfree.com/pg/orders
 */
export async function cashfreeCreateOrder(
  clientId: string,
  clientSecret: string,
  env: CashfreeEnv,
  payload: CashfreeOrderRequest,
): Promise<{ raw: string; parsed: CashfreeOrderResponse }> {
  const res = await fetch(`${baseUrl(env)}/orders`, {
    method: "POST",
    headers: headers(clientId, clientSecret),
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let parsed: CashfreeOrderResponse;
  try {
    parsed = JSON.parse(raw) as CashfreeOrderResponse;
  } catch {
    parsed = { message: raw };
  }
  return { raw, parsed };
}

/**
 * Fetch a Cashfree order by order_id.
 *
 * Cashfree API: GET /pg/orders/{order_id}
 * Returns order status, payment status, and related details.
 */
export async function cashfreeGetOrder(
  clientId: string,
  clientSecret: string,
  env: CashfreeEnv,
  orderId: string,
): Promise<{ raw: string; parsed: CashfreeOrderResponse }> {
  const res = await fetch(`${baseUrl(env)}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: headers(clientId, clientSecret),
  });
  const raw = await res.text();
  let parsed: CashfreeOrderResponse;
  try {
    parsed = JSON.parse(raw) as CashfreeOrderResponse;
  } catch {
    parsed = { message: raw };
  }
  return { raw, parsed };
}

/**
 * Verify a Cashfree webhook signature.
 *
 * Cashfree computes:
 *   HMAC-SHA256(timestamp + rawBody, webhookSecret)
 * and sends it in the `x-webhook-signature` header along with `x-webhook-timestamp`.
 *
 * Returns true if the signature is valid, false if missing or invalid.
 * When no webhookSecret is configured this function should not be called.
 */
export function verifyCashfreeWebhookSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !timestamp) return false;

  const signatureBody = timestamp + rawBody;
  const expected = createHmac("sha256", secret).update(signatureBody).digest("base64");

  try {
    return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}
