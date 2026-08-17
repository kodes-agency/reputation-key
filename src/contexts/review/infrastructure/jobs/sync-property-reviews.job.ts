import type { Job } from 'bullmq'
import type { SyncPropertyReviewsJobData } from '../../application/ports/review-queue.port'
import type { PropertyRoutingPort } from '../../application/ports/property-routing.port'
import type { RunReviewProviderSnapshot } from '../../application/use-cases/run-review-provider-snapshot'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'sync-property-reviews' as const

type SyncHandlerDeps = Readonly<{
  runSnapshot: RunReviewProviderSnapshot
  propertyRouting: PropertyRoutingPort
  enqueueContinuation(data: SyncPropertyReviewsJobData): Promise<void>
}>

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u

/**
 * Executes exactly one bounded provider-snapshot step. Each successful page,
 * targeted confirmation, or deletion batch checkpoints before a continuation
 * is enqueued; provider tokens never enter the BullMQ payload.
 */
export const createSyncPropertyReviewsHandler =
  (deps: SyncHandlerDeps) => async (job: Job<SyncPropertyReviewsJobData>) =>
    trace('job.syncPropertyReviews', async () => {
      const data = job.data
      if (
        !SAFE_SCOPE_ID.test(data.organizationId) ||
        !CANONICAL_UUID.test(data.propertyId) ||
        !CANONICAL_UUID.test(data.connectionId) ||
        (data.runId != null && !CANONICAL_UUID.test(data.runId))
      ) {
        throw new TypeError('Invalid Review provider snapshot job identity')
      }
      const organization = organizationId(data.organizationId)
      const property = propertyId(data.propertyId)
      const connection = googleConnectionId(data.connectionId)
      const currentScope = await deps.propertyRouting.getProcessingScope(
        organization,
        property,
      )
      if (currentScope == null) throw new Error('Review provider source unavailable')
      const sourceEpoch = data.sourceEpoch ?? currentScope.sourceEpoch
      if (
        !Number.isSafeInteger(sourceEpoch) ||
        sourceEpoch < 0 ||
        currentScope.sourceEpoch !== sourceEpoch
      ) {
        throw new Error('Review provider source changed')
      }

      const result = await deps.runSnapshot({
        organizationId: organization,
        propertyId: property,
        connectionId: connection,
        sourceEpoch,
        locationName: data.locationName,
        ...(data.runId == null ? {} : { runId: data.runId }),
      })
      if (result.status === 'checkpointed' || result.status === 'deleting') {
        await deps.enqueueContinuation({
          ...data,
          sourceEpoch,
          runId: result.runId,
        })
      }
      if (result.status === 'failed') throw new Error(result.code)
      return result
    })
