import type { Job } from 'bullmq'
import {
  GBP_PUSH_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
  type GoogleReviewPushNotificationKind,
  type ReviewHeadCheckJobData,
  type ReviewProviderJobData,
  type SyncPropertyReviewsJobData,
  type TargetedGoogleReviewFetchJobData,
} from '../../application/ports/review-queue.port'
import type { PropertySourceEpochPort } from '../../application/ports/property-source-epoch.port'
import { historyImportFailureReason } from '../../application/historical-import-outcome'
import { isParkedSnapshotFailure } from '../../application/parked-snapshot-failure'
import { GOOGLE_CONNECTION_UNUSABLE_CODE } from '../../application/ports/google-review-api.port'
import type { ReviewSyncActivityRecorder } from '../../application/ports/review-sync-activity.port'
import type { ReviewDiscoveryRepository } from '../../application/ports/review-discovery.repository'
import type { ReviewProviderSnapshotFailureCode } from '../../application/ports/review-provider-snapshot.repository'
import type {
  ContinuableSnapshotResult,
  RunReviewProviderSnapshot,
} from '../../application/use-cases/run-review-provider-snapshot'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { RunTargetedGoogleReviewFetch } from '../../application/use-cases/run-targeted-google-review-fetch'
import type {
  RunReviewHeadCheck,
  RunReviewHeadCheckResult,
} from '../../application/use-cases/run-review-head-check'
import type { ReviewHeadChecksMode } from '../../domain/head-check'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import {
  recordsFailureOfRun,
  snapshotFailureRetryMs,
  type PreviousSnapshotFailure,
} from '../../domain/snapshot-failure-backoff'
import { ReviewProviderSnapshotFailure } from './review-provider-snapshot-failure'

export const JOB_NAME = 'sync-property-reviews' as const

/** The queue the job runs on (the governed job catalogue's row for it). */
const JOB_QUEUE = 'default' as const

type SyncHandlerDeps = Readonly<{
  runSnapshot: RunReviewProviderSnapshot
  runTargetedFetch?: RunTargetedGoogleReviewFetch
  /** The head mode's use case. A process without it ends head jobs as `disabled`. */
  runHeadCheck?: RunReviewHeadCheck
  /** `off` (or absent) ends a queued head job without reading Google. */
  headChecks?: ReviewHeadChecksMode
  /** Receives closed event codes only, never a payload field or an error text. */
  logger?: Pick<LoggerPort, 'warn'>
  propertySourceEpoch: PropertySourceEpochPort
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
    'markDiscoveryDeferred' | 'findFailureState' | 'markSyncSucceeded'
  >
  clock: () => Date
  /**
   * Hot-rung interval: the push reset's next-poll clamp, and the wait after a
   * first snapshot failure (it grows with consecutive failures, see
   * domain/snapshot-failure-backoff.ts).
   */
  hotIntervalMs: number
}>

const PUSH_NOTIFICATION_KINDS: ReadonlySet<string> = new Set([
  'NEW_REVIEW',
  'UPDATED_REVIEW',
  'REVIEW_CHANGED',
])

/**
 * What a targeted job says about its push: when Pub/Sub accepted it and what
 * Google reported. A job queued before push health was measured carries
 * neither; it is judged by the time it starts and as the combined kind.
 * Returns null for a value that is not what the consumer writes.
 */
