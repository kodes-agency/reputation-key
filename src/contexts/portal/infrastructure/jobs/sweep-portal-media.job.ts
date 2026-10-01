import type { Job } from 'bullmq'
import type { SweepPortalMedia } from '../../application/use-cases/sweep-portal-media'
import type { LoggerPort } from '#/shared/domain/logger.port'

export const JOB_NAME = 'portal-media-sweep' as const

/**
 * Runs one bounded sweep of Portal media (see the use case). The job carries no
 * payload authority: it takes nothing from `job.data`, so a queued message cannot
 * name an asset or a tenant to delete.
 */
export const createSweepPortalMediaHandler =
  (
    deps: Readonly<{
      sweep: SweepPortalMedia
      logger: Pick<LoggerPort, 'info'>
    }>,
  ) =>
  async (_job: Job): Promise<void> => {
    const outcome = await deps.sweep()
    // Aggregate counts only. No tenant, Property, asset id or object key.
    deps.logger.info({ job: JOB_NAME, ...outcome }, 'Portal media sweep completed')
  }
