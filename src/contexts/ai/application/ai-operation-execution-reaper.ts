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
//   - Review Analysis `succeeded_pending_delivery`, after its result transaction
//     committed but before strict aggregate delivery and the consumer receipt.
//
// Recovery performs both halves of terminal delivery: settle the strict
// property sequence, then record the origin event's consumer receipt. A
// reaper-failed analysis remains selectable while that receipt is absent.
// A completed analysis remains selectable until `markDelivered` wins, even if
// its receipt was written first, so either crash window is retried next tick.
// Sequence gaps stay unreceipted and retry later.
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
  | 'language_not_supported'
  | 'operation_abandoned'
  | 'operation_ambiguous'

type FenceResult =
  | Readonly<{ outcome: 'fenced'; dispositionCode: DispositionCode }>
  | Readonly<{ outcome: 'already_fenced'; dispositionCode: DispositionCode }>
  | Readonly<{ outcome: 'raced' }>
  | Readonly<{ outcome: 'skipped' }>

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
      return candidate.failureCode === 'language_not_supported' ||
        candidate.failureCode === 'operation_abandoned' ||
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
    candidate: StandardRecoveryCandidate,
    dispositionCode: DispositionCode,
  ): Promise<boolean> {
    if (candidate.analysis === null) return false
    const { eventEnvelopeId, ...analysis } = candidate.analysis
    const settled = await settleReviewAnalysisWithoutResult(
      { reviewEvents: deps.reviewEvents, aggregates: deps.aggregates },
      { ...analysis, operationId: candidate.operationId, dispositionCode },
    )
    if (settled.status === 'gap') return false
    await deps.recordAnalysisReceipt(
      eventEnvelopeId,
      settled.status === 'generation_changed' ? 'obsolete' : 'applied',
    )
    return true
  }

  return async () => {
    const nowEpochMillis = deps.nowEpochMillis()
    const horizonDeadline = nowEpochMillis - AI_EXECUTION_ABANDONED_AFTER_MILLIS
    const candidates = await deps.store.listExpiredExecutions({
      nowEpochMillis,
      executionHorizonMillis: AI_EXECUTION_ABANDONED_AFTER_MILLIS,
      limit,
    })
    let operationsFenced = 0
    let operationsDelivered = 0
    let operationsSettled = 0
    let operationsRaced = 0

    for (const candidate of candidates) {
      if (candidate.state === 'succeeded_pending_delivery') {
        if (candidate.createdAtEpochMillis > horizonDeadline) continue
        const { eventEnvelopeId, resultStatus, ...analysis } = candidate.analysis
        if (resultStatus === 'ready') {
          const settled = await settleReviewAnalysisWithResult(
            { reviewEvents: deps.reviewEvents, aggregates: deps.aggregates },
            { ...analysis, operationId: candidate.operationId },
          )
          if (settled.status === 'gap') continue
          if (settled.status === 'generation_changed') {
            const fenced = await deps.store.recordFailure({
              operationId: candidate.operationId,
              organizationId: candidate.organizationId,
              expectedAttempt: candidate.attempt,
              expectedState: 'succeeded_pending_delivery',
              expectedFailureCode: null,
              failureCode: 'completed_without_delivery',
              retryAtEpochMillis: null,
              failedAtEpochMillis: nowEpochMillis,
            })
            if (!fenced) {
              operationsRaced += 1
              continue
            }
            operationsFenced += 1
            await deps.recordAnalysisReceipt(eventEnvelopeId, 'obsolete')
            operationsSettled += 1
            continue
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
          if (delivered) operationsDelivered += 1
          else operationsRaced += 1
          continue
        }

        const dispositionCode =
          resultStatus === 'unavailable'
            ? ('language_not_supported' as const)
            : ('operation_ambiguous' as const)
        const fenced = await deps.store.recordFailure({
          operationId: candidate.operationId,
          organizationId: candidate.organizationId,
          expectedAttempt: candidate.attempt,
          expectedState: 'succeeded_pending_delivery',
          expectedFailureCode: null,
          failureCode: dispositionCode,
          retryAtEpochMillis: null,
          failedAtEpochMillis: nowEpochMillis,
        })
        if (!fenced) {
          operationsRaced += 1
          continue
        }
        operationsFenced += 1
        const settled = await settleReviewAnalysisWithoutResult(
          { reviewEvents: deps.reviewEvents, aggregates: deps.aggregates },
          { ...analysis, operationId: candidate.operationId, dispositionCode },
        )
        if (settled.status === 'gap') continue
        await deps.recordAnalysisReceipt(
          eventEnvelopeId,
          settled.status === 'generation_changed' ? 'obsolete' : 'applied',
        )
        operationsSettled += 1
        continue
      }

      if (
        candidate.state === 'failed' &&
        candidate.failureCode === 'completed_without_delivery'
      ) {
        if (candidate.analysis === null) continue
        await deps.recordAnalysisReceipt(candidate.analysis.eventEnvelopeId, 'obsolete')
        operationsSettled += 1
        continue
      }

      const result = await fence(candidate, nowEpochMillis, horizonDeadline)
      if (result.outcome === 'skipped') continue
      if (result.outcome === 'raced') {
        operationsRaced += 1
        continue
      }
      if (result.outcome === 'fenced') operationsFenced += 1
      if (await settleAnalysis(candidate, result.dispositionCode)) {
        operationsSettled += 1
      }
    }

    return Object.freeze({
      recoveryCandidatesVisited: candidates.length,
      operationsFenced,
      operationsDelivered,
      operationsSettled,
      operationsRaced,
      batchFull: candidates.length >= limit,
    })
  }
}
