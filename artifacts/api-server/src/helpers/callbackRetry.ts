import { db, callbackLogsTable, callbackLogAttemptsTable, usersTable, notificationsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq, and, lte, sql, count, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createNotification } from "./notifications";

const WEBHOOK_FAILURE_WINDOW_HOURS = 1;

async function notifyWebhookFailure(merchantId: number, url: string, attempts: number, qrCodeId: number | null): Promise<void> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.merchantId, merchantId))
    .limit(1);

  if (!user) return;

  // Deduplication: at most one alert per merchant per configurable window.
  // The hour bucket (UTC "YYYY-MM-DDTHH") encodes the window boundary so the
  // same key cannot match across hours.
  const now = new Date();
  const windowHour = Math.floor(now.getUTCHours() / WEBHOOK_FAILURE_WINDOW_HOURS) * WEBHOOK_FAILURE_WINDOW_HOURS;
  const hourBucket = `${now.toISOString().slice(0, 11)}${String(windowHour).padStart(2, "0")}`;
  const dedupeKey = `webhook_failure_${merchantId}_${hourBucket}`;

  const [existing] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.userId, user.id),
      eq(notificationsTable.type, "webhook_failure"),
      sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
    ))
    .limit(1);

  if (existing) {
    logger.info({ merchantId, dedupeKey }, "Webhook failure notification suppressed (duplicate within window)");
    return;
  }

  const qrLabel = qrCodeId != null ? ` (QR Code #${qrCodeId})` : "";
  await createNotification({
    userId: user.id,
    type: "webhook_failure",
    title: "Webhook Delivery Failed",
    body: `Callback to ${url} failed after ${attempts} attempt${attempts !== 1 ? "s" : ""}${qrLabel}. Please check your endpoint and ensure it returns a 2xx response.`,
    metadata: { qrCodeId, url, attempts, dedupeKey },
  });
}

export async function recordAttempt(callbackLogId: number, attemptNumber: number, httpStatus: number | null, responseBody: string | null): Promise<void> {
  await db.insert(callbackLogAttemptsTable).values({
    callbackLogId,
    attemptNumber,
    firedAt: new Date(),
    httpStatus,
    responseBody: responseBody && responseBody.length > 500 ? responseBody.slice(0, 500) + "…" : responseBody,
  }).catch((err) => {
    logger.warn({ err, callbackLogId, attemptNumber }, "Failed to insert callback_log_attempt row");
  });
}

// Hardcoded fallback defaults — used when system config rows are absent.
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_DELAY_1_SECONDS = 30;
const DEFAULT_DELAY_2_SECONDS = 300;
const DEFAULT_DELAY_3_SECONDS = 1800;
const DEFAULT_TEST_MAX_AUTO_RETRIES = 1;
const DEFAULT_TEST_RETRY_DELAY_SECONDS = 60;

export interface WebhookRetryConfig {
  maxAttempts: number;
  delay1Seconds: number;
  delay2Seconds: number;
  delay3Seconds: number;
  testMaxAutoRetries: number;
  testRetryDelaySeconds: number;
}

