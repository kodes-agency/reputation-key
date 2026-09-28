import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  AI_ADMISSION_IN_FLIGHT,
  AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM,
  type AiAdmissionLane,
} from '../../domain/admission-lanes'
import type {
  AiReviewAnalysisBacklogEntry,
  AiReviewAnalysisBacklogPort,
} from '../ports/ai-review-analysis-backlog.port'
import {
  AI_BACKFILL_OPERATION_HORIZON_MILLIS,
  type AnalyzeReviewEventInput,
  type AnalyzeReviewEventResult,
} from './analyze-review-event'

/** How long a drainer owns a claimed entry before another may take it. */
export const AI_BACKLOG_CLAIM_LEASE_MILLIS = 3 * 60_000
/**
 * Provider calls one drain runs at once. It equals an organization's
 * background in-flight budget, so one organization's import can use the whole
 * drain. It stays below the worker's database pool: an analysis holds a client
 * only for one short transaction at a time, never across its provider call.
 */
export const AI_BACKLOG_DRAIN_CONCURRENCY = AI_ADMISSION_IN_FLIGHT.organization.background
/** Entries claimed per round: a property's in-flight share, for up to three properties. */
const AI_BACKLOG_DRAIN_ROUND_LIMIT = 3 * AI_ADMISSION_IN_FLIGHT.property.background
/**
 * A drain keeps claiming rounds for this long, then leaves the rest to the
 * next tick. It stays under the worker's 25-second shutdown budget, so a
 * deploy rarely interrupts a round.
 */
export const AI_BACKLOG_DRAIN_TIME_BUDGET_MILLIS = 20_000
/** Spacing after an unexpected failure, so a poisoned entry cannot spin. */
const FAILURE_RETRY_DELAY_MILLIS = 60_000
const DEFERRED_RETRY_DELAY_MILLIS = 30_000

export type DrainReviewAnalysisBacklogResult = Readonly<{
  claimed: number
  completed: number
  rescheduled: number
  /** Entries returned to the queue because their lane was busy. */
  waitingForLane: number
  failed: number
}>

export type RequestReviewAnalysisResult =
  | Readonly<{ status: 'completed' }>
  | Readonly<{ status: 'waiting'; retryAtEpochMillis: number }>
  | Readonly<{ status: 'not_pending' }>
  | Readonly<{ status: 'failed' }>

type PropertyScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

export type DrainReviewAnalysisBacklogDependencies = Readonly<{
  backlog: AiReviewAnalysisBacklogPort
  analyzeReviewEvent: (
    input: AnalyzeReviewEventInput,
  ) => Promise<AnalyzeReviewEventResult>
  nowEpochMillis: () => number
  /**
   * Records an entry whose attempt threw. Optional so existing constructions
   * keep working; without it the drain behaves exactly as before and says
   * nothing.
   */
  logger?: Pick<LoggerPort, 'warn'>
  /**
   * Advances the Property's first-enablement enrollment once some of its
   * analyses settle, so it is recorded caught up when its last review settles
   * rather than at the next enrollment sweep. Optional; the sweep does it too.
   */
  advanceEnrollment?: (scope: PropertyScope) => Promise<unknown>
}>

type EntryOutcome =
  | Readonly<{ kind: 'completed' }>
  | Readonly<{ kind: 'rescheduled'; retryAtEpochMillis: number }>
  | Readonly<{ kind: 'busy'; retryAtEpochMillis: number }>
  | Readonly<{ kind: 'failed' }>

type DrainCounts = {
  claimed: number
  completed: number
  rescheduled: number
  waitingForLane: number
  failed: number
}

const NOTHING_DRAINED: DrainReviewAnalysisBacklogResult = Object.freeze({
  claimed: 0,
  completed: 0,
  rescheduled: 0,
  waitingForLane: 0,
  failed: 0,
})

/**
 * Run `task` over `items` with at most `concurrency` in flight, in order. The
 * first failure stops new work, lets the running tasks finish, then rejects.
 */
