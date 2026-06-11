import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { checkWebhookSecretRotation } from "./webhookSecretChecker";

export interface WebhookSecretScheduleConfig {
  hour: number;
  minute: number;
}

let scheduledTask: ScheduledTask | null = null;

async function runWebhookSecretCheck(): Promise<void> {
  logger.info("Webhook secret rotation check starting");
  const { merchantsScanned, reminderCount, overdueCount, notificationsSent, emailsSent } =
    await checkWebhookSecretRotation();
  logger.info(
    { merchantsScanned, reminderCount, overdueCount, notificationsSent, emailsSent },
    "Webhook secret rotation check complete",
  );
}

export async function loadWebhookSecretScheduleConfig(): Promise<WebhookSecretScheduleConfig> {
  const keys = [
    SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_HOUR,
    SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_MINUTE,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const hourRaw =
    map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_HOUR) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_HOUR];

  const minuteRaw =
    map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_MINUTE) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_MINUTE];

  const hour = parseInt(hourRaw);
  const minute = parseInt(minuteRaw);

  return {
    hour: isNaN(hour) ? 9 : Math.max(0, Math.min(23, hour)),
    minute: isNaN(minute) ? 0 : Math.max(0, Math.min(59, minute)),
  };
}

function buildCronExpr(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

function scheduleWebhookSecretCheck(cronExpr: string): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  scheduledTask = cron.schedule(cronExpr, async () => {
    try {
      await runWebhookSecretCheck();
    } catch (err) {
      logger.error({ err }, "Webhook secret rotation scheduler check failed");
    }
  });

  logger.info({ cronExpr }, "Webhook secret rotation alert scheduler registered");
}

export async function initWebhookSecretScheduler(): Promise<void> {
  const config = await loadWebhookSecretScheduleConfig();
  const cronExpr = buildCronExpr(config.hour, config.minute);
  scheduleWebhookSecretCheck(cronExpr);

  logger.info(
    { hour: config.hour, minute: config.minute, cronExpr },
    "Webhook secret rotation alert scheduler initialized from DB config",
  );

  // Startup sweep: catch any merchants whose secrets aged while the server was down.
  // Deduplication in checkWebhookSecretRotation() makes this safe to run on every boot.
  runWebhookSecretCheck().catch((err) => {
    logger.warn({ err }, "Startup webhook secret rotation sweep failed");
  });
}

export async function rescheduleWebhookSecretFromDb(): Promise<WebhookSecretScheduleConfig> {
  const config = await loadWebhookSecretScheduleConfig();
  const cronExpr = buildCronExpr(config.hour, config.minute);
  scheduleWebhookSecretCheck(cronExpr);
  return config;
}
