// Production web boot guard for the producer-side Redis contract. The web
// process enqueues post-commit jobs, so validating only the worker would let a
// misconfigured release accept traffic while every producer call fails.

import { definePlugin } from 'nitro'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { assertConfiguredJobRedisRuntime } from '#/shared/jobs/redis-runtime'
import {
  assertProductionRedisTopology,
  getJobRedisUrl,
} from '#/shared/jobs/redis-topology'

export default definePlugin(async () => {
  const env = getEnv()
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
