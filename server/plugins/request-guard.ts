// Nitro plugin: request guard (BQC-7.6) — body-size limit + x-request-id.
//
// Thin wiring shim, registered explicitly in the vite.config.ts nitro
// `plugins` array (serverDir scanning stays off under TanStack Start — the
// array is the ONLY registration path). All logic lives in
// src/shared/security/request-guard.ts (unit-tested there); the wiring is
// pinned by src/shared/architecture/security-headers-wiring.test.ts and
// proven against the booted production artifact by
// scripts/check-security-headers.mjs.

import { definePlugin } from 'nitro'
import { getEnv } from '#/shared/config/env'
import { createRequestGuardPlugin } from '#/shared/security/request-guard'

// ARC-03-T14: configuration is read inside the plugin body, not at module load.
// A module-scope read binds the guard's limits to import order, which is why a
// process fixture could not boot this plugin with a deterministic environment.
export default definePlugin((nitroApp) => {
  const env = getEnv()
  return createRequestGuardPlugin({ bodyLimitBytes: env.REQUEST_BODY_LIMIT_BYTES })(
    nitroApp,
  )
})
