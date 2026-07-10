import cron from "node-cron";
import { readFileSync, readdirSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger";
import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";

const LAST_CLEANUP_SETTING_KEY = "github_sync_last_cleanup";

const HISTORY_FILE = fileURLToPath(
  new URL("../../../../.github-sync-history.json", import.meta.url),
);
const LOG_DIR = fileURLToPath(
  new URL("../../../../.github-sync-logs/", import.meta.url),
);

interface GithubSyncHistoryEntry {
  id: string;
  hasLog?: boolean;
}

async function persistLastCleanupResult(result: { deleted: number; errors: number; ranAt: string }): Promise<void> {
  try {
    await db
      .insert(systemSettingsTable)
      .values({ key: LAST_CLEANUP_SETTING_KEY, value: JSON.stringify(result), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: JSON.stringify(result), updatedAt: new Date() },
      });
  } catch (err) {
    logger.error({ err }, "Failed to persist last GitHub sync log cleanup result");
  }
}

export async function getLastGithubSyncLogCleanupResult(): Promise<{ deleted: number; errors: number; ranAt: string } | null> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, LAST_CLEANUP_SETTING_KEY))
      .limit(1);

    if (!row?.value) {
      return null;
    }

    const parsed = JSON.parse(row.value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.deleted === "number" &&
      typeof parsed.errors === "number" &&
      typeof parsed.ranAt === "string"
    ) {
      return parsed as { deleted: number; errors: number; ranAt: string };
    }
    return null;
  } catch (err) {
    logger.error({ err }, "Failed to read last GitHub sync log cleanup result");
    return null;
  }
}

export async function runGithubSyncLogCleanup(): Promise<{ deleted: number; errors: number }> {
  let history: GithubSyncHistoryEntry[] = [];
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      history = parsed as GithubSyncHistoryEntry[];
    }
  } catch {
    // No history file yet — all log files are orphans
  }

  const knownIds = new Set(history.map((e) => e.id).filter(Boolean));

  let files: string[] = [];
  try {
    files = readdirSync(LOG_DIR).filter((f) => f.endsWith(".log"));
  } catch {
    // Log directory doesn't exist yet — nothing to clean up
    const result = { deleted: 0, errors: 0 };
    await persistLastCleanupResult({ ...result, ranAt: new Date().toISOString() });
    return result;
  }

  let deleted = 0;
  let errors = 0;

  for (const file of files) {
    const id = file.replace(/\.log$/, "");
    if (!knownIds.has(id)) {
      try {
        unlinkSync(`${LOG_DIR}${file}`);
        deleted++;
      } catch (err) {
        errors++;
        logger.warn({ err, file }, "Failed to delete orphaned GitHub sync log file");
      }
    }
  }

  if (deleted > 0 || errors > 0) {
    logger.info({ deleted, errors }, "GitHub sync log cleanup complete");
  }

  await persistLastCleanupResult({ deleted, errors, ranAt: new Date().toISOString() });

  return { deleted, errors };
}

export function initGithubSyncLogCleanupScheduler(): void {
  cron.schedule("0 3 * * *", () => {
    runGithubSyncLogCleanup().catch((err) => {
      logger.error({ err }, "GitHub sync log cleanup scheduler failed");
    });
  });

  logger.info("GitHub sync log cleanup scheduler registered (runs nightly at 03:00)");
}
