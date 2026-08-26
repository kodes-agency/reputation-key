import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import { sha256Hex } from '#/shared/domain/sha256'
import type {
  GoogleReviewApiPort,
  GoogleReviewPage,
} from '../ports/google-review-api.port'
import type { PropertyRoutingPort } from '../ports/property-routing.port'
import type { GoogleReview } from '../../domain/types'
import type {
  ReviewProviderSubjectDeriver,
  ReviewProviderSubjectKeyService,
} from '../provider-subject-keyring'
import {
  REVIEW_PROVIDER_DELETION_BATCH_SIZE,
  REVIEW_PROVIDER_SNAPSHOT_MAX_PAGES,
  REVIEW_PROVIDER_SNAPSHOT_MAX_REVIEWS,
  REVIEW_PROVIDER_SNAPSHOT_PAGE_SIZE,
  type ReviewProviderObservationWriter,
  type ReviewProviderPersistedObservation,
  type ReviewProviderSnapshotFailureCode,
  type ReviewProviderSnapshotRepository,
  type ReviewProviderSnapshotRun,
} from '../ports/review-provider-snapshot.repository'
import type { ReviewSyncActivityRecorder } from '../ports/review-sync-activity.port'

export type RunReviewProviderSnapshotInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  locationName: string
  runId?: string
}>

export type RunReviewProviderSnapshotResult =
  | Readonly<{
      status: 'checkpointed'
      runId: string
      state: 'scanning' | 'confirming'
      /**
       * Set only when the checkpoint was forced by a rate-limited or
       * unavailable provider. The cursor did not move, so the continuation
       * repeats the same call and MUST wait this long first.
       */
      retryAfterMs?: number
    }>
  | Readonly<{ status: 'deleting'; runId: string; applied: number }>
  | Readonly<{ status: 'completed'; runId: string }>
  | Readonly<{
      status: 'failed'
      runId: string
      code: ReviewProviderSnapshotFailureCode
    }>

/**
 * The results that leave a run unfinished, so the caller must enqueue another
 * bounded step. Named here because the sync job branches on exactly this
 * subset, including the `retryAfterMs` backoff hint.
 */
export type ContinuableSnapshotResult = Extract<
  RunReviewProviderSnapshotResult,
  { status: 'checkpointed' | 'deleting' }
>

export type RunReviewProviderSnapshotDeps = Readonly<{
  repository: ReviewProviderSnapshotRepository
  googleReviewApi: GoogleReviewApiPort
  propertyRouting: PropertyRoutingPort
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  /**
   * Durable discovery-activity stamps. A page that persisted a review nobody
   * had seen before is the ONLY evidence that this property is live, and the
   * discovery backoff ladder prices its polling on it.
   */
  syncActivity: ReviewSyncActivityRecorder
  clock: () => Date
}>

const failureCodeForProviderError = (
  error: unknown,
): ReviewProviderSnapshotFailureCode => {
  if (typeof error !== 'object' || error == null || !('code' in error)) {
    return 'provider_failure'
  }
  const code = error.code
  if (code === 'authorization_changed') return 'authorization_changed'
  if (
    code === 'cursor_not_found' ||
    code === 'cursor_expired' ||
    code === 'cursor_binding_mismatch' ||
    code === 'cursor_exhausted' ||
    code === 'cursor_capacity_exceeded'
  ) {
    return 'cursor_failure'
  }
  if (code === 'invalid_request' || code === 'malformed_response') {
    return 'malformed_page'
  }
  return 'provider_failure'
}

/**
 * Rate limiting and provider unavailability are TRANSIENT: the run's cursors
 * are still valid, so the correct move is to checkpoint and let the queue
 * retry the same page. Routing these through failAndDiscard threw away every
 * published cursor and restarted a multi-page scan from zero on a single 429.
 *
 * The cursor does NOT advance on this path, so the continuation repeats the
 * same call. That only terminates if the continuation is DELAYED - see
 * `retryAfterMs` on the checkpointed result, which the sync job turns into the
 * enqueue delay. Without it a rate-limited provider is retried at queue speed.
 */
