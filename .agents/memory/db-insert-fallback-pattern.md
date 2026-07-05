---
name: DB insert fallback + sanitized error pattern for payin orders
description: How the cashfree_payment_orders insert survives schema drift, and how to add a similar guarded insert elsewhere.
---

The root cause of a recurring "provider succeeded, DB insert failed" incident on
`cashfree_payment_orders` was that the Drizzle schema had columns (e.g.
`provider_key`, `payment_method`, `customer_email`, `raw_provider_status`,
`failure_reason`, `raw_payload`, `public_order_id`) that were never actually
applied to the live table — only `paid_at` had a matching `ALTER TABLE` in the
schema guard/migration. Any new Drizzle column needs a matching `ADD COLUMN IF
NOT EXISTS` in **both** the in-process guard (`payinSchemaGuard.ts`) and the
deploy-time migration (`db-migrate.ts`), or production silently drifts from
dev even though `pnpm run typecheck` passes.

**Why:** typecheck/dev-DB testing can never catch this — Drizzle schema
changes don't fail typecheck if the live table doesn't have the column; it
only shows up as a runtime DB error in production.

**How to apply:** for any insert that must be resilient to unexpected schema
drift, use the two-tier pattern in `helpers/payinOrderInsert.ts`: full insert
first, and on failure a minimal insert containing only the columns guaranteed
present by the schema guard. Log sanitized DB error fields only
(`code`/`table`/`column`/`constraint` from the pg driver error object) — never
`message`/`detail`, since Postgres embeds the offending row's raw value in
those fields (e.g. a duplicate-key detail message can contain a customer
phone number or provider order id).
