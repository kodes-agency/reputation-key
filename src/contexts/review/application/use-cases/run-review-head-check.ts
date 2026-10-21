// Review context — one head check of a Property.
//
// Google documents page 1 of reviews.list, newest-updated first, as always
// accurate. One call per skipped discovery look is enough to see a missed push,
// an edit, most replies written on Google, and Google's own count and average.
//
// DARK (the default): it reads Google and RepKey's stored copies, compares them,
// logs what a persisting check WOULD store, and changes nothing about reviews.
// PERSIST (REVIEW_HEAD_CHECKS=persist, ADR 0055, note of 2026-10-21 (d)): the
// same read and comparison, then it stores the reviews that differ and Google's
// own count and average (persist-review-head-page.ts). Persist is built and
// stays off until a week of dark data supports it.
//
// It never throws. Every provider error, an order violation, a failed read of
// the stored copies and a failed write end as a closed outcome or a count the
// job returns normally, so a head check can never fail its job, spend a retry,
// or latch the job family's repair state. It also never records or clears the
// Property's sync failure: the full retry owns that.

import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { compareHead, type HeadComparison } from '../../domain/head-check'
import {
  GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE,
  type GoogleReviewApiPort,
} from '../ports/google-review-api.port'
import type {
  ReviewHeadCheckOutcome,
  ReviewHeadCheckRepository,
  ReviewHeadPersistence,
} from '../ports/review-head-check.repository'
import {
  persistReviewHeadPage,
  type PersistReviewHeadPageDeps,
} from './persist-review-head-page'

export type RunReviewHeadCheckInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  /** The Property's current source epoch, read by the job. */
  sourceEpoch: number
  locationName: string
  /**
   * `persist` stores what differs; `dark` (the default, and what a missing
   * `persist` dependency means) stores nothing.
   */
  mode?: 'dark' | 'persist'
}>

export type RunReviewHeadCheckResult =
  | Readonly<{
      status: 'compared'
      comparison: HeadComparison
      /** Present only when the check ran in persist mode. */
      persistence?: ReviewHeadPersistence | null
    }>
  | Readonly<{ status: Exclude<ReviewHeadCheckOutcome, 'compared'> }>

export type RunReviewHeadCheck = (
  input: RunReviewHeadCheckInput,
) => Promise<RunReviewHeadCheckResult>

export type RunReviewHeadCheckDeps = Readonly<{
  googleReviewApi: Pick<GoogleReviewApiPort, 'readReviewsHead'>
  repository: ReviewHeadCheckRepository
  /** Receives closed codes and counts, never an id, a message or a review field. */
  logger: Pick<LoggerPort, 'info' | 'warn'>
  clock: () => Date
  /**
   * What persist mode needs on top of the read. A process without it runs every
   * check dark, whatever the job asks for.
   */
  persist?: Pick<
    PersistReviewHeadPageDeps,
    | 'observationWriter'
    | 'subjectKeyService'
    | 'propertySourceEpoch'
    | 'syncActivity'
    | 'newId'
  >
}>

// Errors the authorizer (kill switch, suspension, grant, connection state)
// raises carry one of these codes; the adapter's own errors carry theirs.
const AUTHORIZATION_CODES: ReadonlySet<string> = new Set([
  'authorization_changed',
  'reauthorization_required',
  'authorization_denied',
  'stale_source',
  'capability_killed',
])

const FAILURE_OUTCOMES: Readonly<
  Record<string, Exclude<ReviewHeadCheckOutcome, 'compared'>>
> = {
  provider_rate_limited: 'rate_limited',
  provider_unavailable: 'provider_unavailable',
  provider_rejected: 'provider_rejected',
  malformed_response: 'malformed_response',
  [GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE]: 'no_provider',
}

const persisting = (input: Pick<RunReviewHeadCheckInput, 'mode'>): boolean =>
  input.mode === 'persist'

const errorCode = (error: unknown): string | null =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null

/** The closed outcome a failed read of Google ends as. */
const failureOutcome = (error: unknown): Exclude<ReviewHeadCheckOutcome, 'compared'> => {
  const code = errorCode(error)
  if (code === null) return 'error'
  if (AUTHORIZATION_CODES.has(code)) return 'authorization_changed'
  return FAILURE_OUTCOMES[code] ?? 'error'
}

/** Outcomes that leave no history row: nothing was compared and nothing failed on Google. */
const LEAVES_NO_ROW: ReadonlySet<ReviewHeadCheckOutcome> = new Set([
  'skipped_outstanding_failure',
  'no_provider',
])

/** A persisting check that could not even take a read generation stored nothing. */
const UNAVAILABLE: ReviewHeadPersistence = {
  outcome: 'unavailable',
  storedNew: 0,
  storedOther: 0,
  failed: 0,
  factWritten: false,
}

