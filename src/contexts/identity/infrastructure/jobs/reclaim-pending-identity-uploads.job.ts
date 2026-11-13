import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { ReclaimPendingIdentityUploads } from '../../application/reclaim-pending-identity-uploads'

export const JOB_NAME = 'identity-pending-upload-reclaim' as const

/**
 * Runs one bounded pass over avatar and logo uploads that were never saved. It
 * takes nothing from `job.data`, so a queued message cannot name an object to
 * delete. The log carries counts only, no owner or object key.
 */
export const createReclaimPendingIdentityUploadsHandler =
  (
    deps: Readonly<{
      reclaim: ReclaimPendingIdentityUploads
      logger: Pick<LoggerPort, 'info'>
    }>,
  ) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const outcome = await deps.reclaim()
      deps.logger.info(
        { job: JOB_NAME, ...outcome },
        'Pending image upload reclaim completed',
      )
    })
