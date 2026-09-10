// AI operation — abandoned-owner and delivery reaper.
//
// Three durable states can lose their request owner:
//
//   - `executing`, after `claimExecution` but before its terminal write; the
//     provider may already have run, so recovery fails it as
//     `operation_ambiguous` and never retries it;
//   - Review Analysis `pending`, when a retryable provider response returned
//     the operation to `pending` but BullMQ exhausted the origin event's finite
//     dispatch budget before the 15-minute domain horizon;
//   - Review Analysis `failed`, when its terminal write committed before the
//     separate no-result settlement and consumer receipt;
//   - Review Analysis `succeeded_pending_delivery`, after its result transaction
//     committed but before aggregate delivery and the consumer receipt.
// Recovery performs both halves of terminal delivery: settle the analysis
// event, then record the origin event's consumer receipt. A
// reaper-failed analysis remains selectable while that receipt is absent.
// A completed analysis remains selectable until `markDelivered` wins, even if
// its receipt was written first, so either crash window is retried next tick.
//
// Provider safety rests on exact state-and-attempt CAS writes. `claimExecution`
// can invoke the provider only after changing `pending` to `executing`; the
// reaper never changes an operation into an executable state and has no
// inference dependency, so it cannot issue a second billed call.

import {
  AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
  settleReviewAnalysisWithoutResult,
  settleReviewAnalysisWithResult,
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
  'listExpiredExecutions' | 'markDelivered' | 'recordFailure'
>

export type AiOperationExecutionReaperResult = Readonly<{
  /** Rows the bounded recovery scan returned. */
  recoveryCandidatesVisited: number
  /** Rows this run drove to `failed`. */
  operationsFenced: number
  /** Persisted results this run drove to `succeeded`. */
  operationsDelivered: number
  /** Failed or obsolete outcomes whose aggregate sequence and receipt settled. */
  operationsSettled: number
  /** Rows that reached a different terminal state before this run's CAS. */
  operationsRaced: number
  /** The scan filled its batch, so a backlog remains for the next tick. */
  batchFull: boolean
}>

export type AiOperationExecutionReaper = () => Promise<AiOperationExecutionReaperResult>

type StandardRecoveryCandidate = Exclude<
  AiOperationRecoveryCandidate,
  Readonly<{ state: 'succeeded_pending_delivery' }>
>

type DispositionCode =
  'language_not_supported' | 'operation_abandoned' | 'operation_ambiguous'

type FenceResult =
  | Readonly<{ outcome: 'fenced'; dispositionCode: DispositionCode }>
  | Readonly<{ outcome: 'already_fenced'; dispositionCode: DispositionCode }>
  | Readonly<{ outcome: 'raced' }>
  | Readonly<{ outcome: 'skipped' }>

type DeliveryRecoveryCandidate = Extract<
  AiOperationRecoveryCandidate,
  Readonly<{ state: 'succeeded_pending_delivery' }>
>

type DeliveryDispositionCode = Exclude<DispositionCode, 'operation_abandoned'>

type DeliveryFailureCode = 'completed_without_delivery' | DeliveryDispositionCode

type RecoveryResult =
  | Readonly<{ outcome: 'delivered' }>
  | Readonly<{ outcome: 'fenced'; settled: boolean }>
  | Readonly<{ outcome: 'raced' }>
  | Readonly<{ outcome: 'settled' }>
  | Readonly<{ outcome: 'skipped' }>

type RecoveryCounts = {
  operationsFenced: number
  operationsDelivered: number
  operationsSettled: number
  operationsRaced: number
}

function countRecoveryResult(counts: RecoveryCounts, result: RecoveryResult): void {
  switch (result.outcome) {
    case 'delivered':
      counts.operationsDelivered += 1
      return
    case 'fenced':
      counts.operationsFenced += 1
      if (result.settled) counts.operationsSettled += 1
      return
    case 'raced':
      counts.operationsRaced += 1
      return
    case 'settled':
      counts.operationsSettled += 1
      return
    case 'skipped':
      return
  }
}

export function createAiOperationExecutionReaper(
  deps: Readonly<{
    store: ExecutionReaperStore
    reviewEvents: Pick<AiReviewEventStorePort, 'settleOutcome'>
    aggregates: Pick<
      AiPropertyAggregateStorePort,
      'advanceWithoutAnalysis' | 'applyReviewAnalysis'
    >
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
    candidate: StandardRecoveryCandidate,
    nowEpochMillis: number,
    horizonDeadline: number,
  ): Promise<FenceResult> {
    if (candidate.state === 'failed') {
      const dispositionCode: DispositionCode =
        candidate.failureCode === 'language_not_supported' ||
        candidate.failureCode === 'operation_abandoned' ||
        candidate.failureCode === 'operation_ambiguous'
          ? candidate.failureCode
          : 'operation_ambiguous'
      return { outcome: 'already_fenced', dispositionCode }
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

  /** Settle the fenced operation's per-review analysis event. */
  async function settleAnalysis(
    candidate: StandardRecoveryCandidate,
    dispositionCode: DispositionCode,
  ): Promise<boolean> {
    if (candidate.analysis === null) return false
    const { eventEnvelopeId, ...analysis } = candidate.analysis
    const settled = await settleReviewAnalysisWithoutResult(
      { reviewEvents: deps.reviewEvents, aggregates: deps.aggregates },
      { ...analysis, operationId: candidate.operationId, dispositionCode },
    )
    await deps.recordAnalysisReceipt(
      eventEnvelopeId,
      settled.status === 'generation_changed' ? 'obsolete' : 'applied',
    )
    return true
  }

  // Delivery recovery has different CAS and crash windows from owner fencing.
  // Keep ready-result delivery and no-result settlement in focused helpers so
  // each durable transition remains explicit.
  async function fenceCompletedDelivery(
    candidate: DeliveryRecoveryCandidate,
    failureCode: DeliveryFailureCode,
    nowEpochMillis: number,
  ): Promise<boolean> {
    return deps.store.recordFailure({
      operationId: candidate.operationId,
      organizationId: candidate.organizationId,
      expectedAttempt: candidate.attempt,
      expectedState: 'succeeded_pending_delivery',
      expectedFailureCode: null,
      failureCode,
      retryAtEpochMillis: null,
      failedAtEpochMillis: nowEpochMillis,
    })
  }

  async function settleDeliveryWithoutResult(
    candidate: DeliveryRecoveryCandidate,
    dispositionCode: DeliveryDispositionCode,
  ): Promise<boolean> {
    const {
      eventEnvelopeId,
      resultStatus: _resultStatus,
      ...analysis
    } = candidate.analysis
    const settled = await settleReviewAnalysisWithoutResult(
      { reviewEvents: deps.reviewEvents, aggregates: deps.aggregates },
      { ...analysis, operationId: candidate.operationId, dispositionCode },
    )
    await deps.recordAnalysisReceipt(
      eventEnvelopeId,
      settled.status === 'generation_changed' ? 'obsolete' : 'applied',
    )
    return true
  }

  async function deliverReadyAnalysis(
    candidate: DeliveryRecoveryCandidate,
    nowEpochMillis: number,
  ): Promise<RecoveryResult> {
    const {
      eventEnvelopeId,
      resultStatus: _resultStatus,
      ...analysis
    } = candidate.analysis
    const settled = await settleReviewAnalysisWithResult(
      { reviewEvents: deps.reviewEvents, aggregates: deps.aggregates },
      { ...analysis, operationId: candidate.operationId },
    )
    if (settled.status === 'generation_changed') {
      const fenced = await fenceCompletedDelivery(
        candidate,
        'completed_without_delivery',
        nowEpochMillis,
      )
      if (!fenced) return { outcome: 'raced' }
      const recovered = await settleDeliveryWithoutResult(
        candidate,
        'operation_ambiguous',
      )
      return { outcome: 'fenced', settled: recovered }
    }

    // Receipt first is crash-safe because this state cannot invoke the
    // provider. The row remains a candidate until markDelivered wins.
    await deps.recordAnalysisReceipt(eventEnvelopeId, 'applied')
    const delivered = await deps.store.markDelivered({
      operationId: candidate.operationId,
      organizationId: candidate.organizationId,
      expectedAttempt: candidate.attempt,
      deliveredAtEpochMillis: nowEpochMillis,
    })
    return delivered ? { outcome: 'delivered' } : { outcome: 'raced' }
  }

  async function recoverAnalysisWithoutResult(
    candidate: DeliveryRecoveryCandidate,
    dispositionCode: DeliveryDispositionCode,
    nowEpochMillis: number,
  ): Promise<RecoveryResult> {
    const fenced = await fenceCompletedDelivery(
      candidate,
      dispositionCode,
      nowEpochMillis,
    )
    if (!fenced) return { outcome: 'raced' }
    const settled = await settleDeliveryWithoutResult(candidate, dispositionCode)
    return { outcome: 'fenced', settled }
  }

  async function recoverDelivery(
    candidate: DeliveryRecoveryCandidate,
    nowEpochMillis: number,
    horizonDeadline: number,
  ): Promise<RecoveryResult> {
    if (candidate.createdAtEpochMillis > horizonDeadline) {
      return { outcome: 'skipped' }
    }
    if (candidate.analysis.resultStatus === 'ready') {
      return deliverReadyAnalysis(candidate, nowEpochMillis)
    }
    const dispositionCode: DeliveryDispositionCode =
      candidate.analysis.resultStatus === 'unavailable'
        ? 'language_not_supported'
        : 'operation_ambiguous'
    return recoverAnalysisWithoutResult(candidate, dispositionCode, nowEpochMillis)
  }

  async function recoverStandardCandidate(
    candidate: StandardRecoveryCandidate,
    nowEpochMillis: number,
    horizonDeadline: number,
  ): Promise<RecoveryResult> {
    if (
      candidate.state === 'failed' &&
      candidate.failureCode === 'completed_without_delivery'
    ) {
      const settled = await settleAnalysis(candidate, 'operation_ambiguous')
      return settled ? { outcome: 'settled' } : { outcome: 'skipped' }
    }

    const result = await fence(candidate, nowEpochMillis, horizonDeadline)
    if (result.outcome === 'skipped' || result.outcome === 'raced') return result
    const settled = await settleAnalysis(candidate, result.dispositionCode)
    if (result.outcome === 'fenced') return { outcome: 'fenced', settled }
    return settled ? { outcome: 'settled' } : { outcome: 'skipped' }
  }

  return async () => {
    const nowEpochMillis = deps.nowEpochMillis()
    const horizonDeadline = nowEpochMillis - AI_EXECUTION_ABANDONED_AFTER_MILLIS
    const candidates = await deps.store.listExpiredExecutions({
      nowEpochMillis,
      executionHorizonMillis: AI_EXECUTION_ABANDONED_AFTER_MILLIS,
      limit,
    })
    const counts: RecoveryCounts = {
      operationsFenced: 0,
      operationsDelivered: 0,
      operationsSettled: 0,
      operationsRaced: 0,
    }

    for (const candidate of candidates) {
      const result =
        candidate.state === 'succeeded_pending_delivery'
          ? await recoverDelivery(candidate, nowEpochMillis, horizonDeadline)
          : await recoverStandardCandidate(candidate, nowEpochMillis, horizonDeadline)
      countRecoveryResult(counts, result)
    }

    return Object.freeze({
      recoveryCandidatesVisited: candidates.length,
      operationsFenced: counts.operationsFenced,
      operationsDelivered: counts.operationsDelivered,
      operationsSettled: counts.operationsSettled,
      operationsRaced: counts.operationsRaced,
      batchFull: candidates.length >= limit,
    })
  }
}
