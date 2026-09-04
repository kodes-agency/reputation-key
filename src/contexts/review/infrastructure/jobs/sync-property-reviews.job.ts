import type { Job } from 'bullmq'
import {
  GBP_PUSH_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
  type ReviewProviderJobData,
  type SyncPropertyReviewsJobData,
  type TargetedGoogleReviewFetchJobData,
} from '../../application/ports/review-queue.port'
import type { PropertyRoutingPort } from '../../application/ports/property-routing.port'
import type { ReviewSyncActivityRecorder } from '../../application/ports/review-sync-activity.port'
import type { ReviewDiscoveryRepository } from '../../application/ports/review-discovery.repository'
import type {
  ContinuableSnapshotResult,
  RunReviewProviderSnapshot,
} from '../../application/use-cases/run-review-provider-snapshot'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { RunTargetedGoogleReviewFetch } from '../../application/use-cases/run-targeted-google-review-fetch'

export const JOB_NAME = 'sync-property-reviews' as const

type SyncHandlerDeps = Readonly<{
  runSnapshot: RunReviewProviderSnapshot
  runTargetedFetch?: RunTargetedGoogleReviewFetch
  propertyRouting: PropertyRoutingPort
  enqueueContinuation(
    data: SyncPropertyReviewsJobData,
    options?: Readonly<{ delayMs?: number; jobId?: string }>,
  ): Promise<void>
  /**
   * Discovery-ladder liveness stamps. A GBP push proves Google is publishing
   * for this location, so a push-initiated sync resets the property to the
   * hot rung of the backoff ladder (domain/discovery-backoff.ts).
   */
  syncActivity: ReviewSyncActivityRecorder
  discoveryRepo: Pick<
    ReviewDiscoveryRepository,
    'markDiscoveryDeferred' | 'markSyncSucceeded'
  >
  clock: () => Date
  /** Hot-rung interval — the push reset's next-poll clamp. */
  hotIntervalMs: number
}>

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u

const isTargetedFetch = (
  data: ReviewProviderJobData,
): data is TargetedGoogleReviewFetchJobData => 'mode' in data && data.mode === 'targeted'

/**
 * Enqueues the next bounded step, delayed only when the provider asked for a
 * pause. A `checkpointed` result carrying `retryAfterMs` did NOT advance the
 * cursor, so its continuation repeats the same provider call: undelayed, that
 * retries a rate-limited provider at queue speed. `deleting` makes real
 * progress and stays immediate.
 */
async function enqueueNextStep(
  deps: SyncHandlerDeps,
  continuation: SyncPropertyReviewsJobData,
  result: ContinuableSnapshotResult,
): Promise<void> {
  const delayMs = result.status === 'checkpointed' ? result.retryAfterMs : undefined
  if (delayMs === undefined) await deps.enqueueContinuation(continuation)
  else await deps.enqueueContinuation(continuation, { delayMs })
}

const REFERENCE_REF = /^[a-z][a-z0-9_-]{0,31}\.[A-Za-z0-9_-]{43}$/u

type ProviderStepScope = Readonly<{
  organization: ReturnType<typeof organizationId>
  property: ReturnType<typeof propertyId>
  connection: ReturnType<typeof googleConnectionId>
  sourceEpoch: number
}>

/** Payload identity fence. `snapshotRunId` is the continuation cursor of a
 * snapshot run and is absent for a targeted fetch. */
function assertProviderJobIdentity(
  data: ReviewProviderJobData,
  snapshotRunId: string | null | undefined,
): void {
  if (
    !SAFE_SCOPE_ID.test(data.organizationId) ||
    !CANONICAL_UUID.test(data.propertyId) ||
    !CANONICAL_UUID.test(data.connectionId) ||
    (snapshotRunId != null && !CANONICAL_UUID.test(snapshotRunId))
  ) {
    throw new TypeError('Invalid Review provider snapshot job identity')
  }
}

/** The step may only run against the source epoch the job was enqueued for, and
 * only while that epoch is still the property's current processing scope. */
async function resolveStepSourceEpoch(
  deps: SyncHandlerDeps,
  data: ReviewProviderJobData,
  organization: ReturnType<typeof organizationId>,
  property: ReturnType<typeof propertyId>,
): Promise<number> {
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
  return sourceEpoch
}

/** One GBP-push-delivered targeted read. A `reconcile` outcome hands the
 * property to a delivery-scoped full snapshot continuation. */
