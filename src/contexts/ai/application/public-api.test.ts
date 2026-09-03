import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
  isReviewAnalysisRevisionSetEvidence,
} from './ports/ai-review-analysis-enrollment.port'
import {
  aiPropertyTrendGenerationRequested,
  aiReviewAnalysisBackfillRequested,
} from '../domain/events'
import { isAiError } from '../domain/errors'

describe('AI application public API', () => {
  it('exposes the supported identifier-only event constructors', () => {
    const occurredAt = new Date('2026-08-27T00:00:00.000Z')
    const organization = organizationId('org-ai-public-api')
    const property = propertyId('8a000000-0000-4000-8000-000000000001')

    expect(
      aiPropertyTrendGenerationRequested({
        scheduleId: 'schedule-ai-public-api',
        organizationId: organization,
        propertyId: property,
        occurredAt,
      }),
    ).toMatchObject({
      _tag: 'ai.property_trend.generation_requested',
      scheduleId: 'schedule-ai-public-api',
      organizationId: organization,
      propertyId: property,
      occurredAt,
      correlationId: null,
    })

    expect(
      aiReviewAnalysisBackfillRequested({
        organizationId: organization,
        propertyId: property,
        reviewId: reviewId('8a000000-0000-4000-8000-000000000002'),
        sourceEpoch: 2,
        sourceRevision: 3,
        analysisSequence: 4,
        occurredAt,
        correlationId: 'correlation-ai-public-api',
      }),
    ).toMatchObject({
      _tag: 'ai.review_analysis.backfill_requested',
      sourceEpoch: 2,
      sourceRevision: 3,
      analysisSequence: 4,
      correlationId: 'correlation-ai-public-api',
    })
  })

  it('exposes the AI error type guard without accepting arbitrary objects', () => {
    expect(isAiError({ _tag: 'AiError', code: 'forbidden', message: 'denied' })).toBe(
      true,
    )
    expect(isAiError({ code: 'forbidden', message: 'denied' })).toBe(false)
  })

  it('exposes the canonical content-free revision-set evidence guard', () => {
    expect(
      isReviewAnalysisRevisionSetEvidence({
        revisionCount: 0,
        revisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
      }),
    ).toBe(true)
    expect(
      isReviewAnalysisRevisionSetEvidence({
        revisionCount: 1,
        revisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
      }),
    ).toBe(false)
  })
})
