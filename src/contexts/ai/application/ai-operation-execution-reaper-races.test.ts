import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { AiOperationId } from '../domain/types'
import type { AiOperationRecoveryCandidate } from './ports/ai-operation-store.port'
import { createAiOperationExecutionReaper } from './ai-operation-execution-reaper'

const START = Date.parse('2026-11-02T02:00:00.000Z')
const DEADLINE = Date.parse('2026-11-02T02:15:00.000Z')
const analysis = {
  eventEnvelopeId: '79000000-0000-4000-8000-000000000002',
  organizationId: organizationId('ai-recovery-races'),
  propertyId: propertyId('79000000-0000-4000-8000-000000000003'),
  reviewId: reviewId('79000000-0000-4000-8000-000000000004'),
  sourceEpoch: 1,
  sourceRevision: 1,
  analysisSequence: 1,
  reviewAnalysisEpoch: 1,
  propertyProfileVersion: 1,
}

function candidate(
  state: 'pending' | 'executing' | 'succeeded_pending_delivery',
  resultStatus: 'ready' | 'missing' | 'unavailable' = 'ready',
): AiOperationRecoveryCandidate {
  const base = {
    operationId: '79000000-0000-4000-8000-000000000001' as AiOperationId,
    organizationId: analysis.organizationId,
    attempt: 1,
    createdAtEpochMillis: START,
    updatedAtEpochMillis: START,
  }
  return state === 'succeeded_pending_delivery'
    ? { ...base, state, failureCode: null, analysis: { ...analysis, resultStatus } }
    : {
        ...base,
        state,
        failureCode: state === 'pending' ? 'provider_rate_limited' : null,
        analysis,
      }
}

function harness(row: AiOperationRecoveryCandidate, now = DEADLINE) {
  const recordFailure = vi.fn(async () => true)
  const markDelivered = vi.fn(async () => true)
  const applyReviewAnalysis = vi.fn(async () => ({
    status: 'applied' as const,
    aggregateRevision: 1,
  }))
  const advanceWithoutAnalysis = vi.fn(async () => ({
    status: 'applied' as const,
    aggregateRevision: 1,
  }))
  const recordAnalysisReceipt = vi.fn(async () => undefined)
  const reap = createAiOperationExecutionReaper({
    store: {
      listExpiredExecutions: async () => ({ candidates: [row], unreadable: [] }),
      recordFailure,
      markDelivered,
    },
    aggregates: { applyReviewAnalysis, advanceWithoutAnalysis },
    recordAnalysisReceipt,
    nowEpochMillis: () => now,
  })
  return {
    reap,
    recordFailure,
    markDelivered,
    applyReviewAnalysis,
    advanceWithoutAnalysis,
    recordAnalysisReceipt,
  }
}

describe('AI recovery compare-and-set losses', () => {
  it.each(['pending', 'executing'] as const)(
    'does not settle or receipt a %s operation after losing its fence',
    async (state) => {
      const h = harness(candidate(state))
      h.recordFailure.mockResolvedValue(false)

      await expect(h.reap()).resolves.toMatchObject({
        operationsRaced: 1,
        operationsFenced: 0,
        operationsSettled: 0,
      })
      expect(h.recordFailure).toHaveBeenCalledOnce()
      expect(h.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(h.applyReviewAnalysis).not.toHaveBeenCalled()
      expect(h.recordAnalysisReceipt).not.toHaveBeenCalled()
      expect(h.markDelivered).not.toHaveBeenCalled()
    },
  )

  it.each(['missing', 'unavailable'] as const)(
    'does not advance a %s result after losing its delivery fence',
    async (resultStatus) => {
      const h = harness(candidate('succeeded_pending_delivery', resultStatus))
      h.recordFailure.mockResolvedValue(false)

      await expect(h.reap()).resolves.toMatchObject({
        operationsRaced: 1,
        operationsSettled: 0,
      })
      expect(h.recordFailure).toHaveBeenCalledOnce()
      expect(h.advanceWithoutAnalysis).not.toHaveBeenCalled()
      expect(h.recordAnalysisReceipt).not.toHaveBeenCalled()
    },
  )

  it('counts a lost mark-delivered CAS without fencing an already receipted result', async () => {
    const h = harness(candidate('succeeded_pending_delivery'))
    h.markDelivered.mockResolvedValue(false)

    await expect(h.reap()).resolves.toMatchObject({
      operationsRaced: 1,
      operationsDelivered: 0,
    })
    expect(h.applyReviewAnalysis).toHaveBeenCalledOnce()
    expect(h.recordAnalysisReceipt).toHaveBeenCalledExactlyOnceWith(
      analysis.eventEnvelopeId,
      'applied',
    )
    expect(h.recordFailure).not.toHaveBeenCalled()
    expect(h.advanceWithoutAnalysis).not.toHaveBeenCalled()
  })

  it.each(['pending', 'succeeded_pending_delivery'] as const)(
    'leaves %s alone at 02:14:59 and recovers it at 02:15:00',
    async (state) => {
      const before = harness(candidate(state), DEADLINE - 1_000)
      await expect(before.reap()).resolves.toMatchObject({
        operationsFenced: 0,
        operationsDelivered: 0,
        operationsSettled: 0,
      })
      expect(before.recordFailure).not.toHaveBeenCalled()
      expect(before.applyReviewAnalysis).not.toHaveBeenCalled()
      expect(before.recordAnalysisReceipt).not.toHaveBeenCalled()

      const at = harness(candidate(state))
      await expect(at.reap()).resolves.toMatchObject(
        state === 'pending'
          ? { operationsFenced: 1, operationsSettled: 1 }
          : { operationsDelivered: 1 },
      )
      expect(at.recordAnalysisReceipt).toHaveBeenCalledOnce()
    },
  )
})
