import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, merchantsTable, providersTable, uploadedObjectsTable } from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

let cleanupTask: ScheduledTask | null = null;

export interface StorageCleanupConfig {
  enabled: boolean;
  hour: number;
}

export async function loadStorageCleanupConfig(): Promise<StorageCleanupConfig> {
  const keys = [
    SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_ENABLED,
    SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_HOUR,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const enabledRaw =
    map.get(SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_ENABLED) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_ENABLED];

  const hourRaw =
    map.get(SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_HOUR) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_HOUR];

  const hour = parseInt(hourRaw);

  return {
    enabled: enabledRaw !== "false",
    hour: isNaN(hour) ? 3 : Math.max(0, Math.min(23, hour)),
  };
}

function normalizeToObjectPath(logoUrl: string): string | null {
  const idx = logoUrl.indexOf("/objects/");
  if (idx === -1) return null;
  const canonical = logoUrl.slice(idx);
  const qIdx = canonical.search(/[?#]/);
  return qIdx === -1 ? canonical : canonical.slice(0, qIdx);
}

export async function runStorageOrphanCleanup(): Promise<{ totalScanned: number; deleted: number; errors: number }> {
  const objectStorageService = new ObjectStorageService();

  const merchantLogos = await db
    .select({ logoUrl: merchantsTable.logoUrl })
    .from(merchantsTable)
    .where(sql`${merchantsTable.logoUrl} is not null`);

  const providerLogos = await db
    .select({ logoUrl: providersTable.logoUrl })
    .from(providersTable)
    .where(sql`${providersTable.logoUrl} is not null`);

  const usedPaths = new Set<string>(
    [
      ...merchantLogos.map((r) => normalizeToObjectPath(r.logoUrl as string)),
      ...providerLogos.map((r) => normalizeToObjectPath(r.logoUrl as string)),
    ].filter((p): p is string => p !== null)
  );

  const allRows = await db
    .select({ id: uploadedObjectsTable.id, objectPath: uploadedObjectsTable.objectPath })
    .from(uploadedObjectsTable);

  const orphans = allRows.filter((r) => !usedPaths.has(r.objectPath));

  let deleted = 0;
  let errors = 0;

  for (const orphan of orphans) {
    try {
      await objectStorageService.deleteObjectEntity(orphan.objectPath);
      await db
        .delete(uploadedObjectsTable)
        .where(eq(uploadedObjectsTable.id, orphan.id));
      deleted++;
    } catch (err) {
      logger.error({ err, objectPath: orphan.objectPath }, "Storage cleanup scheduler: failed to delete orphaned object");
      errors++;
    }
  }

  return { totalScanned: allRows.length, deleted, errors };
}

async function runScheduledStorageCleanup(): Promise<void> {
  const config = await loadStorageCleanupConfig();

  if (!config.enabled) {
    logger.info("Scheduled storage cleanup is disabled — skipping run");
    return;
  }

  logger.info("Starting scheduled storage orphan cleanup");

  try {
    const result = await runStorageOrphanCleanup();
    logger.info(
      { totalScanned: result.totalScanned, deleted: result.deleted, errors: result.errors },
      "Scheduled storage orphan cleanup complete"
    );
  } catch (err) {
    logger.error({ err }, "Scheduled storage orphan cleanup failed");
  }
}

export function initStorageCleanupScheduler(hour?: number): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  const cronHour = hour !== undefined ? hour : 3;
  const cronExpr = `0 ${cronHour} * * *`;

  cleanupTask = cron.schedule(cronExpr, runScheduledStorageCleanup);
  logger.info({ cronExpr }, "Storage cleanup scheduler registered");
}

export async function initStorageCleanupSchedulerFromDb(): Promise<StorageCleanupConfig> {
  const config = await loadStorageCleanupConfig();
  initStorageCleanupScheduler(config.hour);
  logger.info(
    { enabled: config.enabled, hour: config.hour },
    "Storage cleanup scheduler initialized from DB config"
  );
  return config;
}

export async function rescheduleStorageCleanupFromDb(): Promise<StorageCleanupConfig> {
  const config = await loadStorageCleanupConfig();
  initStorageCleanupScheduler(config.hour);
  return config;
}
