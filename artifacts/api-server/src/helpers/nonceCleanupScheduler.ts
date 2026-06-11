import cron, { type ScheduledTask } from "node-cron";
import { db, callbackNoncesTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";

let cleanupTask: ScheduledTask | null = null;

/**
 * How often (in hours) the scheduled prune runs.
 * Override via NONCE_CLEANUP_INTERVAL_HOURS (integer, 1–23).
 * Values outside that range are rejected and the default of 6 is used.
 * Defaults to 6 hours.
 *
 * The upper bound is 23 because the cron hour-step expression `* /N` is only
 * valid within a 0–23 hour range.
 */
function resolveIntervalHours(): number {
  const raw = process.env["NONCE_CLEANUP_INTERVAL_HOURS"];
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 23) {
      return parsed;
    }
    logger.warn(
      { raw },
      "NONCE_CLEANUP_INTERVAL_HOURS is not a valid integer in [1, 23]; using default 6",
    );
  }
  return 6;
}

/**
 * Delete all rows from `callback_nonces` where `expires_at` is in the past.
 *
 * This is the scheduled counterpart to the lazy per-request prune in
 * `callbackAuth.ts`. The lazy prune only fires when a new nonce is written, so
 * during quiet periods (no inbound callbacks) expired rows accumulate. Running
 * this job periodically keeps the table lean regardless of traffic.
 *
 * Returns the number of rows deleted.
 */
export async function pruneExpiredNonces(): Promise<number> {
  const result = await db
    .delete(callbackNoncesTable)
    .where(lt(callbackNoncesTable.expiresAt, new Date()));

  const deleted = Number((result as any).rowCount ?? 0);

  if (deleted > 0) {
    logger.info({ deleted }, "Nonce cleanup: pruned expired callback_nonces rows");
  } else {
    logger.debug("Nonce cleanup: no expired callback_nonces rows found");
  }

  return deleted;
}

/**
 * Register the nonce cleanup cron job.
 *
 * The interval is controlled by NONCE_CLEANUP_INTERVAL_HOURS (default: 6).
 * Calling this more than once is safe — the previous task is stopped first.
 */
export function initNonceCleanupScheduler(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  const intervalHours = resolveIntervalHours();
  const cronExpr = `0 */${intervalHours} * * *`;

  cleanupTask = cron.schedule(cronExpr, async () => {
    logger.debug("Nonce cleanup job triggered");
    try {
      await pruneExpiredNonces();
    } catch (err) {
      logger.error({ err }, "Nonce cleanup job failed");
    }
  });

  logger.info(
    { intervalHours, cronExpr },
    "Nonce cleanup scheduler registered",
  );
}
