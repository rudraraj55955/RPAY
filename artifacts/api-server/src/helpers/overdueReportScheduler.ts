/**
 * Overdue scheduled-report alert scheduler.
 *
 * Runs daily and finds active report schedules (merchant transaction reports
 * and admin audit-log reports) whose next-due date has passed without a
 * successful delivery.
 *
 * Each overdue schedule triggers one in-app notification per active admin user.
 *
 * De-duplication is enforced atomically at the DB level via the partial unique
 * index `notifications_report_overdue_dedup_idx`.  Inserts use
 * onConflictDoNothing() so concurrent runs (startup sweep + cron) are safe.
 *
 * Dedup key: `report_overdue_<kind>_<scheduleId>_<YYYY-MM-DD>` where the date
 * is the ISO date of nextDue.  Once a report is delivered, lastSentAt advances
 * and the next overdue cycle produces a new key — preventing stale alerts from
 * lingering.
 */

import cron from "node-cron";
import { db, reportSchedulesTable, scheduledAuditReportsTable, merchantsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const DAYS = {
  monthly: 28,
  weekly: 7,
  daily: 1,
} as const;

/**
 * Compute the next-due date from the last-sent timestamp and frequency,
 * mirroring the frontend `getNextDue()` helper in admin/reports.tsx.
 *
 * Returns null when the schedule has never been sent (treated as "not yet
 * overdue" — the scheduler hasn't had a chance to send it yet).
 *
 * A `nextRunAt` override (admin-forced run) takes priority over cadence math.
 */
function computeNextDue(
  lastSentAt: Date | null,
  frequency: string,
  nextRunAt?: Date | null,
): Date | null {
  if (nextRunAt != null) return nextRunAt;
  if (!lastSentAt) return null;
  const days = DAYS[frequency as keyof typeof DAYS] ?? 7;
  return new Date(lastSentAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Returns all active admin user IDs. */
async function getAdminUserIds(): Promise<number[]> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));
  return rows.map(r => r.id);
}

export interface OverdueScanResult {
  merchantSchedulesChecked: number;
  auditSchedulesChecked: number;
  overdueCount: number;
  adminCount: number;
}

/**
 * Core scan: find overdue schedules and notify all active admins.
 */
export async function runOverdueReportScan(): Promise<OverdueScanResult> {
  const now = new Date();

  const [merchantRows, auditRows, adminUserIds] = await Promise.all([
    db
      .select({
        schedule: reportSchedulesTable,
        businessName: merchantsTable.businessName,
      })
      .from(reportSchedulesTable)
      .innerJoin(merchantsTable, eq(reportSchedulesTable.merchantId, merchantsTable.id))
      .where(eq(reportSchedulesTable.isActive, true)),
    db
      .select()
      .from(scheduledAuditReportsTable)
      .where(eq(scheduledAuditReportsTable.isActive, true)),
    getAdminUserIds(),
  ]);

  if (adminUserIds.length === 0) {
    logger.warn("Overdue report scan: no active admin users — skipping notifications");
    return { merchantSchedulesChecked: merchantRows.length, auditSchedulesChecked: auditRows.length, overdueCount: 0, adminCount: 0 };
  }

  let overdueCount = 0;

  for (const row of merchantRows) {
    const { schedule, businessName } = row;
    const nextDue = computeNextDue(schedule.lastSentAt, schedule.frequency, schedule.nextRunAt);
    if (!nextDue || nextDue >= now) continue;

    const nextDueDateStr = nextDue.toISOString().slice(0, 10);
    const dedupeKey = `report_overdue_merchant_${schedule.id}_${nextDueDateStr}`;
    const freqLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
    const appDomain = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

    const rows = adminUserIds.map(adminUserId => ({
      userId: adminUserId,
      type: "scheduled_report_overdue" as const,
      title: "Scheduled Report Overdue",
      body: `The ${freqLabel.toLowerCase()} transaction report for ${businessName} was due on ${nextDueDateStr} but has not been sent. Visit the Reports page to investigate or send it manually.`,
      metadata: {
        scheduleId: schedule.id,
        kind: "merchant",
        merchantId: schedule.merchantId,
        businessName,
        frequency: schedule.frequency,
        nextDue: nextDue.toISOString(),
        nextDueDateStr,
        dedupeKey,
        reportsUrl: `${appDomain}/admin/reports`,
      },
    }));

    const inserted = await db
      .insert(notificationsTable)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });

    if (inserted.length > 0) {
      overdueCount++;
      logger.info(
        { scheduleId: schedule.id, merchantId: schedule.merchantId, businessName, nextDueDateStr, adminCount: adminUserIds.length },
        "Overdue merchant report alert sent to admins",
      );
    }
  }

  for (const schedule of auditRows) {
    const nextDue = computeNextDue(schedule.lastSentAt, schedule.frequency);
    if (!nextDue || nextDue >= now) continue;

    const nextDueDateStr = nextDue.toISOString().slice(0, 10);
    const dedupeKey = `report_overdue_audit_${schedule.id}_${nextDueDateStr}`;
    const freqLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
    const appDomain = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

    const rows = adminUserIds.map(adminUserId => ({
      userId: adminUserId,
      type: "scheduled_report_overdue" as const,
      title: "Scheduled Audit Report Overdue",
      body: `The ${freqLabel.toLowerCase()} audit log report (recipient: ${schedule.recipientEmail}) was due on ${nextDueDateStr} but has not been sent. Visit the Reports page to investigate or retry manually.`,
      metadata: {
        scheduleId: schedule.id,
        kind: "audit",
        recipientEmail: schedule.recipientEmail,
        frequency: schedule.frequency,
        nextDue: nextDue.toISOString(),
        nextDueDateStr,
        dedupeKey,
        reportsUrl: `${appDomain}/admin/reports`,
      },
    }));

    const inserted = await db
      .insert(notificationsTable)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });

    if (inserted.length > 0) {
      overdueCount++;
      logger.info(
        { scheduleId: schedule.id, recipientEmail: schedule.recipientEmail, nextDueDateStr, adminCount: adminUserIds.length },
        "Overdue audit report alert sent to admins",
      );
    }
  }

  logger.info(
    {
      merchantSchedulesChecked: merchantRows.length,
      auditSchedulesChecked: auditRows.length,
      overdueCount,
      adminCount: adminUserIds.length,
    },
    "Overdue report scan complete",
  );

  return {
    merchantSchedulesChecked: merchantRows.length,
    auditSchedulesChecked: auditRows.length,
    overdueCount,
    adminCount: adminUserIds.length,
  };
}

/** Register the daily cron job. Called once at server startup. */
export function initOverdueReportScheduler(): void {
  cron.schedule("30 9 * * *", async () => {
    try {
      await runOverdueReportScan();
    } catch (err) {
      logger.error({ err }, "Overdue report scheduler failed");
    }
  });

  logger.info("Overdue report alert scheduler initialized (daily at 09:30)");
}
