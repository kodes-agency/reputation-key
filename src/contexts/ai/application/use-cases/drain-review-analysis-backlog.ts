import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import {
  AI_ADMISSION_RATE_PER_MINUTE,
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
/** Entries claimed per tick across all properties. */
const AI_BACKLOG_DRAIN_LIMIT = 24
/** Properties drained at once; entries of one property run one after another. */
const AI_BACKLOG_DRAIN_CONCURRENCY = 4
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

export type DrainReviewAnalysisBacklogDependencies = Readonly<{
  backlog: AiReviewAnalysisBacklogPort
  analyzeReviewEvent: (
    input: AnalyzeReviewEventInput,
  ) => Promise<AnalyzeReviewEventResult>
  nowEpochMillis: () => number
}>

type EntryOutcome =
  | Readonly<{ kind: 'completed' }>
  | Readonly<{ kind: 'rescheduled'; retryAtEpochMillis: number }>
  | Readonly<{ kind: 'busy'; retryAtEpochMillis: number }>
  | Readonly<{ kind: 'failed' }>

function groupByProperty(
  entries: ReadonlyArray<AiReviewAnalysisBacklogEntry>,
): ReadonlyArray<ReadonlyArray<AiReviewAnalysisBacklogEntry>> {
  const groups = new Map<string, AiReviewAnalysisBacklogEntry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.propertyId) ?? []
    group.push(entry)
    groups.set(entry.propertyId, group)
  }
  return [...groups.values()]
}

async function inBatches<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += concurrency) {
    await Promise.all(items.slice(index, index + concurrency).map(run))
  }
}

/**
 * Drain Review Analysis waiting in the backlog (ADR 0058). Each tick claims a
 * bounded, per-property share of the newest waiting reviews and runs them
 * through the ordinary analysis use case in their lane. A busy lane returns
 * the property's remaining entries to the queue at the lane's retry time
 * without asking again; any settled outcome removes the entry.
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
    } catch {
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

  return Object.freeze({
    async drain(): Promise<DrainReviewAnalysisBacklogResult> {
      const entries = await dependencies.backlog.claimReady({
        nowEpochMillis: dependencies.nowEpochMillis(),
        leaseMillis: AI_BACKLOG_CLAIM_LEASE_MILLIS,
        perProperty: AI_ADMISSION_RATE_PER_MINUTE.property.background,
        limit: AI_BACKLOG_DRAIN_LIMIT,
      })
      const counts = { completed: 0, rescheduled: 0, waitingForLane: 0, failed: 0 }
      await inBatches(
        groupByProperty(entries),
        AI_BACKLOG_DRAIN_CONCURRENCY,
        async (group) => {
          for (const [index, entry] of group.entries()) {
            const outcome = await run(entry, entry.priority)
            if (outcome.kind === 'completed') counts.completed += 1
            else if (outcome.kind === 'rescheduled') counts.rescheduled += 1
            else if (outcome.kind === 'failed') counts.failed += 1
            else {
              // The lane is full for this property: park the rest of its share
              // at the lane's retry time instead of asking again.
              counts.waitingForLane += group.length - index
              const now = dependencies.nowEpochMillis()
              for (const rest of group.slice(index + 1)) {
                await dependencies.backlog.reschedule({
                  eventEnvelopeId: rest.eventEnvelopeId,
                  organizationId: rest.organizationId,
                  nextAttemptAtEpochMillis: outcome.retryAtEpochMillis,
                  nowEpochMillis: now,
                })
              }
              return
            }
          }
        },
      )
      return { claimed: entries.length, ...counts }
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
      if (outcome.kind === 'completed') return { status: 'completed' }
      if (outcome.kind === 'failed') return { status: 'failed' }
      return { status: 'waiting', retryAtEpochMillis: outcome.retryAtEpochMillis }
    },
  })
}

export type DrainReviewAnalysisBacklog = ReturnType<
  typeof createDrainReviewAnalysisBacklog
>
