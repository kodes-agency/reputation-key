// Bootstrap — registers event handlers and background jobs at startup.
// This is separate from composition.ts so that construction and registration
// are easy to understand independently.
//
// Per architecture: "Keeping registration separate from construction
// makes both easier to understand."

import type { Container } from './composition'
import { createHealthCheckHandler, JOB_NAME } from '#/shared/jobs/health-check.job'
import { isDbHealthy } from '#/shared/db'
import { isRedisHealthy } from '#/shared/cache/redis'
import { getLogger } from '#/shared/observability/logger'

export function bootstrap(container: Container): void {
  const logger = getLogger()

  // ── Register background job handlers ─────────────────────────────
  const healthCheckHandler = createHealthCheckHandler({
    dbHealthy: isDbHealthy,
    redisHealthy: isRedisHealthy,
    logger,
  })

  // Handler returns HealthCheckResult (BullMQ stores it as return value);
  // wrap to satisfy the JobHandler<unknown> signature which expects void.
  container.jobRegistry.register(JOB_NAME, async (job) => {
    void (await healthCheckHandler(job))
  })
  logger.info({ job: JOB_NAME }, 'registered health-check job handler')

  // ── Register event handlers here as contexts are added ────────────
  // Example:
  //   container.eventBus.on('portal.created', (event) => { ... })
}
