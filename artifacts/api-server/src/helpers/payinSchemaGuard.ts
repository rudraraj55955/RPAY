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

/**
 * Every column `payinOrders.ts` inserts into. Kept in one place so the
 * in-process guard and the deploy-time migration (`db-migrate.ts`) can never
 * drift from what the insert actually needs — the exact class of bug that
 * caused `payin_deposit_order_create_failed` / `db_insert_failed` in
 * production even after the provider order was created successfully: the
 * live table was missing columns (e.g. `provider_key`, `payment_method`,
 * `customer_email`, `raw_provider_status`, `failure_reason`, `raw_payload`,
 * `public_order_id`) that had been added to the Drizzle schema but never
 * applied to the running database.
 *
 * All ADD COLUMN statements are nullable/defaulted — never NOT NULL without
 * a DEFAULT — so they can never fail against a table that already has rows.
 */
async function runGuard(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cashfree_payment_orders (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      cashfree_order_id TEXT NOT NULL UNIQUE,
      amount NUMERIC(18,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'CREATED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS public_order_id TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS provider_key TEXT DEFAULT 'cashfree'`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS payment_session_id TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS payment_method TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS utr TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS customer_phone TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS customer_email TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS raw_provider_status TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS failure_reason TEXT`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS raw_payload TEXT`);

  // Older/partial tables may have picked up NOT NULL on optional columns
  // (e.g. from a manual hotfix) with no default — relax those so a legitimate
  // insert missing an optional field never hard-fails.
  await db.execute(sql`
    DO $$
    DECLARE col TEXT;
    BEGIN
      FOREACH col IN ARRAY ARRAY[
        'public_order_id', 'provider_key', 'payment_session_id', 'payment_method',
        'utr', 'customer_phone', 'customer_email', 'raw_provider_status',
        'failure_reason', 'raw_payload'
      ]
      LOOP
        BEGIN
          EXECUTE format('ALTER TABLE cashfree_payment_orders ALTER COLUMN %I DROP NOT NULL', col);
        EXCEPTION WHEN undefined_column THEN NULL;
        END;
      END LOOP;
    END $$;
  `);

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
