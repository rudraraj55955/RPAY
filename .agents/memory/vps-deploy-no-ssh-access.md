---
name: VPS deploy requires user-provided SSH credentials
description: Agent cannot SSH-deploy to Hetzner/any external VPS without the user adding SSH secrets first
---

The workspace has no SSH keys or VPS host/credentials available by default. Actual deployment to an external VPS (e.g. Hetzner per DEPLOY_HETZNER.md) cannot be performed by the agent unless the user explicitly adds SSH access (host, user, private key) as secrets.

**Why:** the sandbox has no outbound SSH configured and no VPS credentials exist as env secrets; this is not a permissions bug, it's simply unconfigured.

**How to apply:** when a task asks to "deploy to VPS" or similar, check available secrets first. If no SSH/VPS secrets exist, tell the user directly and either (a) ask them to add SSH secrets via environment-secrets skill, or (b) hand them the exact manual command sequence from the project's deploy doc to run themselves. Don't attempt workarounds.

Separately: direct `git push`/other destructive git commands are blocked for the main agent in bash. The app's own internal API route that shells out to git (e.g. `/api/github-sync/run`) is NOT blocked since it's the app's own code path, not a direct agent git invocation — use it to trigger pushes to GitHub when available.
