// Nitro plugin: isolated restore mode — web boot assertion + loud log
// (BQC-7.8).
//
// The restore drill boots the WEB process against the restored database with
// RESTORE_MODE=isolated: every capability evaluation denies fail-closed at
// the beta-capabilities seam (src/shared/auth/beta-capabilities.ts getStore()
// — per-request, so the posture holds in dev too; no plugin needed for the
// enforcement itself). This plugin is the production-build boot hook: it runs
// the compatibility assertion and logs the loud line so a restored
// environment is unmistakable in the deploy logs. The worker process REFUSES
// to boot in this mode (src/worker/index.ts). Registered in the explicit
// vite.config.ts plugins array (serverDir scanning stays off under TanStack
// Start — the array is the ONLY registration path). Logic + tests:
// src/shared/config/restore-mode.ts.

import { definePlugin } from 'nitro'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import {
  assertRestoreModeCompatible,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
} from '#/shared/config/restore-mode'

export default definePlugin(() => {
  const env = getEnv()
  assertRestoreModeCompatible(env, 'web')
  if (isRestoreIsolated(env)) {
    getLogger().warn(
      `${RESTORE_ISOLATED_LOG_LINE} — every capability denies fail-closed; ` +
        'restore drill only (unset RESTORE_MODE to cut over)',
    )
  }
})