async function runTargetedFetchStep(
  deps: SyncHandlerDeps,
  data: TargetedGoogleReviewFetchJobData,
  scope: ProviderStepScope,
) {
  if (
    !CANONICAL_UUID.test(data.deliveryId) ||
    (data.referenceRef !== null && !REFERENCE_REF.test(data.referenceRef)) ||
    !deps.runTargetedFetch
  ) {
    throw new TypeError('Invalid targeted Review provider job identity')
  }
  const now = deps.clock()
  await deps.syncActivity.recordPushObserved(
    data.propertyId,
    now,
    new Date(now.getTime() + deps.hotIntervalMs),
  )
  const result = await deps.runTargetedFetch({
    organizationId: scope.organization,
    propertyId: scope.property,
    connectionId: scope.connection,
    sourceEpoch: scope.sourceEpoch,
    referenceRef: data.referenceRef,
    deliveryId: data.deliveryId,
  })
  if (result.status === 'reconcile') {
    await deps.enqueueContinuation(
      {
        propertyId: data.propertyId,
        organizationId: data.organizationId,
        connectionId: data.connectionId,
        locationName: result.locationName,
        sourceEpoch: scope.sourceEpoch,
        initiator: data.initiator,
        correlationId: data.correlationId,
      },
      { jobId: `gbp-push-reconcile-${data.deliveryId}` },
    )
  }
  return result
}

/** One bounded page, confirmation, or deletion batch of a provider snapshot
 * run, plus the continuation that carries the run forward. */
async function runSnapshotStep(
  deps: SyncHandlerDeps,
  data: SyncPropertyReviewsJobData,
  scope: ProviderStepScope,
) {
  // A push-initiated sync is proof the location is live: stamp it so the
  // discovery ladder puts this property back on the hot rung and un-parks
  // its next poll. Only on the FIRST step of a run — continuations carry
  // the same initiator and would re-stamp the same fact once per page.
  if (data.runId == null && data.initiator?.id === GBP_PUSH_SYNC_INITIATOR_ID) {
    const now = deps.clock()
    await deps.syncActivity.recordPushObserved(
      data.propertyId,
      now,
      new Date(now.getTime() + deps.hotIntervalMs),
    )
  }

  const result = await deps.runSnapshot({
    organizationId: scope.organization,
    propertyId: scope.property,
    connectionId: scope.connection,
    sourceEpoch: scope.sourceEpoch,
    observationOrigin:
      data.initiator?.id === GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID
        ? 'historical_onboarding'
        : 'ongoing',
    locationName: data.locationName,
    ...(data.runId == null ? {} : { runId: data.runId }),
  })
  if (result.status === 'checkpointed' || result.status === 'deleting') {
    await enqueueNextStep(
      deps,
      { ...data, sourceEpoch: scope.sourceEpoch, runId: result.runId },
      result,
    )
  }
  if (result.status === 'failed') {
    const now = deps.clock()
    const retryAt = new Date(now.getTime() + deps.hotIntervalMs)
    await deps.discoveryRepo.markDiscoveryDeferred(
      data.propertyId,
      now,
      retryAt,
      result.code,
    )
    throw Object.assign(new Error(result.code), {
      name: 'ReviewProviderSnapshotFailure',
    })
  }
  if (result.status === 'completed') {
    await deps.discoveryRepo.markSyncSucceeded(data.propertyId)
  }
  return result
}

/**
 * Executes exactly one bounded provider-snapshot step. Each successful page,
 * targeted confirmation, or deletion batch checkpoints before a continuation
 * is enqueued; provider tokens never enter the BullMQ payload.
 */
export const createSyncPropertyReviewsHandler =
  (deps: SyncHandlerDeps) => async (job: Job<ReviewProviderJobData>) =>
    trace('job.syncPropertyReviews', async () => {
      const data = job.data
      const targeted = isTargetedFetch(data)
      assertProviderJobIdentity(data, targeted ? undefined : data.runId)
      const organization = organizationId(data.organizationId)
      const property = propertyId(data.propertyId)
      const scope: ProviderStepScope = {
        organization,
        property,
        connection: googleConnectionId(data.connectionId),
        sourceEpoch: await resolveStepSourceEpoch(deps, data, organization, property),
      }
      return targeted
        ? runTargetedFetchStep(deps, data, scope)
        : runSnapshotStep(deps, data, scope)
    })
