// Sentry error reporting setup — minimal stub for Phase 4.
// Full integration deferred to Phase 22 (Production Hardening).
// For now: reads config, no-op init if no DSN.

import { getEnv } from '#/shared/config/env'

export function initSentry(): void {
  const env = getEnv()

  if (!env.SENTRY_DSN) {
    // No DSN configured — Sentry is disabled
    return
  }

  // Full Sentry initialization will be added in Phase 22.
  // For now, we just validate the config is available.
  // When ready: import * as Sentry from '@sentry/node' and call Sentry.init()
}