const isRecoverableProviderError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error != null &&
  'code' in error &&
  (error.code === 'provider_rate_limited' || error.code === 'provider_unavailable')

/** The provider's own backoff hint, when the adapter forwarded one. */
const retryHintMs = (error: unknown): number | undefined =>
  typeof error === 'object' &&
  error != null &&
  'retryAfterMs' in error &&
  typeof error.retryAfterMs === 'number' &&
  Number.isFinite(error.retryAfterMs) &&
  error.retryAfterMs > 0
    ? error.retryAfterMs
    : undefined

const sameScope = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
): Promise<boolean> => {
  const scope = await deps.propertyRouting.getProcessingScope(
    input.organizationId,
    input.propertyId,
  )
  return scope != null && scope.sourceEpoch === input.sourceEpoch
}

const failAndDiscard = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
  runId: string,
  code: ReviewProviderSnapshotFailureCode,
): Promise<RunReviewProviderSnapshotResult> => {
  await deps.googleReviewApi.discardReviewCursors({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    runId,
  })
  const run = await deps.repository.failRun({ runId, code })
  return { status: 'failed', runId: run.id, code: run.failureCode ?? code }
}

const validatePage = (
  run: ReviewProviderSnapshotRun,
  reviews: readonly { reviewName: string }[],
  totalReviewCount: number,
  locationName: string,
): ReviewProviderSnapshotFailureCode | null => {
  if (
    !Number.isSafeInteger(totalReviewCount) ||
    totalReviewCount < 0 ||
    totalReviewCount > REVIEW_PROVIDER_SNAPSHOT_MAX_REVIEWS ||
    reviews.length > REVIEW_PROVIDER_SNAPSHOT_PAGE_SIZE
  ) {
    return totalReviewCount > REVIEW_PROVIDER_SNAPSHOT_MAX_REVIEWS
      ? 'review_cap_exceeded'
      : 'malformed_page'
  }
  const pageIndex =
    run.state === 'scanning' ? run.mainPageIndex : run.confirmationPageIndex
  if (pageIndex < 0 || pageIndex >= REVIEW_PROVIDER_SNAPSHOT_MAX_PAGES) {
    return 'page_cap_exceeded'
  }
  const names = new Set<string>()
  for (const review of reviews) {
    try {
      const resource = parseReviewProviderResource(review.reviewName)
      if (
        `accounts/${resource.accountId}/locations/${resource.locationId}` !== locationName
      ) {
        return 'malformed_page'
      }
    } catch {
      return 'malformed_page'
    }
    if (names.has(review.reviewName)) return 'duplicate_resource'
    names.add(review.reviewName)
  }
  return null
}

const persistPageObservations = async (
  deps: RunReviewProviderSnapshotDeps,
  deriver: ReviewProviderSubjectDeriver,
  input: RunReviewProviderSnapshotInput,
  reviews: readonly GoogleReview[],
  observationScope: string,
): Promise<readonly ReviewProviderPersistedObservation[]> => {
  const observations: ReviewProviderPersistedObservation[] = []
  for (const review of reviews) {
    // Parsing happens before the source writer so malformed provider resources
    // never enter Review persistence.
    parseReviewProviderResource(review.reviewName)
    const subjects = deriver.deriveCandidates({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      resourceName: review.reviewName,
    })
    const persisted = await deps.observationWriter.persist({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      observationKey: sha256Hex(
        `repkey-review-provider-observation-key-v1\0${observationScope}\0${review.reviewName}`,
      ),
      review,
      subjects,
    })
    observations.push({ ...persisted, review, subjects })
  }
  // ONE stamp per page, not per review: a 50-review page is one activity
  // fact. Stamped here rather than after commitPage because the reviews are
  // already durably written at this point — a page that later fails its
  // snapshot bookkeeping is replayed, and on replay every review is already
  // present, so `isNew` would be false and the fact would be lost forever.
  //
  // A failure here propagates: the caller maps it to `observation_failed`,
  // which is loud. Silently dropping the stamp would silently degrade this
  // property's polling instead.
  if (observations.some((observation) => observation.isNew)) {
    await deps.syncActivity.recordNewReviewObserved(input.propertyId, deps.clock())
  }
  return observations
}

