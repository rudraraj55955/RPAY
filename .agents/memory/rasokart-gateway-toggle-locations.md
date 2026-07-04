---
name: RasoKart gateway enable/disable toggle locations
description: Where the real enabled/disabled toggle+save flows live for each payment gateway, vs decoy summary panels.
---

The `/admin/payment-gateways` page has `CashfreePayinPanel`/`CashfreePayoutPanel` components that look like config panels but are read-only summary/link cards — they have no Enable switch or Save button.

The actual enable/disable toggle + Save flow for each gateway lives on separate dedicated pages:
- EKQR / UPI gateway: `EkqrConfigPanel` inside `artifacts/rpay/src/pages/admin/payment-gateways.tsx`
- Cashfree Payin: `artifacts/rpay/src/pages/admin/payment-gateway.tsx` (`AdminPaymentGateway`)
- Cashfree Payout: `SettingsTab` inside `artifacts/rpay/src/pages/admin/payout-gateway.tsx`

**Why:** Easy to miss when searching for "the gateway config UI" — grepping for Enable/Switch inside `payment-gateways.tsx` alone will surface only the EKQR panel and the two decoy summary cards, not the real Payin/Payout editors.

**How to apply:** Any feature that must trigger on gateway enable/disable (e.g. confirmation dialogs, audit logging, guard rails) needs to be wired into all three of the files above, not just `payment-gateways.tsx`.
