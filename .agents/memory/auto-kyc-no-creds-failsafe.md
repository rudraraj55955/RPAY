---
name: Auto KYC fails safe with no live credentials
description: How to verify a new Cashfree-backed auto-verification route when no real API credentials exist in the environment
---

When a new merchant-facing auto-verification feature (e.g. PAN/Aadhaar auto KYC) wraps a Cashfree-style provider, the dev/test environment usually has no real credentials configured (same as the pre-existing legacy `secure_id_settings`/onboarding feature — its credential columns are also empty).

**Rule:** design and verify the "not configured" path as a first-class case, not just an afterthought:
- The route must return a generic, branding-safe error (never provider name/keys) and write **zero** DB rows (no partial verification/log records) when config is missing.
- End-to-end verification in this situation means confirming the fail-safe path (safe error, zero side effects, correct HTTP status) via curl, not obtaining real success responses.

**Why:** without real Cashfree Secure ID creds there is no way to exercise the happy path in this workspace; treating the safe-failure behavior as the verifiable contract avoids blocking the task on external credentials the user hasn't provided.

**How to apply:** when adding a similar provider-backed verification flow, write the config-missing check as the very first branch in the handler (before any DB writes), and test it explicitly with curl before assuming "credentials issue" blocks all verification.