function pushArrivalOf(
  data: TargetedGoogleReviewFetchJobData,
  startedAt: Date,
): Readonly<{
  acceptedAt: Date
  notificationKind: GoogleReviewPushNotificationKind
}> | null {
  const acceptedAt = data.acceptedAt === undefined ? startedAt : new Date(data.acceptedAt)
  const notificationKind = data.notificationKind ?? 'REVIEW_CHANGED'
  if (
    Number.isNaN(acceptedAt.getTime()) ||
    !PUSH_NOTIFICATION_KINDS.has(notificationKind)
  ) {
    return null
  }
  return { acceptedAt, notificationKind }
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u

const isTargetedFetch = (
  data: ReviewProviderJobData,
): data is TargetedGoogleReviewFetchJobData => 'mode' in data && data.mode === 'targeted'

const isHeadCheck = (data: ReviewProviderJobData): data is ReviewHeadCheckJobData =>
  'mode' in data && data.mode === 'head'

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

/**
 * What a step returns when the Property's Google connection cannot be used (it
 * waits for a reconnect, was disconnected, or lost the Business Profile scope).
 */
const SKIPPED_CONNECTION_UNUSABLE = Object.freeze({
  status: 'skipped',
  code: GOOGLE_CONNECTION_UNUSABLE_CODE,
} as const)

/**
 * Ends a step quietly because Google cannot be read until someone reconnects.
 * The reconnect notice is the signal, so the step is not a failure: it returns
 * instead of throwing (BullMQ spends no retry, nothing is dead-lettered, Sentry
 * sees nothing, the family's repair state is not latched) and writes one
 * warning of closed codes. The log schema (BQC-7.3) bans tenant identifiers, so
 * the line names no Property or connection; the notice and the connection row
 * say which. It records nothing about the Property's discovery state either:
 * no failure, no retry date, so the first poll after a reconnect starts a fresh
 * run on its own schedule. Only the unusable connection is quiet; a refusal of
 * a connection that IS usable (`authorization_denied`) still fails loudly.
 */
function skipUnusableConnection(deps: SyncHandlerDeps, mode: 'targeted' | 'snapshot') {
  deps.logger?.warn(
    { event: 'review_sync_skipped_connection_unusable', mode },
    'Review sync skipped: the Google connection needs reconnecting',
  )
  return SKIPPED_CONNECTION_UNUSABLE
}

/**
 * What a step returns when the run it was asked to continue had already failed
 * and this step is not the one that failed it.
 */
const SKIPPED_RUN_ALREADY_FAILED = Object.freeze({
  status: 'skipped',
  code: 'run_already_failed',
} as const)

/**
 * Ends a step quietly because the run it was asked to continue had already
 * failed. The step that failed it dated the Property's backoff, logged, reported
 * the failure to error monitoring and threw; this one is that step's BullMQ
 * retry or a redrive of its dead letter, and re-reading a failed run can only
 * fail again. So it returns instead of
 * throwing: no retry is spent, nothing is dead-lettered, Sentry sees nothing for
 * it, the family's repair state is not latched, and the failing step's
 * `error_class` and retry date stand. On the beta on 2026-10-24 a VACUUM FULL
 * lock failed one run and every retry of its step failed the job again, pushing
 * the backoff out, until a dead letter no redrive could clear. One warning of
 * closed codes; the log schema (BQC-7.3) bans identifiers.
 *
 * One exception, for a failure nobody recorded. The store fails the run first
 * and the failing step dates the Property's failure second; a worker that died
 * between the two (a cursor-store fault while discarding the cursors, a restart)
 * leaves a failed run the Property knows nothing about, and this replay is the
 * only step left to record it. It does so once, with the same backoff the
 * failing step would have dated, and still ends quietly
 * (`recordsFailureOfRun` tells the two cases apart).
 */
async function skipFailedRunReplay(
  deps: SyncHandlerDeps,
  data: SyncPropertyReviewsJobData,
  code: ReviewProviderSnapshotFailureCode,
  runFailedAt: Date | null,
) {
  const previous = await deps.discoveryRepo.findFailureState(data.propertyId)
  if (!recordsFailureOfRun(previous, runFailedAt)) {
    await recordSnapshotFailure(deps, data, code, previous)
  }
  deps.logger?.warn(
    { event: 'review_sync_skipped_run_already_failed', failureCode: code },
    'Review sync skipped: the run had already failed',
  )
  return SKIPPED_RUN_ALREADY_FAILED
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

/** The step may run only while its source epoch is still current. */
async function resolveStepSourceEpoch(
  deps: SyncHandlerDeps,
  data: ReviewProviderJobData,
  organization: ReturnType<typeof organizationId>,
  property: ReturnType<typeof propertyId>,
): Promise<number> {
  const currentScope = await deps.propertySourceEpoch.getSourceEpoch(
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
  const now = deps.clock()
  const arrival = pushArrivalOf(data, now)
  if (
    !CANONICAL_UUID.test(data.deliveryId) ||
    (data.referenceRef !== null && !REFERENCE_REF.test(data.referenceRef)) ||
    arrival === null ||
    !deps.runTargetedFetch
  ) {
    throw new TypeError('Invalid targeted Review provider job identity')
  }
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
    ...arrival,
  })
  if (result.status === 'skipped') return skipUnusableConnection(deps, 'targeted')
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

type HeadStepResult =
  | RunReviewHeadCheckResult
  | Readonly<{ status: 'disabled' | 'obsolete' | 'invalid' | 'error' }>

/**
 * One head check, dark or persisting (`deps.headChecks`). It NEVER throws: the throwing paths of the other modes
 * (an epoch that moved, a bad payload, a provider error) would fail the job,
 * spend its retries and latch the family's repair state for a look that
 * changes nothing. Each ends as a returned outcome instead, and the head never
 * sets or clears the Property's sync failure (`markDiscoveryDeferred`,
 * `markSyncSucceeded`): the full retry owns that.
 */
async function runHeadCheckStep(
  deps: SyncHandlerDeps,
  data: ReviewHeadCheckJobData,
): Promise<HeadStepResult> {
  const mode = deps.headChecks
  if ((mode !== 'dark' && mode !== 'persist') || !deps.runHeadCheck) {
    return { status: 'disabled' }
  }
  try {
    assertProviderJobIdentity(data, undefined)
  } catch {
    return { status: 'invalid' }
  }
  try {
    const organization = organizationId(data.organizationId)
    const property = propertyId(data.propertyId)
    const current = await deps.propertySourceEpoch.getSourceEpoch(organization, property)
    if (current == null) return { status: 'obsolete' }
    if (data.sourceEpoch !== undefined && data.sourceEpoch !== current.sourceEpoch) {
      return { status: 'obsolete' }
    }
    return await deps.runHeadCheck({
      organizationId: organization,
      propertyId: property,
      connectionId: googleConnectionId(data.connectionId),
      sourceEpoch: current.sourceEpoch,
      locationName: data.locationName,
      mode,
    })
  } catch {
    deps.logger?.warn(
      { event: 'review_head_check_job_failed' },
      'Review head check job ended without a result',
    )
    return { status: 'error' }
  }
}

/**
 * Failures that lose a run rather than break it, so the sync starts a fresh
 * run at once instead of failing:
 *
 * - `cursor_lost`: a deploy that restarts the cursor store drops the cursors
 *   of every run in flight (ADR 0050 keeps nothing across a restart). The use
 *   case answers `cursor_failure` instead when no restart explains the loss.
 * - `listing_changed`: Google's listing moved while the run was reading it,
 *   most likely a guest posting mid-run (a different set between the two
 *   scans, a different total or average from one page to the next, a review on
 *   two pages), so the run removed nothing. The store records the specific
 *   code (`confirmation_set_changed`, `total_changed`, `average_changed`,
 *   `duplicate_resource`) instead once the Property's runs keep moving
 *   (application/snapshot-listing-change.ts).
 */
const RESTARTED_AT_ONCE: ReadonlySet<ReviewProviderSnapshotFailureCode> = new Set([
  'cursor_lost',
  'listing_changed',
])

/**
 * The first step of a fresh run for the same Property, source epoch and
 * initiator: no `runId`, so the use case starts a run from page 0 or joins
 * the one already active, and an interrupted first import stays an import.
 */
function freshRunStep(
  data: SyncPropertyReviewsJobData,
  sourceEpoch: number,
): SyncPropertyReviewsJobData {
  const { runId: _lostRunId, ...rest } = data
  return { ...rest, sourceEpoch }
}

/**
 * Dates the failure of a snapshot run on the Property's discovery state, with a
 * backoff, and logs it. Returns whether the failure parks the Property
 * (`isParkedSnapshotFailure`): a parked failure is recorded and the job ends
 * normally instead of failing.
 */
async function recordSnapshotFailure(
  deps: SyncHandlerDeps,
  data: SyncPropertyReviewsJobData,
  code: ReviewProviderSnapshotFailureCode,
  previous: PreviousSnapshotFailure | null,
): Promise<boolean> {
  const now = deps.clock()
  // Two failures fail identically on every run until something outside RepKey
  // changes, so they are parked, not retried: the failure is recorded
  // (`error_class`) and the job ends, instead of three attempts, a quarantine
  // entry and a repair latch every discovery interval.
  // - A location over the review or page cap waits a day; the first-import
  //   notice tells the owner ("location_too_large").
  // - A location Google rejects (`provider_rejected`: 400 or 404 on the read,
  //   while the connection and its other locations are healthy) waits on the
  //   ordinary ladder below, so a location the owner fixes in Google Business
  //   Profile is read again within hours. The use case logged Google's status.
  // `sync.failed-nonzero` keeps firing from the recorded `error_class` while
  // either persists.
  const tooLarge = historyImportFailureReason(code) === 'location_too_large'
  // Any other failure waits longer each time it repeats, so a failure that
  // recurs does not spend a full double listing every 15 minutes.
  const retryAfterMs = snapshotFailureRetryMs({
    previous,
    now,
    baseIntervalMs: deps.hotIntervalMs,
    locationTooLarge: tooLarge,
  })
  await deps.discoveryRepo.markDiscoveryDeferred(
    data.propertyId,
    now,
    new Date(now.getTime() + retryAfterMs),
    code,
  )
  deps.logger?.warn(
    {
      event: 'review_snapshot_failure_deferred',
      failureCode: code,
      retryAfterMs,
    },
    'Review snapshot failed; the next retry is backed off',
  )
  return isParkedSnapshotFailure(code)
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
    firstSeenVia:
      data.initiator?.id === GBP_PUSH_SYNC_INITIATOR_ID ? 'push_reconcile' : 'snapshot',
    locationName: data.locationName,
    ...(data.runId == null ? {} : { runId: data.runId }),
  })
  // A run caught mid-way by a connection that stopped being usable: the use
  // case already ended it and discarded its cursors. Nothing continues and no
  // failure is recorded.
  if (result.status === 'failed' && result.code === GOOGLE_CONNECTION_UNUSABLE_CODE) {
    return skipUnusableConnection(deps, 'snapshot')
  }
  if (result.status === 'checkpointed' || result.status === 'deleting') {
    await enqueueNextStep(
      deps,
      { ...data, sourceEpoch: scope.sourceEpoch, runId: result.runId },
      result,
    )
  }
  // A run lost, not broken: start again now, with no coded failure, retry or
  // dead letter (RESTARTED_AT_ONCE).
  if (result.status === 'failed' && RESTARTED_AT_ONCE.has(result.code)) {
    await deps.enqueueContinuation(freshRunStep(data, scope.sourceEpoch))
    return result
  }
  // This step found its run already failed: the step that failed it was loud
  // and recorded the backoff (or, if it died first, this one records it), so
  // this one ends without failing again.
  if (result.status === 'failed' && result.alreadyFailed) {
    return skipFailedRunReplay(deps, data, result.code, result.alreadyFailed.failedAt)
  }
  if (result.status === 'failed') {
    const previous = await deps.discoveryRepo.findFailureState(data.propertyId)
    // A parked failure (a location over the cap, or one Google rejects) is
    // recorded and the job ends normally, whichever step it is: nothing is
    // thrown, retried, dead-lettered, reported or latched.
    if (await recordSnapshotFailure(deps, data, result.code, previous)) return result
    // The step that failed the run fails the job with the ordinary
    // `ReviewProviderSnapshotFailure`, built and thrown here, in
    // `runSnapshotStep`: error monitoring groups by stack, and the existing
    // issue is grouped under this function.
    const failure = new ReviewProviderSnapshotFailure(result.code)
    // A step that continues a run (it carries a `runId`) also reports the
    // failure itself, once, before it throws. The store ended the run before
    // this threw, so BullMQ's retry of the step can only find the run failed
    // and ends quietly (`skipFailedRunReplay`); the job then completes, and the
    // worker, which reports a failure only when it is terminal, would never see
    // it. The report carries the very error that is thrown, so it groups into
    // the existing issue with its `failure_code` tag. The first step of a run
    // has no run id: its retry starts a new run, which can succeed, so it keeps
    // its attempts and the worker reports the failure when they are spent;
    // reporting it here as well would count it twice.
    if (data.runId != null) {
      captureObservabilityException(failure, {
        source: 'bullmq-job',
        queue: JOB_QUEUE,
        jobName: JOB_NAME,
      })
    }
    throw failure
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
      if (isHeadCheck(data)) return runHeadCheckStep(deps, data)
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
