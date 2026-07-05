---
name: Checkout session vs order-create distinction
description: Why the merchant deposit UI must branch on checkoutUrl presence, not just order-create success
---

A payin/deposit order-create API call can return HTTP 200 with a valid order but a null
`checkoutUrl` (provider failed to issue a session/session id at create time in some paths).
Client UI must treat this as a distinct third state — not "success" (spinner) and not
"failure" (order failed) — with copy like "Payment session could not be started. Please retry."

**Why:** in dev/sandbox, seeded provider credentials (`cashfree_client_id = TEST_CLIENT_ID_123`)
are intentionally fake, so the real create call 502s with `provider_no_session_id` before ever
reaching this state — this state is easy to forget to implement/test since it's unreachable via
the real provider locally.

**How to apply:** when adding a payment/checkout hand-off, always model three UI states from the
create response: (1) checkoutUrl present + auto-open succeeded, (2) checkoutUrl present + auto-open
blocked → show manual "Open ..." fallback button, (3) checkoutUrl absent → show retry message.
Verify state (3) locally by mocking the network response in a Playwright e2e test (`page.route`),
since real sandbox credentials can't produce it.