const finishPhase = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
  run: ReviewProviderSnapshotRun,
  phase: 'main' | 'confirmation',
): Promise<RunReviewProviderSnapshotResult> => {
  if (phase === 'main') {
    const finished = await deps.repository.finishMainScan({ runId: run.id })
    if (finished.status === 'failed') {
      return failAndDiscard(deps, input, run.id, finished.code)
    }
    return { status: 'checkpointed', runId: run.id, state: 'confirming' }
  }

  await deps.googleReviewApi.discardReviewCursors({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    runId: run.id,
  })
  const finished = await deps.repository.finishConfirmationScan({ runId: run.id })
  if (finished.status === 'failed') {
    return { status: 'failed', runId: run.id, code: finished.code }
  }
  return { status: 'deleting', runId: run.id, applied: 0 }
}

/**
 * Which page this continuation is about to work on. The three values are
 * derived together and consumed together — the provider call, the commit's
 * optimistic-concurrency check and the checkpoint state all need the same
 * phase/index/cursor triple, and pairing a phase with another page's cursor is
 * exactly the `binding_mismatch` failure the null-cursor guard below exists to
 * prevent.
 */
type ScanPosition = Readonly<{
  phase: 'main' | 'confirmation'
  pageIndex: number
  cursorRef: string | null
}>

/**
 * Stop without losing progress: the queue retries this run and resumes from
 * the cursors already published, in the phase it stopped in.
 */
const checkpointInPhase = (
  runId: string,
  phase: ScanPosition['phase'],
  retryAfterMs?: number,
): RunReviewProviderSnapshotResult => ({
  status: 'checkpointed',
  runId,
  state: phase === 'main' ? 'scanning' : 'confirming',
  ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
})

/**
 * Fetch one provider page. Returns the page, or the outcome the run must
 * return instead when the provider call failed.
 *
 * A transient provider error must not discard the scan: the run's cursors are
 * still valid, so checkpoint and let the queue retry this same page (the rule
 * the targeted confirmation path already applies). Non-recoverable codes stay
 * terminal.
 */
const fetchListPage = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
  run: ReviewProviderSnapshotRun,
  position: ScanPosition,
): Promise<
  | Readonly<{ ok: true; page: GoogleReviewPage }>
  | Readonly<{ ok: false; outcome: RunReviewProviderSnapshotResult }>
> => {
  try {
    return {
      ok: true,
      page: await deps.googleReviewApi.listReviewsPage({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        sourceEpoch: input.sourceEpoch,
        locationName: input.locationName,
        runId: run.id,
        phase: position.phase,
        pageIndex: position.pageIndex,
        cursorRef: position.cursorRef,
      }),
    }
  } catch (error) {
    if (isRecoverableProviderError(error)) {
      return {
        ok: false,
        outcome: checkpointInPhase(run.id, position.phase, retryHintMs(error)),
      }
    }
    return {
      ok: false,
      outcome: await failAndDiscard(
        deps,
        input,
        run.id,
        failureCodeForProviderError(error),
      ),
    }
  }
}

/**
 * Commit the page's observations and turn the store's answer into the run's
 * outcome.
 *
 * `stale_page` means another worker already advanced this run, so the
 * checkpoint follows the state the STORE reports rather than the phase this
 * attempt believed it was in — resuming on a stale phase is what publishes a
 * cursor against the wrong page.
 */
