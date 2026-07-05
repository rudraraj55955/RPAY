---
name: GitHub sync per-run log capture
description: Design rationale for the /github-sync/history/{id}/log endpoint and why "retry a specific run" was implemented as detail-viewing, not literal replay.
---

The GitHub sync script always pushes the current repo HEAD to `main --force`. A given history entry does not correspond to a distinct commit/snapshot you can "replay" — by the time an admin looks at a failed run, the repo state has usually already moved on. So "let admins retry a specific failed run" was implemented as: give each run a stable `id`, capture its full stdout/stderr, and let admins inspect that captured output in a modal (plus the existing single "Sync now" button for actually re-attempting a push).

**Why:** the task's own "Done looks like" section settled on the same interpretation (expanded error detail + optional full-log view) rather than true per-run replay, because per-run replay isn't meaningful for a force-push-based sync.

**How to apply:** if extending this pattern (e.g. another script-backed history log), each run should get a random id at start, and captured output should be redacted for secrets (token) before writing to disk. Old log files must be deleted in lockstep when history entries roll off the `HISTORY_MAX` cap, or `.github-sync-logs/` grows unbounded.
