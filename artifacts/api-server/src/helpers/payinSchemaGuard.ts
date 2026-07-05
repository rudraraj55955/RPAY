import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Permanent, in-process schema guard for `cashfree_payment_orders`.
 *
 * This exists so the daily-deposit-limit query and status comparisons can
 * NEVER again silently break because of a missing `paid_at` column or
 * lowercase legacy status values — the exact production incident this
 * guards against. It is idempotent (safe to run any number of times) and
 * runs automatically the first time a payin route is hit in this process,
 * so correctness never depends on someone remembering to run a manual SQL
 * hotfix on a VPS.
 *
 * `pnpm --filter @workspace/scripts run db-migrate` (run on every deploy via
 * scripts/post-merge.sh) applies the same guard at deploy time — this
 * in-process guard is a second, defense-in-depth layer for any environment
 * where that script didn't run (e.g. mid-incident recovery).
 */
let guardPromise: Promise<void> | null = null;

async function runGuard(): Promise<void> {
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
  await db.execute(sql`
    UPDATE cashfree_payment_orders
    SET status = UPPER(status)
    WHERE status IS NOT NULL AND status <> UPPER(status)
  `);
}

export async function ensurePayinOrdersSchemaGuard(): Promise<void> {
  if (!guardPromise) {
    guardPromise = runGuard().catch((err) => {
      // Do not permanently cache a failed guard — allow the next request to retry
      // (e.g. transient DB connectivity blip) instead of wedging the process.
      guardPromise = null;
      throw err;
    });
  }
  return guardPromise;
}

/** Test-only: clears the cached guard promise so each test starts fresh. */
export function resetPayinSchemaGuardCacheForTests(): void {
  guardPromise = null;
}