const commitPageOutcome = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
  run: ReviewProviderSnapshotRun,
  position: ScanPosition,
  page: GoogleReviewPage,
  observations: readonly ReviewProviderPersistedObservation[],
): Promise<RunReviewProviderSnapshotResult> => {
  const committed = await deps.repository.commitPage({
    runId: run.id,
    phase: position.phase,
    expectedPageIndex: position.pageIndex,
    expectedCursorRef: position.cursorRef,
    totalReviewCount: page.totalReviewCount,
    nextCursorRef: page.nextCursorRef,
    observations,
  })
  if (committed.status === 'failed') {
    return failAndDiscard(deps, input, run.id, committed.code)
  }
  if (committed.status === 'stale_page') {
    return checkpointInPhase(
      run.id,
      committed.run.state === 'scanning' ? 'main' : 'confirmation',
    )
  }
  if (!committed.finalPage) {
    return checkpointInPhase(run.id, position.phase)
  }
  return finishPhase(deps, input, run, position.phase)
}

const runListPage = async (
  deps: RunReviewProviderSnapshotDeps,
  deriver: ReviewProviderSubjectDeriver,
  input: RunReviewProviderSnapshotInput,
  run: ReviewProviderSnapshotRun,
): Promise<RunReviewProviderSnapshotResult> => {
  if (!(await sameScope(deps, input))) {
    return failAndDiscard(deps, input, run.id, 'source_changed')
  }
  const phase = run.state === 'scanning' ? 'main' : 'confirmation'
  const position: ScanPosition = {
    phase,
    pageIndex: phase === 'main' ? run.mainPageIndex : run.confirmationPageIndex,
    cursorRef: phase === 'main' ? run.mainCursorRef : run.confirmationCursorRef,
  }
  // A null cursor anywhere but page 0 means the previous page was the final one
  // and this continuation raced the phase transition. Calling the provider now
  // would fetch WITHOUT a page token — silently re-reading page 1, adding no
  // unique observations — and then try to publish a cursor for a page that does
  // not exist, which the cursor store refuses with `binding_mismatch`. That is
  // exactly how a completed 6-page / 256-review scan in google-closed-beta
  // ended as `cursor_failure` with no watermark written. Finish the phase the
  // final page already reached instead; `finishMainScan` is idempotent and
  // returns `confirming` when another worker got there first.
  if (position.pageIndex > 0 && position.cursorRef == null) {
    return finishPhase(deps, input, run, phase)
  }

  const fetched = await fetchListPage(deps, input, run, position)
  if (!fetched.ok) return fetched.outcome
  const page = fetched.page

  const invalid = validatePage(
    run,
    page.reviews,
    page.totalReviewCount,
    input.locationName,
  )
  if (invalid) return failAndDiscard(deps, input, run.id, invalid)
  if (!(await sameScope(deps, input))) {
    return failAndDiscard(deps, input, run.id, 'source_changed')
  }

  let observations: readonly ReviewProviderPersistedObservation[]
  try {
    observations = await persistPageObservations(
      deps,
      deriver,
      input,
      page.reviews,
      `${run.id}\0${position.phase}\0${position.pageIndex}`,
    )
  } catch {
    return failAndDiscard(deps, input, run.id, 'observation_failed')
  }
  if (!(await sameScope(deps, input))) {
    return failAndDiscard(deps, input, run.id, 'source_changed')
  }

  return commitPageOutcome(deps, input, run, position, page, observations)
}