const logLine = (
  outcome: ReviewHeadCheckOutcome,
  comparison: HeadComparison | null,
  persistence: ReviewHeadPersistence | null,
  durationMs: number,
) => ({
  event: 'review_head_check',
  outcome,
  // Only a persisting check says what it stored; a dark line is as it always was.
  ...(persistence === null
    ? {}
    : {
        persisted: persistence.outcome,
        storedNew: persistence.storedNew,
        storedOther: persistence.storedOther,
        storeFailed: persistence.failed,
        factWritten: persistence.factWritten,
      }),
  listed: comparison?.listed ?? 0,
  new: comparison?.newCount ?? 0,
  changed: comparison?.changedCount ?? 0,
  replyChanged: comparison?.replyChangedCount ?? 0,
  leaseRefresh: comparison?.leaseRefreshCount ?? 0,
  wouldPersist: comparison?.wouldPersist ?? 0,
  totalDifference: comparison?.totalDifference ?? null,
  averageDifference: comparison?.averageDifference ?? null,
  hasMore: comparison?.hasMore ?? null,
  orderViolation: outcome === 'order_violation',
  durationMs,
})

export const createRunReviewHeadCheck = (
  deps: RunReviewHeadCheckDeps,
): RunReviewHeadCheck => {
  /** Read Google, then the stored copies, and compare. Throws; the caller classifies. */
  const compare = async (
    input: RunReviewHeadCheckInput,
    now: Date,
    persist: RunReviewHeadCheckDeps['persist'],
  ): Promise<RunReviewHeadCheckResult> => {
    const head = await deps.googleReviewApi.readReviewsHead({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      locationName: input.locationName,
    })
    if (head.status === 'order_violation') return { status: 'order_violation' }
    const persistDeps = persisting(input) ? persist : undefined
    // The instant Google's numbers were read, and the reply read generation,
    // taken right after the provider's response and once for the page: no later
    // asynchronous work may reorder this read behind another one.
    const readAt = persistDeps === undefined ? now : deps.clock()
    const replyReadGeneration =
      persistDeps === undefined ? null : await allocateGeneration(persistDeps)
    const baseline = await deps.repository.readBaseline({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      externalIds: head.reviews.map((review) => review.externalId),
    })
    const comparison = compareHead({
      now,
      sourceEpoch: input.sourceEpoch,
      reviews: head.reviews,
      copies: baseline.copies,
      googleTotal: head.totalReviewCount,
      googleAverage: head.averageRating,
      storedLiveCount: baseline.storedLiveCount,
      storedAverage: baseline.storedAverageRating,
      hasMore: head.hasMore,
    })
    if (persistDeps === undefined) {
      return { status: 'compared', comparison, persistence: null }
    }
    if (replyReadGeneration === null) {
      return { status: 'compared', comparison, persistence: UNAVAILABLE }
    }
    return {
      status: 'compared',
      comparison,
      persistence: await persistReviewHeadPage(
        {
          ...persistDeps,
          repository: deps.repository,
          logger: deps.logger,
          clock: deps.clock,
        },
        {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          sourceEpoch: input.sourceEpoch,
          locationName: input.locationName,
          reviews: head.reviews,
          copies: baseline.copies,
          googleTotal: head.totalReviewCount,
          googleAverage: head.averageRating,
          replyReadGeneration,
          readAt,
          now,
        },
      ),
    }
  }

  const allocateGeneration = async (
    persist: NonNullable<RunReviewHeadCheckDeps['persist']>,
  ): Promise<number | null> => {
    try {
      return await persist.observationWriter.allocateReplyReadGeneration()
    } catch {
      return null
    }
  }

  const readOutcome = async (
    input: RunReviewHeadCheckInput,
    now: Date,
  ): Promise<RunReviewHeadCheckResult> => {
    try {
      if (await deps.repository.hasOutstandingFailure(input.propertyId)) {
        return { status: 'skipped_outstanding_failure' }
      }
      return await compare(input, now, deps.persist)
    } catch (error) {
      const status = failureOutcome(error)
      // A closed code only: a provider message or a driver error can carry an
      // identifier, and an unforeseen failure is worth a line of its own.
      if (status === 'error') {
        deps.logger.warn(
          { event: 'review_head_check_failed' },
          'Review head check failed',
        )
      }
      return { status }
    }
  }

  const record = async (
    input: RunReviewHeadCheckInput,
    result: RunReviewHeadCheckResult,
    startedAt: Date,
    completedAt: Date,
  ): Promise<void> => {
    if (LEAVES_NO_ROW.has(result.status)) return
    try {
      await deps.repository.recordRun({
        propertyId: input.propertyId,
        sourceEpoch: input.sourceEpoch,
        startedAt,
        completedAt,
        mode: persisting(input) && deps.persist !== undefined ? 'head' : 'head_dark',
        outcome: result.status,
        comparison: result.status === 'compared' ? result.comparison : null,
        persistence: result.status === 'compared' ? (result.persistence ?? null) : null,
      })
    } catch {
      deps.logger.warn(
        { event: 'review_head_check_run_not_recorded' },
        'Review head check history row could not be written',
      )
    }
  }

  return async (input) => {
    const startedAt = deps.clock()
    const result = await readOutcome(input, startedAt)
    const completedAt = deps.clock()
    await record(input, result, startedAt, completedAt)
    deps.logger.info(
      logLine(
        result.status,
        result.status === 'compared' ? result.comparison : null,
        result.status === 'compared' ? (result.persistence ?? null) : null,
        completedAt.getTime() - startedAt.getTime(),
      ),
      'Review head check finished',
    )
    return result
  }
}
