import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import { sha256Hex } from '#/shared/domain/sha256'
import {
  GOOGLE_CONNECTION_UNUSABLE_CODE,
  type GoogleReviewApiPort,
  type GoogleReviewPage,
  type GoogleReviewRead,
} from '../ports/google-review-api.port'
import type { PropertySourceEpochPort } from '../ports/property-source-epoch.port'
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
  type ReviewProviderPersistedObservation,
  type ReviewProviderSnapshotFailureCode,
  type ReviewProviderSnapshotRepository,
  type ReviewProviderSnapshotRun,
} from '../ports/review-provider-snapshot.repository'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type { ReviewSyncActivityRecorder } from '../ports/review-sync-activity.port'
import { snapshotRunCountAgreement } from '../snapshot-count-gap'
import type { ReviewProviderObservationOrigin } from '../ports/response-target-authority.port'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type RunReviewProviderSnapshotInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  observationOrigin: ReviewProviderObservationOrigin
  /**
   * Which route this step reaches reviews by, for the push health ledger:
   * polling (`snapshot`), or the full snapshot a Google push handed off to
   * because its target could not be read (`push_reconcile`, which a push
   * already covers). Required, so a new caller cannot leave it out.
   */
  firstSeenVia: 'snapshot' | 'push_reconcile'
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
      /**
       * Set only when this step did not fail the run: it found the run already
       * failed (the queue retrying the step that failed it, a redrive of that
       * step's dead letter, a continuation queued before the run ended) and
       * `code` is the failure the store holds. Unmarked, this step failed the
       * run. A caller that fails its job for the failure must do so only
       * unmarked: a replay can never succeed, and failing it again only pushes
       * the Property's backoff out and dead-letters the job. `failedAt` is when
       * the store ended the run (null if it holds no date), which lets the
       * caller tell whether the step that failed it recorded the failure before
       * it died.
       */
      alreadyFailed?: Readonly<{ failedAt: Date | null }>
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
  propertySourceEpoch: PropertySourceEpochPort
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  /**
   * Durable discovery-activity stamps. A page that persisted a review nobody
   * had seen before is the ONLY evidence that this property is live, and the
   * discovery backoff ladder prices its polling on it.
   */
  syncActivity: ReviewSyncActivityRecorder
  clock: () => Date
  /**
   * Observation-write failures and provider failures without a coded cause
   * are logged with bounded execution identity before the run becomes terminal.
   */
  logger: LoggerPort
}>

const failureCodeForProviderError = (
  error: unknown,
): ReviewProviderSnapshotFailureCode => {
  if (typeof error !== 'object' || error == null || !('code' in error)) {
    return 'provider_failure'
  }
  const code = error.code
  if (code === 'authorization_changed') return 'authorization_changed'
  if (code === 'provider_rejected') return 'provider_rejected'
  if (
    code === 'authorization_denied' ||
    code === GOOGLE_CONNECTION_UNUSABLE_CODE ||
    code === 'runtime_unavailable' ||
    code === 'stale_source'
  ) {
    return code
  }
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

/**
 * The page cursor went with a cursor store restart. The store keeps nothing
 * across one (ADR 0050), so a deploy that restarts it drops the cursor of
 * every run then in flight: `cursor_not_found` from a store that started after
 * this run did. One that has been up since before the run began did not lose
 * the cursor that way, and neither did one that cannot say when it started:
 * those stay `cursor_failure`, which fails loudly.
 */
const lostToCursorStoreRestart = (
  error: unknown,
  run: Pick<ReviewProviderSnapshotRun, 'startedAt'>,
): boolean =>
  typeof error === 'object' &&
  error != null &&
  'code' in error &&
  error.code === 'cursor_not_found' &&
  'cursorStoreStartedAtMs' in error &&
  typeof error.cursorStoreStartedAtMs === 'number' &&
  error.cursorStoreStartedAtMs > run.startedAt.getTime()

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
  const scope = await deps.propertySourceEpoch.getSourceEpoch(
    input.organizationId,
    input.propertyId,
  )
  return scope != null && scope.sourceEpoch === input.sourceEpoch
}

