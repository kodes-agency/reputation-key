// AI operation — abandoned-owner reaper.
//
// Two durable states can lose their request owner:
//
//   - `executing`, after `claimExecution` but before its terminal write; the
//     provider may already have run, so recovery fails it as
//     `operation_ambiguous` and never retries it;
//   - Review Analysis `pending`, when a retryable provider response returned
//     the operation to `pending` but BullMQ exhausted the origin event's finite
//     dispatch budget before the 15-minute domain horizon.
//
// The latter freezes the strict property sequence unless recovery performs both
// halves of normal terminal delivery: fence the operation, then advance the
// no-result aggregate sequence and record the origin event's consumer receipt.
// A failed `operation_abandoned`/`operation_ambiguous` analysis remains
// selectable while that receipt is absent, so a crash between those halves is
// retried on the next tick. Sequence gaps stay unreceipted and retry later.
//
// Provider safety rests on one CAS. `claimExecution` can invoke the provider
// only after changing `pending` to `executing`; the reaper changes that same
// exact pending state/attempt/failure to `failed`. Whichever CAS wins excludes
// the other. The reaper itself has no inference dependency and can never issue
// a second billed call.

import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  settleReviewAnalysisWithoutResult,
} from './use-cases/analyze-review-event'
import type {
  AiOperationRecoveryCandidate,
  AiOperationStorePort,
} from './ports/ai-operation-store.port'
import type { AiPropertyAggregateStorePort } from './ports/ai-property-aggregate-store.port'
import type { AiReviewEventStorePort } from './ports/ai-review-event-store.port'

const AI_EXECUTION_REAPER_BATCH_SIZE = 100

/**
 * Shared bound for an open attempt and an operation waiting for redelivery.
 */
export const AI_EXECUTION_ABANDONED_AFTER_MILLIS = AI_ANALYSIS_OPERATION_HORIZON_MILLIS

type ExecutionReaperStore = Pick<
  AiOperationStorePort,
  'listExpiredExecutions' | 'recordFailure'
>

export type AiOperationExecutionReaperResult = Readonly<{
  /** Rows the bounded scan returned. */
  abandonedVisited: number
  /** Rows this run drove to `failed`. */
  operationsFenced: number
  /** Rows that settled under us between the scan and the write. */
  operationsRaced: number
  /** The scan filled its batch, so a backlog remains for the next tick. */
  batchFull: boolean
}>

export type AiOperationExecutionReaper = () => Promise<AiOperationExecutionReaperResult>

type DispositionCode = 'operation_abandoned' | 'operation_ambiguous'

type FenceResult =
  | Readonly<{ outcome: 'fenced'; dispositionCode: DispositionCode }>
  | Readonly<{ outcome: 'already_fenced'; dispositionCode: DispositionCode }>
  | Readonly<{ outcome: 'raced' }>
  | Readonly<{ outcome: 'skipped' }>

export function createAiOperationExecutionReaper(
  deps: Readonly<{
    store: ExecutionReaperStore
    reviewEvents: Pick<AiReviewEventStorePort, 'settleOutcome'>
    aggregates: Pick<AiPropertyAggregateStorePort, 'advanceWithoutAnalysis'>
    recordAnalysisReceipt: (
      eventEnvelopeId: string,
      status: 'applied' | 'obsolete',
    ) => Promise<void>
    nowEpochMillis: () => number
    limit?: number
  }>,
): AiOperationExecutionReaper {
  const limit = deps.limit ?? AI_EXECUTION_REAPER_BATCH_SIZE

  /**
   * Fence one candidate, or report why it was left alone. A `failed` candidate
   * was fenced by an earlier tick that then crashed before it could settle the
   * review-analysis side, so it needs no second fence - only its disposition.
   */
  async function fence(
    candidate: AiOperationRecoveryCandidate,
    nowEpochMillis: number,
    horizonDeadline: number,
  ): Promise<FenceResult> {
    if (candidate.state === 'failed') {
      return candidate.failureCode === 'operation_abandoned' ||
        candidate.failureCode === 'operation_ambiguous'
        ? { outcome: 'already_fenced', dispositionCode: candidate.failureCode }
        : { outcome: 'skipped' }
    }
    if (
      candidate.state === 'pending' &&
      candidate.createdAtEpochMillis > horizonDeadline
    ) {
      return { outcome: 'skipped' }
    }
    // The CAS is state-specific: a pending row is fenced against its recorded
    // failure, an executing row against no failure at all, so the two shapes
    // cannot be flattened into one object.
    const expected =
      candidate.state === 'pending'
        ? {
            expectedState: 'pending' as const,
            expectedFailureCode: candidate.failureCode,
          }
        : { expectedState: 'executing' as const, expectedFailureCode: null }
    const pending = candidate.state === 'pending'
    const fenced = await deps.store.recordFailure({
      operationId: candidate.operationId,
      organizationId: candidate.organizationId,
      expectedAttempt: candidate.attempt,
      ...expected,
      failureCode: pending ? 'operation_abandoned' : 'operation_ambiguous',
      retryAtEpochMillis: null,
      failedAtEpochMillis: nowEpochMillis,
    })
    return fenced
      ? {
          outcome: 'fenced',
          dispositionCode: pending ? 'operation_abandoned' : 'operation_ambiguous',
        }
      : { outcome: 'raced' }
  }

  /** Advance the strict per-property analysis sequence the fenced operation held. */
  async function settleAnalysis(
    candidate: AiOperationRecoveryCandidate,
    dispositionCode: DispositionCode,
  ): Promise<void> {
    if (candidate.analysis === null) return
    const { eventEnvelopeId, ...analysis } = candidate.analysis
    const settled = await settleReviewAnalysisWithoutResult(
      { reviewEvents: deps.reviewEvents, aggregates: deps.aggregates },
      { ...analysis, operationId: candidate.operationId, dispositionCode },
    )
    if (settled.status === 'gap') return
    await deps.recordAnalysisReceipt(
      eventEnvelopeId,
      settled.status === 'generation_changed' ? 'obsolete' : 'applied',
    )
  }

  return async () => {
    const nowEpochMillis = deps.nowEpochMillis()
    const horizonDeadline = nowEpochMillis - AI_EXECUTION_ABANDONED_AFTER_MILLIS
    const abandoned = await deps.store.listExpiredExecutions({
      nowEpochMillis,
      executionHorizonMillis: AI_EXECUTION_ABANDONED_AFTER_MILLIS,
      limit,
    })
    let operationsFenced = 0
    let operationsRaced = 0

    for (const candidate of abandoned) {
      const result = await fence(candidate, nowEpochMillis, horizonDeadline)
      if (result.outcome === 'skipped') continue
      if (result.outcome === 'raced') {
        operationsRaced += 1
        continue
      }
      if (result.outcome === 'fenced') operationsFenced += 1
      await settleAnalysis(candidate, result.dispositionCode)
    }

    return Object.freeze({
      abandonedVisited: abandoned.length,
      operationsFenced,
      operationsRaced,
      batchFull: abandoned.length >= limit,
    })
  }
}
