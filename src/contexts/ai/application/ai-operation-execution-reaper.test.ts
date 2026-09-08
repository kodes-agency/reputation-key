import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
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
const OVERDUE_OPERATION_ID =
  '79000000-0000-4000-8000-000000000003' as AiOperationId
const FRESH_OPERATION_ID =
  '79000000-0000-4000-8000-000000000004' as AiOperationId

function pendingCandidate(
  operationId: AiOperationId,
  createdAtEpochMillis: number,
) {
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
      reviewAnalysisEpoch: 3,
      propertyProfileVersion: 4,
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
    const listExpiredExecutions = vi.fn<
      AiOperationStorePort['listExpiredExecutions']
    >(async () => [overdue, fresh])
    const recordFailure = vi.fn<AiOperationStorePort['recordFailure']>(async () => true)
    const settleOutcome = vi.fn(async () => ({
      terminalAnalysisSequence: 18,
      aggregateRevision: 17,
    }))
    const advanceWithoutAnalysis = vi.fn(async () => ({
      status: 'applied' as const,
      aggregateRevision: 18,
    }))
    const recordAnalysisReceipt = vi.fn(async () => undefined)
    const dependencies = {
      store: { listExpiredExecutions, recordFailure },
      reviewEvents: { settleOutcome },
      aggregates: { advanceWithoutAnalysis },
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
  })
})
