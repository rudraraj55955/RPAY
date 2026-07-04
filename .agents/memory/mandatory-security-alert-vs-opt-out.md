---
name: Mandatory security alerts vs opt-out preference alerts
description: When to skip adding a new opt-out preference column for a new admin notification type
---

RasoKart has two categories of admin email alerts: opt-out ones (planExpiryAlertEmails, webhookFailureEmails, etc. — a boolean column per user, checked before sending) and mandatory security alerts (no column, sent to every active admin unconditionally).

**Why:** Adding a new opt-out preference means touching schema, auth.ts, openapi.yaml, zod codegen, and the admin settings UI — disproportionate plumbing for alerts admins should never be able to silence (e.g. payment gateway credential rotation). A plain `getAllActiveAdminEmails()` helper (role=admin, isActive=true, no preference filter) is the right shape for these.

**How to apply:** Before wiring a new admin notification, ask whether it's routine/informational (→ add opt-out preference column, follow the existing pattern) or a security-sensitive event admins must always see (→ send unconditionally to all active admins, no new column). Toggling `enabled`/env flags alone is not a credential change and must not trigger a credential-rotation alert — only actual client ID/secret/webhook-secret/API-key value changes should.
