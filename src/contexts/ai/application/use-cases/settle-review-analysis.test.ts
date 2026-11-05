import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  settleReviewAnalysisWithoutResult,
  settleReviewAnalysisWithResult,
} from './analyze-review-event'

const input = {
  organizationId: organizationId('settlement-test'),
  propertyId: propertyId('71000000-0000-4000-8000-000000000001'),
  reviewId: reviewId('71000000-0000-4000-8000-000000000002'),
  sourceEpoch: 2,
  reviewAnalysisEpoch: 3,
  analysisSequence: 18,
  propertyProfileVersion: 4,
} as const

describe('review analysis terminal settlement', () => {
  it.each(['applied', 'replayed', 'stale'] as const)(
    'settles a no-result sequence directly through the aggregate authority: %s',
    async (status) => {
      const advanceWithoutAnalysis = vi.fn(async () => ({
        status,
        aggregateRevision: 19,
      }))
      const result = await settleReviewAnalysisWithoutResult(
        { aggregates: { advanceWithoutAnalysis } },
        { ...input, dispositionCode: 'operation_ambiguous' },
      )

      expect(advanceWithoutAnalysis).toHaveBeenCalledExactlyOnceWith({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: 2,
        reviewAnalysisEpoch: 3,
        analysisSequence: 18,
        propertyProfileVersion: 4,
        dispositionCode: 'operation_ambiguous',
      })
      expect(result.status).toBe(status === 'stale' ? 'generation_changed' : 'terminal')
    },
  )

  it.each(['applied', 'replayed', 'stale', 'unavailable'] as const)(
    'settles a stored result directly through the aggregate authority: %s',
    async (status) => {
      const applyReviewAnalysis = vi.fn(async () => ({ status, aggregateRevision: 19 }))
      const result = await settleReviewAnalysisWithResult(
        { aggregates: { applyReviewAnalysis } },
        { ...input, sourceRevision: 5 },
      )

      expect(applyReviewAnalysis).toHaveBeenCalledExactlyOnceWith({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: 2,
        sourceRevision: 5,
        reviewAnalysisEpoch: 3,
        analysisSequence: 18,
        propertyProfileVersion: 4,
        calendarProfileVersion: 'property-calendar-v1',
      })
      expect(result.status).toBe(
        status === 'stale' || status === 'unavailable'
          ? 'generation_changed'
          : 'terminal',
      )
    },
  )
})