/**
 * The failure as the store recorded it, which for a listing that moved under
 * the run (a different set between the scans, a different total or average
 * from page to page, a review on two pages) depends on the Property's earlier
 * runs (`snapshot-listing-change.ts`). A `listing_changed` run is expected and
 * the sync job starts again at once, so it is a warning with the three counts
 * and nothing else: no identifier, so the line is content-free, and the run
 * row (`failure_code = 'listing_changed'`) says which Property. `listed` and
 * `confirmed` are how far each scan got before the listing moved: a run that
 * stopped in its main scan has `confirmed` at 0.
 */
const failedOutcome = (
  deps: RunReviewProviderSnapshotDeps,
  run: ReviewProviderSnapshotRun,
  code: ReviewProviderSnapshotFailureCode,
): RunReviewProviderSnapshotResult => {
  const recorded = run.failureCode ?? code
  if (recorded === 'listing_changed') {
    deps.logger.warn(
      {
        event: 'review_snapshot_listing_changed',
        expected: run.expectedProviderTotal,
        listed: run.mainUniqueCount,
        confirmed: run.confirmationUniqueCount,
      },
      'Review snapshot listing changed while it was being read; no removals applied',
    )
  }
  return { status: 'failed', runId: run.id, code: recorded }
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
  const run = await deps.repository.failRun({
    runId,
    organizationId: input.organizationId,
    code,
  })
  return failedOutcome(deps, run, code)
}

/**
 * A step that reads its run already failed. Only a step queued with a `runId`
 * can: `startOrResume` never returns a terminal run. The cursors are discarded
 * again (idempotent; it covers a step that died after failing the run and
 * before discarding them), nothing else is done, and the result says so
 * (`alreadyFailed`), so the sync job ends quietly instead of failing again.
 */
const replayFailedRun = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
  run: ReviewProviderSnapshotRun,
): Promise<RunReviewProviderSnapshotResult> => {
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
    alreadyFailed: { failedAt: run.terminalAt },
  }
}

/**
 * What a Google rejection says about the answer, as closed values: Google's
 * HTTP status (a number, the one fact that tells a removed location, 404, from
 * a refused request, 400) and whether the request was dispatched. Read off the
 * review API error's dispatch evidence; an error without it gives
 * `providerStatus: null` and `dispatch: 'unknown'`. The logger's `safeError`
 * keeps only an error's name and code, so the status reaches no log unless it
 * is copied out like this.
 */
const providerRejectionEvidence = (
  error: unknown,
): Readonly<{
  providerStatus: number | null
  dispatch: 'not_sent' | 'answered' | 'unknown'
}> => {
  const failure =
    typeof error === 'object' && error != null && 'failure' in error
      ? error.failure
      : null
  if (typeof failure !== 'object' || failure == null) {
    return { providerStatus: null, dispatch: 'unknown' }
  }
  const status = 'providerStatus' in failure ? failure.providerStatus : null
  const dispatch = 'dispatch' in failure ? failure.dispatch : null
  return {
    providerStatus:
      typeof status === 'number' && Number.isSafeInteger(status) ? status : null,
    dispatch: dispatch === 'not_sent' || dispatch === 'answered' ? dispatch : 'unknown',
  }
}

const failForProviderError = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
  runId: string,
  error: unknown,
): Promise<RunReviewProviderSnapshotResult> => {
  const code = failureCodeForProviderError(error)
  // BQC-7.3 bans tenant identifiers in logs; runId is the approved execution
  // identity and resolves the property through the run row.
  if (code === 'provider_failure') {
    deps.logger.error(
      { err: error, runId },
      'review snapshot failed without a coded cause',
    )
  }
  // A rejection has a cause and a name: one warning with Google's status
  // instead of an error that says nothing was known.
  if (code === 'provider_rejected') {
    deps.logger.warn(
      {
        event: 'review_snapshot_provider_rejected',
        ...providerRejectionEvidence(error),
        runId,
      },
      'Review snapshot rejected by Google: the location or request is not valid',
    )
  }
  return failAndDiscard(deps, input, runId, code)
}

