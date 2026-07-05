---
name: Schema guard needed for new Drizzle columns
description: Adding columns to a Drizzle schema file is not enough — the dev DB and prod DB need an explicit idempotent ALTER TABLE or a real db push, or the server 502s at seed time.
---

Adding a column to a `lib/db/src/schema/*.ts` table definition does not change the actual Postgres table. If the interactive `db push` can't run (no TTY, or was skipped), the dev DB silently drifts from the schema file — typecheck and build both pass because they only check TypeScript types, not the live DB shape. The first sign is a 502 at login/seed time with a Postgres error like `column "X" of relation "Y" does not exist`.

**Why:** this happened after a full feature build (schema + seed + route) reported "DB schema additions: COMPLETED" in an earlier session, but the actual `ALTER TABLE` never landed on the dev DB — it only existed in the Drizzle schema file and was assumed applied. The break was invisible until an end-to-end login test actually hit the seed path.

**How to apply:**
- After any schema file change, verify the live DB columns with `\d <table>` (via `psql "$DATABASE_URL"` or the `executeSql` code-execution helper) — do not trust "db push completed" from a prior session without checking.
- For safety in both dev and prod, add the new columns via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` inside the seed/startup path (see `payinSchemaGuard.ts` for the established pattern in this repo), not just in the Drizzle schema file.
- Always run a real end-to-end login/seed test (not just `typecheck`/`build`) after schema changes — type-level checks cannot catch live DB drift.
