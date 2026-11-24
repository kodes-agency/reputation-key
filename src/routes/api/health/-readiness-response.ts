import { isContainerReady } from '#/composition/container-readiness.server'
import { areRedisDependenciesHealthy } from '#/shared/health/redis-dependencies'
import { isDbHealthy } from '#/shared/health/db-probe'
import { probeHttpStatus } from '#/shared/health/probes'
import {
  isMigrationJournalMatched,
  isKeyConfigurationReady,
  isPolicyConfigurationReady,
  runReadiness,
} from '#/shared/health/readiness'

/** The readiness verdict as served by both `/api/health` and `/api/health/ready`. */
export async function readinessResponse() {
  const result = await runReadiness({
    container: isContainerReady,
    keys: isKeyConfigurationReady,
    db: isDbHealthy,
    redis: areRedisDependenciesHealthy,
    migrations: isMigrationJournalMatched,
    policy: isPolicyConfigurationReady,
  })
  return new Response(JSON.stringify(result), {
    status: probeHttpStatus(result.status),
    headers: { 'Content-Type': 'application/json' },
  })
}
