import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { AiOperationStorePort } from './ports/ai-operation-store.port'
import type { AiOperationId } from '../domain/types'
import {
  AI_EXECUTION_ABANDONED_AFTER_MILLIS,
  createAiOperationExecutionReaper,
} from './ai-operation-execution-reaper'

const NOW = Date.parse('2026-09-08T18:30:00.000Z')
const ORGANIZATION_ID = organizationId('ai-operation-reaper-test')
const PROPERTY_ID = propertyId('79000000-0000-4000-8000-000000000001')
const EVENT_ID = '79000000-0000-4000-8000-000000000002'
const REVIEW_ID = reviewId('79000000-0000-4000-8000-000000000005')
const OVERDUE_OPERATION_ID = '79000000-0000-4000-8000-000000000003' as AiOperationId
const FRESH_OPERATION_ID = '79000000-0000-4000-8000-000000000004' as AiOperationId
const STALE_OPERATION_ID = '79000000-0000-4000-8000-000000000007' as AiOperationId
const STALE_EVENT_ID = '79000000-0000-4000-8000-000000000008'

function pendingCandidate(operationId: AiOperationId, createdAtEpochMillis: number) {
  return {
    operationId,
    organizationId: ORGANIZATION_ID,
    attempt: 1,
    state: 'pending' as const,
    failureCode: 'provider_rate_limited' as const,
    createdAtEpochMillis,
    updatedAtEpochMillis: createdAtEpochMillis,
    analysis: {
      eventEnvelopeId: EVENT_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      analysisSequence: 18,
      reviewId: REVIEW_ID,
      sourceRevision: 1,
      reviewAnalysisEpoch: 3,
      propertyProfileVersion: 4,
    },
  }
}

function deliveryCandidate(
  operationId: AiOperationId,
  eventEnvelopeId: string,
  createdAtEpochMillis: number,
  resultStatus: 'ready' | 'unavailable' | 'missing',
) {
  return {
    operationId,
    organizationId: ORGANIZATION_ID,
    attempt: 1,
    state: 'succeeded_pending_delivery' as const,
    failureCode: null,
    createdAtEpochMillis,
    updatedAtEpochMillis: createdAtEpochMillis,
    analysis: {
      eventEnvelopeId,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 1,
      analysisSequence: 18,
      reviewAnalysisEpoch: 3,
      propertyProfileVersion: 4,
      resultStatus,
    },
  }
}