async function forEachConcurrently<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.values()
  const state: { failure: Readonly<{ error: unknown }> | null } = { failure: null }
  async function worker(): Promise<void> {
    while (state.failure === null) {
      const next = queue.next()
      if (next.done) return
      try {
        await task(next.value)
      } catch (error) {
        state.failure = { error }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  if (state.failure !== null) throw state.failure.error
}

/**
 * Drain Review Analysis waiting in the backlog (ADR 0058). Each round claims a
 * bounded, per-property share of the newest waiting reviews and runs them
 * through the ordinary analysis use case in their lane, a few at a time; the
 * drain keeps claiming rounds while they settle work, up to its time budget.
 * A busy lane returns the property's remaining entries to the queue at the
 * lane's retry time without asking again; any settled outcome removes the
 * entry.
 */
export function createDrainReviewAnalysisBacklog(
  dependencies: DrainReviewAnalysisBacklogDependencies,
) {
  async function run(
    entry: AiReviewAnalysisBacklogEntry,
    lane: AiAdmissionLane,
  ): Promise<EntryOutcome> {
    try {
      const result = await dependencies.analyzeReviewEvent({
        organizationId: entry.organizationId,
        propertyId: entry.propertyId,
        reviewId: entry.reviewId,
        sourceEpoch: entry.sourceEpoch,
        sourceRevision: entry.sourceRevision,
        analysisSequence: entry.analysisSequence,
        eventEnvelopeId: entry.eventEnvelopeId,
        disposition: 'pending',
        // The horizon starts when the drainer first takes the entry, not when
        // the review was imported: waiting in the queue is not a stuck attempt.
        eventRecordedAtEpochMillis: entry.firstStartedAtEpochMillis,
        operationHorizonMillis: AI_BACKFILL_OPERATION_HORIZON_MILLIS,
        execution: 'execute',
        lane,
        ...(lane === 'interactive'
          ? { admissionHeadroom: AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM }
          : {}),
      })
      const now = dependencies.nowEpochMillis()
      if (result.status === 'retry') {
        await dependencies.backlog.reschedule({
          eventEnvelopeId: entry.eventEnvelopeId,
          organizationId: entry.organizationId,
          nextAttemptAtEpochMillis: result.retryAtEpochMillis,
          nowEpochMillis: now,
        })
        return result.code === 'admission_busy'
          ? { kind: 'busy', retryAtEpochMillis: result.retryAtEpochMillis }
          : { kind: 'rescheduled', retryAtEpochMillis: result.retryAtEpochMillis }
      }
      if (result.status === 'deferred') {
        const retryAtEpochMillis = now + DEFERRED_RETRY_DELAY_MILLIS
        await dependencies.backlog.reschedule({
          eventEnvelopeId: entry.eventEnvelopeId,
          organizationId: entry.organizationId,
          nextAttemptAtEpochMillis: retryAtEpochMillis,
          nowEpochMillis: now,
        })
        return { kind: 'rescheduled', retryAtEpochMillis }
      }
      await dependencies.backlog.complete({
        eventEnvelopeId: entry.eventEnvelopeId,
        organizationId: entry.organizationId,
      })
      return { kind: 'completed' }
    } catch (error) {
      // The entry comes back after the delay whatever went wrong, so this line
      // is the only place an operator can see which entry keeps failing
      // (`attempts` counts its reschedules) and why. Identifiers only (AI
      // invariant 12): the shared logger reduces an Error to its name and
      // code, and a thrown value that is not an Error is left out.
      dependencies.logger?.warn(
        {
          ...(error instanceof Error ? { err: error } : {}),
          eventEnvelopeId: entry.eventEnvelopeId,
          organizationId: entry.organizationId,
          propertyId: entry.propertyId,
          reviewId: entry.reviewId,
          attempts: entry.attempts,
          lane,
        },
        'AI review analysis backlog entry failed',
      )
      const now = dependencies.nowEpochMillis()
      await dependencies.backlog
        .reschedule({
          eventEnvelopeId: entry.eventEnvelopeId,
          organizationId: entry.organizationId,
          nextAttemptAtEpochMillis: now + FAILURE_RETRY_DELAY_MILLIS,
          nowEpochMillis: now,
        })
        .catch(() => undefined)
      return { kind: 'failed' }
    }
  }

  /**
   * Catch-up is recorded from the settlement ledger, so a failure here loses
   * nothing: the enrollment sweep records it instead. Identifiers only.
   */
  async function advanceEnrollments(scopes: Iterable<PropertyScope>): Promise<void> {
    if (!dependencies.advanceEnrollment) return
    for (const scope of scopes) {
      try {
        await dependencies.advanceEnrollment(scope)
      } catch (error) {
        dependencies.logger?.warn(
          {
            ...(error instanceof Error ? { err: error } : {}),
            organizationId: scope.organizationId,
            propertyId: scope.propertyId,
          },
          'AI review analysis enrollment advance failed',
        )
      }
    }
  }

  /**
   * One round: claim the ready share and run it. `parked` carries each
   * property lane found busy, with its retry time, across the drain's rounds.
   * Returns how many entries this round claimed and settled.
   */
  async function drainRound(
    parked: Map<string, number>,
    counts: DrainCounts,
  ): Promise<Readonly<{ claimed: number; completed: number }>> {
    const entries = await dependencies.backlog.claimReady({
      nowEpochMillis: dependencies.nowEpochMillis(),
      leaseMillis: AI_BACKLOG_CLAIM_LEASE_MILLIS,
      perProperty: AI_ADMISSION_IN_FLIGHT.property.background,
      limit: AI_BACKLOG_DRAIN_ROUND_LIMIT,
    })
    const settled = new Map<string, PropertyScope>()
    let completed = 0
    await forEachConcurrently(entries, AI_BACKLOG_DRAIN_CONCURRENCY, async (entry) => {
      const lane = entry.priority
      const laneKey = `${entry.propertyId}:${lane}`
      const parkedUntil = parked.get(laneKey)
      const now = dependencies.nowEpochMillis()
      if (parkedUntil !== undefined && parkedUntil > now) {
        // The lane is full for this property: park the entry at the lane's
        // retry time instead of asking again.
        counts.waitingForLane += 1
        await dependencies.backlog.reschedule({
          eventEnvelopeId: entry.eventEnvelopeId,
          organizationId: entry.organizationId,
          nextAttemptAtEpochMillis: parkedUntil,
          nowEpochMillis: now,
        })
        return
      }
      const outcome = await run(entry, lane)
      if (outcome.kind === 'completed') {
        counts.completed += 1
        completed += 1
        settled.set(entry.propertyId, {
          organizationId: entry.organizationId,
          propertyId: entry.propertyId,
        })
      } else if (outcome.kind === 'rescheduled') {
        counts.rescheduled += 1
      } else if (outcome.kind === 'failed') {
        counts.failed += 1
      } else {
        counts.waitingForLane += 1
        parked.set(
          laneKey,
          Math.max(parked.get(laneKey) ?? 0, outcome.retryAtEpochMillis),
        )
      }
    })
    counts.claimed += entries.length
    await advanceEnrollments(settled.values())
    return { claimed: entries.length, completed }
  }

  // One drain per process at a time: a tick that lands while an earlier drain
  // is still working leaves the backlog to it.
  let draining = false

  return Object.freeze({
    async drain(): Promise<DrainReviewAnalysisBacklogResult> {
      if (draining) return NOTHING_DRAINED
      draining = true
      try {
        const startedAt = dependencies.nowEpochMillis()
        const counts: DrainCounts = { ...NOTHING_DRAINED }
        const parked = new Map<string, number>()
        let round: Readonly<{ claimed: number; completed: number }>
        do {
          round = await drainRound(parked, counts)
          // Stop once a round settles nothing: the backlog is empty, or every
          // lane it reached is busy or failing and has its retry time.
        } while (
          round.completed > 0 &&
          dependencies.nowEpochMillis() - startedAt < AI_BACKLOG_DRAIN_TIME_BUDGET_MILLIS
        )
        return counts
      } finally {
        draining = false
      }
    },

    /**
     * Analyse one waiting review now, ahead of the queue, on the interactive
     * lane with headroom left for reply drafts. A busy lane leaves the entry
     * queued with interactive priority, so the next drain takes it first.
     */
    async drainReview(
      input: Readonly<{
        organizationId: OrganizationId
        propertyId: PropertyId
        reviewId: ReviewId
      }>,
    ): Promise<RequestReviewAnalysisResult> {
      const entry = await dependencies.backlog.claimForReview({
        ...input,
        nowEpochMillis: dependencies.nowEpochMillis(),
        leaseMillis: AI_BACKLOG_CLAIM_LEASE_MILLIS,
      })
      if (entry === null) return { status: 'not_pending' }
      const outcome = await run(entry, 'interactive')
      if (outcome.kind === 'completed') {
        await advanceEnrollments([
          { organizationId: entry.organizationId, propertyId: entry.propertyId },
        ])
        return { status: 'completed' }
      }
      if (outcome.kind === 'failed') return { status: 'failed' }
      return { status: 'waiting', retryAtEpochMillis: outcome.retryAtEpochMillis }
    },
  })
}

export type DrainReviewAnalysisBacklog = ReturnType<
  typeof createDrainReviewAnalysisBacklog
>
