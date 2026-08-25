import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  aiPropertyTrendGenerationRequested,
  aiReviewAnalysisBackfillRequested,
} from './events'

const NOW = new Date('2026-08-25T00:00:00.000Z')
const ORGANIZATION_ID = organizationId('org-1')
const PROPERTY_ID = propertyId('71000000-0000-4000-8000-000000000201')

describe('AI durable domain facts', () => {
  it('constructs the property-trend request with the canonical envelope', () => {
    const event = aiPropertyTrendGenerationRequested({
      scheduleId: '71000000-0000-4000-8000-000000000202',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      occurredAt: NOW,
      correlationId: 'corr-trend',
    })

    expect(event).toMatchObject({
      _tag: 'ai.property_trend.generation_requested',
      occurredAt: NOW,
      correlationId: 'corr-trend',
    })
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('constructs a fenced analysis-backfill request', () => {
    const event = aiReviewAnalysisBackfillRequested({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: reviewId('71000000-0000-4000-8000-000000000203'),
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 2,
      occurredAt: NOW,
    })

    expect(event).toMatchObject({
      _tag: 'ai.review_analysis.backfill_requested',
      correlationId: null,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 2,
    })
  })

  it.each([
    { sourceEpoch: -1, sourceRevision: 1, analysisSequence: 1 },
    { sourceEpoch: 0, sourceRevision: 0, analysisSequence: 1 },
    { sourceEpoch: 0, sourceRevision: 1, analysisSequence: 0 },
  ])('rejects invalid backfill fencing values: %o', (fence) => {
    expect(() =>
      aiReviewAnalysisBackfillRequested({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: reviewId('71000000-0000-4000-8000-000000000203'),
        ...fence,
        occurredAt: NOW,
      }),
    ).toThrow()
  })
})
