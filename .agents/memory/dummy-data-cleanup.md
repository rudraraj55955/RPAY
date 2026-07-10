---
name: Dummy-data cleanup dual-implementation
description: Why the dummy/demo data cleanup logic exists in two places and how to keep them consistent
---

RasoKart has a Super-Admin-only "Data Hygiene" cleanup tool (API routes under
`/admin/dummy-data-cleanup` + a `cleanup:dummy-data` CLI script in `scripts/`).

Both implementations detect dummy merchants the same way: email/business-name
matches test|demo|dummy|sample|example, or phone is a known fake number
(9999999999/8888888888/0000000000/1234567890), EXCLUDING the documented demo
merchant logins in `@workspace/demo-credentials` (those stay, only their
seeded transaction/withdrawal/wallet_ledger/settlement/qr/VA/notification rows
get deleted, wallet balances reset to 0). Amount alone (e.g. ₹1/₹10) is never
used as a dummy-data signal.

**Why:** `scripts/` and `artifacts/api-server/` are separate leaf workspace
packages per pnpm-workspace rules — they cannot import from each other, so the
detection/cleanup SQL had to be duplicated rather than shared via a lib.

**How to apply:** if the dummy-data detection patterns ever change (new fake
phone numbers, new table added to the merchant-scoped delete list, etc.),
update BOTH `artifacts/api-server/src/helpers/dummyDataCleanup.ts` and
`scripts/src/cleanup-dummy-data.ts` in the same change, or the CLI and the
in-app Data Hygiene page will disagree on what counts as dummy data.
