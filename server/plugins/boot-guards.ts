// Nitro plugin: the web process's boot guards, run in order before traffic.
// Registered in the explicit vite.config.ts plugins array (serverDir scanning
// stays off under TanStack Start — the array is the ONLY registration path).
// The worker runs the same assertions in src/worker/index.ts.
//
//   - release identity: refuse a declared candidate that differs from the
//     revision baked into the image.
//   - restore mode (BQC-7.8): the restore-isolated boot assertion plus the loud
//     log line so a restored environment is unmistakable. Capability fail-closed
//     enforcement itself lives at the beta-capabilities seam (per-request).
//     Logic + tests: src/shared/config/restore-mode.ts.
//   - Redis runtime (DATA-18): the web process enqueues post-commit jobs, so
//     validating only the worker would let a misconfigured release accept
//     traffic while every producer call fails.

import { definePlugin } from 'nitro'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { getDb } from '#/shared/db'
import { assertReleaseIdentity } from '#/shared/config/release-identity'
import { assertRecoveryCutoverAttestation } from '#/shared/config/recovery-cutover-attestation'
import { createRecoveryCutoverRunReader } from '#/shared/db/recovery/recovery-cutover-run-reader'
import {
  assertRestoreModeCompatible,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
} from '#/shared/config/restore-mode'
import { assertConfiguredJobRedisRuntime } from '#/shared/jobs/redis-runtime'
import {
  assertProductionRedisTopology,
  getJobRedisUrl,
} from '#/shared/jobs/redis-topology'

export default definePlugin(async () => {
  const env = getEnv()
  assertReleaseIdentity(env)

  assertRestoreModeCompatible(env, 'web')
  await assertRecoveryCutoverAttestation(createRecoveryCutoverRunReader(getDb()), env)
  if (isRestoreIsolated(env)) {
    getLogger().warn(
      `${RESTORE_ISOLATED_LOG_LINE} — every capability denies fail-closed; ` +
        'restore drill only (pin the verified recovery run/generation before cutover)',
    )
  }

  assertProductionRedisTopology(env)
  const redisUrl = getJobRedisUrl(env)
  if (!redisUrl) return

  const readiness = await assertConfiguredJobRedisRuntime(redisUrl)
  getLogger().info(
    {
      redisVersion: readiness.redisVersion,
      maxmemoryPolicy: readiness.maxmemoryPolicy,
      getdelAvailable: readiness.getdelAvailable,
    },
    'BullMQ Redis runtime verified for web producers',
  )
})
