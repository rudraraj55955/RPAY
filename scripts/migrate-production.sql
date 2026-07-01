-- RasoKart Production Migration Script
-- Safe, idempotent — run on VPS after git pull.
-- Uses IF NOT EXISTS / DO blocks to never fail on a pre-existing column or index.
-- Run as: psql "$DATABASE_URL" -f scripts/migrate-production.sql

BEGIN;

-- ── quiet_hours_queue ────────────────────────────────────────────────────────
ALTER TABLE quiet_hours_queue
  ADD COLUMN IF NOT EXISTS flushed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE quiet_hours_queue
  ADD COLUMN IF NOT EXISTS flushed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quiet_hours_queue_flushed_deliver
  ON quiet_hours_queue (flushed, deliver_after);

-- ── withdrawals ──────────────────────────────────────────────────────────────
-- These columns were added for the payout-system integration.
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS provider_reference_id TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS utr TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS approved_by_admin_id INTEGER;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS payout_mode TEXT NOT NULL DEFAULT 'IMPS';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS upi_id TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS bank_account TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS ifsc_code TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS account_holder TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ── system_config new keys (seed inserts these but migration makes them safe) ─
-- No schema change needed — system_config is a key-value table.
-- New keys (cashfree_payout_bulk_enabled, etc.) are inserted by the API server
-- seed on startup.

COMMIT;

SELECT 'Migration complete ✓' AS status;
