---
name: Smart routing rule priority tie-break
description: routing_rules with equal priority values silently favor the lowest-id row; a new custom-gateway rule added at the same priority as the seeded default provider will lose.
---

Equal-priority routing rules do not alternate or favor the newest — ties resolve to the lowest `id` (insertion order), so a newly added rule sharing an existing default's priority (commonly `1`, e.g. a seeded primary-gateway rule) will silently never win even if it's marked as the same priority.

**Why:** discovered while testing that an admin-added routing rule at the same priority as an existing seeded rule was silently ignored in provider selection, despite being enabled and valid.

**How to apply:** when adding or testing a rule meant to take precedence over an existing one, use a strictly lower priority number than the incumbent — don't assume equal priorities are broken by recency.
