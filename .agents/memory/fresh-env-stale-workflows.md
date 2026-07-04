---
name: Fresh-env stale legacy workflows
description: A newly started/restarted environment can surface duplicate .replit workflow definitions that conflict on ports with the artifact-managed workflows.
---

Some RasoKart environment snapshots have leftover legacy `.replit` workflow entries (e.g. plain "API Server", "RasoKart", "Project") alongside the current artifact-managed ones (named like `artifacts/api-server: API Server`, `artifacts/rpay: web`). Both bind the same ports (8080, 3000), so starting the legacy ones causes `EADDRINUSE` and makes the app preview 502.

**Why:** the artifacts system generates its own workflow per `artifact.toml` service; older/manually-added `.replit` workflow blocks with the same run command aren't automatically removed and can survive an environment restart.

**How to apply:** if `restart_workflow` / the app preview fails with `EADDRINUSE` or the "Project" workflow fails to start, run `listWorkflows()` via code_execution. If you see duplicate pairs targeting the same port (one named `artifacts/<dir>: <service>` and one without that prefix), use `removeWorkflow({ name })` to delete the non-`artifacts/...` duplicates, then `restart_workflow` the `artifacts/...`-named ones directly. Do not hand-edit `.replit` workflow blocks — let the artifact tooling own that file.
