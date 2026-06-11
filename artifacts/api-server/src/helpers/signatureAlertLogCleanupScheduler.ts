import cron, { type ScheduledTask } from "node-cron";
import { db, signatureFailureAlertLogsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";

let cleanupTask: ScheduledTask | null = null;

/**
 * How many days of alert log history to retain.
 * Override via ALERT_LOG_RETENTION_DAYS (positive integer).
 * Values that are not positive integers are rejected and the default of 90 is used.
 * Defaults to 90 days.
 */
function resolveRetentionDays(): number {
  const raw = process.env["ALERT_LOG_RETENTION_DAYS"];
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
    logger.warn(
      { raw },
      "ALERT_LOG_RETENTION_DAYS is not a valid positive integer; using default 90",
    );
  }
  return 90;
}

/**
 * Delete all rows from `signature_failure_alert_logs` where `sent_at` is
 * older than the configured retention window.
 *
 * Returns the number of rows deleted.
 */
export async function pruneOldAlertLogs(): Promise<number> {
  const retentionDays = resolveRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(signatureFailureAlertLogsTable)
    .where(lt(signatureFailureAlertLogsTable.sentAt, cutoff));

  const deleted = Number((result as any).rowCount ?? 0);

  if (deleted > 0) {
    logger.info(
      { deleted, retentionDays },
      "Alert log cleanup: pruned old signature_failure_alert_logs rows",
    );
  } else {
    logger.debug(
      { retentionDays },
      "Alert log cleanup: no old signature_failure_alert_logs rows found",
    );
  }

  return deleted;
}

/**
 * Register the nightly alert log cleanup cron job.
 *
 * Runs at 03:00 every day. Retention window is controlled by
 * ALERT_LOG_RETENTION_DAYS (default: 90).
 * Calling this more than once is safe — the previous task is stopped first.
 */
export function initSignatureAlertLogCleanupScheduler(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  const cronExpr = "0 3 * * *";

  cleanupTask = cron.schedule(cronExpr, async () => {
    logger.debug("Alert log cleanup job triggered");
    try {
      await pruneOldAlertLogs();
    } catch (err) {
      logger.error({ err }, "Alert log cleanup job failed");
    }
  });

  const retentionDays = resolveRetentionDays();
  logger.info(
    { retentionDays, cronExpr },
    "Signature alert log cleanup scheduler registered",
  );
}
