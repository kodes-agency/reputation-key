// Review context — BullMQ job handler for syncing property reviews
// Per architecture: job handlers live in context/infrastructure/jobs/.

import type { Job } from 'bullmq'

export const JOB_NAME = 'sync-property-reviews' as const
import type { SyncPropertyReviewsJobData } from '../../application/ports/review-queue.port'
import type { syncReviews } from '../../application/use-cases/sync-reviews'
import { propertyId, organizationId, googleConnectionId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { isCapabilityJobEnabled } from '#/shared/auth/beta-capabilities'

type SyncHandlerDeps = Readonly<{
  /** Pre-wired use case from composition (includes BQR-2.3 command store). */
  syncReviews: ReturnType<typeof syncReviews>
}>

export const createSyncPropertyReviewsHandler = (deps: SyncHandlerDeps) => {
  return async (job: Job<SyncPropertyReviewsJobData>) => {
    return trace('job.syncPropertyReviews', async () => {
      const logger = getLogger()

      // BQC-0.4 stop control: already-enqueued work must not call Google after
      // the capability is switched off (jobs are skipped, not deleted).
      if (!isCapabilityJobEnabled('property.connect_gbp')) {
        logger.info(
          { jobId: job.id, propertyId: job.data.propertyId },
          'BQC-0.4: sync skipped — property.connect_gbp is disabled',
        )
        return
      }

      logger.info(
        { jobId: job.id, propertyId: job.data.propertyId },
        'Syncing property reviews',
      )

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      for (const id of [job.data.propertyId, job.data.connectionId]) {
        if (!UUID_RE.test(id)) {
          logger.error({ jobData: job.data }, 'Invalid UUID in job data, skipping')
          return
        }
      }

      try {
        const result = await deps.syncReviews({
          propertyId: propertyId(job.data.propertyId),
          organizationId: organizationId(job.data.organizationId),
          connectionId: googleConnectionId(job.data.connectionId),
          locationName: job.data.locationName,
        })

        if (result.isErr()) {
          const e = result.error
          logger.error(
            { err: e, jobId: job.id, propertyId: job.data.propertyId },
            'Property reviews sync failed',
          )
          throw e // Re-throw so BullMQ retries
        }

        const syncResult = result.value
        if (syncResult.partialFailure) {
          logger.warn(
            {
              jobId: job.id,
              propertyId: job.data.propertyId,
              fetched: syncResult.fetched,
              created: syncResult.created,
              updated: syncResult.updated,
              refreshed: syncResult.refreshed,
              failed: syncResult.failed,
            },
            'Property reviews sync completed with partial failures',
          )
        } else {
          logger.info(
            {
              jobId: job.id,
              propertyId: job.data.propertyId,
              fetched: syncResult.fetched,
              created: syncResult.created,
              updated: syncResult.updated,
              refreshed: syncResult.refreshed,
              repliesMirrored: syncResult.repliesMirrored,
            },
            'Property reviews synced',
          )
        }
      } catch (err) {
        logger.error(
          { err, jobId: job.id, propertyId: job.data.propertyId },
          'Failed to sync property reviews',
        )
        throw err
      }
    })
  }
}
