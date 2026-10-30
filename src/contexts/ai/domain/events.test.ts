import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  aiPropertyTrendGenerationRequested,
  aiReviewAnalysisBackfillRequested,
  aiReviewUrgentDetected,
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
    ).toThrow(/safe integer/)
  })

  it('constructs the Urgent alert fact: a review revision and the analysis, no reason', () => {
    const event = aiReviewUrgentDetected({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: reviewId('71000000-0000-4000-8000-000000000203'),
      sourceEpoch: 0,
      sourceRevision: 2,
      analysisSequence: 5,
      occurredAt: NOW,
    })

    expect(event).toMatchObject({
      _tag: 'ai.review_analysis.urgent_detected',
      correlationId: null,
      sourceEpoch: 0,
      sourceRevision: 2,
      analysisSequence: 5,
    })
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Object.keys(event).sort()).toEqual([
      '_tag',
      'analysisSequence',
      'correlationId',
      'eventId',
      'occurredAt',
      'organizationId',
      'propertyId',
      'reviewId',
      'sourceEpoch',
      'sourceRevision',
    ])
  })

  it('keeps the writer’s deterministic id for the Urgent alert fact', () => {
    const event = aiReviewUrgentDetected({
      eventId: '71000000-0000-5000-8000-000000000209',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: reviewId('71000000-0000-4000-8000-000000000203'),
      sourceEpoch: 1,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
      correlationId: 'op-1',
    })

    expect(event.eventId).toBe('71000000-0000-5000-8000-000000000209')
    expect(event.correlationId).toBe('op-1')
  })

  it.each([
    { sourceEpoch: -1, sourceRevision: 1, analysisSequence: 1 },
    { sourceEpoch: 0, sourceRevision: 0, analysisSequence: 1 },
    { sourceEpoch: 0, sourceRevision: 1, analysisSequence: 0 },
  ])('rejects invalid Urgent alert fencing values: %o', (fence) => {
    expect(() =>
      aiReviewUrgentDetected({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: reviewId('71000000-0000-4000-8000-000000000203'),
        ...fence,
        occurredAt: NOW,
      }),
    ).toThrow(/safe integer/)
  })
})
