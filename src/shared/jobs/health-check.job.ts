// Health-check background job — verifies DB and Redis connectivity.
// Per architecture: "Sample health-check background job that runs every 5 minutes."
// Idempotent: running twice produces the same output.

import type { Job } from 'bullmq'
import pino from 'pino'

export const JOB_NAME = 'health-check' as const

// fallow-ignore-next-line unused-type
export type HealthCheckResult = Readonly<{
  db: boolean
  redis: boolean
  timestamp: string
}>

export type HealthCheckDeps = Readonly<{
  dbHealthy: () => Promise<boolean>
  redisHealthy: () => Promise<boolean>
  logger: pino.Logger
}>

export function createHealthCheckHandler(deps: HealthCheckDeps) {
  return async (_job: Job): Promise<HealthCheckResult> => {
    const [db, redis] = await Promise.all([
      deps.dbHealthy().catch((err) => {
        deps.logger.error({ err }, '[health-check] db check failed')
        return false
      }),
      deps.redisHealthy().catch((err) => {
        deps.logger.error({ err }, '[health-check] redis check failed')
        return false
      }),
    ])

    const result: HealthCheckResult = {
      db,
      redis,
      timestamp: new Date().toISOString(),
    }

    deps.logger.info(result, '[health-check] status')
    return result
  }
}