export async function loadWebhookRetryConfig(): Promise<WebhookRetryConfig> {
  const keys = [
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS,
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1_SECONDS,
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2_SECONDS,
    SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3_SECONDS,
    SYSTEM_CONFIG_KEYS.WEBHOOK_TEST_MAX_AUTO_RETRIES,
    SYSTEM_CONFIG_KEYS.WEBHOOK_TEST_RETRY_DELAY_SECONDS,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map(r => [r.key, r.value]));

  const parse = (key: string, fallback: number): number => {
    const raw = map.get(key) ?? SYSTEM_CONFIG_DEFAULTS[key as keyof typeof SYSTEM_CONFIG_DEFAULTS];
    const v = Number(raw);
    return isFinite(v) && v > 0 ? v : fallback;
  };

  return {
    maxAttempts: parse(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
    delay1Seconds: parse(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1_SECONDS, DEFAULT_DELAY_1_SECONDS),
    delay2Seconds: parse(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2_SECONDS, DEFAULT_DELAY_2_SECONDS),
    delay3Seconds: parse(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3_SECONDS, DEFAULT_DELAY_3_SECONDS),
    testMaxAutoRetries: parse(SYSTEM_CONFIG_KEYS.WEBHOOK_TEST_MAX_AUTO_RETRIES, DEFAULT_TEST_MAX_AUTO_RETRIES),
    testRetryDelaySeconds: parse(SYSTEM_CONFIG_KEYS.WEBHOOK_TEST_RETRY_DELAY_SECONDS, DEFAULT_TEST_RETRY_DELAY_SECONDS),
  };
}

function getNextRetryDelayMs(attempts: number, config: WebhookRetryConfig): number {
  // attempts is the number of attempts already made (including the just-failed one)
  switch (attempts) {
    case 1: return config.delay1Seconds * 1000;
    case 2: return config.delay2Seconds * 1000;
    case 3: return config.delay3Seconds * 1000;
    default: return 0;
  }
}

export async function scheduleCallbackRetry(logId: number, attempts: number): Promise<void> {
  const config = await loadWebhookRetryConfig();

  if (attempts >= config.maxAttempts) {
    await db
      .update(callbackLogsTable)
      .set({ status: "failed", nextRetryAt: null })
      .where(eq(callbackLogsTable.id, logId));
    return;
  }

  const delayMs = getNextRetryDelayMs(attempts, config);
  const nextRetryAt = new Date(Date.now() + delayMs);

  await db
    .update(callbackLogsTable)
    .set({ status: "pending_retry", nextRetryAt })
    .where(eq(callbackLogsTable.id, logId));
}

export async function fireCallback(
  url: string,
  body: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; httpStatus: number | null; responseBody: string | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    const responseBody = await res.text().catch(() => null);
    return { ok: res.ok, httpStatus: res.status, responseBody };
  } catch (err) {
    return {
      ok: false,
      httpStatus: null,
      responseBody: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function processPendingRetries(): Promise<void> {
  const now = new Date();

  const pending = await db
    .select()
    .from(callbackLogsTable)
    .where(
      and(
        eq(callbackLogsTable.status, "pending_retry"),
        lte(callbackLogsTable.nextRetryAt, now),
      ),
    )
    .limit(50);

  if (pending.length === 0) return;

  logger.info({ count: pending.length }, "Processing pending callback retries");

  // Load retry config once for the entire batch.
  const config = await loadWebhookRetryConfig();

  for (const log of pending) {
    if (!log.requestBody) {
      await db
        .update(callbackLogsTable)
        .set({ status: "failed", nextRetryAt: null, lastAttemptAt: now })
        .where(eq(callbackLogsTable.id, log.id));
      continue;
    }

    const newAttempts = log.attempts + 1;
    const { ok, httpStatus, responseBody } = await fireCallback(log.url, log.requestBody);

    await recordAttempt(log.id, newAttempts, httpStatus, responseBody);

    if (ok) {
      await db
        .update(callbackLogsTable)
        .set({
          status: "success",
          httpStatus,
          responseBody,
          attempts: newAttempts,
          nextRetryAt: null,
          lastAttemptAt: now,
        })
        .where(eq(callbackLogsTable.id, log.id));

      logger.info({ logId: log.id, attempts: newAttempts }, "Callback retry succeeded");
    } else {
      logger.warn(
        { logId: log.id, attempts: newAttempts, httpStatus, url: log.url },
        "Callback retry failed",
      );

      // Test deliveries are capped at testMaxAutoRetries auto-retries; live deliveries
      // follow the full backoff schedule up to maxAttempts.
      const reachedCap = log.isTest
        ? newAttempts > config.testMaxAutoRetries
        : newAttempts >= config.maxAttempts;
      if (reachedCap) {
        await db
          .update(callbackLogsTable)
          .set({
            status: "failed",
            httpStatus,
            responseBody,
            attempts: newAttempts,
            nextRetryAt: null,
            lastAttemptAt: now,
          })
          .where(eq(callbackLogsTable.id, log.id));

        if (!log.isTest) {
          await notifyWebhookFailure(log.merchantId, log.url, newAttempts, log.qrCodeId ?? null).catch((err) => {
            logger.error({ err, logId: log.id }, "Failed to send webhook failure notification");
          });
        }
      } else {
        const delayMs = getNextRetryDelayMs(newAttempts, config);
        const nextRetryAt = new Date(Date.now() + delayMs);

        await db
          .update(callbackLogsTable)
          .set({
            httpStatus,
            responseBody,
            attempts: newAttempts,
            nextRetryAt,
            lastAttemptAt: now,
          })
          .where(eq(callbackLogsTable.id, log.id));
      }
    }
  }
}
