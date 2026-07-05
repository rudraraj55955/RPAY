---
name: Migration script itself can drift from Drizzle schema
description: The idempotent CREATE TABLE in db-migrate.ts / schemaGuard.ts is hand-written SQL, not generated from schema.ts, so it can independently fall out of sync with the Drizzle schema file.
---

`quiet_hours_queue`'s CREATE TABLE in both `scripts/src/db-migrate.ts` and the in-process `schemaGuard.ts` only had `(id, user_id, subject, html, queued_at)` while `lib/db/src/schema/quietHoursQueue.ts` and the code reading/writing it (`helpers/quietHours.ts`) required `to`, `deliver_after`, `flushed`, `flushed_at`, `created_at`. This caused the every-minute quiet-hours flush scheduler to fail continuously with "column does not exist" — a real running error, but one that never surfaced in a login flow or typecheck, only in scheduler logs.

**Why:** the idempotent migration/guard SQL is hand-maintained, not generated from the Drizzle schema file — so "the guard exists" does not guarantee "the guard is complete." Both `db-migrate.ts` and `schemaGuard.ts` are separate hand-written copies that must independently match `lib/db/src/schema/*.ts`.

**How to apply:** when hunting for schema drift, don't just check whether a table/guard exists — diff the actual live DB columns (`\d <table>` or `information_schema.columns`) against the Drizzle schema file for every table with a scheduler or background job, not just the ones exercised by common e2e login/CRUD flows. Recurring-job errors (cron/scheduler failures) are a distinct drift signal from request-path errors and won't show up in a login-focused e2e test — check workflow logs for "does not exist" / "ERROR" patterns across a full scheduler tick (wait ~60s+) as part of any "permanent schema drift" audit.