describe('AI operation execution reaper', () => {
  it('terminal-settles an abandoned pending analysis but leaves an in-horizon retry alone', async () => {
    const overdue = pendingCandidate(
      OVERDUE_OPERATION_ID,
      NOW - AI_EXECUTION_ABANDONED_AFTER_MILLIS,
    )
    const fresh = pendingCandidate(
      FRESH_OPERATION_ID,
      NOW - AI_EXECUTION_ABANDONED_AFTER_MILLIS + 1,
    )
    const listExpiredExecutions = vi.fn<AiOperationStorePort['listExpiredExecutions']>(
      async () => [overdue, fresh],
    )
    const recordFailure = vi.fn<AiOperationStorePort['recordFailure']>(async () => true)
    const markDelivered = vi.fn<AiOperationStorePort['markDelivered']>(async () => true)
    const settleOutcome = vi.fn(async () => ({
      terminalAnalysisSequence: 18,
      aggregateRevision: 17,
    }))
    const advanceWithoutAnalysis = vi.fn(async () => ({
      status: 'applied' as const,
      aggregateRevision: 18,
    }))
    const applyReviewAnalysis = vi.fn()
    const recordAnalysisReceipt = vi.fn(async () => undefined)
    const dependencies = {
      store: { listExpiredExecutions, recordFailure, markDelivered },
      reviewEvents: { settleOutcome },
      aggregates: { advanceWithoutAnalysis, applyReviewAnalysis },
      recordAnalysisReceipt,
      nowEpochMillis: () => NOW,
    }

    await createAiOperationExecutionReaper(dependencies)()

    expect(recordFailure).toHaveBeenCalledOnce()
    expect(recordFailure).toHaveBeenCalledWith({
      operationId: OVERDUE_OPERATION_ID,
      organizationId: ORGANIZATION_ID,
      expectedAttempt: 1,
      expectedState: 'pending',
      expectedFailureCode: 'provider_rate_limited',
      failureCode: 'operation_abandoned',
      retryAtEpochMillis: null,
      failedAtEpochMillis: NOW,
    })
    expect(settleOutcome).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 3,
      analysisSequence: 18,
      state: 'terminal_no_result',
      operationId: OVERDUE_OPERATION_ID,
      dispositionCode: 'operation_abandoned',
    })
    expect(advanceWithoutAnalysis).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 3,
      analysisSequence: 18,
      propertyProfileVersion: 4,
      dispositionCode: 'operation_abandoned',
    })
    expect(recordAnalysisReceipt).toHaveBeenCalledWith(EVENT_ID, 'applied')
    expect(recordFailure).not.toHaveBeenCalledWith(
      expect.objectContaining({ operationId: FRESH_OPERATION_ID }),
    )
    expect(markDelivered).not.toHaveBeenCalled()
    expect(applyReviewAnalysis).not.toHaveBeenCalled()
  })

  it('delivers a current persisted analysis, obsoletes a stale one, and leaves an in-horizon delivery alone', async () => {
    const overdue = deliveryCandidate(
      OVERDUE_OPERATION_ID,
      EVENT_ID,
      NOW - AI_EXECUTION_ABANDONED_AFTER_MILLIS,
      'ready',
    )
    const fresh = deliveryCandidate(
      FRESH_OPERATION_ID,
      '79000000-0000-4000-8000-000000000006',
      NOW - AI_EXECUTION_ABANDONED_AFTER_MILLIS + 1,
      'ready',
    )
    const stale = deliveryCandidate(
      STALE_OPERATION_ID,
      STALE_EVENT_ID,
      NOW - AI_EXECUTION_ABANDONED_AFTER_MILLIS,
      'ready',
    )
    const listExpiredExecutions = vi.fn<
      AiOperationStorePort['listExpiredExecutions']
    >(async () => [overdue, stale, fresh])
    const recordFailure = vi.fn<AiOperationStorePort['recordFailure']>(async () => true)
    const markDelivered = vi.fn<AiOperationStorePort['markDelivered']>(async () => true)
    const settleOutcome = vi.fn(async () => ({
      terminalAnalysisSequence: 18,
      aggregateRevision: 17,
    }))
    const applyReviewAnalysis = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'applied' as const,
        aggregateRevision: 18,
      })
      .mockResolvedValueOnce({ status: 'stale' as const })
    const advanceWithoutAnalysis = vi.fn()
    const recordAnalysisReceipt = vi.fn(async () => undefined)

    const outcome = await createAiOperationExecutionReaper({
      store: { listExpiredExecutions, recordFailure, markDelivered },
      reviewEvents: { settleOutcome },
      aggregates: { applyReviewAnalysis, advanceWithoutAnalysis },
      recordAnalysisReceipt,
      nowEpochMillis: () => NOW,
    })()

    expect(settleOutcome).toHaveBeenCalledTimes(2)
    expect(settleOutcome).toHaveBeenNthCalledWith(1, {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 3,
      analysisSequence: 18,
      state: 'ready',
      operationId: OVERDUE_OPERATION_ID,
      dispositionCode: null,
    })
    expect(settleOutcome).toHaveBeenNthCalledWith(2, {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 3,
      analysisSequence: 18,
      state: 'ready',
      operationId: STALE_OPERATION_ID,
      dispositionCode: null,
    })
    expect(applyReviewAnalysis).toHaveBeenCalledTimes(2)
    expect(applyReviewAnalysis).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 1,
      analysisSequence: 18,
      reviewAnalysisEpoch: 3,
      propertyProfileVersion: 4,
      calendarProfileVersion: 'property-calendar-v1',
    })
    expect(recordAnalysisReceipt).toHaveBeenCalledTimes(2)
    expect(recordAnalysisReceipt).toHaveBeenCalledWith(EVENT_ID, 'applied')
    expect(recordAnalysisReceipt).toHaveBeenCalledWith(STALE_EVENT_ID, 'obsolete')
    expect(markDelivered).toHaveBeenCalledOnce()
    expect(markDelivered).toHaveBeenCalledWith({
      operationId: OVERDUE_OPERATION_ID,
      organizationId: ORGANIZATION_ID,
      expectedAttempt: 1,
      deliveredAtEpochMillis: NOW,
    })
    expect(recordFailure).toHaveBeenCalledOnce()
    expect(recordFailure).toHaveBeenCalledWith({
      operationId: STALE_OPERATION_ID,
      organizationId: ORGANIZATION_ID,
      expectedAttempt: 1,
      expectedState: 'succeeded_pending_delivery',
      expectedFailureCode: null,
      failureCode: 'completed_without_delivery',
      retryAtEpochMillis: null,
      failedAtEpochMillis: NOW,
    })
    expect(markDelivered).not.toHaveBeenCalledWith(
      expect.objectContaining({ operationId: FRESH_OPERATION_ID }),
    )
    expect(outcome).toEqual({
      recoveryCandidatesVisited: 3,
      operationsFenced: 1,
      operationsDelivered: 1,
      operationsSettled: 1,
      operationsRaced: 0,
      batchFull: false,
    })
  })

  it('terminal-settles an analysis whose completed operation has no persisted result', async () => {
    const missing = deliveryCandidate(
      OVERDUE_OPERATION_ID,
      EVENT_ID,
      NOW - AI_EXECUTION_ABANDONED_AFTER_MILLIS,
      'missing',
    )
    const listExpiredExecutions = vi.fn<
      AiOperationStorePort['listExpiredExecutions']
    >(async () => [missing])
    const recordFailure = vi.fn<AiOperationStorePort['recordFailure']>(async () => true)
    const markDelivered = vi.fn<AiOperationStorePort['markDelivered']>(async () => true)
    const settleOutcome = vi.fn(async () => ({
      terminalAnalysisSequence: 18,
      aggregateRevision: 17,
    }))
    const applyReviewAnalysis = vi.fn()
    const advanceWithoutAnalysis = vi.fn(async () => ({
      status: 'applied' as const,
      aggregateRevision: 18,
    }))
    const recordAnalysisReceipt = vi.fn(async () => undefined)

    const outcome = await createAiOperationExecutionReaper({
      store: { listExpiredExecutions, recordFailure, markDelivered },
      reviewEvents: { settleOutcome },
      aggregates: { applyReviewAnalysis, advanceWithoutAnalysis },
      recordAnalysisReceipt,
      nowEpochMillis: () => NOW,
    })()

    expect(recordFailure).toHaveBeenCalledWith({
      operationId: OVERDUE_OPERATION_ID,
      organizationId: ORGANIZATION_ID,
      expectedAttempt: 1,
      expectedState: 'succeeded_pending_delivery',
      expectedFailureCode: null,
      failureCode: 'operation_ambiguous',
      retryAtEpochMillis: null,
      failedAtEpochMillis: NOW,
    })
    expect(settleOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'terminal_no_result',
        operationId: OVERDUE_OPERATION_ID,
        dispositionCode: 'operation_ambiguous',
      }),
    )
    expect(advanceWithoutAnalysis).toHaveBeenCalledOnce()
    expect(applyReviewAnalysis).not.toHaveBeenCalled()
    expect(markDelivered).not.toHaveBeenCalled()
    expect(recordAnalysisReceipt).toHaveBeenCalledWith(EVENT_ID, 'applied')
    expect(outcome).toEqual({
      recoveryCandidatesVisited: 1,
      operationsFenced: 1,
      operationsDelivered: 0,
      operationsSettled: 1,
      operationsRaced: 0,
      batchFull: false,
    })
  })
})