const confirmTargetedCandidate = async (
  deps: RunReviewProviderSnapshotDeps,
  deriver: ReviewProviderSubjectDeriver,
  input: RunReviewProviderSnapshotInput,
  run: ReviewProviderSnapshotRun,
): Promise<RunReviewProviderSnapshotResult | null> => {
  const candidate = await deps.repository.readNextLinkedCandidate({ runId: run.id })
  if (!candidate) return null
  if (!(await sameScope(deps, input))) {
    return failAndDiscard(deps, input, run.id, 'source_changed')
  }

  let result
  try {
    result = await deps.googleReviewApi.getReview({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      locationName: input.locationName,
      reviewName: candidate.reviewName,
    })
  } catch (error) {
    if (isRecoverableProviderError(error)) {
      return checkpointInPhase(run.id, 'confirmation', retryHintMs(error))
    }
    return failAndDiscard(deps, input, run.id, failureCodeForProviderError(error))
  }
  if (!(await sameScope(deps, input))) {
    return failAndDiscard(deps, input, run.id, 'source_changed')
  }

  if (result.status === 'not_found') {
    const status = await deps.repository.confirmLinkedCandidateMissing({
      runId: run.id,
      reviewId: candidate.reviewId,
      expectedSourceRevision: candidate.expectedSourceRevision,
    })
    if (status === 'confirmed') {
      return { status: 'checkpointed', runId: run.id, state: 'confirming' }
    }
    return failAndDiscard(deps, input, run.id, 'review_mutation')
  }

  if (result.review.reviewName !== candidate.reviewName) {
    return failAndDiscard(deps, input, run.id, 'malformed_page')
  }
  let observation: ReviewProviderPersistedObservation
  try {
    const [persisted] = await persistPageObservations(
      deps,
      deriver,
      input,
      [result.review],
      `${run.id}\0targeted\0${candidate.reviewId}\0${candidate.expectedSourceRevision}`,
    )
    if (!persisted) throw new Error('observation missing')
    observation = persisted
  } catch {
    return failAndDiscard(deps, input, run.id, 'observation_failed')
  }
  await deps.repository.recordCandidateObservation({ runId: run.id, observation })
  return failAndDiscard(deps, input, run.id, 'confirmation_set_changed')
}

export type RunReviewProviderSnapshot = (
  input: RunReviewProviderSnapshotInput,
) => Promise<RunReviewProviderSnapshotResult>

export const runReviewProviderSnapshot =
  (deps: RunReviewProviderSnapshotDeps) =>
  async (
    input: RunReviewProviderSnapshotInput,
  ): Promise<RunReviewProviderSnapshotResult> => {
    if (!(await sameScope(deps, input))) {
      return {
        status: 'failed',
        runId: input.runId ?? '',
        code: 'source_changed',
      }
    }
    const expired = await deps.repository.readExpiredActiveRun({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      ...(input.runId == null ? {} : { runId: input.runId }),
    })
    if (expired) {
      return failAndDiscard(
        deps,
        input,
        expired.id,
        expired.state === 'confirming'
          ? 'confirmation_deadline_elapsed'
          : 'cursor_failure',
      )
    }
    const deriver = await deps.subjectKeyService.acquireDeriver()
    let run = input.runId
      ? await deps.repository.readRun({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          sourceEpoch: input.sourceEpoch,
          runId: input.runId,
        })
      : await deps.repository.startOrResume({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          sourceEpoch: input.sourceEpoch,
        })
    if (!run) {
      return { status: 'failed', runId: input.runId ?? '', code: 'source_changed' }
    }

    if (run.state === 'failed') {
      await deps.googleReviewApi.discardReviewCursors({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        sourceEpoch: input.sourceEpoch,
        runId: run.id,
      })
      return {
        status: 'failed',
        runId: run.id,
        code: run.failureCode ?? 'provider_failure',
      }
    }
    if (run.state === 'completed') return { status: 'completed', runId: run.id }
    if (run.state === 'deleting') {
      const batch = await deps.repository.applyDeletionBatch({
        runId: run.id,
        limit: REVIEW_PROVIDER_DELETION_BATCH_SIZE,
      })
      if (batch.done) {
        await deps.googleReviewApi.discardReviewCursors({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          sourceEpoch: input.sourceEpoch,
          runId: run.id,
        })
        return { status: 'completed', runId: run.id }
      }
      return { status: 'deleting', runId: run.id, applied: batch.applied }
    }
    if (run.state === 'scanning') return runListPage(deps, deriver, input, run)

    const targeted = await confirmTargetedCandidate(deps, deriver, input, run)
    if (targeted) return targeted
    run = await deps.repository.beginConfirmationScan({ runId: run.id })
    return runListPage(deps, deriver, input, run)
  }
