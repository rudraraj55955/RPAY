import cron from "node-cron";
import { readFileSync, readdirSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger";

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

export function runGithubSyncLogCleanup(): { deleted: number; errors: number } {
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
    return { deleted: 0, errors: 0 };
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

  return { deleted, errors };
}

export function initGithubSyncLogCleanupScheduler(): void {
  cron.schedule("0 3 * * *", () => {
    try {
      runGithubSyncLogCleanup();
    } catch (err) {
      logger.error({ err }, "GitHub sync log cleanup scheduler failed");
    }
  });

  logger.info("GitHub sync log cleanup scheduler registered (runs nightly at 03:00)");
}
