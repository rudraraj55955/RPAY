/**
 * Notification reminder email scheduler.
 *
 * Runs daily and finds merchant users whose notification preferences have been
 * partially disabled for ≥ 30 days (notif_prefs_disabled_at <= NOW() - 30 days)
 * and who haven't received a reminder within the last 30 days
 * (notif_reminder_sent_at IS NULL OR notif_reminder_sent_at <= NOW() - 30 days)
 * and who have not opted out of reminder emails (notif_reminder_emails = true).
 *
 * Sends one reminder email per eligible user, then stamps notif_reminder_sent_at
 * so they won't receive another reminder for another 30 days (or until they
 * re-disable after re-enabling).
 *
 * The job bypasses quiet-hours since this is a periodic reminder, not a
 * real-time transactional alert. It also bypasses per-category opt-out checks
 * because the user has already disabled those categories — the whole point is
 * to nudge them back.
 */

import cron from "node-cron";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq, and, isNotNull, lte, or, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";
import { buildNotifReminderHtml } from "./notifReminderEmail";

const SILENCE_DAYS = 30;
const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";
const JWT_SECRET = process.env.SESSION_SECRET || "rasokart-secret-key-change-in-production";

export interface NotifReminderScanResult {
  checked: number;
  sent: number;
  skippedNoSmtp: number;
}

function generateUnsubscribeToken(userId: number): string {
  return jwt.sign({ purpose: "notif-reminder-unsubscribe", userId }, JWT_SECRET, { expiresIn: "90d" });
}

/**
 * Load merchant users who are overdue for a notification reminder:
 *   - notif_prefs_disabled_at is set and is at least SILENCE_DAYS ago
 *   - notif_reminder_sent_at is NULL  OR  was sent at least SILENCE_DAYS ago
 *   - notif_reminder_emails is true (user has not opted out)
 */
async function loadEligibleUsers(): Promise<
  Array<{ id: number; email: string; name: string }>
> {
  const cutoff = new Date(Date.now() - SILENCE_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "merchant"),
        eq(usersTable.isActive, true),
        eq(usersTable.notifReminderEmails, true),
        isNotNull(usersTable.notifPrefsDisabledAt),
        lte(usersTable.notifPrefsDisabledAt, cutoff),
        or(
          isNull(usersTable.notifReminderSentAt),
          lte(usersTable.notifReminderSentAt, cutoff)
        )
      )
    );

  return rows;
}

export async function runNotifReminderScan(): Promise<NotifReminderScanResult> {
  const users = await loadEligibleUsers();

  if (users.length === 0) {
    logger.info("Notif reminder scan: no eligible users found");
    return { checked: 0, sent: 0, skippedNoSmtp: 0 };
  }

  logger.info({ count: users.length }, "Notif reminder scan: eligible users found");

  let sent = 0;
  let skippedNoSmtp = 0;
  const now = new Date();

  for (const user of users) {
    try {
      const subject = "[RasoKart] Reminder — your email notifications have been off for 30+ days";
      const unsubscribeToken = generateUnsubscribeToken(user.id);
      const unsubscribeLink = `${APP_DOMAIN}/api/auth/notif-reminder-unsubscribe?token=${unsubscribeToken}`;
      const html = buildNotifReminderHtml({ name: user.name, unsubscribeLink });

      const ok = await sendMail({ to: user.email, subject, html });

      if (ok) {
        await db
          .update(usersTable)
          .set({ notifReminderSentAt: now })
          .where(eq(usersTable.id, user.id));

        sent++;
        logger.info(
          { userId: user.id, email: user.email },
          "Notif reminder email sent"
        );
      } else {
        skippedNoSmtp++;
        logger.warn(
          { userId: user.id, email: user.email },
          "Notif reminder email could not be sent (SMTP not configured or failed)"
        );
      }
    } catch (err) {
      logger.error({ err, userId: user.id }, "Failed to send notif reminder email");
    }
  }

  logger.info(
    { checked: users.length, sent, skippedNoSmtp },
    "Notif reminder scan complete"
  );

  return { checked: users.length, sent, skippedNoSmtp };
}

export function initNotifReminderScheduler(): void {
  cron.schedule("0 10 * * *", async () => {
    try {
      await runNotifReminderScan();
    } catch (err) {
      logger.error({ err }, "Notif reminder scheduler failed");
    }
  });

  logger.info("Notif reminder scheduler initialized (daily at 10:00)");
}
