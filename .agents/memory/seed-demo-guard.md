---
name: Seed demo merchant guard
description: How to prevent seed.ts from re-creating deleted demo merchants; and how to run schema migrations without a TTY
---

**Current rule (reversed from an earlier decision — see history below):** Demo merchants merchant@demo.com and merchant2@demo.com are upserted in seed.ts (`insert().onConflictDoUpdate()`), exactly like merchant3@demo.com, so they always exist and are login-able in every environment, including a fresh/cleaned DB. All downstream demo-data blocks still gate on `if (m1 && m2)`, which is now always true.

**Why:** These two accounts are documented in replit.md's Demo Credentials table and relied on by onboarding/sales demos and the pre-filled "Try it" API-docs panel. An earlier iteration made them SELECT-only (see history) so a deliberately-cleaned production environment would stay clean, but that caused documented demo logins to silently 401 in *any* environment where the rows didn't already exist (e.g. a fresh dev DB) — judged a worse failure mode than production re-appearing after an intentional delete. If production ever needs demo accounts truly gone, delete them via a manual script (see `scripts/src/fix-credentials.ts` pattern) after removing/adjusting this upsert, not by relying on SELECT-only seed behavior.

**History (superseded):** Previously m1/m2 were SELECT-only ("link if present, skip if absent") specifically to survive a clean-prod deletion. If this requirement returns, wrap the upsert back to `db.select().from(...).where(eq(..., "demo@email")).limit(1)` and keep all `if (m1 && m2)` guards — the credential-events null-safe pattern (`const rows = m1 ? await db.select(...) : [{ c: 1 }]`) still applies either way since `m1`/`m2` can be undefined in that mode.

**Non-interactive schema migrations:** `drizzle-kit push` requires a TTY (interactive prompt) — it will throw in CI or bash tool. Use direct SQL instead:
```sql
ALTER TABLE report_delivery_logs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS triggered_by text,
  ...;
```
