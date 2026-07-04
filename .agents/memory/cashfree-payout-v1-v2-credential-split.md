---
name: Cashfree Payouts V1 vs V2 credential/activation split
description: Live Cashfree client ID/secret can pass the v1 authorize connection test yet still get 401 authentication_failed on v2 Standard Transfer beneficiary/transfer endpoints.
---

Cashfree treats "Payouts V1" (bearer-token `/authorize` endpoint, used by `testPayoutConnection`) and
"Payouts V2 / Standard Transfers" (`x-client-id`/`x-client-secret` + `x-api-version` header, used for
beneficiary create/transfer) as separately-activated capabilities on the merchant's live account.

A successful v1 authorize test does **not** guarantee v2 endpoints will accept the same credentials —
v2 can reject with `401 authentication_failed` / "Invalid clientId and clientSecret combination" even
when v1 works fine.

**Why:** Observed during a real live ₹1 payout attempt — test-connection (v1) succeeded, but
`cashfreePayoutEnsureBeneficiary` (v2 endpoint) immediately 401'd with the same credentials. This is
an account-activation/credential-scope issue on Cashfree's side, not an application bug (headers, base
URL, and endpoint path were all correct per `cashfree-payout-v2-url.md`).

**How to apply:** If a live payout fails at the beneficiary-registration step with `authentication_failed`
despite a passing connection test, do not assume a code bug — first have the user confirm "Payouts V2 /
Standard Transfers" is activated on their Cashfree live account (or that a v2-specific secret was issued),
before re-attempting. The withdrawal-approve route already safely reverses the wallet hold on this failure
(FAILED/REVERSED → release hold, no auto-retry), so no funds are ever stuck from this failure mode.
