import { createHmac, timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { db, apiKeysTable, merchantsTable, callbackLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Middleware: authenticate an inbound callback request via the X-Api-Key header.
 * On success, sets `req.callbackMerchantId` and `req.callbackApiKeyId` for downstream use.
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKeyHeader = (req.headers["x-api-key"] as string | undefined)?.trim();
  if (!apiKeyHeader) {
    res.status(401).json({ error: "X-Api-Key header is required" });
    return;
  }

  const [keyRow] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.apiKey, apiKeyHeader))
    .limit(1);

  if (!keyRow || !keyRow.isActive) {
    res.status(401).json({ error: "Invalid or inactive API key" });
    return;
  }

  (req as any).callbackMerchantId = keyRow.merchantId;
  (req as any).callbackApiKeyId = keyRow.id;
  next();
}

/**
 * Compute and compare HMAC-SHA256 signatures in constant time.
 * Accepts both `sha256=<hex>` and bare `<hex>` formats in the header.
 */
function verifyHmacSignature(secret: string, rawBody: Buffer, signatureHeader: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Middleware: enforce HMAC-SHA256 callback signature verification.
 * Must run AFTER `requireApiKey` (reads `req.callbackMerchantId`).
 *
 * - If the merchant has a `callbackSecret` configured, every request MUST include
 *   an `X-Signature: sha256=<hex>` header that matches HMAC-SHA256(secret, rawBody).
 * - Returns 401 with a clear error when the header is missing or the signature is wrong.
 * - If no secret is configured the request passes through (opt-in enforcement).
 * - Sets `req.signatureVerified` (true | null) for downstream logging.
 */
export async function verifyCallbackSignature(req: Request, res: Response, next: NextFunction): Promise<void> {
  const merchantId: number | undefined = (req as any).callbackMerchantId;
  if (merchantId === undefined) {
    res.status(500).json({ error: "verifyCallbackSignature must run after requireApiKey" });
    return;
  }

  const [merchant] = await db
    .select({ callbackSecret: merchantsTable.callbackSecret })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId))
    .limit(1);

  if (!merchant?.callbackSecret) {
    (req as any).signatureVerified = null;
    next();
    return;
  }

  const signatureHeader = (req.headers["x-signature"] as string | undefined)?.trim();

  if (!signatureHeader) {
    db.insert(callbackLogsTable).values({
      merchantId,
      url: req.originalUrl,
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date(),
      signatureVerified: false,
      responseBody: "X-Signature header is required for this merchant",
    }).catch((err: unknown) => {
      logger.warn({ err }, "Failed to log signature-missing callback attempt");
    });
    res.status(401).json({ error: "X-Signature header is required for this merchant" });
    return;
  }

  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) {
    res.status(500).json({ error: "Unable to verify signature: raw body unavailable" });
    return;
  }

  if (!verifyHmacSignature(merchant.callbackSecret, rawBody, signatureHeader)) {
    db.insert(callbackLogsTable).values({
      merchantId,
      url: req.originalUrl,
      status: "failed",
      attempts: 1,
      lastAttemptAt: new Date(),
      signatureVerified: false,
      responseBody: "Invalid X-Signature",
    }).catch((err: unknown) => {
      logger.warn({ err }, "Failed to log signature-invalid callback attempt");
    });
    res.status(401).json({ error: "Invalid X-Signature" });
    return;
  }

  (req as any).signatureVerified = true;
  next();
}
