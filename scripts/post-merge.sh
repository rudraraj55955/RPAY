#!/bin/bash
set -e
# PNPM_NO_UPDATE_NOTIFIER suppresses the version-check banner that can slow
# the install by several seconds when the registry is sluggish.
PNPM_NO_UPDATE_NOTIFIER=1 pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run db-migrate
pnpm --filter @workspace/api-server run seed
pnpm --filter @workspace/scripts run github-sync
