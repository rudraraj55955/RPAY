import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, auditLogsTable } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

let retentionTask: ScheduledTask | null = null;

export async function loadTestEmailRetentionDays(): Promise<number> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.TEST_EMAIL_HISTORY_RETENTION_DAYS));

  const raw =
    rows[0]?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.TEST_EMAIL_HISTORY_RETENTION_DAYS];
  const days = parseInt(raw);
  return isNaN(days) ? 30 : Math.max(0, days);
}

export async function runTestEmailRetentionCleanup(): Promise<{ deleted: number }> {
  const retentionDays = await loadTestEmailRetentionDays();

  if (retentionDays === 0) {
    logger.info("Test email history retention is disabled (retention_days = 0) — skipping cleanup");
    return { deleted: 0 };
  }

  const deleteResult = await db
    .delete(auditLogsTable)
    .where(
      sql`${auditLogsTable.action} = 'test_email_sent'
        AND ${auditLogsTable.createdAt} < NOW() - (${retentionDays} || ' days')::interval`
    );

  const deleted = Number((deleteResult as any).rowCount ?? 0);

  logger.info({ retentionDays, deleted }, "Test email history retention cleanup complete");
  return { deleted };
}

export function initTestEmailRetentionScheduler(): void {
  if (retentionTask) {
    retentionTask.stop();
    retentionTask = null;
  }

  retentionTask = cron.schedule("30 2 * * *", async () => {
    try {
      await runTestEmailRetentionCleanup();
    } catch (err) {
      logger.error({ err }, "Test email history retention cleanup job failed");
    }
  });

  logger.info("Test email retention scheduler registered (runs nightly at 02:30)");
}