const validatePage = (
  run: ReviewProviderSnapshotRun,
  reviews: readonly { reviewName: string }[],
  totalReviewCount: number,
  averageRating: number | null,
  locationName: string,
): ReviewProviderSnapshotFailureCode | null => {
  if (
    !Number.isSafeInteger(totalReviewCount) ||
    totalReviewCount < 0 ||
    totalReviewCount > REVIEW_PROVIDER_SNAPSHOT_MAX_REVIEWS ||
    !(
      (totalReviewCount === 0 && averageRating === null) ||
      (totalReviewCount > 0 &&
        typeof averageRating === 'number' &&
        Number.isFinite(averageRating) &&
        averageRating >= 0 &&
        averageRating <= 5)
    ) ||
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
  run: Pick<ReviewProviderSnapshotRun, 'id' | 'observationOrigin' | 'startedAt'>,
  reviews: readonly GoogleReviewRead[],
  observationScope: string,
  replyReadGeneration: number,
): Promise<readonly ReviewProviderPersistedObservation[]> => {
  const historyCutoff = await importHistoryCutoff(deps, input, run)
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
      observationOrigin: observationOriginForReview(run, historyCutoff, review),
      firstSeenVia: input.firstSeenVia,
      observationKey: sha256Hex(
        `repkey-review-provider-observation-key-v1\0${observationScope}\0${review.reviewName}`,
      ),
      replyReadGeneration,
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

/**
 * The cutoff an import run classifies against: its source epoch's durable
 * history cutoff, fixed when the epoch's first import was admitted. A retried
 * import that starts a later run must not move it. A run that predates the
 * durable record falls back to its own start. Other runs have none here; the
 * observation writer applies the epoch's cutoff to their first sightings, and
 * tells onboarding history from what a relink or a late listing brings in.
 */
const importHistoryCutoff = async (
  deps: RunReviewProviderSnapshotDeps,
  input: RunReviewProviderSnapshotInput,
  run: Pick<ReviewProviderSnapshotRun, 'observationOrigin' | 'startedAt'>,
): Promise<Date | null> => {
  if (run.observationOrigin !== 'historical_onboarding') return null
  const recorded = await deps.repository.readHistoryCutoff({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
  })
  return recorded?.cutoffAt ?? run.startedAt
}

/**
 * An initial import is a baseline, not a licence to exclude reviews that were
 * actually published while its bounded pages were still running. The epoch's
 * durable history cutoff is the only stable cutoff across continuations and
 * retries. Provider publication time is preferred because local arrival order
 * changes under pagination; an unusable provider clock is excluded rather
 * than converted into performance evidence.
 */
const observationOriginForReview = (
  run: Pick<ReviewProviderSnapshotRun, 'observationOrigin'>,
  historyCutoff: Date | null,
  review: GoogleReview,
): ReviewProviderObservationOrigin => {
  if (run.observationOrigin !== 'historical_onboarding' || historyCutoff == null) {
    return run.observationOrigin
  }
  const publishedAt = review.sourceCreatedAt ?? review.reviewedAt
  const publishedAtMs = publishedAt.getTime()
  if (!Number.isFinite(publishedAtMs)) return 'legacy_unknown'
  return publishedAtMs > historyCutoff.getTime() ? 'ongoing' : 'historical_onboarding'
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
  const finished = await deps.repository.finishConfirmationScan({
    runId: run.id,
    organizationId: input.organizationId,
  })
  if (finished.status === 'failed') {
    return failedOutcome(deps, finished.run, finished.code)
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
    if (lostToCursorStoreRestart(error, run)) {
      deps.logger.warn(
        {
          event: 'review_snapshot_cursor_lost',
          runId: run.id,
          phase: position.phase,
          pageIndex: position.pageIndex,
        },
        'Review snapshot lost its page cursor to a cursor store restart',
      )
      return {
        ok: false,
        outcome: await failAndDiscard(deps, input, run.id, 'cursor_lost'),
      }
    }
    return {
      ok: false,
      outcome: await failForProviderError(deps, input, run.id, error),
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
    organizationId: input.organizationId,
    phase: position.phase,
    expectedPageIndex: position.pageIndex,
    expectedCursorRef: position.cursorRef,
    totalReviewCount: page.totalReviewCount,
    averageRating: page.averageRating,
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

  // Allocate immediately after acquiring the page response. Validation and
  // source-fence checks may still reject it (leaving an intentional gap), but
  // no later asynchronous work may reorder this response behind another one.
  let replyReadGeneration: number
  try {
    replyReadGeneration = await deps.observationWriter.allocateReplyReadGeneration()
  } catch (error) {
    deps.logger.warn({ err: error }, 'Reply read generation could not be allocated')
    return failAndDiscard(deps, input, run.id, 'observation_failed')
  }

  const invalid = validatePage(
    run,
    page.reviews,
    page.totalReviewCount,
    page.averageRating,
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
      run,
      page.reviews,
      `${run.id}\0${position.phase}\0${position.pageIndex}`,
      replyReadGeneration,
    )
  } catch (error) {
    deps.logger.warn({ err: error }, 'Page Review observation write failed')
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
    return failForProviderError(deps, input, run.id, error)
  }
  if (result.status === 'not_found') {
    if (!(await sameScope(deps, input))) {
      return failAndDiscard(deps, input, run.id, 'source_changed')
    }
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

  // Allocate immediately after a found response and before any asynchronous
  // source check, so concurrent responses cannot be reordered by that check.
  let replyReadGeneration: number
  try {
    replyReadGeneration = await deps.observationWriter.allocateReplyReadGeneration()
  } catch (error) {
    deps.logger.warn({ err: error }, 'Reply read generation could not be allocated')
    return failAndDiscard(deps, input, run.id, 'observation_failed')
  }
  if (!(await sameScope(deps, input))) {
    return failAndDiscard(deps, input, run.id, 'source_changed')
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
      run,
      [result.review],
      `${run.id}\0targeted\0${candidate.reviewId}\0${candidate.expectedSourceRevision}`,
      replyReadGeneration,
    )
    if (!persisted) throw new Error('observation missing')
    observation = persisted
  } catch (error) {
    deps.logger.warn({ err: error }, 'Targeted Review observation write failed')
    return failAndDiscard(deps, input, run.id, 'observation_failed')
  }
  await deps.repository.recordCandidateObservation({
    runId: run.id,
    organizationId: input.organizationId,
    observation,
  })
  return failAndDiscard(deps, input, run.id, 'confirmation_set_changed')
}

/**
 * A run that completed although Google's total and its list differed by a
 * small amount removed nothing (`snapshot-count-gap.ts`). Say so, with the
 * three counts and nothing else: no identifier, so the line is content-free,
 * and the run row (`expected_total <> main_unique_count`) says which Property.
 */
const logCountGap = (
  deps: RunReviewProviderSnapshotDeps,
  run: ReviewProviderSnapshotRun,
): void => {
  const agreement = snapshotRunCountAgreement(run)
  if (agreement.kind !== 'gap') return
  deps.logger.warn(
    {
      event: 'review_snapshot_completed_with_count_gap',
      expected: agreement.expected,
      unique: agreement.unique,
      gap: agreement.gap,
    },
    'Review snapshot completed with a Google count gap; no removals applied',
  )
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
          observationOrigin: input.observationOrigin,
        })
    if (!run) {
      return { status: 'failed', runId: input.runId ?? '', code: 'source_changed' }
    }

    if (run.state === 'failed') return replayFailedRun(deps, input, run)
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
        logCountGap(deps, batch.run)
        return { status: 'completed', runId: run.id }
      }
      return { status: 'deleting', runId: run.id, applied: batch.applied }
    }
    if (run.state === 'scanning') return runListPage(deps, deriver, input, run)

    const targeted = await confirmTargetedCandidate(deps, deriver, input, run)
    if (targeted) return targeted
    run = await deps.repository.beginConfirmationScan({
      runId: run.id,
      organizationId: input.organizationId,
    })
    return runListPage(deps, deriver, input, run)
  }
